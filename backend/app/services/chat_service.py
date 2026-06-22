"""Business logic for the realtime chat feature.

Conversations, messages, reactions, read state, presence and the company contact
directory. Every conversation is scoped to one company root (``organization_id``)
so chat never crosses a tenant boundary. Realtime fan-out is targeted at a
conversation's members via :func:`app.realtime.hub.emit` with ``user_ids``.

Services follow the codebase convention: take ``AsyncSession`` first, ``db.add``
+ ``await db.flush()`` (never commit — the request's ``get_db`` dependency
commits), and raise typed ``AppError`` subclasses.
"""

from __future__ import annotations

import time
from datetime import datetime, timezone

from redis.exceptions import RedisError
from sqlalchemy import and_, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import NotFoundError, PermissionDeniedError, ValidationError
from app.core.redis import get_redis
from app.middleware.tenant import descendants_subquery
from app.models.chat import (
    CONVERSATION_TYPES,
    Conversation,
    ConversationMember,
    Message,
    MessageAttachment,
    MessageMention,
    MessageReaction,
)
from app.models.user import User, user_organization
from app.realtime.hub import emit, get_hub
from app.schemas.chat import (
    ChatAttachmentOut,
    ChatChannelOut,
    ChatContactOut,
    ChatConversationOut,
    ChatMemberOut,
    ChatMessageOut,
    ChatMessagePage,
    ChatReactionOut,
    ChatReplyPreview,
    ChatUserOut,
)

_PREVIEW_LEN = 140
_MAX_BODY_LEN = 8000


def _now() -> datetime:
    return datetime.now(timezone.utc)


def require_org(org_id: int | None) -> int:
    """Chat always acts inside one concrete company; reject an unscoped caller."""
    if org_id is None:
        raise ValidationError("Select an organization to use chat")
    return org_id


def _truncate(text: str | None) -> str | None:
    if not text:
        return text
    return text if len(text) <= _PREVIEW_LEN else text[:_PREVIEW_LEN] + "…"


def _user_out(user: User | None) -> ChatUserOut | None:
    if user is None:
        return None
    return ChatUserOut(id=user.id, name=user.name, email=user.email)


# ── Lookups / batch loaders ───────────────────────────────────────────────────
async def _load_users(db: AsyncSession, ids) -> dict[int, User]:
    wanted = [i for i in {x for x in ids} if i]
    if not wanted:
        return {}
    rows = (await db.execute(select(User).where(User.id.in_(wanted)))).scalars().all()
    return {u.id: u for u in rows}


async def _member_ids(db: AsyncSession, conversation_id: int) -> list[int]:
    rows = (
        await db.execute(
            select(ConversationMember.user_id).where(
                ConversationMember.conversation_id == conversation_id
            )
        )
    ).scalars().all()
    return list(rows)


def _company_user_ids_subquery(org_id: int):
    """Subquery of every user id granted any node inside the company's sub-tree."""
    return select(user_organization.c.user_id).where(
        user_organization.c.organization_id.in_(descendants_subquery(org_id))
    )


async def _require_company_users(db: AsyncSession, org_id: int, ids) -> None:
    wanted = list({i for i in ids})
    if not wanted:
        return
    present = set(
        (
            await db.execute(
                select(user_organization.c.user_id).where(
                    user_organization.c.user_id.in_(wanted),
                    user_organization.c.organization_id.in_(descendants_subquery(org_id)),
                )
            )
        ).scalars().all()
    )
    if any(i not in present for i in wanted):
        raise ValidationError("Some users are not part of this company")


async def _get_conversation(db: AsyncSession, org_id: int, conversation_id: int) -> Conversation:
    conv = (
        await db.execute(
            select(Conversation).where(
                Conversation.id == conversation_id,
                Conversation.organization_id == org_id,
            )
        )
    ).scalar_one_or_none()
    if conv is None:
        raise NotFoundError("Conversation not found")
    return conv


async def _get_membership(
    db: AsyncSession, conversation_id: int, user_id: int
) -> ConversationMember | None:
    return (
        await db.execute(
            select(ConversationMember).where(
                ConversationMember.conversation_id == conversation_id,
                ConversationMember.user_id == user_id,
            )
        )
    ).scalar_one_or_none()


async def get_conversation_for_user(
    db: AsyncSession, org_id: int, user_id: int, conversation_id: int
) -> tuple[Conversation, ConversationMember]:
    """Load a conversation the user belongs to, or 404 (never leak existence)."""
    conv = await _get_conversation(db, org_id, conversation_id)
    membership = await _get_membership(db, conversation_id, user_id)
    if membership is None:
        raise NotFoundError("Conversation not found")
    return conv, membership


