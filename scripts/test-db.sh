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

# Optional extra SQL file (e.g. a benchmark) run against the fully migrated schema.
if [ -n "${DB_TEST_EXTRA:-}" ]; then
  echo "-- extra: ${DB_TEST_EXTRA}"
  "${PSQL[@]}" -f "${DB_TEST_EXTRA}" 2>&1 | grep -vE "^(SET|RESET)$" || true
fi

echo "-- rollback guard (must refuse without confirmation)"
if "${PSQL[@]}" -f "${ROOT}/supabase/rollback/20261013160000_m1_rollback.sql" >/dev/null 2>&1; then
  echo "FAILED: rollback script ran without app.confirm_m1_rollback" >&2
  exit 1
fi
echo "   PASS: rollback refuses to run without explicit confirmation"
echo 1 >> "${WORK}/pass_count"

run_file "${ROOT}/tests/db/99_rollback.sql"

echo "-- migration atomicity: a name collision mid-file must leave NOTHING behind"
"${PSQL[@]%-d tdm_test}" -d postgres -c "create database tdm_collision" >/dev/null
COLL=("${PGBIN}/psql" -X -q -h "${WORK}" -U postgres -v ON_ERROR_STOP=1 -d tdm_collision)
"${COLL[@]}" -f "${ROOT}/tests/db/00_harness.sql" >/dev/null
"${COLL[@]}" -c "create table public.subscriptions (preexisting int)" >/dev/null
if COLL_ERR=$("${COLL[@]}" -f "${ROOT}/supabase/migrations/20261013160000_m1_01_tables.sql" 2>&1 >/dev/null); then
  echo "FAILED: migration 01 succeeded despite a colliding public.subscriptions" >&2
  exit 1
fi
# It must have failed for the intended reason, not because the harness was broken.
echo "${COLL_ERR}" | grep -q 'relation "subscriptions" already exists' || {
  echo "FAILED: migration 01 failed for an unexpected reason: ${COLL_ERR}" >&2
  exit 1
}
LEFT=$("${COLL[@]}" -At -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('profiles','founders','companies','company_members')")
SCHEMA=$("${COLL[@]}" -At -c "select count(*) from pg_namespace where nspname='private'")
if [ "${LEFT}" != "0" ] || [ "${SCHEMA}" != "0" ]; then
  echo "FAILED: partial migration left objects behind (tables=${LEFT}, private schema=${SCHEMA})" >&2
  exit 1
fi
KEPT=$("${COLL[@]}" -At -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='subscriptions'")
[ "${KEPT}" = "1" ] || { echo "FAILED: pre-existing table was disturbed" >&2; exit 1; }
echo "   PASS: failed migration rolled back completely and left the pre-existing table untouched"
echo 1 >> "${WORK}/pass_count"

TOTAL=$(awk '{s+=$1} END {print s+0}' "${WORK}/pass_count")
echo
echo "DB tests: ${TOTAL} assertions passed (local PostgreSQL $("${PGBIN}/postgres" --version | awk '{print $3}'), Supabase emulation harness)."
