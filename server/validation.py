"""Input validation for everything a visitor can type or send."""

import re
import unicodedata

NAME_MIN = 1
NAME_MAX = 32
_EXTRA_NAME_CHARS = set(" -_.'")
_TOKEN_RE = re.compile(r"^[A-Za-z0-9_-]{16,64}$")


class ValidationError(ValueError):
    def __init__(self, field, message):
        super().__init__(message)
        self.field = field
        self.message = message


def clean_name(value):
    """Normalise and validate a designation. Returns the cleaned name."""
    if not isinstance(value, str):
        raise ValidationError("name", "Designation must be text.")
    name = unicodedata.normalize("NFKC", value)
    name = " ".join(name.split())  # trim and collapse all whitespace
    if len(name) < NAME_MIN:
        raise ValidationError("name", "Designation cannot be empty.")
    if len(name) > NAME_MAX:
        raise ValidationError("name", f"Designation must be at most {NAME_MAX} characters.")
    for ch in name:
        cat = unicodedata.category(ch)
        if ch in _EXTRA_NAME_CHARS or cat[0] in ("L", "N") or cat in ("Mn", "Mc"):
            continue
        raise ValidationError(
            "name",
            "Designation may only use letters, numbers, spaces and - _ . '",
        )
    if not any(unicodedata.category(ch)[0] in ("L", "N") for ch in name):
        raise ValidationError("name", "Designation needs at least one letter or number.")
    return name


def clean_token(value, field="token"):
    """Validate an optional opaque token. Returns it, or None when absent."""
    if value is None or value == "":
        return None
    if not isinstance(value, str) or not _TOKEN_RE.match(value):
        raise ValidationError(field, "Malformed token.")
    return value


def bearer_token(header):
    if not header:
        return None
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise ValidationError("authorization", "Expected 'Authorization: Bearer <token>'.")
    return clean_token(token.strip(), "authorization")
