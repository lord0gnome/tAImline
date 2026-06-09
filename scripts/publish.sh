#!/usr/bin/env bash
#
# publish.sh — ship a tAImline version end to end.
#
# What it does, in order:
#   1. App repo: bump package.json + Helm Chart.yaml to the given version and
#      make ONE dedicated commit ("Release vX.Y.Z") touching only those files.
#   2. Push master to both remotes (gitea = Flux chart source, github = GHCR CI)
#      and push the vX.Y.Z tag (the tag is what produces the clean semver image).
#   3. Wait until ghcr.io/<image>:X.Y.Z actually exists.
#   4. Flux repo: bump the HelmRelease image.tag, commit ("taimline: X.Y.Z"),
#      push, and reconcile so the cluster picks it up immediately.
#
# Prereqs: the feature work for this release is ALREADY committed (this script
# refuses to run on a dirty tree so the release commit stays version-only).
#
# Usage:   scripts/publish.sh <version>          e.g. scripts/publish.sh 0.16.0
#
# Override via env if your layout differs:
#   APP_REMOTES   space-separated git remotes to push     (default "gitea github")
#   TAG_REMOTES   git remotes to push the tag to           (default "gitea github")
#   IMAGE         GHCR image (no tag)                      (default ghcr.io/lord0gnome/taimline)
#   FLUX_REPO     path to the Flux git repo                (default /home/gnome/projects/k3s/flux)
#   FLUX_HR       HelmRelease path within FLUX_REPO        (default clusters/k3s/apps/taimline/helmrelease.yaml)
#   FLUX_REMOTE   Flux repo git remote                     (default origin)
#   FLUX_NS       flux-system namespace                    (default flux-system)
#   SOURCE_NAME   GitRepository source name                (default taimline)
#   KUSTOMIZATION apps kustomization name                  (default apps)
#   HR_NAME       HelmRelease name                         (default taimline)
#   HR_NS         HelmRelease namespace                    (default taimline)
#   IMAGE_TIMEOUT seconds to wait for the image            (default 1200)
#   SKIP_IMAGE_WAIT=1   skip the GHCR wait (not recommended)
#
set -euo pipefail

# ---- config -----------------------------------------------------------------
APP_REMOTES=${APP_REMOTES:-"gitea github"}
TAG_REMOTES=${TAG_REMOTES:-"gitea github"}
IMAGE=${IMAGE:-ghcr.io/lord0gnome/taimline}
FLUX_REPO=${FLUX_REPO:-/home/gnome/projects/k3s/flux}
FLUX_HR=${FLUX_HR:-clusters/k3s/apps/taimline/helmrelease.yaml}
FLUX_REMOTE=${FLUX_REMOTE:-origin}
FLUX_NS=${FLUX_NS:-flux-system}
SOURCE_NAME=${SOURCE_NAME:-taimline}
KUSTOMIZATION=${KUSTOMIZATION:-apps}
HR_NAME=${HR_NAME:-taimline}
HR_NS=${HR_NS:-taimline}
IMAGE_TIMEOUT=${IMAGE_TIMEOUT:-1200}

# Resolve the app repo as the git root of this script, regardless of CWD.
APP_REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && git rev-parse --show-toplevel)

say()  { printf '\n\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# ---- args -------------------------------------------------------------------
VERSION=${1:-}
[[ -n "$VERSION" ]] || die "usage: $0 <version>   (e.g. $0 0.16.0)"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version must be X.Y.Z, got '$VERSION'"
TAG="v$VERSION"

for bin in git npm sed skopeo flux; do command -v "$bin" >/dev/null || die "missing required tool: $bin"; done

# =============================================================================
say "Step 1/4 — app repo version bump ($APP_REPO)"
cd "$APP_REPO"

branch=$(git rev-parse --abbrev-ref HEAD)
[[ "$branch" == "master" ]] || die "app repo not on master (on '$branch')"
[[ -z "$(git status --porcelain)" ]] || die "working tree is dirty — commit/stash feature work first (the release commit must be version-only)"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null && die "tag $TAG already exists"

npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null
sed -i -E "s/^version: .*/version: $VERSION/; s/^appVersion: .*/appVersion: \"$VERSION\"/" deploy/helm/taimline/Chart.yaml

git add package.json package-lock.json deploy/helm/taimline/Chart.yaml
git commit -q -m "Release $TAG"
git tag -a "$TAG" -m "$TAG"
ok "committed 'Release $TAG' and tagged $TAG"

# =============================================================================
say "Step 2/4 — push branch + tag"
for r in $APP_REMOTES; do git push "$r" master && ok "pushed master -> $r"; done
for r in $TAG_REMOTES; do git push "$r" "$TAG" && ok "pushed $TAG -> $r"; done

# =============================================================================
say "Step 3/4 — wait for image $IMAGE:$VERSION on GHCR"
if [[ "${SKIP_IMAGE_WAIT:-0}" == "1" ]]; then
  ok "SKIP_IMAGE_WAIT=1 — not waiting"
else
  deadline=$(( $(date +%s) + IMAGE_TIMEOUT ))
  until skopeo inspect --raw "docker://$IMAGE:$VERSION" >/dev/null 2>&1; do
    [[ $(date +%s) -lt $deadline ]] || die "timed out after ${IMAGE_TIMEOUT}s waiting for $IMAGE:$VERSION (is the CI build green?)"
    printf '  … not ready yet, retrying in 15s\n'
    sleep 15
  done
  ok "image $IMAGE:$VERSION is available"
fi

# =============================================================================
say "Step 4/4 — flux repo bump + reconcile ($FLUX_REPO)"
[[ -d "$FLUX_REPO/.git" ]] || die "FLUX_REPO is not a git repo: $FLUX_REPO"
cd "$FLUX_REPO"
[[ -z "$(git status --porcelain)" ]] || die "flux repo working tree is dirty: $FLUX_REPO"
git pull --ff-only "$FLUX_REMOTE" "$(git rev-parse --abbrev-ref HEAD)" >/dev/null 2>&1 || true

[[ -f "$FLUX_HR" ]] || die "HelmRelease not found: $FLUX_REPO/$FLUX_HR"
matches=$(grep -cE '^[[:space:]]*tag:[[:space:]]' "$FLUX_HR")
[[ "$matches" == "1" ]] || die "expected exactly one 'tag:' line in $FLUX_HR, found $matches — refusing to guess"
sed -i -E "s|^([[:space:]]*tag:[[:space:]]*).*|\1\"$VERSION\"|" "$FLUX_HR"
grep -qE "tag:[[:space:]]*\"$VERSION\"" "$FLUX_HR" || die "image.tag bump did not take in $FLUX_HR"

if git diff --quiet -- "$FLUX_HR"; then
  ok "image.tag already $VERSION — nothing to commit"
else
  git add "$FLUX_HR"
  git commit -q -m "taimline: $VERSION"
  git push "$FLUX_REMOTE" HEAD && ok "pushed flux bump -> $FLUX_REMOTE"
fi

say "reconciling flux (faster than the periodic interval)"
flux reconcile source git "$SOURCE_NAME" -n "$FLUX_NS"                 && ok "source/$SOURCE_NAME reconciled (new Chart.yaml)"
flux reconcile kustomization "$KUSTOMIZATION" -n "$FLUX_NS" --with-source && ok "kustomization/$KUSTOMIZATION applied (new HelmRelease)"
flux reconcile helmrelease "$HR_NAME" -n "$HR_NS" --with-source        && ok "helmrelease/$HR_NAME upgraded"

say "Published $TAG 🎉"
flux get helmrelease "$HR_NAME" -n "$HR_NS"
