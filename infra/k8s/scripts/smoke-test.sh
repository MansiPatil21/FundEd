#!/usr/bin/env bash
# Smoke test for a FundEd deployment through its single entry point, the Nginx Service.
# Proves the product works end to end, not only that pods are Running: the web page, API health
# with every dependency up, a real account, and a plan solved by the optimizer behind its API key.
#
# Usage: smoke-test.sh BASE_URL      e.g. smoke-test.sh http://localhost:8080
set -euo pipefail

base="${1:?usage: smoke-test.sh BASE_URL}"
base="${base%/}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
token=""

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

# Prints one field of the last response body, by dotted path: `field status`, `field user.id`.
field() {
  python3 -c '
import json, sys
value = json.load(open(sys.argv[1]))
for key in sys.argv[2].split("."):
    value = value[int(key)] if isinstance(value, list) else value[key]
print(len(value) if sys.argv[3:] == ["len"] else value)' "$work/body" "$@"
}

# request METHOD PATH [JSON_BODY] -> prints the status code, and saves the body for `field`.
request() {
  local args=(-sS -m 120 -o "$work/body" -w '%{http_code}' -X "$1" -H 'Content-Type: application/json')
  [ -n "$token" ] && args+=(-H "Authorization: Bearer $token")
  [ -n "${3:-}" ] && args+=(--data "$3")
  curl "${args[@]}" "$base$2" || true
}

echo "1/5 API health, with MongoDB, Redis and the optimizer all up"
for attempt in $(seq 1 36); do
  status="$(request GET /health)"
  [ "$status" = 200 ] && break
  [ "$attempt" = 36 ] && fail "/health returned ${status:-no response}: $(cat "$work/body" 2>/dev/null)"
  sleep 5
done
echo "    $(cat "$work/body")"

echo "2/5 Web app served"
status="$(request GET /)"
[ "$status" = 200 ] || fail "/ returned $status"
grep -qi "<html" "$work/body" || fail "/ did not return an HTML page"

echo "3/5 Create an account"
suffix="$(openssl rand -hex 6)"
status="$(request POST /api/auth/register \
  "{\"email\":\"smoke-$suffix@example.com\",\"password\":\"Kube-smoke-$suffix-Plan!\",\"displayName\":\"Smoke Test\",\"homeCurrency\":\"INR\"}")"
[ "$status" = 201 ] || fail "register returned $status: $(cat "$work/body")"
token="$(field token)"

echo "4/5 Add an obligation"
due="$(python3 -c 'import datetime; print(datetime.date.today() + datetime.timedelta(days=14))')"
status="$(request POST /api/obligations \
  "{\"label\":\"Tuition deposit\",\"amountMinor\":100000,\"currency\":\"CAD\",\"cadence\":\"ONCE\",\"nextDueOn\":\"$due\"}")"
case "$status" in 200 | 201) ;; *) fail "creating an obligation returned $status: $(cat "$work/body")" ;; esac

echo "5/5 Solve a transfer plan through the optimizer"
status="$(request POST /api/plan \
  '{"horizonDays":30,"openingBalanceMinor":500000,"fees":{"fixedMinor":500,"variableBps":50},"assumedRate":60}')"
[ "$status" = 200 ] || fail "plan returned $status: $(cat "$work/body")"
[ "$(field status)" = OPTIMAL ] || fail "plan status was $(field status)"
echo "    plan OPTIMAL with $(field transfers len) transfer(s)"

echo "Smoke test passed against $base"
