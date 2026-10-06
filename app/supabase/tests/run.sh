#!/usr/bin/env bash
# Spin up a throwaway Postgres, apply migrations and run the RLS tests.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
bin="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
# Works as root (servers run as the postgres user) or as an ordinary user such as a CI runner (no sudo needed).
[ -x "$bin/initdb" ] || { echo "PostgreSQL server binaries not found. Set PG_BIN to the directory holding initdb." >&2; exit 1; }
export PATH="$bin:$PATH"
dir="$(mktemp -d)"
port="${PG_TEST_PORT:-55432}"
run() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
chmod 777 "$dir"
run "$bin/initdb -D $dir/data -A trust -U postgres >/dev/null"
run "$bin/pg_ctl -D $dir/data -o '-p $port -k $dir' -l $dir/log -w start >/dev/null"
trap 'run "$bin/pg_ctl -D $dir/data -m immediate stop >/dev/null"; rm -rf "$dir"' EXIT
psql=(psql -h "$dir" -p "$port" -U postgres -v ON_ERROR_STOP=1 -q -d postgres)
# supabase db push and db reset apply every migration in ONE session, so session-scoped objects a migration creates
# (pg_temp helpers, temp tables) are still there for the next one. Apply them all together once to catch clashes.
"${psql[@]}" -c "create database t_single_session" >/dev/null
single=(-f "$here/shim.sql"); for f in "$here"/../migrations/*.sql; do single+=(-f "$f"); done
if ! psql -h "$dir" -p "$port" -U postgres -v ON_ERROR_STOP=1 -q -d t_single_session -o /dev/null "${single[@]}" >"$dir/single.log" 2>&1; then
  grep -v NOTICE "$dir/single.log" >&2
  echo "FAILED: the migrations do not apply in a single session (as supabase db push runs them)" >&2
  exit 1
fi
echo "ok - every migration applies in a single session"
for t in rls engagement operations social_auth subjects homework calendar whatsapp payments invoice_notifications round4_qa_fixes viewas rates contacts audit tax admissions vetting data_rights system_health spam handover round5_merge creditnote_fix launch_fix handoverac contactdel secminor deletion_fix; do
  # Each test file starts from a freshly migrated database.
  "${psql[@]}" -c "drop database if exists t_$t" -c "create database t_$t" >/dev/null 2>&1
  db=(psql -h "$dir" -p "$port" -U postgres -v ON_ERROR_STOP=1 -q -d "t_$t")
  "${db[@]}" -f "$here/shim.sql"
  for f in "$here"/../migrations/*.sql; do "${db[@]}" -o /dev/null -f "$f"; done
  "${db[@]}" -v migration_count="$(ls "$here"/../migrations/*.sql | wc -l)" -o /dev/null -f "$here/${t}_test.sql" 2>&1 | sed -e 's/^psql:[^ ]* NOTICE:  /  /'
  [ "${PIPESTATUS[0]}" = 0 ] || exit 1
done
