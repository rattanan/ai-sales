#!/bin/sh
set -eu

: "${DATABASE_URL:?DATABASE_URL is required}"
: "${BACKUP_DIR:?BACKUP_DIR must be an explicit backup directory}"

case "$BACKUP_DIR" in
  /|/Users|/home|"$HOME") echo "Refusing broad BACKUP_DIR" >&2; exit 2 ;;
esac

stamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$BACKUP_DIR/$stamp"
mkdir -p "$target"
chmod 0700 "$target"

pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --file="$target/postgres.dump"

if [ -n "${REDIS_URL:-}" ]; then
  redis-cli -u "$REDIS_URL" --rdb "$target/redis.rdb"
fi

if [ -n "${LOCAL_STORAGE_PATH:-}" ] && [ -d "$LOCAL_STORAGE_PATH" ]; then
  tar -C "$LOCAL_STORAGE_PATH" -czf "$target/object-storage.tgz" .
fi

(cd "$target" && sha256sum ./* > SHA256SUMS)
printf '%s\n' "$target"
