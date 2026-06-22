"""End-to-end-ish tests for the chat service against real SQLite.

Exercises the non-trivial SQL (per-conversation unread via the membership join,
conversation listing, reactions) and the tenant/membership guards.
"""

from __future__ import annotations

import pytest
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.errors import NotFoundError, ValidationError
from app.models.organization import Organization
from app.models.user import Role, User, user_organization
from app.services import chat_service


async def _make_org(db, name="Acme", code="ACME") -> Organization:
    org = Organization(name=name, code=code, parent_id=None, is_active=True)
    db.add(org)
    await db.flush()
    return org


async def _make_user(db, org_id: int, name: str, email: str) -> User:
    user = User(name=name, email=email, password="x")
    db.add(user)
    await db.flush()
    await db.execute(
        user_organization.insert().values(user_id=user.id, organization_id=org_id)
    )
    await db.flush()
    # Re-load with roles eagerly (mirrors get_current_user) so has_role() never
    # triggers a lazy load outside the async greenlet context.
    return (
        await db.execute(
            select(User)
            .options(selectinload(User.roles).selectinload(Role.permissions))
            .where(User.id == user.id)
        )
    ).scalar_one()


@pytest.mark.asyncio
async def test_direct_conversation_send_unread_and_read(db_session):
    db = db_session
    org = await _make_org(db)
    alice = await _make_user(db, org.id, "Alice", "alice@acme.test")
    bob = await _make_user(db, org.id, "Bob", "bob@acme.test")

    # Alice opens a DM with Bob.
    conv = await chat_service.create_conversation(
        db, org.id, alice, type="direct", user_id=bob.id, member_ids=None,
        name=None, topic=None,
    )
    assert conv.type == "direct"
    assert conv.counterpart and conv.counterpart.id == bob.id
    assert conv.name == "Bob"  # direct name is the counterpart

    # Re-opening returns the same conversation (single row per pair).
    conv2 = await chat_service.create_conversation(
        db, org.id, bob, type="direct", user_id=alice.id, member_ids=None,
        name=None, topic=None,
    )
    assert conv2.id == conv.id

    # Alice sends two messages.
    await chat_service.send_message(
        db, org.id, alice, conv.id, body="hello", reply_to_id=None,
        mention_ids=None, attachments=None,
    )
    m2 = await chat_service.send_message(
        db, org.id, alice, conv.id, body="you there?", reply_to_id=None,
        mention_ids=None, attachments=None,
    )

    # Bob sees 2 unread; Alice (the sender) sees 0.
    bob_list = await chat_service.list_conversations(db, org.id, bob.id)
    assert len(bob_list) == 1
    assert bob_list[0].unread_count == 2
    assert bob_list[0].last_message and bob_list[0].last_message.body == "you there?"

    alice_list = await chat_service.list_conversations(db, org.id, alice.id)
    assert alice_list[0].unread_count == 0

    assert await chat_service.unread_total(db, org.id, bob.id) == 2

    # Bob reads up to the latest message → unread clears.
    await chat_service.mark_read(db, org.id, bob, conv.id, m2.id)
    assert await chat_service.unread_total(db, org.id, bob.id) == 0
    bob_list = await chat_service.list_conversations(db, org.id, bob.id)
    assert bob_list[0].unread_count == 0


@pytest.mark.asyncio
async def test_reactions_toggle(db_session):
    db = db_session
    org = await _make_org(db)
    alice = await _make_user(db, org.id, "Alice", "alice@acme.test")
    bob = await _make_user(db, org.id, "Bob", "bob@acme.test")
    conv = await chat_service.create_conversation(
        db, org.id, alice, type="direct", user_id=bob.id, member_ids=None,
        name=None, topic=None,
    )
    msg = await chat_service.send_message(
        db, org.id, alice, conv.id, body="hi", reply_to_id=None,
        mention_ids=None, attachments=None,
    )

    out = await chat_service.toggle_reaction(db, org.id, bob, msg.id, "👍")
    assert out.reactions and out.reactions[0].emoji == "👍"
    assert out.reactions[0].count == 1 and out.reactions[0].me is True

    out = await chat_service.toggle_reaction(db, org.id, bob, msg.id, "👍")
    assert out.reactions == []  # toggled off