# ── Message serialization ─────────────────────────────────────────────────────
def _reactions_out(message: Message, me_id: int) -> list[ChatReactionOut]:
    by_emoji: dict[str, list[int]] = {}
    for r in message.reactions:
        by_emoji.setdefault(r.emoji, []).append(r.user_id)
    return [
        ChatReactionOut(emoji=emoji, count=len(uids), user_ids=sorted(uids), me=me_id in uids)
        for emoji, uids in by_emoji.items()
    ]


def _message_out(
    message: Message,
    me_id: int,
    users: dict[int, User],
    reply_msgs: dict[int, Message],
) -> ChatMessageOut:
    deleted = message.deleted_at is not None
    reply: ChatReplyPreview | None = None
    if message.reply_to_id and message.reply_to_id in reply_msgs:
        r = reply_msgs[message.reply_to_id]
        rs = users.get(r.sender_id) if r.sender_id else None
        reply = ChatReplyPreview(
            id=r.id,
            sender_name=rs.name if rs else None,
            body=None if r.deleted_at else _truncate(r.body),
        )
    return ChatMessageOut(
        id=message.id,
        conversation_id=message.conversation_id,
        sender=_user_out(users.get(message.sender_id)) if message.sender_id else None,
        type=message.type,
        body=None if deleted else message.body,
        reply_to=reply,
        attachments=[]
        if deleted
        else [
            ChatAttachmentOut(
                id=a.id,
                kind=a.kind,
                filename=a.filename,
                content_type=a.content_type,
                size_bytes=a.size_bytes,
                url=a.url,
            )
            for a in message.attachments
        ],
        reactions=[] if deleted else _reactions_out(message, me_id),
        mention_user_ids=[] if deleted else [m.user_id for m in message.mentions],
        edited_at=message.edited_at,
        deleted_at=message.deleted_at,
        created_at=message.created_at,
    )


async def _build_message_outs(
    db: AsyncSession, messages: list[Message], me_id: int
) -> list[ChatMessageOut]:
    if not messages:
        return []
    reply_ids = {m.reply_to_id for m in messages if m.reply_to_id}
    reply_msgs: dict[int, Message] = {}
    if reply_ids:
        rows = (
            await db.execute(select(Message).where(Message.id.in_(reply_ids)))
        ).scalars().all()
        reply_msgs = {r.id: r for r in rows}
    uids: set[int] = {m.sender_id for m in messages if m.sender_id}
    uids |= {r.sender_id for r in reply_msgs.values() if r.sender_id}
    users = await _load_users(db, uids)
    return [_message_out(m, me_id, users, reply_msgs) for m in messages]


# ── Conversation serialization ────────────────────────────────────────────────
async def _conversation_out(
    db: AsyncSession,
    conv: Conversation,
    me_id: int,
    *,
    unread: int,
    member_count: int,
    counterpart: User | None,
    last_message: ChatMessageOut | None,
    include_members: bool = False,
    my_role: str | None = None,
    joined: bool = True,
    is_pinned: bool = False,
) -> ChatConversationOut:
    name = counterpart.name if (conv.type == "direct" and counterpart) else conv.name
    members_out: list[ChatMemberOut] | None = None
    if include_members:
        rows = (
            await db.execute(
                select(ConversationMember).where(
                    ConversationMember.conversation_id == conv.id
                )
            )
        ).scalars().all()
        users = await _load_users(db, [r.user_id for r in rows])
        members_out = []
        for r in rows:
            u = users.get(r.user_id)
            members_out.append(
                ChatMemberOut(
                    user_id=r.user_id,
                    name=u.name if u else f"User {r.user_id}",
                    email=u.email if u else None,
                    role=r.role,
                    is_muted=r.is_muted,
                    last_read_message_id=r.last_read_message_id or 0,
                )
            )
    return ChatConversationOut(
        id=conv.id,
        type=conv.type,
        name=name,
        topic=conv.topic,
        is_archived=conv.is_archived,
        last_message_at=conv.last_message_at,
        created_at=conv.created_at,
        unread_count=unread,
        counterpart=_user_out(counterpart) if conv.type == "direct" else None,
        member_count=member_count,
        last_message=last_message,
        members=members_out,
        my_role=my_role,
        joined=joined,
        is_pinned=is_pinned,
    )


