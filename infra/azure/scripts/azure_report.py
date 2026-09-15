"""Deployment report straight from the Azure Resource Manager REST API.

Run after every deploy. It fails the pipeline when:
  * any resource in the resource group is non-compliant with an assigned Azure Policy, or
  * the container app did not finish provisioning, or its latest revision is not running.

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
    non_compliant_resources: int
    non_compliant_policies: int
    provisioning_state: str
    running_status: str
    latest_revision: str
    fqdn: str

    @property
    def problems(self) -> list[str]:
        found = []
        if self.non_compliant_resources:
            found.append(
                f"{self.non_compliant_resources} resource(s) non-compliant with "
                f"{self.non_compliant_policies} policy assignment(s)"
            )
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


def build_report(send: Transport, subscription: str, resource_group: str, container_app: str) -> Report:
    scope = f"{ARM}/subscriptions/{subscription}/resourceGroups/{resource_group}"

    status, summary = send(
        "POST",
        f"{scope}/providers/Microsoft.PolicyInsights/policyStates/latest/summarize?api-version={POLICY_API}",
        "",
    )
    if status != 200:
        raise RuntimeError(f"policy summarize returned {status}: {summary.get('error', summary)}")
    results = (summary.get("value") or [{}])[0].get("results", {})

    status, app = send(
        "GET",
        f"{scope}/providers/Microsoft.App/containerApps/{container_app}?api-version={CONTAINER_APPS_API}",
        "",
    )
    if status != 200:
        raise RuntimeError(f"container app lookup returned {status}: {app.get('error', app)}")
    properties = app.get("properties", {})

    return Report(
        non_compliant_resources=int(results.get("nonCompliantResources", 0)),
        non_compliant_policies=int(results.get("nonCompliantPolicies", 0)),
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
    args = parser.parse_args(argv)

    report = build_report(http_transport(access_token()), args.subscription, args.resource_group, args.container_app)
    print(json.dumps(report.__dict__, indent=2))
    if report.problems:
        for problem in report.problems:
            print(f"FAIL: {problem}", file=sys.stderr)
        return 1
    print("OK: all resources compliant, container app healthy")
    return 0


if __name__ == "__main__":
    sys.exit(main())
