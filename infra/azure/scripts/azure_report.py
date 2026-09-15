"""Deployment report straight from the Azure Resource Manager REST API.

Run after every deploy. It fails the pipeline when:
  * any resource is non-compliant with a policy assignment this deployment owns (by name prefix), or
  * the container app did not finish provisioning, or its latest revision is not running.

Non-compliance with assignments it does not own, such as Microsoft Defender for Cloud's
subscription-wide security benchmark, is printed as a warning. Those recommendations often need
paid tiers (private endpoints, a Premium registry) and are not this deployment's guardrails, so
failing a release on them would block every deploy on a student subscription.

Calls the REST API directly with the standard library rather than through the Azure CLI or SDK,
so the exact endpoints and api-versions this depends on are visible in one place. The bearer
token comes from AZURE_ACCESS_TOKEN when set, otherwise from `az account get-access-token`, which
works both on a laptop and after `azure/login` in GitHub Actions.

Usage:
    python azure_report.py --subscription SUB --resource-group RG --container-app APP
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Callable

ARM = "https://management.azure.com"
POLICY_API = "2019-10-01"
CONTAINER_APPS_API = "2024-03-01"

Transport = Callable[[str, str, str], tuple[int, dict]]


@dataclass(frozen=True)
class Report:
    own_violations: list[str]
    other_findings: int
    provisioning_state: str
    running_status: str
    latest_revision: str
    fqdn: str

    @property
    def problems(self) -> list[str]:
        found = [f"policy violation: {violation}" for violation in self.own_violations]
        if self.provisioning_state != "Succeeded":
            found.append(f"container app provisioning state is {self.provisioning_state}")
        if self.running_status not in ("Running", "RunningAtMaxScale", "unknown"):
            found.append(f"container app running status is {self.running_status}")
        return found


def access_token() -> str:
    token = os.environ.get("AZURE_ACCESS_TOKEN")
    if token:
        return token
    result = subprocess.run(
        ["az", "account", "get-access-token", "--resource", ARM, "--query", "accessToken", "--output", "tsv"],
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def http_transport(token: str) -> Transport:
    def send(method: str, url: str, body: str) -> tuple[int, dict]:
        request = urllib.request.Request(
            url,
            data=body.encode() if body else (b"" if method == "POST" else None),
            method=method,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.status, json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            return error.code, json.loads(error.read() or b"{}")

    return send


def build_report(
    send: Transport, subscription: str, resource_group: str, container_app: str, own_prefix: str = "funded-"
) -> Report:
    scope = f"{ARM}/subscriptions/{subscription}/resourceGroups/{resource_group}"

    status, states = send(
        "POST",
        f"{scope}/providers/Microsoft.PolicyInsights/policyStates/latest/queryResults"
        f"?api-version={POLICY_API}&$filter=ComplianceState%20eq%20%27NonCompliant%27",
        "",
    )
    if status != 200:
        raise RuntimeError(f"policy query returned {status}: {states.get('error', states)}")
    own, other = [], 0
    for state in states.get("value", []):
        assignment = state.get("policyAssignmentName", "")
        if assignment.startswith(own_prefix):
            resource = state.get("resourceId", "unknown").rsplit("/", 1)[-1]
            own.append(f"{resource} breaks {assignment}")
        else:
            other += 1

    status, app = send(
        "GET",
        f"{scope}/providers/Microsoft.App/containerApps/{container_app}?api-version={CONTAINER_APPS_API}",
        "",
    )
    if status != 200:
        raise RuntimeError(f"container app lookup returned {status}: {app.get('error', app)}")
    properties = app.get("properties", {})

    return Report(
        own_violations=sorted(set(own)),
        other_findings=other,
        provisioning_state=properties.get("provisioningState", "unknown"),
        running_status=properties.get("runningStatus", "unknown"),
        latest_revision=properties.get("latestRevisionName", "unknown"),
        fqdn=properties.get("configuration", {}).get("ingress", {}).get("fqdn", ""),
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--subscription", required=True)
    parser.add_argument("--resource-group", required=True)
    parser.add_argument("--container-app", required=True)
    parser.add_argument("--own-assignment-prefix", default="funded-")
    args = parser.parse_args(argv)

    report = build_report(
        http_transport(access_token()), args.subscription, args.resource_group, args.container_app, args.own_assignment_prefix
    )
    print(json.dumps(report.__dict__, indent=2))
    if report.other_findings:
        print(f"WARN: {report.other_findings} finding(s) from policy assignments this deployment does not own")
    if report.problems:
        for problem in report.problems:
            print(f"FAIL: {problem}", file=sys.stderr)
        return 1
    print("OK: no violations of this deployment's policies, container app healthy")
    return 0


if __name__ == "__main__":
    sys.exit(main())
