"""Add realtime chat tables.

Direct/group/channel conversations, membership + per-thread read state, messages
(text + system), attachments, reactions and @mentions. Every row is scoped to a
company root (``organization_id``) so chat never crosses a tenant boundary.

PostgreSQL only (the SQLite test harness builds from the models). Forward-only.

Revision ID: o1c2d3e4f5a6
Revises: n0b1c2d3e4f5
Create Date: 2026-06-19
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "o1c2d3e4f5a6"
down_revision: Union[str, None] = "n0b1c2d3e4f5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "chat_conversations",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=True),
        sa.Column("topic", sa.String(length=500), nullable=True),
        sa.Column("is_archived", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("last_message_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("direct_key", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "direct_key", name="uq_chat_direct_key"),
    )
    op.create_index(
        "ix_chat_conversations_org_type", "chat_conversations", ["organization_id", "type"]
    )
    op.create_index(
        "ix_chat_conversations_org_last_msg",
        "chat_conversations",
        ["organization_id", "last_message_at"],
    )

    op.create_table(
        "chat_conversation_members",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("conversation_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("role", sa.String(length=16), server_default="member", nullable=False),
        sa.Column("last_read_message_id", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_muted", sa.Boolean(), server_default="0", nullable=False),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["conversation_id"], ["chat_conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("conversation_id", "user_id", name="uq_chat_member"),
    )
    op.create_index("ix_chat_members_user", "chat_conversation_members", ["user_id"])

    op.create_table(
        "chat_messages",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("conversation_id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("sender_id", sa.Integer(), nullable=True),
        sa.Column("type", sa.String(length=16), server_default="text", nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("reply_to_id", sa.Integer(), nullable=True),
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["conversation_id"], ["chat_conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sender_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["reply_to_id"], ["chat_messages.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_messages_conv_id", "chat_messages", ["conversation_id", "id"])
    op.create_index("ix_chat_messages_org", "chat_messages", ["organization_id"])

    op.create_table(
        "chat_attachments",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("message_id", sa.Integer(), nullable=False),
        sa.Column("organization_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), server_default="file", nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column(
            "content_type",
            sa.String(length=128),
            server_default="application/octet-stream",
            nullable=False,
        ),
        sa.Column("size_bytes", sa.Integer(), server_default="0", nullable=False),
        sa.Column("url", sa.String(length=512), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["message_id"], ["chat_messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_chat_attachments_message", "chat_attachments", ["message_id"])

    op.create_table(
        "chat_reactions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("message_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("emoji", sa.String(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["message_id"], ["chat_messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", "user_id", "emoji", name="uq_chat_reaction"),
    )
    op.create_index("ix_chat_reactions_message", "chat_reactions", ["message_id"])

    op.create_table(
        "chat_mentions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("message_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["message_id"], ["chat_messages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id", "user_id", name="uq_chat_mention"),
    )
    op.create_index("ix_chat_mentions_user", "chat_mentions", ["user_id"])


def downgrade() -> None:
    raise NotImplementedError(
        "Forward-only: drop the chat_* tables from a pre-migration backup if a "
        "rollback is required."
    )