# ── Listing conversations ─────────────────────────────────────────────────────
async def list_conversations(
    db: AsyncSession, org_id: int, user_id: int
) -> list[ChatConversationOut]:
    pairs = (
        await db.execute(
            select(Conversation, ConversationMember)
            .join(ConversationMember, ConversationMember.conversation_id == Conversation.id)
            .where(
                ConversationMember.user_id == user_id,
                Conversation.organization_id == org_id,
            )
        )
    ).all()
    if not pairs:
        return []

    convs = [p[0] for p in pairs]
    my_membership = {p[0].id: p[1] for p in pairs}
    conv_ids = [c.id for c in convs]

    # Member counts.
    count_rows = (
        await db.execute(
            select(ConversationMember.conversation_id, func.count())
            .where(ConversationMember.conversation_id.in_(conv_ids))
            .group_by(ConversationMember.conversation_id)
        )
    ).all()
    member_count = {cid: n for cid, n in count_rows}

    # Direct counterparts (the other member of each direct conversation).
    direct_ids = [c.id for c in convs if c.type == "direct"]
    counterpart_uid: dict[int, int] = {}
    if direct_ids:
        rows = (
            await db.execute(
                select(ConversationMember.conversation_id, ConversationMember.user_id).where(
                    ConversationMember.conversation_id.in_(direct_ids),
                    ConversationMember.user_id != user_id,
                )
            )
        ).all()
        for cid, uid in rows:
            counterpart_uid.setdefault(cid, uid)

    # Latest message per conversation.
    last_rows = (
        await db.execute(
            select(Message.conversation_id, func.max(Message.id))
            .where(Message.conversation_id.in_(conv_ids))
            .group_by(Message.conversation_id)
        )
    ).all()
    last_msg_ids = [mid for _cid, mid in last_rows if mid is not None]
    last_by_conv: dict[int, ChatMessageOut] = {}
    if last_msg_ids:
        msgs = (
            await db.execute(select(Message).where(Message.id.in_(last_msg_ids)))
        ).scalars().all()
        outs = await _build_message_outs(db, msgs, user_id)
        last_by_conv = {o.conversation_id: o for o in outs}

    # Unread counts (per-conversation threshold via the membership join).
    unread_rows = (
        await db.execute(
            select(Message.conversation_id, func.count())
            .select_from(Message)
            .join(
                ConversationMember,
                and_(
                    ConversationMember.conversation_id == Message.conversation_id,
                    ConversationMember.user_id == user_id,
                ),
            )
            .where(
                Message.conversation_id.in_(conv_ids),
                Message.id > ConversationMember.last_read_message_id,
                Message.sender_id != user_id,
                Message.type != "system",
                Message.deleted_at.is_(None),
            )
            .group_by(Message.conversation_id)
        )
    ).all()
    unread = {cid: n for cid, n in unread_rows}

    counterparts = await _load_users(db, counterpart_uid.values())

    out: list[ChatConversationOut] = []
    for conv in convs:
        out.append(
            await _conversation_out(
                db,
                conv,
                user_id,
                unread=unread.get(conv.id, 0),
                member_count=member_count.get(conv.id, 0),
                counterpart=counterparts.get(counterpart_uid.get(conv.id)),
                last_message=last_by_conv.get(conv.id),
                my_role=my_membership[conv.id].role,
                is_pinned=my_membership[conv.id].is_pinned,
            )
        )
    # Pinned first, then newest activity (creation time when there are no messages).
    epoch = datetime.min.replace(tzinfo=timezone.utc)
    out.sort(key=lambda c: (c.last_message_at or c.created_at or epoch), reverse=True)
    out.sort(key=lambda c: 0 if c.is_pinned else 1)
    return out


async def conversation_detail(
    db: AsyncSession, org_id: int, user_id: int, conversation_id: int
) -> ChatConversationOut:
    conv, membership = await get_conversation_for_user(db, org_id, user_id, conversation_id)
    member_count = (
        await db.execute(
            select(func.count()).select_from(ConversationMember).where(
                ConversationMember.conversation_id == conv.id
            )
        )
    ).scalar() or 0
    counterpart = None
    if conv.type == "direct":
        other = (
            await db.execute(
                select(ConversationMember.user_id).where(
                    ConversationMember.conversation_id == conv.id,
                    ConversationMember.user_id != user_id,
                )
            )
        ).scalar_one_or_none()
        if other is not None:
            counterpart = (await _load_users(db, [other])).get(other)
    unread = await _conversation_unread(db, conv.id, membership)
    return await _conversation_out(
        db,
        conv,
        user_id,
        unread=unread,
        member_count=member_count,
        counterpart=counterpart,
        last_message=None,
        include_members=True,
        my_role=membership.role,
        is_pinned=membership.is_pinned,
    )


async def _conversation_unread(
    db: AsyncSession, conversation_id: int, membership: ConversationMember
) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(Message)
            .where(
                Message.conversation_id == conversation_id,
                Message.id > membership.last_read_message_id,
                Message.sender_id != membership.user_id,
                Message.type != "system",
                Message.deleted_at.is_(None),
            )
        )
    ).scalar() or 0


