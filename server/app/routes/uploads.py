from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Request, UploadFile, status
from fastapi.responses import FileResponse

from ..errors import AppError
from ..webdeps import require_faculty

router = APIRouter(prefix="/api/uploads", tags=["uploads"])
ALLOWED_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "application/pdf": ".pdf",
}
MAX_FILE_SIZE = 5 * 1024 * 1024
FILE_ID_PATTERN = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:png|jpg|pdf)$")


def _valid_signature(data: bytes, mime_type: str) -> bool:
    if mime_type == "image/png":
        return data.startswith(b"\x89PNG\r\n\x1a\n")
    if mime_type == "image/jpeg":
        return data.startswith(b"\xff\xd8\xff")
    if mime_type == "application/pdf":
        return data.startswith(b"%PDF-")
    return False


@router.post("/", status_code=status.HTTP_201_CREATED)
async def upload_file(
    request: Request,
    _user: Annotated[dict, Depends(require_faculty)],
    file: Annotated[UploadFile | None, File()] = None,
) -> dict:
    if file is None:
        raise AppError(400, "FILE_REQUIRED", "Attach one file")
    extension = ALLOWED_TYPES.get(file.content_type or "")
    if extension is None:
        raise AppError(415, "UNSUPPORTED_FILE_TYPE", "Only PNG, JPEG and PDF files are supported")

    data = await file.read(MAX_FILE_SIZE + 1)
    if len(data) > MAX_FILE_SIZE:
        raise AppError(413, "FILE_TOO_LARGE", "Files must be 5 MB or smaller")
    if not data or not _valid_signature(data, file.content_type or ""):
        raise AppError(415, "INVALID_FILE_CONTENT", "The file content does not match its declared type")
    directory = Path(request.app.state.upload_dir)
    directory.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid.uuid4()}{extension}"
    target = directory / filename
    with target.open("xb") as destination:
        destination.write(data)
    return {
        "file": {
            "id": filename,
            "originalName": file.filename,
            "mimeType": file.content_type,
            "url": f"/api/uploads/{filename}",
        }
    }


@router.get("/{file_id}")
def get_upload(
    file_id: str,
    request: Request,
    _user: Annotated[dict, Depends(require_faculty)],
) -> FileResponse:
    if not FILE_ID_PATTERN.fullmatch(file_id):
        raise AppError(404, "NOT_FOUND", "File not found")
    target = Path(request.app.state.upload_dir) / file_id
    if not target.is_file():
        raise AppError(404, "NOT_FOUND", "File not found")
    mime_type = {".png": "image/png", ".jpg": "image/jpeg", ".pdf": "application/pdf"}[target.suffix]
    return FileResponse(
        target,
        media_type=mime_type,
        headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"},
    )
