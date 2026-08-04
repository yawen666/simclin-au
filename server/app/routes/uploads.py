from __future__ import annotations

import uuid
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Depends, File, Request, UploadFile, status

from ..errors import AppError
from ..webdeps import require_faculty

router = APIRouter(prefix="/api/uploads", tags=["uploads"])
ALLOWED_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "application/pdf": ".pdf",
}
MAX_FILE_SIZE = 5 * 1024 * 1024


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
            "url": f"/uploads/{filename}",
        }
    }