# ── Creating conversations ────────────────────────────────────────────────────
def _direct_key(a: int, b: int) -> str:
    lo, hi = sorted((a, b))
    return f"{lo}:{hi}"


async def _find_direct(db: AsyncSession, org_id: int, key: str) -> Conversation | None:
    return (
        await db.execute(
            select(Conversation).where(
                Conversation.organization_id == org_id,
                Conversation.type == "direct",
                Conversation.direct_key == key,
            )
        )
    ).scalar_one_or_none()


async def get_or_create_direct(
    db: AsyncSession, org_id: int, user_id: int, other_id: int
) -> Conversation:
    if other_id == user_id:
        raise ValidationError("Cannot start a conversation with yourself")
    await _require_company_users(db, org_id, [other_id])
    key = _direct_key(user_id, other_id)
    existing = await _find_direct(db, org_id, key)
    if existing is not None:
        return existing

    conv = Conversation(
        organization_id=org_id, type="direct", created_by=user_id, direct_key=key
    )
    try:
        async with db.begin_nested():
            db.add(conv)
            await db.flush()
    except IntegrityError:
        # Lost a race to create the same pair's direct conversation; reuse theirs.
        existing = await _find_direct(db, org_id, key)
        if existing is not None:
            return existing
        raise
    db.add_all(
        [
            ConversationMember(conversation_id=conv.id, user_id=user_id, role="member"),
            ConversationMember(conversation_id=conv.id, user_id=other_id, role="member"),
        ]
    )
    await db.flush()
    return conv


async def create_conversation(
    db: AsyncSession, org_id: int, user: User, *, type: str, user_id: int | None,
    member_ids: list[int] | None, name: str | None, topic: str | None,
) -> ChatConversationOut:
    if type not in CONVERSATION_TYPES:
        raise ValidationError("Invalid conversation type")

    if type == "direct":
        if not user_id:
            raise ValidationError("A user is required for a direct conversation")
        conv = await get_or_create_direct(db, org_id, user.id, user_id)
        await emit_conversation_changed(db, conv)
        return await conversation_detail(db, org_id, user.id, conv.id)

    clean_name = (name or "").strip()
    if not clean_name:
        raise ValidationError("A name is required")

    conv = Conversation(
        organization_id=org_id,
        type=type,
        name=clean_name[:255],
        topic=(topic or "").strip()[:500] or None,
        created_by=user.id,
    )
    db.add(conv)
    await db.flush()
    # Creator is always the owner.
    db.add(ConversationMember(conversation_id=conv.id, user_id=user.id, role="owner"))

    if type == "group":
        ids = [i for i in (member_ids or []) if i != user.id]
        if ids:
            await _require_company_users(db, org_id, ids)
            db.add_all(
                ConversationMember(conversation_id=conv.id, user_id=i, role="member")
                for i in dict.fromkeys(ids)
            )
    await db.flush()

    await emit_conversation_changed(db, conv)
    return await conversation_detail(db, org_id, user.id, conv.id)


async def update_conversation(
    db: AsyncSession, org_id: int, user: User, conversation_id: int, *,
    name: str | None, topic: str | None, is_archived: bool | None,
) -> ChatConversationOut:
    conv, membership = await get_conversation_for_user(db, org_id, user.id, conversation_id)
    if conv.type == "direct":
        raise ValidationError("Direct conversations cannot be edited")
    _require_role(membership, ("owner", "admin"), user)

    if name is not None:
        clean = name.strip()
        if not clean:
            raise ValidationError("Name cannot be empty")
        conv.name = clean[:255]
    if topic is not None:
        conv.topic = topic.strip()[:500] or None
    if is_archived is not None:
        conv.is_archived = is_archived
    await db.flush()
    await emit_conversation_changed(db, conv)
    return await conversation_detail(db, org_id, user.id, conv.id)


# ── Membership ────────────────────────────────────────────────────────────────
def _require_role(membership: ConversationMember, roles: tuple[str, ...], user: User) -> None:
    if user.has_role(settings.super_admin_role):
        return
    if membership.role not in roles:
        raise PermissionDeniedError("You do not have permission for this action")


