#!/usr/bin/env bash
# Deploys FundEd to Azure Kubernetes Service with the same manifests CI tests on kind.
#   1. Terraform creates the cluster (infra/aks)
#   2. the three service images are built for the node architecture and pushed to ACR
#   3. kubectl signs in through Microsoft Entra ID
#   4. the manifests are applied with this commit's image tags
#   5. the smoke test and the NetworkPolicy check run against the public load balancer
#
# Usage: infra/k8s/deploy-aks.sh [--skip-infra] [--stop]
#   --skip-infra  reuse the existing cluster
#   --stop        stop the cluster afterwards, so only its disk is billed until `az aks start`
#
# Needs: az (signed in), terraform, docker with buildx, kubectl, kubelogin, and an applied
# infra/azure stack, which owns the registry and the Terraform state storage.
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
k8s="$root/infra/k8s"
aks="$root/infra/aks"

skip_infra=false
stop_after=false
for arg in "$@"; do
  case "$arg" in
    --skip-infra) skip_infra=true ;;
    --stop) stop_after=true ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

TF_VAR_subscription_id="${TF_VAR_subscription_id:-$(az account show --query id -o tsv)}"
TF_VAR_acr_name="$(terraform -chdir="$root/infra/azure" output -raw acr_name)"
export TF_VAR_subscription_id TF_VAR_acr_name
registry="$TF_VAR_acr_name.azurecr.io"
tag="k8s-$(git -C "$root" rev-parse --short HEAD)"

echo "== 1/5 Cluster"
terraform -chdir="$aks" init -input=false -reconfigure \
  -backend-config="$root/infra/azure/backend.hcl" -backend-config="key=funded-aks.tfstate" >/dev/null
if [ "$skip_infra" = false ]; then
  terraform -chdir="$aks" apply -input=false -auto-approve
fi
rg="$(terraform -chdir="$aks" output -raw resource_group)"
cluster="$(terraform -chdir="$aks" output -raw cluster_name)"
platform="linux/$(terraform -chdir="$aks" output -raw node_architecture)"

echo "== 2/5 Images for $platform, tag $tag"
az acr login --name "$TF_VAR_acr_name" >/dev/null
docker buildx build --platform "$platform" --target runtime -t "$registry/funded-api:$tag" --push "$root/backend"
docker buildx build --platform "$platform" -t "$registry/funded-optimizer:$tag" --push "$root/optimizer"
docker buildx build --platform "$platform" -t "$registry/funded-web:$tag" --push "$root/web"

echo "== 3/5 Credentials through Microsoft Entra ID"
az aks get-credentials --resource-group "$rg" --name "$cluster" --overwrite-existing >/dev/null
kubelogin convert-kubeconfig -l azurecli
kubectl config use-context "$cluster" >/dev/null

echo "== 4/5 Deploy"
release="$k8s/.release/aks"
mkdir -p "$release"
cat >"$release/kustomization.yaml" <<EOF
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
resources:
  - ../../overlays/aks
images:
  - name: funded-api
    newName: $registry/funded-api
    newTag: $tag
  - name: funded-optimizer
    newName: $registry/funded-optimizer
    newTag: $tag
  - name: funded-web
    newName: $registry/funded-web
    newTag: $tag
EOF
"$k8s/scripts/create-secrets.sh"
kubectl apply -k "$release"
ROLLOUT_TIMEOUT=600s "$k8s/scripts/wait-ready.sh"

echo "== 5/5 Verify through the public load balancer"
ip=""
for _ in $(seq 1 60); do
  ip="$(kubectl -n funded get service nginx -o jsonpath='{.status.loadBalancer.ingress[0].ip}')"
  [ -n "$ip" ] && break
  sleep 5
done
[ -n "$ip" ] || { echo "the load balancer never got a public IP" >&2; exit 1; }
"$k8s/scripts/smoke-test.sh" "http://$ip"
"$k8s/scripts/verify-network-policy.sh"
echo "FundEd on AKS: http://$ip"

if [ "$stop_after" = true ]; then
  az aks stop --resource-group "$rg" --name "$cluster"
  echo "Cluster stopped. Start it again with: az aks start -g $rg -n $cluster"
fi
