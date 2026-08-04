from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import json
import time
from typing import Any

from .errors import AppError


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def create_token(payload: dict[str, Any], secret: str, expires_seconds: int = 12 * 60 * 60) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    claims = {**payload, "iat": int(time.time()), "exp": int(time.time()) + expires_seconds}
    encoded_header = _b64encode(json.dumps(header, separators=(",", ":")).encode())
    encoded_claims = _b64encode(json.dumps(claims, separators=(",", ":")).encode())
    signing_input = f"{encoded_header}.{encoded_claims}".encode()
    signature = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
    return f"{encoded_header}.{encoded_claims}.{_b64encode(signature)}"


def decode_token(token: str, secret: str) -> dict[str, Any]:
    try:
        encoded_header, encoded_claims, encoded_signature = token.split(".")
        signing_input = f"{encoded_header}.{encoded_claims}".encode()
        expected = hmac.new(secret.encode(), signing_input, hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64decode(encoded_signature)):
            raise ValueError("invalid signature")
        header = json.loads(_b64decode(encoded_header))
        claims = json.loads(_b64decode(encoded_claims))
        if header.get("alg") != "HS256" or int(claims.get("exp", 0)) <= int(time.time()):
            raise ValueError("expired or unsupported token")
        return claims
    except (binascii.Error, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise AppError(401, "UNAUTHORIZED", "A valid session token is required") from exc