async def add_members(
    db: AsyncSession, org_id: int, user: User, conversation_id: int, user_ids: list[int]
) -> ChatConversationOut:
    conv, membership = await get_conversation_for_user(db, org_id, user.id, conversation_id)
    if conv.type == "direct":
        raise ValidationError("Cannot add members to a direct conversation")
    _require_role(membership, ("owner", "admin"), user)

    wanted = [i for i in dict.fromkeys(user_ids) if i]
    if not wanted:
        return await conversation_detail(db, org_id, user.id, conv.id)
    await _require_company_users(db, org_id, wanted)
    existing = set(await _member_ids(db, conv.id))
    added = [i for i in wanted if i not in existing]
    if added:
        db.add_all(
            ConversationMember(conversation_id=conv.id, user_id=i, role="member")
            for i in added
        )
        await db.flush()
        names = await _load_users(db, added)
        label = ", ".join(names[i].name for i in added if i in names) or "members"
        await _post_system_message(db, conv, f"{user.name} added {label}")
    await emit_conversation_changed(db, conv)
    return await conversation_detail(db, org_id, user.id, conv.id)


async def remove_member(
    db: AsyncSession, org_id: int, user: User, conversation_id: int, target_user_id: int
) -> None:
    conv, membership = await get_conversation_for_user(db, org_id, user.id, conversation_id)
    if conv.type == "direct":
        raise ValidationError("Cannot leave a direct conversation")
    is_self = target_user_id == user.id
    if not is_self:
        _require_role(membership, ("owner", "admin"), user)

    target = await _get_membership(db, conv.id, target_user_id)
    if target is None:
        raise NotFoundError("Member not found")

    # Members notified BEFORE the row is gone so the leaver's client also refreshes.
    notify_ids = await _member_ids(db, conv.id)
    await db.delete(target)
    await db.flush()
    actor_name = (await _load_users(db, [target_user_id])).get(target_user_id)
    name = actor_name.name if actor_name else f"User {target_user_id}"
    await _post_system_message(db, conv, f"{name} left the conversation")
    await emit(
        conv.organization_id,
        "chat.conversation",
        {"conversation_id": conv.id},
        user_ids=notify_ids,
    )


# ── Channels ──────────────────────────────────────────────────────────────────
async def list_channels(
    db: AsyncSession, org_id: int, user_id: int
) -> list[ChatChannelOut]:
    channels = (
        await db.execute(
            select(Conversation)
            .where(Conversation.organization_id == org_id, Conversation.type == "channel")
            .order_by(Conversation.name)
        )
    ).scalars().all()
    if not channels:
        return []
    ids = [c.id for c in channels]
    counts = {
        cid: n
        for cid, n in (
            await db.execute(
                select(ConversationMember.conversation_id, func.count())
                .where(ConversationMember.conversation_id.in_(ids))
                .group_by(ConversationMember.conversation_id)
            )
        ).all()
    }
    joined = set(
        (
            await db.execute(
                select(ConversationMember.conversation_id).where(
                    ConversationMember.conversation_id.in_(ids),
                    ConversationMember.user_id == user_id,
                )
            )
        ).scalars().all()
    )
    return [
        ChatChannelOut(
            id=c.id,
            name=c.name,
            topic=c.topic,
            member_count=counts.get(c.id, 0),
            joined=c.id in joined,
        )
        for c in channels
    ]


async def join_channel(
    db: AsyncSession, org_id: int, user: User, conversation_id: int
) -> ChatConversationOut:
    conv = await _get_conversation(db, org_id, conversation_id)
    if conv.type != "channel":
        raise ValidationError("Only channels can be joined")
    existing = await _get_membership(db, conv.id, user.id)
    if existing is None:
        db.add(ConversationMember(conversation_id=conv.id, user_id=user.id, role="member"))
        await db.flush()
        await _post_system_message(db, conv, f"{user.name} joined")
        await emit_conversation_changed(db, conv)
    return await conversation_detail(db, org_id, user.id, conv.id)


# ── Messages ──────────────────────────────────────────────────────────────────
async def list_messages(
    db: AsyncSession, org_id: int, user_id: int, conversation_id: int, *,
    before_id: int | None, limit: int,
) -> ChatMessagePage:
    await get_conversation_for_user(db, org_id, user_id, conversation_id)
    limit = max(1, min(limit, 100))
    stmt = select(Message).where(Message.conversation_id == conversation_id)
    if before_id is not None:
        stmt = stmt.where(Message.id < before_id)
    stmt = stmt.order_by(Message.id.desc()).limit(limit + 1)
    rows = (await db.execute(stmt)).scalars().all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    rows = list(reversed(rows))  # ascending (oldest → newest) for display
    data = await _build_message_outs(db, rows, user_id)
    return ChatMessagePage(data=data, has_more=has_more)


