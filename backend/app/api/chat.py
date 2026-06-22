from __future__ import annotations

from fastapi import APIRouter, File, Form, Query, UploadFile, status
from fastapi.responses import FileResponse

from app.core.dependencies import CurrentUser, DbSession, TenantOrgId
from app.core.errors import NotFoundError, ValidationError
from app.schemas.chat import (
    AddMembersRequest,
    CallAnswerRequest,
    CallEndRequest,
    CallIceRequest,
    CallOfferRequest,
    ChatChannelOut,
    ChatContactOut,
    ChatConversationOut,
    ChatMessageOut,
    ChatMessagePage,
    CreateConversationRequest,
    EditMessageRequest,
    MarkReadRequest,
    PinRequest,
    PresenceOut,
    ReactRequest,
    UnreadCountOut,
    UpdateConversationRequest,
)
from app.schemas.common import MessageResponse
from app.core.errors import ValidationError
from app.services import chat_service
from app.services.upload_storage import resolve_chat_upload_path, save_chat_upload

router = APIRouter(prefix="/api/v1/chat", tags=["chat"])

# Cap attachments per message — same-tenant abuse / disk-exhaustion guard.
_MAX_ATTACHMENTS_PER_MESSAGE = 10


# ── Conversations ─────────────────────────────────────────────────────────────
@router.get("/conversations", response_model=list[ChatConversationOut])
async def list_conversations(db: DbSession, user: CurrentUser, org_id: TenantOrgId):
    org = chat_service.require_org(org_id)
    return await chat_service.list_conversations(db, org, user.id)


