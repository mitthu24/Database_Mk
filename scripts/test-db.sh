#!/usr/bin/env bash
# Runs the SQL/RLS test suite against a THROWAWAY local PostgreSQL cluster.
# Never connects to Supabase or any remote database.
#
# The suite runs in two modes (override with DB_TEST_MODES="explicit"):
#   explicit : NO default grants on new public objects (current Supabase default)
#   legacy   : old permissive default grants to anon/authenticated/service_role
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

"${RUN[@]}" "${PGBIN}/initdb" -D "${WORK}/data" -A trust -U postgres -E UTF8 --locale=C.UTF-8 >/dev/null
"${RUN[@]}" "${PGBIN}/pg_ctl" -D "${WORK}/data" -w -l "${WORK}/pg.log" \
  -o "-c listen_addresses='' -k ${WORK} -c fsync=off" start >/dev/null

psql_db() { # psql_db <db> <psql args...>
  local db="$1"; shift
  "${PGBIN}/psql" -X -q -h "${WORK}" -U postgres -v ON_ERROR_STOP=1 -v root="${ROOT}" -d "${db}" "$@"
}

LOG="${WORK}/out.log"
PASS_FILE="${WORK}/pass_count"
run_file() { # run_file <db> <file>
  echo "-- ${2#"${ROOT}"/}"
  if ! psql_db "$1" -f "$2" >/dev/null 2>"${LOG}"; then
    grep -E "PASS|FAIL|ERROR|DETAIL|HINT|CONTEXT|LINE" "${LOG}" || cat "${LOG}"
    echo "FAILED in $2 (mode database $1)" >&2
    exit 1
  fi
  grep -E "PASS" "${LOG}" | sed 's/^psql:[^ ]* NOTICE:  /   /; s/^NOTICE:  /   /' || true
  grep -c "PASS" "${LOG}" >> "${PASS_FILE}" || true
}

run_suite() { # run_suite <mode>
  local mode="$1" db="tdm_$1"
  echo
  echo "================ mode: ${mode} ================"
  psql_db postgres -c "create database ${db}" >/dev/null

  run_file "${db}" "${ROOT}/tests/db/00_harness.sql"
  if [ "${mode}" = "legacy" ]; then
    run_file "${db}" "${ROOT}/tests/db/00a_legacy_default_grants.sql"
  fi
  for f in "${ROOT}"/supabase/migrations/*.sql; do run_file "${db}" "$f"; done
  for f in "${ROOT}"/tests/db/[1-8]*.sql; do run_file "${db}" "$f"; done

  # Optional extra SQL file (e.g. a benchmark) run against the fully migrated schema.
  if [ -n "${DB_TEST_EXTRA:-}" ] && [ "${mode}" = "explicit" ]; then
    echo "-- extra: ${DB_TEST_EXTRA}"
    psql_db "${db}" -f "${DB_TEST_EXTRA}" 2>&1 | grep -vE "^(SET|RESET)$" || true
  fi

  echo "-- rollback guard (must refuse without confirmation)"
  if psql_db "${db}" -f "${ROOT}/supabase/rollback/20261013160000_m1_rollback.sql" >/dev/null 2>&1; then
    echo "FAILED: rollback script ran without app.confirm_m1_rollback" >&2
    exit 1
  fi
  echo "   PASS: rollback refuses to run without explicit confirmation"
  echo 1 >> "${PASS_FILE}"
  if psql_db "${db}" -f "${ROOT}/supabase/rollback/20261013170000_m2_rollback.sql" >/dev/null 2>&1; then
    echo "FAILED: M2 rollback script ran without app.confirm_m2_rollback" >&2
    exit 1
  fi
  echo "   PASS: the M2+ rollback also refuses without explicit confirmation"
  echo 1 >> "${PASS_FILE}"
  if psql_db "${db}" -c "set app.confirm_m1_rollback = 'yes'" -f "${ROOT}/supabase/rollback/20261013160000_m1_rollback.sql" >/dev/null 2>&1; then
    echo "FAILED: the M1 rollback ran while M2+ objects still depend on it" >&2
    exit 1
  fi
  echo "   PASS: the M1 rollback refuses while M2+ objects depend on its tables (must roll back M2+ first)"
  echo 1 >> "${PASS_FILE}"

  run_file "${db}" "${ROOT}/tests/db/99_rollback.sql"
}

for MODE in ${DB_TEST_MODES:-explicit legacy}; do
  case "${MODE}" in explicit|legacy) run_suite "${MODE}" ;; *) echo "unknown mode ${MODE}" >&2; exit 2 ;; esac
done

echo
echo "================ migration atomicity ================"
echo "-- a name collision mid-file must leave NOTHING behind"
psql_db postgres -c "create database tdm_collision" >/dev/null
run_file tdm_collision "${ROOT}/tests/db/00_harness.sql" >/dev/null
psql_db tdm_collision -c "create table public.subscriptions (preexisting int)" >/dev/null
if COLL_ERR=$(psql_db tdm_collision -f "${ROOT}/supabase/migrations/20261013160000_m1_01_tables.sql" 2>&1 >/dev/null); then
  echo "FAILED: migration 01 succeeded despite a colliding public.subscriptions" >&2
  exit 1
fi
echo "${COLL_ERR}" | grep -q 'relation "subscriptions" already exists' || {
  echo "FAILED: migration 01 failed for an unexpected reason: ${COLL_ERR}" >&2
  exit 1
}
LEFT=$(psql_db tdm_collision -At -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('profiles','founders','companies','company_members')")
SCHEMA=$(psql_db tdm_collision -At -c "select count(*) from pg_namespace where nspname='private'")
if [ "${LEFT}" != "0" ] || [ "${SCHEMA}" != "0" ]; then
  echo "FAILED: partial migration left objects behind (tables=${LEFT}, private schema=${SCHEMA})" >&2
  exit 1
fi
KEPT=$(psql_db tdm_collision -At -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='subscriptions'")
[ "${KEPT}" = "1" ] || { echo "FAILED: pre-existing table was disturbed" >&2; exit 1; }
echo "   PASS: failed migration rolled back completely and left the pre-existing table untouched"
echo 1 >> "${PASS_FILE}"

TOTAL=$(awk '{s+=$1} END {print s+0}' "${PASS_FILE}")
echo
echo "DB tests: ${TOTAL} assertions passed across modes [${DB_TEST_MODES:-explicit legacy}] (local PostgreSQL $("${PGBIN}/postgres" --version | awk '{print $3}'), Supabase emulation harness)."
