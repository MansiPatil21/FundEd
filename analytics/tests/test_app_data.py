from datetime import datetime, timezone

import pytest
from bson import ObjectId

from funded_elt.app_data import ALLOWED_FIELDS, extract, to_record

SENSITIVE = {"email", "passwordHash", "displayName", "googleId", "label", "employer", "permitNumber", "institution"}

USER = {
    "_id": ObjectId("6aa751fe7598268395e1dd6c"),
    "email": "student@example.com",
    "passwordHash": "scrypt$32768$8$1$c2FsdA==$a2V5",
    "displayName": "Mansi Patil",
    "homeCurrency": "INR",
    "localCurrency": "CAD",
    "permit": {"institution": "Dalhousie", "permitNumber": "F123456789", "weeklyHourCap": 24},
    "createdAt": datetime(2026, 9, 13, 20, 15),
}


def _all_keys(value):
    if isinstance(value, dict):
        return set(value) | {key for item in value.values() for key in _all_keys(item)}
    return set()


def test_keeps_only_allowlisted_fields_and_never_personal_data():
    identifier, record = to_record("users", USER)

    assert identifier == "6aa751fe7598268395e1dd6c"
    assert record == {
        "homeCurrency": "INR",
        "localCurrency": "CAD",
        "weeklyHourCap": 24,
        "createdAt": "2026-09-13T20:15:00+00:00",
    }
    assert not _all_keys(record) & SENSITIVE


def test_free_text_the_student_typed_is_not_copied():
    _, obligation = to_record(
        "obligations",
        {"_id": "o1", "userId": "u1", "label": "Rent for Mom's place", "amountMinor": 50000, "currency": "INR", "cadence": "MONTHLY"},
    )
    _, shift = to_record("shifts", {"_id": "s1", "userId": "u1", "employer": "Tim Hortons", "onCampus": False})

    assert "label" not in obligation
    assert "employer" not in shift


def test_converts_bson_types_to_json():
    _, record = to_record(
        "fx_alerts",
        {
            "_id": ObjectId("6aa751fe7598268395e1dd6d"),
            "userId": ObjectId("6aa751fe7598268395e1dd6c"),
            "targetRate": 68.5,
            "direction": "AT_OR_ABOVE",
            "triggeredAt": None,
            "createdAt": datetime(2026, 9, 1, 12, 0, tzinfo=timezone.utc),
        },
    )

    assert record["userId"] == "6aa751fe7598268395e1dd6c"
    assert record["triggeredAt"] is None
    assert record["createdAt"] == "2026-09-01T12:00:00+00:00"


class _FakeCollection:
    def __init__(self, documents):
        self.documents = documents
        self.projection = None

    def find(self, filter, projection, batch_size):
        self.projection = projection
        return iter(self.documents)  # deliberately ignores the projection


def test_asks_mongodb_for_allowlisted_fields_and_filters_anyway():
    users = _FakeCollection([USER])

    records = list(extract({"users": users}, "users"))

    assert set(users.projection) == set(ALLOWED_FIELDS["users"])
    assert not _all_keys(records[0][1]) & SENSITIVE


def test_a_document_without_an_id_is_an_error():
    with pytest.raises(ValueError, match="no _id"):
        to_record("deadlines", {"kind": "TUITION"})


def test_only_known_collections_can_be_extracted():
    with pytest.raises(KeyError):
        to_record("transfer_plans", {"_id": "p1"})
