from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin

# Conversation kinds. ``direct`` is a 1:1 DM (a single row per user pair, keyed by
# ``direct_key``); ``group`` is an invite-only multi-person thread; ``channel`` is
# a company-wide topic any member of the company may discover and join.
CONVERSATION_TYPES = ("direct", "group", "channel")

# Membership roles within a conversation (distinct from the platform RBAC roles).
MEMBER_ROLES = ("owner", "admin", "member")


class Conversation(Base, TimestampMixin):
    """A chat thread, scoped to one company (the tenant root ``organization_id``)."""

    __tablename__ = "chat_conversations"
    __table_args__ = (
        Index("ix_chat_conversations_org_type", "organization_id", "type"),
        Index("ix_chat_conversations_org_last_msg", "organization_id", "last_message_at"),
        # One direct conversation per unordered user pair within a company. NULL for
        # group/channel rows (NULLs are distinct in a UNIQUE index on both PG/SQLite,
        # so groups/channels never collide here).
        UniqueConstraint("organization_id", "direct_key", name="uq_chat_direct_key"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    organization_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE")
    )
    type: Mapped[str] = mapped_column(String(16))
    name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    topic: Mapped[str | None] = mapped_column(String(500), nullable=True)
    is_archived: Mapped[bool] = mapped_column(Boolean, server_default="0")
    created_by: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    # Sort key for the conversation list; bumped on every new message.
    last_message_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # "minUserId:maxUserId" for direct conversations; NULL otherwise.
    direct_key: Mapped[str | None] = mapped_column(String(64), nullable=True)

    members: Mapped[list["ConversationMember"]] = relationship(
        "ConversationMember",
        back_populates="conversation",
        lazy="noload",
        cascade="all, delete-orphan",
    )


class ConversationMember(Base, TimestampMixin):
    """A user's membership in a conversation, plus their per-thread read state."""

    __tablename__ = "chat_conversation_members"
    __table_args__ = (
        UniqueConstraint("conversation_id", "user_id", name="uq_chat_member"),
        Index("ix_chat_members_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("chat_conversations.id", ondelete="CASCADE")
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE")
    )
    role: Mapped[str] = mapped_column(String(16), server_default="member")
    # Highest message id this member has read; unread = messages with a larger id
    # (from someone else). A plain int (not an FK) so message deletes never touch it.
    last_read_message_id: Mapped[int] = mapped_column(Integer, server_default="0")
    is_muted: Mapped[bool] = mapped_column(Boolean, server_default="0")
    # Per-member pin: pinned conversations sort to the top of that user's list.
    is_pinned: Mapped[bool] = mapped_column(Boolean, server_default="0")
    joined_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=True
    )

    conversation: Mapped["Conversation"] = relationship(
        "Conversation", back_populates="members", lazy="noload"
    )


class Message(Base, TimestampMixin):
    """A single chat message. ``organization_id`` is denormalised from the
    conversation so message/attachment reads carry a direct tenant filter."""

    __tablename__ = "chat_messages"
    __table_args__ = (
        Index("ix_chat_messages_conv_id", "conversation_id", "id"),
        Index("ix_chat_messages_org", "organization_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    conversation_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("chat_conversations.id", ondelete="CASCADE")
    )
    organization_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE")
    )
    sender_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    type: Mapped[str] = mapped_column(String(16), server_default="text")
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    reply_to_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("chat_messages.id", ondelete="SET NULL"), nullable=True
    )
    edited_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # Soft delete: body is cleared and a tombstone shown so reply context survives.
    deleted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    attachments: Mapped[list["MessageAttachment"]] = relationship(
        "MessageAttachment", lazy="selectin", cascade="all, delete-orphan"
    )
    reactions: Mapped[list["MessageReaction"]] = relationship(
        "MessageReaction", lazy="selectin", cascade="all, delete-orphan"
    )
    mentions: Mapped[list["MessageMention"]] = relationship(
        "MessageMention", lazy="selectin", cascade="all, delete-orphan"
    )


class MessageAttachment(Base, TimestampMixin):
    __tablename__ = "chat_attachments"
    __table_args__ = (Index("ix_chat_attachments_message", "message_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("chat_messages.id", ondelete="CASCADE")
    )
    organization_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("organizations.id", ondelete="CASCADE")
    )
    # 'image' (rendered inline) or 'file' (download chip).
    kind: Mapped[str] = mapped_column(String(16), server_default="file")
    filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(128), server_default="application/octet-stream")
    size_bytes: Mapped[int] = mapped_column(Integer, server_default="0")
    url: Mapped[str] = mapped_column(String(512))


class MessageReaction(Base, TimestampMixin):
    __tablename__ = "chat_reactions"
    __table_args__ = (
        UniqueConstraint("message_id", "user_id", "emoji", name="uq_chat_reaction"),
        Index("ix_chat_reactions_message", "message_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("chat_messages.id", ondelete="CASCADE")
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE")
    )
    emoji: Mapped[str] = mapped_column(String(32))


class MessageMention(Base, TimestampMixin):
    """Records an @mention so the mentioned user can be notified/highlighted."""

    __tablename__ = "chat_mentions"
    __table_args__ = (
        UniqueConstraint("message_id", "user_id", name="uq_chat_mention"),
        Index("ix_chat_mentions_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("chat_messages.id", ondelete="CASCADE")
    )
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE")
    )
