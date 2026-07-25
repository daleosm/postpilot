"""Password and opaque-session helpers compatible with the current live data."""

from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from urllib.parse import urlsplit, urlunsplit

SCRYPT_KEY_LENGTH = 64
SCRYPT_N = 2**14
SCRYPT_R = 8
SCRYPT_P = 1


def _decode_base64url(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _encode_base64url(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def hash_node_scrypt_password(password: str) -> str:
    """Create a salted hash compatible with the pre-cutover Node verifier.

    The seed already contains Node-format hashes. Keeping the same format lets
    a future password-management endpoint update a user without a forced
    credential migration during the staged API cutover.
    """
    salt = secrets.token_bytes(16)
    derived = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=SCRYPT_N,
        r=SCRYPT_R,
        p=SCRYPT_P,
        dklen=SCRYPT_KEY_LENGTH,
    )
    return f"scrypt${_encode_base64url(salt)}${_encode_base64url(derived)}"


def verify_node_scrypt_password(password: str, password_hash: str | None) -> bool:
    """Verify the `scrypt$salt$key` hashes made by Node's crypto.scrypt()."""
    if not password_hash:
        return False
    algorithm, separator, encoded = password_hash.partition("$")
    if algorithm != "scrypt" or not separator:
        return False
    salt, separator, expected_key = encoded.partition("$")
    if not salt or not separator or not expected_key:
        return False
    try:
        derived = hashlib.scrypt(
            password.encode("utf-8"),
            salt=_decode_base64url(salt),
            n=SCRYPT_N,
            r=SCRYPT_R,
            p=SCRYPT_P,
            dklen=SCRYPT_KEY_LENGTH,
        )
        return hmac.compare_digest(derived, _decode_base64url(expected_key))
    except (TypeError, ValueError):
        return False


def new_session_token() -> str:
    return secrets.token_urlsafe(48)


def hash_session_token(token: str, session_secret: str | None = None) -> str:
    """Return a non-reversible database value for an opaque browser token.

    The keyed form is used by the API. The optional unkeyed form keeps this
    helper convenient for deterministic compatibility tests.
    """
    if session_secret:
        return hmac.new(session_secret.encode("utf-8"), token.encode("utf-8"), hashlib.sha256).hexdigest()
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def safe_callback_path(value: str | None) -> str:
    """Accept only a same-origin relative application path after sign-in."""
    if not value or not value.startswith("/") or value.startswith("//"):
        return "/"
    parsed = urlsplit(value)
    return (
        urlunsplit(("", "", parsed.path or "/", parsed.query, "")) if not parsed.scheme and not parsed.netloc else "/"
    )


def safe_auth_redirect(value: str | None, base_url: str) -> str:
    path = safe_callback_path(value)
    base = urlsplit(base_url)
    return urlunsplit((base.scheme, base.netloc, path, "", ""))
