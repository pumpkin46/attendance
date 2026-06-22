from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status

from app.core.dependencies import (
    CurrentUser,
    DbSession,
    TenantNodeScope,
    TenantOrgId,
    TenantScope,
    get_rfid_reader,
    require_permission,
)
from app.core.pagination import PaginatedResponse, PaginationDep, paginate
from app.core.rate_limit import recognition_rate_limit
from app.models.rfid import RfidReader
from app.schemas.rfid import (
    DeviceTapResponse,
    RfidCardCreate,
    RfidCardOut,
    RfidEventOut,
    RfidReaderCreate,
    RfidReaderCreatedOut,
    RfidReaderOut,
    RfidReaderUpdate,
    RfidTokenRegeneratedOut,
    SimulateRequest,
    SimulateTapResponse,
    TapRequest,
)
from app.services import rfid_service

router = APIRouter(prefix="/api/v1", tags=["rfid"])


def _ip(request: Request) -> str | None:
    return request.client.host if request.client else None


# ── Reader CRUD ───────────────────────────────────────────────────────────────


@router.get("/rfid-readers", response_model=list[RfidReaderOut])
async def list_readers(
    db: DbSession,
    user: CurrentUser,
    org_id: TenantScope,
    _: require_permission("rfid.manage"),
):
    return await rfid_service.list_readers(db, org_id)


@router.post("/rfid-readers", response_model=RfidReaderCreatedOut, status_code=status.HTTP_201_CREATED)
async def create_reader(
    body: RfidReaderCreate,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("rfid.manage"),
):
    out, token = await rfid_service.create_reader(
        db, org_id, body, user_id=user.id, ip_address=_ip(request)
    )
    return RfidReaderCreatedOut(**out.model_dump(), api_token_plain=token)


@router.get("/rfid-readers/{reader_id}", response_model=RfidReaderOut)
async def get_reader(reader_id: int, db: DbSession, user: CurrentUser, org_id: TenantScope):
    return await rfid_service.get_reader_out(db, reader_id, org_id)


@router.put("/rfid-readers/{reader_id}", response_model=RfidReaderOut)
async def update_reader(
    reader_id: int,
    body: RfidReaderUpdate,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("rfid.manage"),
):
    return await rfid_service.update_reader(
        db, reader_id, org_id, body, user_id=user.id, ip_address=_ip(request)
    )


@router.delete("/rfid-readers/{reader_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_reader(
    reader_id: int,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("rfid.manage"),
):
    await rfid_service.deactivate_reader(
        db, reader_id, org_id, user_id=user.id, ip_address=_ip(request)
    )
    return None


@router.post("/rfid-readers/{reader_id}/regenerate-token", response_model=RfidTokenRegeneratedOut)
async def regenerate_reader_token(
    reader_id: int,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("rfid.manage"),
):
    return await rfid_service.regenerate_token(
        db, reader_id, org_id, user_id=user.id, ip_address=_ip(request)
    )


# ── RFID Cards ────────────────────────────────────────────────────────────────


@router.get("/employees/{employee_id}/rfid-cards", response_model=list[RfidCardOut])
async def list_employee_cards(
    employee_id: int,
    db: DbSession,
    user: CurrentUser,
    org_id: TenantScope,
    node_scope: TenantNodeScope,
):
    return await rfid_service.list_employee_cards(
        db, employee_id, org_id, node_scope=node_scope
    )


@router.post(
    "/employees/{employee_id}/rfid-cards",
    response_model=RfidCardOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_employee_card(
    employee_id: int,
    body: RfidCardCreate,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    node_scope: TenantNodeScope,
    user: require_permission("rfid.manage"),
):
    return await rfid_service.add_employee_card(
        db,
        employee_id,
        org_id,
        body,
        user_id=user.id,
        ip_address=_ip(request),
        node_scope=node_scope,
    )


@router.delete("/rfid-cards/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_card(
    card_id: int,
    request: Request,
    db: DbSession,
    org_id: TenantOrgId,
    node_scope: TenantNodeScope,
    user: require_permission("rfid.manage"),
):
    await rfid_service.revoke_card(
        db,
        card_id,
        org_id,
        user_id=user.id,
        ip_address=_ip(request),
        node_scope=node_scope,
    )
    return None


# ── RFID Events ───────────────────────────────────────────────────────────────


@router.get("/rfid-events", response_model=PaginatedResponse[RfidEventOut])
async def list_rfid_events(
    db: DbSession,
    org_id: TenantScope,
    pagination: PaginationDep,
    _: require_permission("rfid.manage"),
):
    stmt = rfid_service.events_query(org_id)
    page = await paginate(db, stmt, pagination.page, pagination.per_page)
    page.data = [rfid_service.format_event(e) for e in page.data]
    return page


# ── Tap endpoints ─────────────────────────────────────────────────────────────


@router.post("/rfid/simulate", response_model=SimulateTapResponse)
async def simulate_tap(
    body: SimulateRequest,
    db: DbSession,
    org_id: TenantOrgId,
    user: require_permission("rfid.manage"),
):
    reader = await rfid_service.get_reader_or_404(db, body.rfid_reader_id, org_id)
    return await rfid_service.process_tap(db, body.uid, reader, body.timestamp)


@router.post(
    "/rfid/tap",
    response_model=DeviceTapResponse,
    dependencies=[recognition_rate_limit()],
)
async def rfid_tap(
    body: TapRequest,
    db: DbSession,
    reader: RfidReader = Depends(get_rfid_reader),
):
    return await rfid_service.process_tap(db, body.uid, reader, body.timestamp)
