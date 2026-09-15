#!/usr/bin/env bash
# Proves the NetworkPolicies are enforced, not only applied. A probe pod outside the allow-list
# must reach Nginx (so the probe itself works) and must NOT reach the API, the web app, the
# optimizer or Redis directly. The API, which is allowed, must reach the optimizer.
set -euo pipefail

ns="${NAMESPACE:-funded}"
probe="np-probe"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

cleanup() { kubectl -n "$ns" delete pod "$probe" --ignore-not-found --wait=false >/dev/null; }
trap cleanup EXIT

kubectl -n "$ns" run "$probe" --image=busybox:1.37 --restart=Never --labels=role=network-probe \
  --overrides='{"spec":{"automountServiceAccountToken":false}}' --command -- sleep 600 >/dev/null
kubectl -n "$ns" wait --for=condition=Ready "pod/$probe" --timeout=120s >/dev/null

reaches_http() { kubectl -n "$ns" exec "$probe" -- wget -q -O /dev/null -T 5 "$1" >/dev/null 2>&1; }

echo "allowed  probe -> nginx:80"
reaches_http http://nginx/ || fail "the probe could not reach Nginx, so it cannot test anything"

echo "allowed  api -> optimizer:5000"
kubectl -n "$ns" exec deploy/api -c api -- wget -q -O /dev/null -T 5 http://optimizer:5000/health \
  || fail "the API could not reach the optimizer"

for url in http://api:4000/health/live http://web:3000/ http://optimizer:5000/health; do
  echo "blocked  probe -> ${url#http://}"
  if reaches_http "$url"; then fail "a pod outside the allow-list reached $url"; fi
done

echo "blocked  probe -> redis:6379"
if kubectl -n "$ns" exec "$probe" -- sh -c 'printf "PING\r\n" | nc -w 5 redis 6379' 2>/dev/null | grep -q PONG; then
  fail "a pod outside the allow-list reached Redis"
fi

echo "NetworkPolicies enforced"
