"""Tests for the ARM REST API report, against a fake transport rather than a live subscription."""

from __future__ import annotations

import pytest

from azure_report import Report, build_report

SUB, RG, APP = "sub-123", "rg-funded-dev", "ca-funded-optimizer"


def fake_transport(policy=(200, None), app=(200, None)):
    calls = []

    def send(method, url, body):
        calls.append((method, url))
        if "policyStates" in url:
            status, payload = policy
            return status, payload if payload is not None else {"value": [{"results": {"nonCompliantResources": 0, "nonCompliantPolicies": 0}}]}
        status, payload = app
        return status, payload if payload is not None else {
            "properties": {
                "provisioningState": "Succeeded",
                "runningStatus": "Running",
                "latestRevisionName": "ca-funded-optimizer--abc123",
                "configuration": {"ingress": {"fqdn": "ca-funded-optimizer.example.azurecontainerapps.io"}},
            }
        }

    return send, calls


def test_a_healthy_compliant_deployment_has_no_problems():
    send, calls = fake_transport()

    report = build_report(send, SUB, RG, APP)

    assert report.problems == []
    assert report.latest_revision == "ca-funded-optimizer--abc123"
    assert calls[0] == (
        "POST",
        f"https://management.azure.com/subscriptions/{SUB}/resourceGroups/{RG}"
        "/providers/Microsoft.PolicyInsights/policyStates/latest/summarize?api-version=2019-10-01",
    )
    assert calls[1][0] == "GET"
    assert calls[1][1].endswith(f"/providers/Microsoft.App/containerApps/{APP}?api-version=2024-03-01")


def test_non_compliant_resources_are_reported():
    send, _ = fake_transport(policy=(200, {"value": [{"results": {"nonCompliantResources": 2, "nonCompliantPolicies": 1}}]}))

    report = build_report(send, SUB, RG, APP)

    assert report.problems == ["2 resource(s) non-compliant with 1 policy assignment(s)"]


def test_a_failed_provisioning_state_is_reported():
    send, _ = fake_transport(app=(200, {"properties": {"provisioningState": "Failed", "runningStatus": "Stopped"}}))

    problems = build_report(send, SUB, RG, APP).problems

    assert "container app provisioning state is Failed" in problems
    assert "container app running status is Stopped" in problems


def test_an_empty_policy_summary_counts_as_compliant():
    send, _ = fake_transport(policy=(200, {"value": []}))

    assert build_report(send, SUB, RG, APP).non_compliant_resources == 0


@pytest.mark.parametrize("which", ["policy", "app"])
def test_an_api_error_raises_with_the_status(which):
    error = (403, {"error": {"code": "AuthorizationFailed"}})
    send, _ = fake_transport(**{which: error})

    with pytest.raises(RuntimeError, match="403"):
        build_report(send, SUB, RG, APP)


def test_scale_to_zero_with_no_running_status_is_not_a_failure():
    report = Report(0, 0, "Succeeded", "unknown", "rev", "fqdn")
    assert report.problems == []
