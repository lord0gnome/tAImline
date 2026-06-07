# Deploying tAImline (k3s + Flux)

Artifacts:

- `../Containerfile` — multi-stage, non-root image (Debian, node 24).
- `helm/taimline/` — the Helm chart (StatefulSet + Longhorn PVC, migrate init
  container, Service, nginx Ingress, probes).
- `flux/` — Flux wiring (GitRepository source, HelmRelease, namespace,
  SOPS secret example, kustomization).
- `../.github/workflows/build-image.yml` — builds + pushes
  `ghcr.io/lord0gnome/taimline`.

## How it fits the cluster

Matches the conventions in the `k3s/flux` repo:

- **Ingress:** ingress-nginx. Public tier `nginx` + `cert-manager` issuer
  (`letsencrypt-staging`, switch to `letsencrypt-prod` once the staging cert
  appears) with a per-host `*-tls` secret. For LAN-only, set
  `ingress.className: nginx-internal`, `clusterIssuer: ""`, `tls: false` (the
  internal controller serves the `*.morill.es` wildcard).
- **Storage:** Longhorn (`storageClass: longhorn`), RWO — hence a single
  replica StatefulSet (SQLite has one writer).
- **Secrets:** SOPS (age), decrypted in-cluster by the apps Kustomization.
- **DB growth path:** swap to CloudNativePG (already in the cluster) or
  libSQL/Turso later; that flips the StatefulSet to a stateless Deployment.

## One-time wiring in the `k3s/flux` repo

1. **Source:** copy `flux/source.yaml` →
   `clusters/k3s/infrastructure/sources/taimline.yaml` and add `taimline.yaml`
   to that dir's `kustomization.yaml`. Authorize the `flux-system` SSH deploy
   key on the Gitea repo.
2. **App:** copy `flux/{namespace,helmrelease,kustomization}.yaml` →
   `clusters/k3s/apps/taimline/`, and add `taimline` to
   `clusters/k3s/apps/kustomization.yaml`.
3. **Secret:**
   ```sh
   cd clusters/k3s/apps/taimline
   cp <this repo>/deploy/flux/secret.example.yaml secret.yaml
   # fill SESSION_SECRET, GitHub OAuth creds, S3 creds
   sops --encrypt --in-place secret.yaml
   ```
4. **(Private GHCR only)** create a `ghcr-pull` docker-registry secret
   (SOPS-encrypted) in the `taimline` namespace and uncomment
   `imagePullSecrets` in `helmrelease.yaml`.
5. Commit + push; Flux reconciles. App comes up at
   `https://taimline.morill.es`.

## Local verification

```sh
# chart renders + validates
helm lint deploy/helm/taimline
helm template taimline deploy/helm/taimline | kubeconform -strict -ignore-missing-schemas

# image builds and serves
podman build -t taimline:dev -f Containerfile .
podman run --rm -e DATABASE_PATH=/data/taimline.db -v taimline-data:/data -p 4321:4321 taimline:dev
curl -fsS http://localhost:4321/healthz
```
