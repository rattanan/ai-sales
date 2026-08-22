#!/usr/bin/env bash

set -Eeuo pipefail

SSH_TARGET="${DEPLOY_SSH_TARGET:-ntop}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-__DEFAULT__}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
HEALTH_TIMEOUT_SECONDS="${DEPLOY_HEALTH_TIMEOUT_SECONDS:-240}"
CHECK_ONLY="${DEPLOY_CHECK_ONLY:-0}"

usage() {
  cat <<'EOF'
Deploy AI-Sales to a remote Docker Compose host and verify the complete stack.

Usage:
  ./deploy.sh

Optional environment variables:
  DEPLOY_SSH_TARGET                 SSH host or alias (default: ntop)
  DEPLOY_REMOTE_DIR                 Remote repository (default: $HOME/ai-sales)
  DEPLOY_BRANCH                     Git branch (default: main)
  DEPLOY_HEALTH_TIMEOUT_SECONDS     Per-service timeout (default: 240)
  DEPLOY_CHECK_ONLY=1               Skip Git/deploy and run readiness checks only

Examples:
  ./deploy.sh
  DEPLOY_REMOTE_DIR=/opt/ai-sales ./deploy.sh
  DEPLOY_CHECK_ONLY=1 ./deploy.sh
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

if [[ ! "$SSH_TARGET" =~ ^[A-Za-z0-9._@:-]+$ || "$SSH_TARGET" == -* ]]; then
  echo "DEPLOY_SSH_TARGET contains unsupported characters." >&2
  exit 2
fi
if [[ "$REMOTE_DIR" != "__DEFAULT__" && ! "$REMOTE_DIR" =~ ^[A-Za-z0-9_./-]+$ ]]; then
  echo "DEPLOY_REMOTE_DIR contains unsupported characters." >&2
  exit 2
fi
if [[ ! "$DEPLOY_BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]]; then
  echo "DEPLOY_BRANCH contains unsupported characters." >&2
  exit 2
fi
if [[ ! "$HEALTH_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
  echo "DEPLOY_HEALTH_TIMEOUT_SECONDS must be a positive integer." >&2
  exit 2
fi
if [[ "$CHECK_ONLY" != "0" && "$CHECK_ONLY" != "1" ]]; then
  echo "DEPLOY_CHECK_ONLY must be 0 or 1." >&2
  exit 2
fi

echo "Connecting to ${SSH_TARGET}..."

ssh \
  -o BatchMode=yes \
  -o ConnectTimeout=15 \
  "$SSH_TARGET" \
  "bash -s -- $REMOTE_DIR $DEPLOY_BRANCH $HEALTH_TIMEOUT_SECONDS $CHECK_ONLY" <<'REMOTE_SCRIPT'
set -Eeuo pipefail

remote_dir="$1"
deploy_branch="$2"
health_timeout_seconds="$3"
check_only="$4"

if [[ "$remote_dir" == "__DEFAULT__" ]]; then
  remote_dir="$HOME/ai-sales"
fi

cd "$remote_dir"

compose() {
  docker compose --profile app "$@"
}

show_diagnostics() {
  local exit_code=$?
  trap - ERR
  echo
  echo "Deployment/readiness check failed (exit ${exit_code})." >&2
  compose ps --all >&2 || true
  compose logs --tail 100 postgres redis migrate storage-init worker app nginx >&2 || true
  exit "$exit_code"
}
trap show_diagnostics ERR

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found on remote host: $1" >&2
    return 1
  fi
}

container_id() {
  compose ps --all -q "$1" | head -n 1
}

wait_for_service() {
  local service="$1"
  local expected="$2"
  local deadline=$((SECONDS + health_timeout_seconds))
  local id state health exit_code

  while ((SECONDS < deadline)); do
    id="$(container_id "$service")"
    if [[ -n "$id" ]]; then
      state="$(docker inspect --format '{{.State.Status}}' "$id")"
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")"
      exit_code="$(docker inspect --format '{{.State.ExitCode}}' "$id")"

      case "$expected" in
        healthy)
          if [[ "$state" == "running" && "$health" == "healthy" ]]; then
            echo "  [ready] $service is healthy"
            return 0
          fi
          if [[ "$state" == "exited" || "$health" == "unhealthy" ]]; then
            echo "$service failed: state=$state health=$health exit=$exit_code" >&2
            return 1
          fi
          ;;
        running)
          if [[ "$state" == "running" ]]; then
            echo "  [ready] $service is running"
            return 0
          fi
          if [[ "$state" == "exited" ]]; then
            echo "$service exited unexpectedly with code $exit_code" >&2
            return 1
          fi
          ;;
        completed)
          if [[ "$state" == "exited" && "$exit_code" == "0" ]]; then
            echo "  [ready] $service completed successfully"
            return 0
          fi
          if [[ "$state" == "exited" && "$exit_code" != "0" ]]; then
            echo "$service failed with exit code $exit_code" >&2
            return 1
          fi
          ;;
      esac
    fi
    sleep 3
  done

  echo "Timed out waiting for $service to become $expected." >&2
  return 1
}

verify_postgres() {
  compose exec -T postgres \
    psql -v ON_ERROR_STOP=1 -U ai_dashboard -d ai_dashboard -tAc 'SELECT 1' \
    | grep -qx '1'
  echo "  [ready] PostgreSQL accepts queries"
}

verify_redis() {
  compose exec -T redis sh -eu -c '
    redis_password="$(tr "\000" "\n" </proc/1/cmdline | awk '\''found { print; exit } $0 == "--requirepass" { found=1 }'\'')"
    test -n "$redis_password"
    test "$(redis-cli --no-auth-warning -a "$redis_password" ping)" = "PONG"
  '
  echo "  [ready] Redis accepts authenticated commands"
}

verify_worker() {
  compose exec -T worker node dist-worker/apps/worker/health.js >/dev/null
  echo "  [ready] Worker completed an end-to-end queue job"
}

verify_app() {
  compose exec -T app node -e \
    "fetch('http://127.0.0.1:8080/api/v1/health').then(async response => { if (!response.ok) { console.error(await response.text()); process.exit(1); } }).catch(error => { console.error(error.message); process.exit(1); })"
  echo "  [ready] App health API reports database, Redis, and worker ready"
}

verify_nginx() {
  compose exec -T nginx nginx -t >/dev/null
  compose exec -T nginx wget -qO /dev/null http://127.0.0.1:8080/api/v1/health
  echo "  [ready] Nginx configuration and reverse proxy are working"
}

echo "Preflight checks"
require_command docker
require_command git
docker info >/dev/null
docker compose version
test -f docker-compose.yml
test -f .env
compose config --quiet
echo "  [ready] Docker engine and Compose configuration"

if [[ "$check_only" == "0" ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Remote repository has tracked changes; refusing to overwrite them." >&2
    exit 1
  fi

  current_branch="$(git branch --show-current)"
  if [[ "$current_branch" != "$deploy_branch" ]]; then
    echo "Remote repository is on '$current_branch', expected '$deploy_branch'." >&2
    exit 1
  fi

  previous_revision="$(git rev-parse --short HEAD)"
  echo "Updating $deploy_branch (current: $previous_revision)"
  git fetch --prune origin "$deploy_branch"
  git merge --ff-only "origin/$deploy_branch"
  deployed_revision="$(git rev-parse --short HEAD)"
  echo "Building revision $deployed_revision"
  compose pull postgres redis storage-init nginx
  compose build --pull migrate worker app

  echo "Starting PostgreSQL and Redis"
  compose up -d postgres redis
  wait_for_service postgres healthy
  wait_for_service redis healthy

  echo "Applying database migrations"
  compose run --rm migrate

  echo "Preparing persistent storage"
  compose up -d --force-recreate storage-init
  wait_for_service storage-init completed

  echo "Starting worker"
  compose up -d worker
  wait_for_service worker healthy

  echo "Starting app and Nginx"
  compose up -d app
  wait_for_service app healthy
  compose up -d --remove-orphans nginx
  wait_for_service nginx running
else
  echo "Check-only mode: no Git or container changes will be made."
  wait_for_service postgres healthy
  wait_for_service redis healthy
  wait_for_service worker healthy
  wait_for_service app healthy
  wait_for_service nginx running
fi

echo "End-to-end readiness checks"
verify_postgres
verify_redis
verify_worker
verify_app
verify_nginx

echo
compose ps
echo
echo "AI-Sales is deployed and ready on $HOSTNAME at revision $(git rev-parse --short HEAD)."
REMOTE_SCRIPT
