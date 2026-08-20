#!/usr/bin/env bash

set -Eeuo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_root"

for command_name in npm docker; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Error: '$command_name' is required for local development." >&2
    exit 1
  fi
done

if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker is not running. Start Docker Desktop and try again." >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "Error: .env is missing." >&2
  echo "Create it with 'cp .env.example .env', then configure the local secrets." >&2
  exit 1
fi

if [ ! -d node_modules ] || [ ! -f node_modules/.package-lock.json ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  echo "Installing npm dependencies..."
  npm install
fi

echo "Starting PostgreSQL and Redis..."
docker compose up -d --wait postgres redis

echo "Preparing the application database..."
npm run db:generate
npm run db:deploy

app_pid=""
worker_pid=""

cleanup() {
  trap - EXIT INT TERM

  if [ -n "$app_pid" ] && kill -0 "$app_pid" 2>/dev/null; then
    kill "$app_pid" 2>/dev/null || true
  fi

  if [ -n "$worker_pid" ] && kill -0 "$worker_pid" 2>/dev/null; then
    kill "$worker_pid" 2>/dev/null || true
  fi

  wait "$app_pid" "$worker_pid" 2>/dev/null || true
}

trap cleanup EXIT INT TERM

echo "Starting the worker in watch mode..."
npm run worker:watch &
worker_pid=$!

echo "Starting Next.js at http://localhost:3000 ..."
npm run dev &
app_pid=$!

exit_status=0
while kill -0 "$app_pid" 2>/dev/null && kill -0 "$worker_pid" 2>/dev/null; do
  sleep 1
done

if ! kill -0 "$app_pid" 2>/dev/null; then
  wait "$app_pid" || exit_status=$?
  echo "Next.js stopped (exit $exit_status)." >&2
else
  wait "$worker_pid" || exit_status=$?
  echo "Worker stopped (exit $exit_status)." >&2
fi

exit "$exit_status"
