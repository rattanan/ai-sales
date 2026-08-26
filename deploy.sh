#!/usr/bin/env bash
set -Eeuo pipefail

APP_DIR="/opt/apps/ai-sales"
WEB_APP_NAME="ai-sales-web"
WORKER_APP_NAME="ai-sales-worker"
INFRA_COMPOSE_FILE="docker-compose.infrastructure.yml"
WEB_HEALTH_URL="http://127.0.0.1:3002/login"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_RETRY_DELAY="${HEALTH_RETRY_DELAY:-2}"

cd "$APP_DIR"

exec 9>"$APP_DIR/.deploy.lock"
if ! flock -n 9; then
  echo "Another deployment is already running." >&2
  exit 1
fi

compose() {
  docker compose -f "$INFRA_COMPOSE_FILE" "$@"
}

show_diagnostics() {
  local exit_code=$?
  trap - ERR
  echo >&2
  echo "Deployment failed (exit $exit_code). Current status:" >&2
  docker info --format 'Docker: {{.ServerVersion}}' >&2 || true
  compose ps --all >&2 || true
  pm2 status >&2 || true
  exit "$exit_code"
}
trap show_diagnostics ERR

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    return 1
  fi
}

check_docker() {
  docker info >/dev/null
  compose config --quiet
  echo "[ready] Docker engine and Compose configuration"
}

wait_for_container_health() {
  local service="$1"
  local attempt container_id state health

  for ((attempt = 1; attempt <= HEALTH_RETRIES; attempt++)); do
    container_id="$(compose ps -q "$service")"
    if [[ -n "$container_id" ]]; then
      state="$(docker inspect --format '{{.State.Status}}' "$container_id")"
      health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container_id")"
      if [[ "$state" == "running" && "$health" == "healthy" ]]; then
        echo "[ready] Docker service $service is healthy"
        return 0
      fi
      if [[ "$state" == "exited" || "$health" == "unhealthy" ]]; then
        echo "Docker service $service failed: state=$state health=$health" >&2
        return 1
      fi
    fi
    sleep "$HEALTH_RETRY_DELAY"
  done

  echo "Timed out waiting for Docker service $service." >&2
  return 1
}

check_postgres() {
  wait_for_container_health postgres
  local result
  result="$(compose exec -T postgres psql -v ON_ERROR_STOP=1 -U ai_sales -d ai_sales -tAc 'SELECT 1')"
  if [[ "$result" != "1" ]]; then
    echo "PostgreSQL query check returned an unexpected result: $result" >&2
    return 1
  fi
  echo "[ready] PostgreSQL accepts queries"
}

check_redis() {
  wait_for_container_health redis
  compose exec -T redis sh -eu -c '
    response="$(redis-cli --no-auth-warning -a "$AI_SALES_REDIS_PASSWORD" ping)"
    test "$response" = "PONG"
  '
  echo "[ready] Redis responds to authenticated PING"
}

check_pm2_app() {
  local app_name="$1"
  pm2 jlist | node -e '
    let input = "";
    process.stdin.on("data", chunk => input += chunk);
    process.stdin.on("end", () => {
      const name = process.argv[1];
      const app = JSON.parse(input).find(item => item.name === name);
      if (!app || app.pm2_env.status !== "online") process.exit(1);
    });
  ' "$app_name"
  echo "[ready] PM2 process $app_name is online"
}

check_worker() {
  local attempt
  check_pm2_app "$WORKER_APP_NAME"
  for ((attempt = 1; attempt <= HEALTH_RETRIES; attempt++)); do
    if node dist-worker/apps/worker/health.js >/dev/null 2>&1; then
      echo "[ready] Worker completed its queue health check"
      return 0
    fi
    sleep "$HEALTH_RETRY_DELAY"
  done
  echo "Worker queue health check failed." >&2
  return 1
}

check_web() {
  check_pm2_app "$WEB_APP_NAME"
  curl --fail --silent --show-error \
    --retry "$HEALTH_RETRIES" --retry-delay "$HEALTH_RETRY_DELAY" --retry-connrefused \
    "$WEB_HEALTH_URL" >/dev/null
  echo "[ready] Web application responds at $WEB_HEALTH_URL"
}

echo "Preflight checks"
for command_name in curl docker flock git node npm npx pm2; do
  require_command "$command_name"
done
test -f "$INFRA_COMPOSE_FILE"
test -f .env
test -f ecosystem.config.cjs
check_docker

echo "Starting Docker infrastructure"
compose up -d postgres redis
check_postgres
check_redis

echo "Updating application"
git pull --ff-only
npm install
npx prisma generate
npx prisma migrate deploy
npm run build
mkdir -p .next/standalone/.next
cp -a public .next/standalone/
cp -a .next/static .next/standalone/.next/
npm run worker:build

echo "Restarting application processes"
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 save

echo "Post-deployment status checks"
check_docker
check_postgres
check_redis
check_worker
check_web

echo
compose ps
pm2 status
echo
echo "AI-Sales deployment completed successfully at revision $(git rev-parse --short HEAD)."
