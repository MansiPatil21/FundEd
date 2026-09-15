#!/usr/bin/env bash
# Creates the funded-secrets Secret once, with random values, and keeps an existing one, so a
# redeploy does not rotate JWT_SECRET and sign everyone out. Secret values never live in git.
set -euo pipefail

ns="${NAMESPACE:-funded}"

kubectl get namespace "$ns" >/dev/null 2>&1 || kubectl create namespace "$ns"

if kubectl -n "$ns" get secret funded-secrets >/dev/null 2>&1; then
  echo "funded-secrets already exists, kept as is"
  exit 0
fi

kubectl -n "$ns" create secret generic funded-secrets \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=FX_WEBHOOK_SECRET="$(openssl rand -hex 24)" \
  --from-literal=OPTIMIZER_API_KEY="$(openssl rand -hex 24)"