@router.post(
    "/conversations",
    response_model=ChatConversationOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_conversation(
    body: CreateConversationRequest, db: DbSession, user: CurrentUser, org_id: TenantOrgId
):
    org = chat_service.require_org(org_id)
    return await chat_service.create_conversation(
        db,
        org,
        user,
        type=body.type,
        user_id=body.user_id,
        member_ids=body.member_ids,
        name=body.name,
        topic=body.topic,
    )


@router.get("/conversations/{conversation_id}", response_model=ChatConversationOut)
async def get_conversation(
    conversation_id: int, db: DbSession, user: CurrentUser, org_id: TenantOrgId
):
    org = chat_service.require_org(org_id)
    return await chat_service.conversation_detail(db, org, user.id, conversation_id)


@router.patch("/conversations/{conversation_id}", response_model=ChatConversationOut)
async def update_conversation(
    conversation_id: int,
    body: UpdateConversationRequest,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    org = chat_service.require_org(org_id)
    return await chat_service.update_conversation(
        db, org, user, conversation_id,
        name=body.name, topic=body.topic, is_archived=body.is_archived,
    )


@router.post("/conversations/{conversation_id}/members", response_model=ChatConversationOut)
async def add_members(
    conversation_id: int,
    body: AddMembersRequest,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    org = chat_service.require_org(org_id)
    return await chat_service.add_members(db, org, user, conversation_id, body.user_ids)


@router.delete(
    "/conversations/{conversation_id}/members/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_member(
    conversation_id: int,
    user_id: int,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    org = chat_service.require_org(org_id)
    await chat_service.remove_member(db, org, user, conversation_id, user_id)


@router.post("/conversations/{conversation_id}/pin", response_model=ChatConversationOut)
async def set_pinned(
    conversation_id: int,
    body: PinRequest,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    org = chat_service.require_org(org_id)
    return await chat_service.set_pinned(db, org, user, conversation_id, body.pinned)


@router.post("/conversations/{conversation_id}/read", response_model=MessageResponse)
async def mark_read(
    conversation_id: int,
    body: MarkReadRequest,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    org = chat_service.require_org(org_id)
    await chat_service.mark_read(db, org, user, conversation_id, body.last_read_message_id)
    return MessageResponse(message="ok")


@router.post(
    "/conversations/{conversation_id}/typing", status_code=status.HTTP_204_NO_CONTENT
)
async def typing(
    conversation_id: int, db: DbSession, user: CurrentUser, org_id: TenantOrgId
):
    org = chat_service.require_org(org_id)
    await chat_service.notify_typing(db, org, user, conversation_id)


# ── Messages ──────────────────────────────────────────────────────────────────
@router.get(
    "/conversations/{conversation_id}/messages", response_model=ChatMessagePage
)
async def list_messages(
    conversation_id: int,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
    before_id: int | None = Query(None),
    limit: int = Query(30, ge=1, le=100),
):
    org = chat_service.require_org(org_id)
    return await chat_service.list_messages(
        db, org, user.id, conversation_id, before_id=before_id, limit=limit
    )


@router.post(
    "/conversations/{conversation_id}/messages",
    response_model=ChatMessageOut,
    status_code=status.HTTP_201_CREATED,
)
async def send_message(
    conversation_id: int,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
    body: str = Form(""),
    reply_to_id: int | None = Form(None),
    mentions: str | None = Form(None),
    files: list[UploadFile] | None = File(None),
):
    org = chat_service.require_org(org_id)
    # Validate membership before persisting any uploaded files (avoids orphaning
    # bytes on disk for a conversation the caller can't post to).
    await chat_service.get_conversation_for_user(db, org, user.id, conversation_id)

    real_files = [f for f in (files or []) if f.filename]
    if len(real_files) > _MAX_ATTACHMENTS_PER_MESSAGE:
        raise ValidationError(
            f"Too many attachments (max {_MAX_ATTACHMENTS_PER_MESSAGE} per message)"
        )

    attachments: list[dict] = []
    for f in files or []:
        if not f.filename:
            continue
        _path, url, content_type, size, kind = save_chat_upload(org, conversation_id, f)
        attachments.append(
            {
                "url": url,
                "filename": f.filename,
                "content_type": content_type,
                "size_bytes": size,
                "kind": kind,
            }
        )

    mention_ids = _parse_id_csv(mentions)
    return await chat_service.send_message(
        db, org, user, conversation_id,
        body=body, reply_to_id=reply_to_id,
        mention_ids=mention_ids, attachments=attachments,
    )


@router.patch("/messages/{message_id}", response_model=ChatMessageOut)
async def edit_message(
    message_id: int,
    body: EditMessageRequest,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    org = chat_service.require_org(org_id)
    return await chat_service.edit_message(db, org, user, message_id, body.body)


@router.delete("/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_message(
    message_id: int, db: DbSession, user: CurrentUser, org_id: TenantOrgId
):
    org = chat_service.require_org(org_id)
    await chat_service.delete_message(db, org, user, message_id)


@router.post("/messages/{message_id}/reactions", response_model=ChatMessageOut)
async def react(
    message_id: int,
    body: ReactRequest,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    org = chat_service.require_org(org_id)
    return await chat_service.toggle_reaction(db, org, user, message_id, body.emoji)


# ── Channels ──────────────────────────────────────────────────────────────────
@router.get("/channels", response_model=list[ChatChannelOut])
async def list_channels(db: DbSession, user: CurrentUser, org_id: TenantOrgId):
    org = chat_service.require_org(org_id)
    return await chat_service.list_channels(db, org, user.id)


@router.post("/channels/{conversation_id}/join", response_model=ChatConversationOut)
async def join_channel(
    conversation_id: int, db: DbSession, user: CurrentUser, org_id: TenantOrgId
):
    org = chat_service.require_org(org_id)
    return await chat_service.join_channel(db, org, user, conversation_id)


# ── WebRTC call signaling (1:1) ───────────────────────────────────────────────
@router.post("/calls/{conversation_id}/offer", status_code=status.HTTP_204_NO_CONTENT)
async def call_offer(
    conversation_id: int,
    body: CallOfferRequest,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    org = chat_service.require_org(org_id)
    await chat_service.call_offer(db, org, user, conversation_id, body.call_id, body.sdp, body.video)


@router.post("/calls/{conversation_id}/answer", status_code=status.HTTP_204_NO_CONTENT)
async def call_answer(
    conversation_id: int,
    body: CallAnswerRequest,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    org = chat_service.require_org(org_id)
    await chat_service.call_answer(db, org, user, conversation_id, body.call_id, body.sdp)


@router.post("/calls/{conversation_id}/ice", status_code=status.HTTP_204_NO_CONTENT)
async def call_ice(
    conversation_id: int,
    body: CallIceRequest,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    org = chat_service.require_org(org_id)
    await chat_service.call_ice(db, org, user, conversation_id, body.call_id, body.candidate)


@router.post("/calls/{conversation_id}/end", status_code=status.HTTP_204_NO_CONTENT)
async def call_end(
    conversation_id: int,
    body: CallEndRequest,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
):
    org = chat_service.require_org(org_id)
    await chat_service.call_end(
        db, org, user, conversation_id, body.call_id, body.reason, body.duration_seconds
    )


# ── Directory / presence / unread ─────────────────────────────────────────────
@router.get("/contacts", response_model=list[ChatContactOut])
async def list_contacts(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantOrgId,
    search: str | None = Query(None),
):
    org = chat_service.require_org(org_id)
    return await chat_service.list_contacts(db, org, user.id, search)


@router.get("/presence", response_model=PresenceOut)
async def presence(db: DbSession, user: CurrentUser, org_id: TenantOrgId):
    org = chat_service.require_org(org_id)
    return PresenceOut(online=await chat_service.online_user_ids(org))


@router.get("/unread-count", response_model=UnreadCountOut)
async def unread_count(db: DbSession, user: CurrentUser, org_id: TenantOrgId):
    org = chat_service.require_org(org_id)
    return UnreadCountOut(total=await chat_service.unread_total(db, org, user.id))


# ── Attachment serving ────────────────────────────────────────────────────────
@router.get("/attachments/{org_id}/{conversation_id}/{filename}")
async def serve_attachment(
    org_id: int,
    conversation_id: int,
    filename: str,
    db: DbSession,
    user: CurrentUser,
    tenant_org_id: TenantOrgId,
):
    # Tenant isolation: a scoped caller may only read their own company's files.
    if tenant_org_id is not None and tenant_org_id != org_id:
        raise NotFoundError("File not found")
    # Privacy: only members of the conversation may read its attachments.
    await chat_service.get_conversation_for_user(db, org_id, user.id, conversation_id)
    path = resolve_chat_upload_path(org_id, conversation_id, filename)
    return FileResponse(path, media_type=_media_type(path.suffix.lower()))


def _parse_id_csv(value: str | None) -> list[int]:
    if not value:
        return []
    out: list[int] = []
    for part in value.split(","):
        part = part.strip()
        if part:
            try:
                out.append(int(part))
            except ValueError:
                continue
    return out


def _media_type(suffix: str) -> str:
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".pdf": "application/pdf",
        ".txt": "text/plain",
        ".csv": "text/csv",
        ".webm": "audio/webm",
        ".ogg": "audio/ogg",
        ".oga": "audio/ogg",
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".wav": "audio/wav",
    }.get(suffix, "application/octet-stream")
