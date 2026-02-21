import csv
import io
from collections.abc import Iterable
from typing import Any

from fastapi.responses import Response
from openpyxl import Workbook


def csv_attachment_response(
    *,
    filename: str,
    header: list[str],
    rows: Iterable[Iterable[Any]],
) -> Response:
    out = io.StringIO()
    writer = csv.writer(out)
    writer.writerow(header)
    for row in rows:
        writer.writerow(list(row))
    return Response(
        content=out.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


def xlsx_attachment_response(
    *,
    filename: str,
    sheet_name: str,
    header: list[str],
    rows: Iterable[Iterable[Any]],
) -> Response:
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_name
    ws.append(header)
    for row in rows:
        ws.append(list(row))

    out = io.BytesIO()
    wb.save(out)
    out.seek(0)
    return Response(
        content=out.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
