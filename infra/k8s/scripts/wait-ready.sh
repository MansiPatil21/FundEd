#!/usr/bin/env bash
# Waits for every workload to finish rolling out, and prints what is wrong if one does not.
set -euo pipefail

ns="${NAMESPACE:-funded}"
timeout="${ROLLOUT_TIMEOUT:-300s}"

for workload in statefulset/mongo deployment/redis deployment/optimizer deployment/api deployment/web deployment/nginx; do
  if ! kubectl -n "$ns" rollout status "$workload" --timeout="$timeout"; then
    echo "::group::$workload did not become ready"
    kubectl -n "$ns" get pods -o wide
    kubectl -n "$ns" describe "$workload" | tail -n 30
    kubectl -n "$ns" logs "$workload" --all-containers --tail=80 || true
    echo "::endgroup::"
    exit 1
  fi
done

kubectl -n "$ns" get pods -o wide