async def send_message(
    db: AsyncSession, org_id: int, user: User, conversation_id: int, *,
    body: str | None, reply_to_id: int | None, mention_ids: list[int] | None,
    attachments: list[dict] | None,
) -> ChatMessageOut:
    conv, membership = await get_conversation_for_user(db, org_id, user.id, conversation_id)

    clean_body = (body or "").strip()
    if len(clean_body) > _MAX_BODY_LEN:
        clean_body = clean_body[:_MAX_BODY_LEN]
    attachments = attachments or []
    if not clean_body and not attachments:
        raise ValidationError("Message cannot be empty")

    if reply_to_id is not None:
        ok = (
            await db.execute(
                select(Message.id).where(
                    Message.id == reply_to_id, Message.conversation_id == conv.id
                )
            )
        ).scalar_one_or_none()
        if ok is None:
            reply_to_id = None  # stale reply target; drop quietly rather than 400

    msg = Message(
        conversation_id=conv.id,
        organization_id=conv.organization_id,
        sender_id=user.id,
        type="text",
        body=clean_body or None,
        reply_to_id=reply_to_id,
    )
    db.add(msg)
    await db.flush()

    for a in attachments:
        db.add(
            MessageAttachment(
                message_id=msg.id,
                organization_id=conv.organization_id,
                kind=a.get("kind", "file"),
                filename=a.get("filename", "file"),
                content_type=a.get("content_type", "application/octet-stream"),
                size_bytes=int(a.get("size_bytes", 0)),
                url=a["url"],
            )
        )

    member_ids = await _member_ids(db, conv.id)
    if mention_ids:
        valid = [i for i in dict.fromkeys(mention_ids) if i in set(member_ids)]
        db.add_all(MessageMention(message_id=msg.id, user_id=i) for i in valid)

    conv.last_message_at = _now()
    if conv.is_archived:
        conv.is_archived = False  # new activity resurfaces an archived thread
    # The sender has implicitly read their own message.
    membership.last_read_message_id = max(membership.last_read_message_id or 0, msg.id)
    await db.flush()
    await db.refresh(msg)

    out = (await _build_message_outs(db, [msg], user.id))[0]
    await emit(
        conv.organization_id,
        "chat.message",
        {"conversation_id": conv.id, "message": out.model_dump(mode="json")},
        user_ids=member_ids,
    )
    return out


async def _get_message_for_user(
    db: AsyncSession, org_id: int, user_id: int, message_id: int
) -> tuple[Message, Conversation, ConversationMember]:
    msg = (
        await db.execute(
            select(Message).where(
                Message.id == message_id, Message.organization_id == org_id
            )
        )
    ).scalar_one_or_none()
    if msg is None:
        raise NotFoundError("Message not found")
    conv, membership = await get_conversation_for_user(db, org_id, user_id, msg.conversation_id)
    return msg, conv, membership


async def edit_message(
    db: AsyncSession, org_id: int, user: User, message_id: int, body: str
) -> ChatMessageOut:
    msg, conv, _membership = await _get_message_for_user(db, org_id, user.id, message_id)
    if msg.deleted_at is not None:
        raise ValidationError("Cannot edit a deleted message")
    if msg.sender_id != user.id:
        raise PermissionDeniedError("You can only edit your own messages")
    clean = (body or "").strip()
    if not clean:
        raise ValidationError("Message cannot be empty")
    msg.body = clean[:_MAX_BODY_LEN]
    msg.edited_at = _now()
    await db.flush()
    return await _emit_message_updated(db, conv, msg, user.id)


async def delete_message(
    db: AsyncSession, org_id: int, user: User, message_id: int
) -> None:
    msg, conv, membership = await _get_message_for_user(db, org_id, user.id, message_id)
    if msg.deleted_at is not None:
        return
    is_owner_admin = membership.role in ("owner", "admin") or user.has_role(
        settings.super_admin_role
    )
    if msg.sender_id != user.id and not is_owner_admin:
        raise PermissionDeniedError("You can only delete your own messages")

    # Reclaim attachment storage and rows; the message becomes a tombstone.
    from app.services.upload_storage import delete_chat_file

    atts = (
        await db.execute(
            select(MessageAttachment).where(MessageAttachment.message_id == msg.id)
        )
    ).scalars().all()
    for a in atts:
        delete_chat_file(a.url)
        await db.delete(a)
    msg.deleted_at = _now()
    msg.body = None
    await db.flush()

    member_ids = await _member_ids(db, conv.id)
    await emit(
        conv.organization_id,
        "chat.message_deleted",
        {"conversation_id": conv.id, "message_id": msg.id},
        user_ids=member_ids,
    )


