#!/usr/bin/env bash
# Spin up a throwaway Postgres, apply migrations and run the RLS tests.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
dir="$(mktemp -d)"
port="${PG_TEST_PORT:-55432}"
run() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
chmod 777 "$dir"
run "$bin/initdb -D $dir/data -A trust -U postgres >/dev/null"
run "$bin/pg_ctl -D $dir/data -o '-p $port -k $dir' -l $dir/log -w start >/dev/null"
trap 'run "$bin/pg_ctl -D $dir/data -m immediate stop >/dev/null"; rm -rf "$dir"' EXIT
psql=(psql -h "$dir" -p "$port" -U postgres -v ON_ERROR_STOP=1 -q -d postgres)
for t in rls engagement operations social_auth homework calendar whatsapp; do
  # Each test file starts from a freshly migrated database.
  "${psql[@]}" -c "drop database if exists t_$t" -c "create database t_$t" >/dev/null 2>&1
  db=(psql -h "$dir" -p "$port" -U postgres -v ON_ERROR_STOP=1 -q -d "t_$t")
  "${db[@]}" -f "$here/shim.sql"
  for f in "$here"/../migrations/*.sql; do "${db[@]}" -o /dev/null -f "$f"; done
  "${db[@]}" -o /dev/null -f "$here/${t}_test.sql" 2>&1 | sed -e 's/^psql:[^ ]* NOTICE:  /  /'
  [ "${PIPESTATUS[0]}" = 0 ] || exit 1
done