@pytest.mark.asyncio
async def test_group_and_membership(db_session):
    db = db_session
    org = await _make_org(db)
    alice = await _make_user(db, org.id, "Alice", "alice@acme.test")
    bob = await _make_user(db, org.id, "Bob", "bob@acme.test")
    carol = await _make_user(db, org.id, "Carol", "carol@acme.test")

    conv = await chat_service.create_conversation(
        db, org.id, alice, type="group", user_id=None, member_ids=[bob.id],
        name="Project X", topic="planning",
    )
    assert conv.type == "group" and conv.member_count == 2
    assert conv.my_role == "owner"

    # Bob (a member, not owner) cannot add members.
    from app.core.errors import PermissionDeniedError

    with pytest.raises(PermissionDeniedError):
        await chat_service.add_members(db, org.id, bob, conv.id, [carol.id])

    # Alice can.
    conv = await chat_service.add_members(db, org.id, alice, conv.id, [carol.id])
    assert conv.member_count == 3

    # Carol can leave herself.
    await chat_service.remove_member(db, org.id, carol, conv.id, carol.id)
    detail = await chat_service.conversation_detail(db, org.id, alice.id, conv.id)
    assert detail.member_count == 2


@pytest.mark.asyncio
async def test_channels_join(db_session):
    db = db_session
    org = await _make_org(db)
    alice = await _make_user(db, org.id, "Alice", "alice@acme.test")
    bob = await _make_user(db, org.id, "Bob", "bob@acme.test")

    channel = await chat_service.create_conversation(
        db, org.id, alice, type="channel", user_id=None, member_ids=None,
        name="general", topic="company-wide",
    )
    # Bob discovers the channel and is not yet joined.
    channels = await chat_service.list_channels(db, org.id, bob.id)
    assert len(channels) == 1 and channels[0].joined is False

    await chat_service.join_channel(db, org.id, bob, channel.id)
    channels = await chat_service.list_channels(db, org.id, bob.id)
    assert channels[0].joined is True and channels[0].member_count == 2


@pytest.mark.asyncio
async def test_tenant_isolation_blocks_cross_company(db_session):
    db = db_session
    org_a = await _make_org(db, name="Acme", code="ACME")
    org_b = await _make_org(db, name="Globex", code="GLOBEX")
    alice = await _make_user(db, org_a.id, "Alice", "alice@acme.test")
    mallory = await _make_user(db, org_b.id, "Mallory", "mallory@globex.test")

    # Cannot DM a user from another company.
    with pytest.raises(ValidationError):
        await chat_service.create_conversation(
            db, org_a.id, alice, type="direct", user_id=mallory.id,
            member_ids=None, name=None, topic=None,
        )

    conv = await chat_service.create_conversation(
        db, org_a.id, alice, type="channel", user_id=None, member_ids=None,
        name="acme-only", topic=None,
    )
    # A caller scoped to org B cannot see org A's conversation.
    with pytest.raises(NotFoundError):
        await chat_service.conversation_detail(db, org_b.id, alice.id, conv.id)


@pytest.mark.asyncio
async def test_hub_presence_transitions():
    """Online/offline fire only on the first/last socket, per company root."""
    from app.realtime.hub import RealtimeHub

    hub = RealtimeHub()
    # First socket for user 1 in org 10 -> a single online transition.
    assert await hub.presence_connect(1, {10}) == [10]
    # A second tab adds no new transition; user stays online.
    assert await hub.presence_connect(1, {10}) == []
    assert await hub.online_user_ids(10) == [1]
    # Closing one tab keeps the user online (no offline transition)...
    assert await hub.presence_disconnect(1, {10}) == []
    assert await hub.online_user_ids(10) == [1]
    # ...closing the last tab retracts presence exactly once.
    assert await hub.presence_disconnect(1, {10}) == [10]
    assert await hub.online_user_ids(10) == []
    # A multi-company connection announces/retracts per root.
    assert sorted(await hub.presence_connect(2, {10, 20})) == [10, 20]
    assert await hub.online_user_ids(20) == [2]
    assert sorted(await hub.presence_disconnect(2, {10, 20})) == [10, 20]
    assert await hub.online_user_ids(20) == []


@pytest.mark.asyncio
async def test_system_message_does_not_mark_unread(db_session):
    """Join/leave system notices must not bump unread counts."""
    db = db_session
    org = await _make_org(db)
    alice = await _make_user(db, org.id, "Alice", "alice@acme.test")
    bob = await _make_user(db, org.id, "Bob", "bob@acme.test")
    carol = await _make_user(db, org.id, "Carol", "carol@acme.test")

    group = await chat_service.create_conversation(
        db, org.id, alice, type="group", user_id=None, member_ids=[bob.id],
        name="Team", topic=None,
    )
    # Adding Carol posts a "X added Carol" system message.
    await chat_service.add_members(db, org.id, alice, group.id, [carol.id])
    # That system message must not register as unread for Bob.
    assert await chat_service.unread_total(db, org.id, bob.id) == 0


