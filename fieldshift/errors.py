"""Domain errors that map cleanly onto HTTP responses."""
from __future__ import annotations


class FieldShiftError(Exception):
    status_code = 500
    code = "internal_error"

    def __init__(self, message: str, *, detail: str | None = None, hint: str | None = None):
        super().__init__(message)
        self.message = message
        self.detail = detail
        self.hint = hint

    def to_dict(self) -> dict:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "detail": self.detail,
                "hint": self.hint,
            }
        }


class InvalidCoordinates(FieldShiftError):
    status_code = 400
    code = "invalid_coordinates"


class InvalidDateRange(FieldShiftError):
    status_code = 400
    code = "invalid_date_range"


class InvalidParameter(FieldShiftError):
    status_code = 400
    code = "invalid_parameter"


class PowerTimeout(FieldShiftError):
    status_code = 504
    code = "power_timeout"


class PowerUnavailable(FieldShiftError):
    status_code = 502
    code = "power_unavailable"


class PowerNoData(FieldShiftError):
    status_code = 404
    code = "power_no_data"


class NotFound(FieldShiftError):
    status_code = 404
    code = "not_found"
