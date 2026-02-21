from collections.abc import Callable
from typing import TypeVar

from sqlalchemy.orm import Query

T = TypeVar("T")


def paginate_query(
    query: Query,
    *,
    page: int | None,
    page_size: int = 20,
    max_page_size: int = 200,
) -> tuple[list[T], int, int, int] | list[T]:
    if page is None:
        return query.all()

    safe_page = max(1, page)
    safe_page_size = max(1, min(page_size, max_page_size))
    total = query.count()
    items = query.offset((safe_page - 1) * safe_page_size).limit(safe_page_size).all()
    return items, total, safe_page, safe_page_size


def build_paged_response(
    *,
    items: list[T],
    total: int,
    page: int,
    page_size: int,
    serializer: Callable[[T], dict] | None = None,
) -> dict:
    if serializer is None:
        serialized = items
    else:
        serialized = [serializer(item) for item in items]
    return {
        "items": serialized,
        "total": total,
        "page": page,
        "page_size": page_size,
    }