@pytest.mark.asyncio
async def test_call_end_posts_history_and_requires_direct(db_session):
    db = db_session
    org = await _make_org(db)
    alice = await _make_user(db, org.id, "Alice", "alice@acme.test")
    bob = await _make_user(db, org.id, "Bob", "bob@acme.test")

    direct = await chat_service.create_conversation(
        db, org.id, alice, type="direct", user_id=bob.id, member_ids=None,
        name=None, topic=None,
    )
    # A completed call posts a single call-history system message...
    await chat_service.call_end(db, org.id, alice, direct.id, "call-1", "hangup", 83)
    msgs = await chat_service.list_messages(db, org.id, alice.id, direct.id, before_id=None, limit=50)
    system = [m for m in msgs.data if m.type == "system"]
    assert any("1:23" in (m.body or "") for m in system)
    # ...and it does not count as unread for Bob (system messages never do).
    assert await chat_service.unread_total(db, org.id, bob.id) == 0

    # Calls are 1:1 only — a group conversation is rejected.
    group = await chat_service.create_conversation(
        db, org.id, alice, type="group", user_id=None, member_ids=[bob.id],
        name="Team", topic=None,
    )
    with pytest.raises(ValidationError):
        await chat_service.call_offer(db, org.id, alice, group.id, "call-2", {"type": "offer"}, True)


@pytest.mark.asyncio
async def test_pin_sorts_first_and_sets_flag(db_session):
    db = db_session
    org = await _make_org(db)
    alice = await _make_user(db, org.id, "Alice", "alice@acme.test")
    bob = await _make_user(db, org.id, "Bob", "bob@acme.test")
    carol = await _make_user(db, org.id, "Carol", "carol@acme.test")

    group = await chat_service.create_conversation(
        db, org.id, alice, type="group", user_id=None, member_ids=[carol.id],
        name="Team", topic=None,
    )
    direct = await chat_service.create_conversation(
        db, org.id, alice, type="direct", user_id=bob.id, member_ids=None,
        name=None, topic=None,
    )
    # A fresh message makes the direct conversation the most recent by default.
    await chat_service.send_message(
        db, org.id, alice, direct.id, body="hi", reply_to_id=None,
        mention_ids=None, attachments=None,
    )
    listed = await chat_service.list_conversations(db, org.id, alice.id)
    assert listed[0].id == direct.id  # newest activity first

    # Pinning the group floats it to the top and flips the flag.
    pinned = await chat_service.set_pinned(db, org.id, alice, group.id, True)
    assert pinned.is_pinned is True
    listed = await chat_service.list_conversations(db, org.id, alice.id)
    assert listed[0].id == group.id and listed[0].is_pinned is True
    assert listed[1].id == direct.id and listed[1].is_pinned is False


@pytest.mark.asyncio
async def test_member_payload_includes_last_read(db_session):
    db = db_session
    org = await _make_org(db)
    alice = await _make_user(db, org.id, "Alice", "alice@acme.test")
    bob = await _make_user(db, org.id, "Bob", "bob@acme.test")
    conv = await chat_service.create_conversation(
        db, org.id, alice, type="direct", user_id=bob.id, member_ids=None,
        name=None, topic=None,
    )
    msg = await chat_service.send_message(
        db, org.id, alice, conv.id, body="hello", reply_to_id=None,
        mention_ids=None, attachments=None,
    )
    await chat_service.mark_read(db, org.id, bob, conv.id, msg.id)
    detail = await chat_service.conversation_detail(db, org.id, alice.id, conv.id)
    by_user = {m.user_id: m for m in (detail.members or [])}
    # Bob has read up to the message → seen-count math on the client can use this.
    assert by_user[bob.id].last_read_message_id >= msg.id


@pytest.mark.asyncio
async def test_contacts_excludes_self_and_other_company(db_session):
    db = db_session
    org_a = await _make_org(db, name="Acme", code="ACME")
    org_b = await _make_org(db, name="Globex", code="GLOBEX")
    alice = await _make_user(db, org_a.id, "Alice", "alice@acme.test")
    bob = await _make_user(db, org_a.id, "Bob", "bob@acme.test")
    await _make_user(db, org_b.id, "Mallory", "mallory@globex.test")

    contacts = await chat_service.list_contacts(db, org_a.id, alice.id, None)
    ids = {c.id for c in contacts}
    assert bob.id in ids
    assert alice.id not in ids  # self excluded
    assert len(ids) == 1  # Mallory (other company) excluded
