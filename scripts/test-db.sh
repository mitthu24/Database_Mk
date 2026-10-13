#!/usr/bin/env bash
# Runs the SQL/RLS test suite against a THROWAWAY local PostgreSQL cluster.
# Never connects to Supabase or any remote database.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
if [ -z "${PGBIN}" ] || [ ! -x "${PGBIN}/initdb" ]; then
  echo "PostgreSQL server binaries not found (need initdb/pg_ctl/psql, e.g. apt install postgresql)." >&2
  exit 2
fi

WORK="$(mktemp -d /var/tmp/tdm-pgtest.XXXXXX)"
chmod 755 "${WORK}"
RUN=()
if [ "$(id -u)" = "0" ]; then
  chown postgres "${WORK}"
  RUN=(runuser -u postgres --)
fi

cleanup() {
  "${RUN[@]}" "${PGBIN}/pg_ctl" -D "${WORK}/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "${WORK}"
}
trap cleanup EXIT

"${RUN[@]}" "${PGBIN}/initdb" -D "${WORK}/data" -A trust -U postgres >/dev/null
"${RUN[@]}" "${PGBIN}/pg_ctl" -D "${WORK}/data" -w -l "${WORK}/pg.log" \
  -o "-c listen_addresses='' -k ${WORK} -c fsync=off" start >/dev/null

PSQL=("${PGBIN}/psql" -X -q -h "${WORK}" -U postgres -v ON_ERROR_STOP=1)
"${PSQL[@]}" -d postgres -c "create database tdm_test" >/dev/null
PSQL+=(-d tdm_test)

LOG="${WORK}/out.log"
run_file() {
  echo "-- ${1#"${ROOT}"/}"
  if ! "${PSQL[@]}" -f "$1" >/dev/null 2>"${LOG}"; then
    grep -E "PASS|FAIL|ERROR|DETAIL|HINT|CONTEXT|LINE" "${LOG}" || cat "${LOG}"
    echo "FAILED in $1" >&2
    exit 1
  fi
  grep -E "PASS" "${LOG}" | sed 's/^psql:[^ ]* NOTICE:  /   /; s/^NOTICE:  /   /' || true
  grep -c "PASS" "${LOG}" >> "${WORK}/pass_count" || true
}

run_file "${ROOT}/tests/db/00_harness.sql"
for f in "${ROOT}"/supabase/migrations/*.sql; do run_file "$f"; done
for f in "${ROOT}"/tests/db/[1-8]*.sql; do run_file "$f"; done

echo "-- rollback guard (must refuse without confirmation)"
if "${PSQL[@]}" -f "${ROOT}/supabase/rollback/20261013160000_m1_rollback.sql" >/dev/null 2>&1; then
  echo "FAILED: rollback script ran without app.confirm_m1_rollback" >&2
  exit 1
fi
echo "   PASS: rollback refuses to run without explicit confirmation"
echo 1 >> "${WORK}/pass_count"

run_file "${ROOT}/tests/db/99_rollback.sql"

TOTAL=$(awk '{s+=$1} END {print s+0}' "${WORK}/pass_count")
echo
echo "DB tests: ${TOTAL} assertions passed (local PostgreSQL $("${PGBIN}/postgres" --version | awk '{print $3}'), Supabase emulation harness)."
