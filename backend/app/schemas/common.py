from typing import Generic, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


class MessageResponse(BaseModel):
    message: str


class PaginatedResponse(BaseModel, Generic[T]):
    """Paginator JSON shape (compatible with the React admin UI)."""

    data: list[T]
    current_page: int
    last_page: int
    per_page: int
    total: int
