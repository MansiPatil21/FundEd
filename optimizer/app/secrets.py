"""Where the optimiser's shared API key comes from.

In order of precedence:
  1. OPTIMIZER_API_KEY, set directly. Local runs, tests, and any host without Key Vault.
  2. Azure Key Vault, when KEY_VAULT_URL is set. The key is read at runtime with the container's
     managed identity, so the value never appears in app configuration, image, or Terraform output.
  3. Neither: no key is required.

Key Vault is read over its REST API with the standard library rather than the Azure SDK, which
would add four packages to the image for two HTTP calls. The value is cached for five minutes, so
rotating the secret in the vault takes effect without a redeploy, and a solve does not wait on two
network round trips every time.
"""

from __future__ import annotations

import json
import os
import threading
import time
import urllib.parse
import urllib.request
from typing import Callable

CACHE_SECONDS = 300
VAULT_RESOURCE = "https://vault.azure.net"
VAULT_API_VERSION = "7.4"
IDENTITY_API_VERSION = "2019-08-01"

Fetch = Callable[[str, dict[str, str]], dict]


class KeyUnavailable(RuntimeError):
    """Key Vault is configured but the key could not be read. Callers must fail closed."""


def _http_get_json(url: str, headers: dict[str, str]) -> dict:
    request = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read())


class ApiKeySource:
    def __init__(self, fetch: Fetch = _http_get_json, clock: Callable[[], float] = time.monotonic) -> None:
        self._fetch = fetch
        self._clock = clock
        self._lock = threading.Lock()
        self._cached: tuple[str, float] | None = None

    def get(self) -> str | None:
        direct = os.environ.get("OPTIMIZER_API_KEY")
        if direct:
            return direct
        vault_url = os.environ.get("KEY_VAULT_URL")
        if not vault_url:
            return None

        with self._lock:
            now = self._clock()
            if self._cached and now - self._cached[1] < CACHE_SECONDS:
                return self._cached[0]
            try:
                value = self._read_from_vault(vault_url)
            except Exception as error:  # noqa: BLE001 - any failure here means the same thing
                raise KeyUnavailable(f"could not read the API key from Key Vault: {error}") from error
            self._cached = (value, now)
            return value

    def _read_from_vault(self, vault_url: str) -> str:
        # Container Apps exposes a managed identity token endpoint to the container through these two
        # variables. The header value proves the request comes from inside this container.
        endpoint = os.environ["IDENTITY_ENDPOINT"]
        identity_header = os.environ["IDENTITY_HEADER"]
        query = {"resource": VAULT_RESOURCE, "api-version": IDENTITY_API_VERSION}
        client_id = os.environ.get("AZURE_CLIENT_ID")
        if client_id:
            query["client_id"] = client_id
        token = self._fetch(f"{endpoint}?{urllib.parse.urlencode(query)}", {"X-IDENTITY-HEADER": identity_header})["access_token"]

        name = os.environ.get("OPTIMIZER_API_KEY_SECRET", "optimizer-api-key")
        secret_url = f"{vault_url.rstrip('/')}/secrets/{urllib.parse.quote(name)}?api-version={VAULT_API_VERSION}"
        value = self._fetch(secret_url, {"Authorization": f"Bearer {token}"})["value"]
        if not value:
            raise ValueError("secret is empty")
        return value


api_keys = ApiKeySource()
