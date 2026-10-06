#!/usr/bin/env bash
# Run the live end-to-end harness: the area scripts in parallel, then email.js (which checks what they sent),
# then cleanup.js (which undoes what they created), and print a summary table.
#
#   ./run-all.sh                 # live app, with the E2E_* settings from the environment
#   DEMO=1 BASE=http://localhost:8505 ./run-all.sh   # dry run against a local demo build
#   ./run-all.sh auth smoke      # only some scripts (email and cleanup still follow unless skipped)
#   E2E_SKIP_CLEANUP=1 ./run-all.sh   # keep the test data to look at it in the app
set -u
cd "$(dirname "$0")"

export E2E_RUN_ID="${E2E_RUN_ID:-$(date +%y%m%d%H%M)-$(head -c 64 /dev/urandom | tr -dc 'a-z0-9' | head -c 4)}"
export E2E_RUN_STARTED_AT="${E2E_RUN_STARTED_AT:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"
OUT="${E2E_OUT:-$(pwd)/out}/$E2E_RUN_ID"
mkdir -p "$OUT"

PARALLEL=("$@")
if [ ${#PARALLEL[@]} -eq 0 ]; then PARALLEL=(public auth lessons calendar payments smoke); fi

echo "E2E run $E2E_RUN_ID ($([ "${DEMO:-}" = 1 ] && echo "DEMO ${BASE:-http://localhost:8505}" || echo "LIVE ${LIVE_BASE:-https://eliteeducationuae.github.io/app}")) -> $OUT"

pids=()
for s in "${PARALLEL[@]}"; do
  timeout "${E2E_SCRIPT_TIMEOUT:-1200}" node "$s.js" > "$OUT/$s.log" 2>&1 &
  pids+=($!)
done
for p in "${pids[@]}"; do wait "$p"; done

timeout "${E2E_SCRIPT_TIMEOUT:-1200}" node email.js > "$OUT/email.log" 2>&1
if [ "${E2E_SKIP_CLEANUP:-}" != 1 ]; then
  timeout "${E2E_SCRIPT_TIMEOUT:-1200}" node cleanup.js "$E2E_RUN_ID" > "$OUT/cleanup.log" 2>&1
fi

node -e '
const fs = require("fs"), path = require("path");
const dir = process.argv[1];
const order = ["public", "auth", "lessons", "calendar", "payments", "smoke", "email", "cleanup"];
const rows = fs.readdirSync(dir).filter((f) => /^[a-z]+\.json$/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
rows.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
const logs = fs.readdirSync(dir).filter((f) => f.endsWith(".log")).map((f) => f.replace(/\.log$/, ""));
for (const l of logs) if (!rows.some((r) => r.name === l)) rows.push({ name: l, status: "CRASHED", ok: 0, fail: 0, skip: 0, notes: ["no result written; see " + l + ".log"] });
const pad = (s, n) => String(s).padEnd(n);
console.log("");
console.log(pad("script", 10) + pad("result", 9) + pad("ok", 5) + pad("fail", 6) + pad("skip", 6) + "first problem or note");
console.log("-".repeat(100));
let bad = 0;
for (const r of rows) {
  if (!["PASS", "PARTIAL"].includes(r.status)) bad++;
  const first = (r.failures && r.failures[0]) || (r.notes && r.notes[0]) || "";
  console.log(pad(r.name, 10) + pad(r.status, 9) + pad(r.ok, 5) + pad(r.fail, 6) + pad(r.skip, 6) + first.slice(0, 120));
}
console.log("");
console.log("Logs, screenshots and results: " + dir);
process.exit(bad ? 1 : 0);
' "$OUT"
