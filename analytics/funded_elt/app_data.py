"""Extract FundEd's application data from MongoDB, keeping only the fields analytics needs.

Privacy is an allowlist, enforced twice. The MongoDB query projects only the allowed fields, so
email addresses, password hashes, names, permit numbers and free-text labels never leave the
database. `to_record` then filters again, so a projection that was ignored or mistyped still
cannot leak a field into the warehouse.
"""

from __future__ import annotations

from collections.abc import Iterator, Mapping
from datetime import datetime, timezone
from typing import Any, Protocol

# Collection -> fields copied into the warehouse. A dotted path reads a nested field and is
# stored under its last segment, so permit.weeklyHourCap arrives as weeklyHourCap.
ALLOWED_FIELDS: dict[str, tuple[str, ...]] = {
    "users": ("_id", "homeCurrency", "localCurrency", "permit.weeklyHourCap", "createdAt", "onboardedAt"),
    "shifts": ("_id", "userId", "startedAt", "endedAt", "onCampus", "createdAt"),
    "obligations": ("_id", "userId", "amountMinor", "currency", "cadence", "nextDueOn", "createdAt"),
    "deadlines": ("_id", "userId", "kind", "dueOn", "completedAt"),
    "fx_alerts": ("_id", "userId", "baseCurrency", "quoteCurrency", "targetRate", "direction", "triggeredAt", "createdAt"),
}

_MISSING = object()


class _Collection(Protocol):
    def find(self, filter: Mapping[str, Any], projection: Mapping[str, int], batch_size: int) -> Any: ...


class _Database(Protocol):
    def __getitem__(self, name: str) -> _Collection: ...


def _read_path(document: Mapping[str, Any], path: str) -> Any:
    value: Any = document
    for part in path.split("."):
        if not isinstance(value, Mapping) or part not in value:
            return _MISSING
        value = value[part]
    return value


def _to_json_value(value: Any) -> Any:
    if isinstance(value, datetime):
        # MongoDB returns naive datetimes that are UTC; say so explicitly.
        aware = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return aware.astimezone(timezone.utc).isoformat()
    if isinstance(value, Mapping):
        return {str(key): _to_json_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_to_json_value(item) for item in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    # ObjectId and any other BSON type become their string form.
    return str(value)


def to_record(collection: str, document: Mapping[str, Any]) -> tuple[str, dict[str, Any]]:
    """Returns the document's id and a JSON-safe record holding only allowlisted fields."""
    fields = ALLOWED_FIELDS[collection]
    identifier = _read_path(document, "_id")
    if identifier is _MISSING:
        raise ValueError(f"{collection} document has no _id")

    record: dict[str, Any] = {}
    for field in fields:
        if field == "_id":
            continue
        value = _read_path(document, field)
        if value is not _MISSING:
            record[field.rsplit(".", 1)[-1]] = _to_json_value(value)
    return str(identifier), record


def extract(database: _Database, collection: str, batch_size: int = 1000) -> Iterator[tuple[str, dict[str, Any]]]:
    """Streams every document of a collection as (id, record), in batches."""
    projection = {field: 1 for field in ALLOWED_FIELDS[collection]}
    for document in database[collection].find({}, projection=projection, batch_size=batch_size):
        yield to_record(collection, document)
