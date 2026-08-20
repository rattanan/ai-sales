#!/bin/sh
set -eu

: "${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
: "${POSTGRES_BACKUP_FILE:?POSTGRES_BACKUP_FILE is required}"

database_name=$(psql "$RESTORE_DATABASE_URL" -Atqc 'select current_database()')
case "$database_name" in
  *_restore_drill) ;;
  *) echo "Target database must end with _restore_drill" >&2; exit 2 ;;
esac

pg_restore --dbname="$RESTORE_DATABASE_URL" --clean --if-exists --no-owner "$POSTGRES_BACKUP_FILE"
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'select count(*) as users from "User";'
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'select count(*) as searchable_chunks from "DocumentChunk" where content is not null;'
psql "$RESTORE_DATABASE_URL" -v ON_ERROR_STOP=1 -c 'select count(*) as citations from "MessageCitation";'

if [ -n "${OBJECT_STORAGE_BACKUP_FILE:-}" ] && [ -n "${RESTORE_STORAGE_DIR:-}" ]; then
  mkdir -p "$RESTORE_STORAGE_DIR"
  tar -xzf "$OBJECT_STORAGE_BACKUP_FILE" -C "$RESTORE_STORAGE_DIR"
fi

printf '%s\n' "Restore drill completed for $database_name"
