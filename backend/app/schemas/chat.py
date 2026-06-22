from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


# ── Shared building blocks ────────────────────────────────────────────────────
class ChatUserOut(BaseModel):
    id: int
    name: str
    email: str | None = None


class ChatAttachmentOut(BaseModel):
    id: int
    kind: str  # 'image' | 'file' | 'audio'
    filename: str
    content_type: str
    size_bytes: int
    url: str


class ChatReactionOut(BaseModel):
    emoji: str
    count: int
    user_ids: list[int]
    # True when the requesting user is among ``user_ids``.
    me: bool


class ChatReplyPreview(BaseModel):
    id: int
    sender_name: str | None = None
    body: str | None = None


class ChatMessageOut(BaseModel):
    id: int
    conversation_id: int
    sender: ChatUserOut | None = None
    type: str  # 'text' | 'system'
    body: str | None = None
    reply_to: ChatReplyPreview | None = None
    attachments: list[ChatAttachmentOut] = Field(default_factory=list)
    reactions: list[ChatReactionOut] = Field(default_factory=list)
    mention_user_ids: list[int] = Field(default_factory=list)
    edited_at: datetime | None = None
    deleted_at: datetime | None = None
    created_at: datetime | None = None


class ChatMessagePage(BaseModel):
    """A page of messages in ascending id order (oldest → newest)."""

    data: list[ChatMessageOut]
    has_more: bool


class ChatMemberOut(BaseModel):
    user_id: int
    name: str
    email: str | None = None
    role: str
    is_muted: bool = False
    # Highest message id this member has read — drives per-message "seen" counts.
    last_read_message_id: int = 0


class ChatConversationOut(BaseModel):
    id: int
    type: str  # 'direct' | 'group' | 'channel'
    # For group/channel: the conversation name. For direct: the counterpart's name.
    name: str | None = None
    topic: str | None = None
    is_archived: bool = False
    last_message_at: datetime | None = None
    created_at: datetime | None = None
    unread_count: int = 0
    # The other participant for a direct conversation; null for group/channel.
    counterpart: ChatUserOut | None = None
    member_count: int = 0
    last_message: ChatMessageOut | None = None
    # Populated on the detail endpoint only.
    members: list[ChatMemberOut] | None = None
    my_role: str | None = None
    # True when the requesting user is a member (always true except for an
    # un-joined channel surfaced by the channel browser).
    joined: bool = True
    # Whether the requesting user has pinned this conversation.
    is_pinned: bool = False


class ChatChannelOut(BaseModel):
    id: int
    name: str | None = None
    topic: str | None = None
    member_count: int = 0
    joined: bool = False


class ChatContactOut(BaseModel):
    id: int
    name: str
    email: str | None = None
    online: bool = False


# ── Request bodies ────────────────────────────────────────────────────────────
class CreateConversationRequest(BaseModel):
    type: str  # 'direct' | 'group' | 'channel'
    # direct: the other user. group: the initial members. name/topic: group & channel.
    user_id: int | None = None
    member_ids: list[int] | None = None
    name: str | None = None
    topic: str | None = None


class UpdateConversationRequest(BaseModel):
    name: str | None = None
    topic: str | None = None
    is_archived: bool | None = None


class AddMembersRequest(BaseModel):
    user_ids: list[int]


class EditMessageRequest(BaseModel):
    body: str


class ReactRequest(BaseModel):
    emoji: str


class MarkReadRequest(BaseModel):
    last_read_message_id: int


class PinRequest(BaseModel):
    pinned: bool


# ── WebRTC call signaling ─────────────────────────────────────────────────────
class CallOfferRequest(BaseModel):
    call_id: str
    sdp: dict[str, Any]  # RTCSessionDescription JSON: {type, sdp}
    video: bool = True


class CallAnswerRequest(BaseModel):
    call_id: str
    sdp: dict[str, Any]


class CallIceRequest(BaseModel):
    call_id: str
    candidate: dict[str, Any]  # RTCIceCandidate JSON


class CallEndRequest(BaseModel):
    call_id: str
    reason: Literal["hangup", "reject", "cancel", "busy", "unanswered", "failed"] = "hangup"
    duration_seconds: int | None = Field(default=None, ge=0, le=86_400)


# ── Misc responses ────────────────────────────────────────────────────────────
class PresenceOut(BaseModel):
    online: list[int]


class UnreadCountOut(BaseModel):
    total: int
