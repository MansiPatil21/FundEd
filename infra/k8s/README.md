# FundEd on Kubernetes

The whole product (web, API, optimizer, MongoDB, Redis, and Nginx as the single entry point) as
Kubernetes manifests, managed with Kustomize. One base, two overlays:

| Overlay | Where | Images | Nginx exposed as |
| --- | --- | --- | --- |
| `overlays/kind` | CI on every change, and local clusters | built locally, loaded with `kind load` | ClusterIP (port-forward) |
| `overlays/aks` | Azure Kubernetes Service | Azure Container Registry, tagged per commit | Azure Standard Load Balancer |

## What the manifests do

- **Workloads.** MongoDB as a StatefulSet with a persistent volume and a single-node replica set
  (Prisma needs transactions). The API runs its index migration as an init container, retried with
  backoff until MongoDB has a primary. Web runs two replicas behind a PodDisruptionBudget.
- **Health.** Liveness asks only whether a process answers, so a database outage does not restart a
  healthy API. Readiness checks every dependency, so traffic stops while one is down.
- **Scaling.** A HorizontalPodAutoscaler adds optimizer replicas (1 to 3) when CPU passes 70% of the
  request, since solves are CPU-bound. The API stays at one replica on purpose: the rate poller and
  Socket.IO rooms live in the process.
- **Security.** Default-deny NetworkPolicies, then only nginx -> web/api and api -> optimizer/mongo/redis.
  FundEd containers run as non-root with every Linux capability dropped and no service account
  token. Secrets are created in the cluster by `scripts/create-secrets.sh` and never committed.
- **Config.** A generated ConfigMap with a content hash, so a changed value rolls the pods that use it.

## Verification

`scripts/smoke-test.sh` goes through Nginx: API health with every dependency up, the web page, a real
account, an obligation, and a plan solved by the optimizer behind its API key.
`scripts/verify-network-policy.sh` proves the policies are enforced: a probe pod reaches Nginx but not
the API, web, optimizer or Redis directly, while the API does reach the optimizer.

The [Kubernetes workflow](../../.github/workflows/kubernetes.yml) runs all of it on a fresh kind
cluster for every change, after validating the rendered manifests against the Kubernetes schemas
with kubeconform, and also checks that the autoscaler is reading CPU metrics.

## Run it locally

```bash
kind create cluster --name funded
docker build -t funded-api:ci --target runtime backend
docker build -t funded-optimizer:ci optimizer
docker build -t funded-web:ci web
kind load docker-image funded-api:ci funded-optimizer:ci funded-web:ci --name funded

infra/k8s/scripts/create-secrets.sh
kubectl apply -k infra/k8s/overlays/kind
infra/k8s/scripts/wait-ready.sh
kubectl -n funded port-forward service/nginx 8080:80    # http://localhost:8080
```

## Deploy to AKS

`infra/aks` is a separate Terraform root (its own state key), so the cluster can be created and
destroyed without touching the Container Apps stack in `infra/azure`, whose registry it pulls from.

- Free tier control plane, one `Standard_B2ps_v2` Arm64 node (what Azure for Students offers in
  canadacentral), Azure CNI overlay with Cilium enforcing the NetworkPolicies.
- No local admin account: kubectl signs in with Microsoft Entra ID and is authorised by Azure RBAC.
- Nodes pull from ACR with the kubelet identity's AcrPull role. No registry password exists.

```bash
infra/k8s/deploy-aks.sh          # Terraform, build and push, deploy, smoke test, policy check
infra/k8s/deploy-aks.sh --stop   # the same, then stop the cluster so the node is not billed
az aks start -g rg-funded-dev-aks -n aks-funded-dev    # bring it back later
```
