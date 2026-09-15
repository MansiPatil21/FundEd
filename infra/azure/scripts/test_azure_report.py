"""Tests for the ARM REST API report, against a fake transport rather than a live subscription."""

from __future__ import annotations

import pytest

from azure_report import Report, build_report

SUB, RG, APP = "sub-123", "rg-funded-dev", "ca-funded-optimizer"
HEALTHY_APP = {
    "properties": {
        "provisioningState": "Succeeded",
        "runningStatus": "Running",
        "latestRevisionName": "ca-funded-optimizer--abc123",
        "configuration": {"ingress": {"fqdn": "ca-funded-optimizer.example.azurecontainerapps.io"}},
    }
}


def state(assignment, resource):
    return {"policyAssignmentName": assignment, "resourceId": f"/subscriptions/{SUB}/resourceGroups/{RG}/providers/x/{resource}"}


def fake_transport(policy=(200, {"value": []}), app=(200, HEALTHY_APP)):
    calls = []

    def send(method, url, body):
        calls.append((method, url))
        return policy if "policyStates" in url else app

    return send, calls


def test_a_healthy_compliant_deployment_has_no_problems():
    send, calls = fake_transport()

    report = build_report(send, SUB, RG, APP)

    assert report.problems == []
    assert report.latest_revision == "ca-funded-optimizer--abc123"
    method, url = calls[0]
    assert method == "POST"
    assert url.startswith(
        f"https://management.azure.com/subscriptions/{SUB}/resourceGroups/{RG}"
        "/providers/Microsoft.PolicyInsights/policyStates/latest/queryResults?api-version=2019-10-01"
    )
    assert "ComplianceState%20eq%20%27NonCompliant%27" in url
    assert calls[1][1].endswith(f"/providers/Microsoft.App/containerApps/{APP}?api-version=2024-03-01")


def test_violations_of_this_deployments_own_policies_fail_the_report():
    send, _ = fake_transport(policy=(200, {"value": [state("funded-require-project-tag", "untagged-thing")]}))

    report = build_report(send, SUB, RG, APP)

    assert report.problems == ["policy violation: untagged-thing breaks funded-require-project-tag"]


def test_findings_from_policies_it_does_not_own_are_counted_but_do_not_fail():
    # Reproduces the first real run: Defender for Cloud's benchmark flagged the registry and vault.
    send, _ = fake_transport(policy=(200, {"value": [
        state("SecurityCenterBuiltIn", "acrfundeddevkp57s"),
        state("SecurityCenterBuiltIn", "kv-funded-dev-kp57s"),
    ]}))

    report = build_report(send, SUB, RG, APP)

    assert report.problems == []
    assert report.other_findings == 2


def test_the_same_resource_breaking_the_same_policy_twice_is_reported_once():
    duplicate = state("funded-allowed-locations", "thing")
    send, _ = fake_transport(policy=(200, {"value": [duplicate, duplicate]}))

    assert build_report(send, SUB, RG, APP).own_violations == ["thing breaks funded-allowed-locations"]


def test_a_failed_provisioning_state_is_reported():
    send, _ = fake_transport(app=(200, {"properties": {"provisioningState": "Failed", "runningStatus": "Stopped"}}))

    problems = build_report(send, SUB, RG, APP).problems

    assert "container app provisioning state is Failed" in problems
    assert "container app running status is Stopped" in problems


@pytest.mark.parametrize("which", ["policy", "app"])
def test_an_api_error_raises_with_the_status(which):
    error = (403, {"error": {"code": "AuthorizationFailed"}})
    send, _ = fake_transport(**{which: error})

    with pytest.raises(RuntimeError, match="403"):
        build_report(send, SUB, RG, APP)


def test_scale_to_zero_with_no_running_status_is_not_a_failure():
    assert Report([], 0, "Succeeded", "unknown", "rev", "fqdn").problems == []