async def toggle_reaction(
    db: AsyncSession, org_id: int, user: User, message_id: int, emoji: str
) -> ChatMessageOut:
    msg, conv, _membership = await _get_message_for_user(db, org_id, user.id, message_id)
    if msg.deleted_at is not None:
        raise ValidationError("Cannot react to a deleted message")
    clean = (emoji or "").strip()[:32]
    if not clean:
        raise ValidationError("Invalid reaction")

    existing = (
        await db.execute(
            select(MessageReaction).where(
                MessageReaction.message_id == msg.id,
                MessageReaction.user_id == user.id,
                MessageReaction.emoji == clean,
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        await db.delete(existing)
    else:
        db.add(MessageReaction(message_id=msg.id, user_id=user.id, emoji=clean))
    await db.flush()
    await db.refresh(msg)
    return await _emit_message_updated(db, conv, msg, user.id)


async def _emit_message_updated(
    db: AsyncSession, conv: Conversation, msg: Message, me_id: int
) -> ChatMessageOut:
    out = (await _build_message_outs(db, [msg], me_id))[0]
    member_ids = await _member_ids(db, conv.id)
    await emit(
        conv.organization_id,
        "chat.message_updated",
        {"conversation_id": conv.id, "message": out.model_dump(mode="json")},
        user_ids=member_ids,
    )
    return out


# ── Read state, typing, presence, system messages ─────────────────────────────
async def mark_read(
    db: AsyncSession, org_id: int, user: User, conversation_id: int, last_read_message_id: int
) -> None:
    _conv, membership = await get_conversation_for_user(db, org_id, user.id, conversation_id)
    new_val = max(membership.last_read_message_id or 0, last_read_message_id)
    if new_val == (membership.last_read_message_id or 0):
        return
    membership.last_read_message_id = new_val
    await db.flush()
    member_ids = await _member_ids(db, conversation_id)
    await emit(
        org_id,
        "chat.read",
        {
            "conversation_id": conversation_id,
            "user_id": user.id,
            "last_read_message_id": new_val,
        },
        user_ids=member_ids,
    )


async def set_pinned(
    db: AsyncSession, org_id: int, user: User, conversation_id: int, pinned: bool
) -> ChatConversationOut:
    _conv, membership = await get_conversation_for_user(db, org_id, user.id, conversation_id)
    membership.is_pinned = pinned
    await db.flush()
    return await conversation_detail(db, org_id, user.id, conversation_id)


async def notify_typing(
    db: AsyncSession, org_id: int, user: User, conversation_id: int
) -> None:
    _conv, _membership = await get_conversation_for_user(db, org_id, user.id, conversation_id)
    others = [i for i in await _member_ids(db, conversation_id) if i != user.id]
    if not others:
        return
    await emit(
        org_id,
        "chat.typing",
        {"conversation_id": conversation_id, "user_id": user.id, "name": user.name},
        user_ids=others,
    )


# ── WebRTC call signaling ─────────────────────────────────────────────────────
# 1:1 calls only. The realtime hub relays SDP/ICE between the two participants
# (HTTP in -> targeted ws event out); media flows peer-to-peer over WebRTC. The
# party that ends the call posts a single call-history system message.
def _require_direct_call(conv: Conversation) -> None:
    if conv.type != "direct":
        raise ValidationError("Calls are only supported in direct conversations")


async def _call_others(db: AsyncSession, conv: Conversation, user_id: int) -> list[int]:
    return [i for i in await _member_ids(db, conv.id) if i != user_id]


async def _relay_call(
    db: AsyncSession, org_id: int, user: User, conversation_id: int,
    event: str, payload: dict,
) -> Conversation:
    conv, _membership = await get_conversation_for_user(db, org_id, user.id, conversation_id)
    _require_direct_call(conv)
    others = await _call_others(db, conv, user.id)
    await emit(
        conv.organization_id,
        event,
        {"conversation_id": conv.id, "from_user": {"id": user.id, "name": user.name}, **payload},
        user_ids=others,
    )
    return conv


async def call_offer(
    db: AsyncSession, org_id: int, user: User, conversation_id: int,
    call_id: str, sdp: dict, video: bool,
) -> None:
    await _relay_call(
        db, org_id, user, conversation_id, "chat.call.offer",
        {"call_id": call_id, "sdp": sdp, "video": video},
    )


async def call_answer(
    db: AsyncSession, org_id: int, user: User, conversation_id: int, call_id: str, sdp: dict,
) -> None:
    await _relay_call(
        db, org_id, user, conversation_id, "chat.call.answer", {"call_id": call_id, "sdp": sdp}
    )


async def call_ice(
    db: AsyncSession, org_id: int, user: User, conversation_id: int, call_id: str, candidate: dict,
) -> None:
    await _relay_call(
        db, org_id, user, conversation_id, "chat.call.ice",
        {"call_id": call_id, "candidate": candidate},
    )


# Dedupe call-history posts per call_id so glare / both-parties-ending a call
# produces exactly one log entry. Redis-backed (cross-worker) with an in-process
# fallback when Redis is disabled.
_CALL_HISTORY_TTL = 3600
_call_history_seen: dict[str, float] = {}


async def _claim_call_history(call_id: str) -> bool:
    """True only the first time ``call_id`` is claimed within the TTL window."""
    redis = get_redis()
    if redis is not None:
        try:
            return bool(await redis.set(f"chat:call:hist:{call_id}", "1", nx=True, ex=_CALL_HISTORY_TTL))
        except RedisError:
            return True  # best-effort: don't drop the log on a Redis blip
    now = time.monotonic()
    for k, t in list(_call_history_seen.items()):
        if now - t > _CALL_HISTORY_TTL:
            _call_history_seen.pop(k, None)
    if call_id in _call_history_seen:
        return False
    _call_history_seen[call_id] = now
    return True


def _fmt_duration(seconds: int) -> str:
    return f"{seconds // 60}:{seconds % 60:02d}"


def _call_history_text(reason: str, duration_seconds: int | None) -> str | None:
    if reason == "hangup":
        dur = duration_seconds if (duration_seconds and 0 < duration_seconds <= 86_400) else None
        return f"📞 Call ended · {_fmt_duration(dur)}" if dur else "📞 Call ended"
    if reason == "reject":
        return "📞 Call declined"
    if reason in ("cancel", "unanswered"):
        return "📞 Missed call"
    if reason == "busy":
        return "📞 Line busy"
    if reason == "failed":
        return "📞 Call failed"
    return None


async def call_end(
    db: AsyncSession, org_id: int, user: User, conversation_id: int,
    call_id: str, reason: str, duration_seconds: int | None,
) -> None:
    conv = await _relay_call(
        db, org_id, user, conversation_id, "chat.call.end",
        {"call_id": call_id, "reason": reason},
    )
    # One call-history entry per call_id — dedupe handles glare / both parties
    # ending (which legitimately each POST /end for the same call).
    text = _call_history_text(reason, duration_seconds)
    if text and await _claim_call_history(call_id):
        await _post_system_message(db, conv, text)


async def _post_system_message(db: AsyncSession, conv: Conversation, text: str) -> None:
    msg = Message(
        conversation_id=conv.id,
        organization_id=conv.organization_id,
        sender_id=None,
        type="system",
        body=text,
    )
    db.add(msg)
    conv.last_message_at = _now()
    await db.flush()
    # Eager-load the selectin relationships before serializing — accessing them
    # unloaded would emit a lazy SELECT outside the async greenlet context.
    await db.refresh(msg)
    out = (await _build_message_outs(db, [msg], 0))[0]
    member_ids = await _member_ids(db, conv.id)
    await emit(
        conv.organization_id,
        "chat.message",
        {"conversation_id": conv.id, "message": out.model_dump(mode="json")},
        user_ids=member_ids,
    )


async def emit_conversation_changed(db: AsyncSession, conv: Conversation) -> None:
    """Tell every current member to refresh their conversation list."""
    member_ids = await _member_ids(db, conv.id)
    await emit(
        conv.organization_id,
        "chat.conversation",
        {"conversation_id": conv.id},
        user_ids=member_ids,
    )


# ── Directory & misc ──────────────────────────────────────────────────────────
async def list_contacts(
    db: AsyncSession, org_id: int, user_id: int, search: str | None
) -> list[ChatContactOut]:
    stmt = (
        select(User)
        .where(User.id.in_(_company_user_ids_subquery(org_id)), User.is_active == True)  # noqa: E712
        .where(User.id != user_id)
        .order_by(User.name)
        .limit(100)
    )
    if search and (term := search.strip()):
        like = f"%{term}%"
        from sqlalchemy import or_

        stmt = stmt.where(or_(User.name.ilike(like), User.email.ilike(like)))
    users = (await db.execute(stmt)).scalars().all()
    online = set(await get_hub().online_user_ids(org_id))
    return [
        ChatContactOut(id=u.id, name=u.name, email=u.email, online=u.id in online)
        for u in users
    ]


async def online_user_ids(org_id: int) -> list[int]:
    return await get_hub().online_user_ids(org_id)


async def unread_total(db: AsyncSession, org_id: int, user_id: int) -> int:
    return (
        await db.execute(
            select(func.count())
            .select_from(Message)
            .join(
                ConversationMember,
                and_(
                    ConversationMember.conversation_id == Message.conversation_id,
                    ConversationMember.user_id == user_id,
                ),
            )
            .join(Conversation, Conversation.id == Message.conversation_id)
            .where(
                Conversation.organization_id == org_id,
                Message.id > ConversationMember.last_read_message_id,
                Message.sender_id != user_id,
                Message.type != "system",
                Message.deleted_at.is_(None),
            )
        )
    ).scalar() or 0
