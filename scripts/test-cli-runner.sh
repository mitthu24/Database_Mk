#!/usr/bin/env bash
# Exercises the REAL Supabase CLI migration runner (supabase db push) against a
# THROWAWAY local PostgreSQL (127.0.0.1 only; never a Supabase project). Proves:
#   - the four migration files apply in order with their explicit BEGIN/COMMIT,
#   - migration history is recorded, a re-push is a no-op,
#   - a mid-file failure leaves nothing behind and records nothing,
#   - the "applied but not recorded" gap is detected and fixable with `migration repair`,
#   - the RLS suite and the post-apply verification pass on the CLI-applied schema.
# Needs: PostgreSQL server binaries, and the CLI (npx downloads it; override with SUPABASE_CLI).
# Usage: scripts/test-cli-runner.sh [explicit|legacy]   (default explicit)
set -uo pipefail

MODE="${1:-explicit}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -x "${PGBIN}/initdb" ] || { echo "PostgreSQL server binaries not found." >&2; exit 2; }
CLI=(${SUPABASE_CLI:-npx --yes supabase})

WORK="$(mktemp -d /var/tmp/tdm-clitest.XXXXXX)"; chmod 755 "${WORK}"
RUN=(); [ "$(id -u)" = "0" ] && { chown postgres "${WORK}"; RUN=(runuser -u postgres --); }
cd "${WORK}"   # the CLI writes state into its working directory; never into the repo
PORT=$((54000 + RANDOM % 900))
cleanup() { "${RUN[@]}" "${PGBIN}/pg_ctl" -D "${WORK}/data" -m immediate stop >/dev/null 2>&1; rm -rf "${WORK}"; }
trap cleanup EXIT
fail() { echo "FAILED: $*" >&2; exit 1; }
ok() { echo "   PASS: $*"; }

"${RUN[@]}" "${PGBIN}/initdb" -D "${WORK}/data" -A trust -U postgres >/dev/null
"${RUN[@]}" "${PGBIN}/pg_ctl" -D "${WORK}/data" -w -l "${WORK}/pg.log" \
  -o "-c listen_addresses=127.0.0.1 -p ${PORT} -k ${WORK} -c fsync=off" start >/dev/null
P=("${PGBIN}/psql" -X -q -h 127.0.0.1 -p "${PORT}" -U postgres -v ON_ERROR_STOP=1 -v root="${ROOT}")
url() { echo "postgresql://postgres@127.0.0.1:${PORT}/$1?sslmode=disable"; }
newdb() { # newdb <name>  (+ Supabase emulation harness in the selected default-grant mode)
  "${P[@]}" -d postgres -c "create database $1" >/dev/null
  "${P[@]}" -d "$1" -f "${ROOT}/tests/db/00_harness.sql" >/dev/null
  [ "${MODE}" = "legacy" ] && "${P[@]}" -d "$1" -f "${ROOT}/tests/db/00a_legacy_default_grants.sql" >/dev/null
  return 0
}

W="${WORK}/proj"; mkdir -p "${W}/supabase/migrations"
cp "${ROOT}"/supabase/migrations/*.sql "${W}/supabase/migrations/"   # copies; the repo is untouched
"${CLI[@]}" init --workdir "${W}" --force >/dev/null 2>&1 || fail "supabase init"
echo "Supabase CLI $("${CLI[@]}" --version 2>&1 | tail -1) | default-grant mode: ${MODE} | local PostgreSQL only"

echo "-- 1. dry-run lists the seven files"
newdb cli_ok
N=$("${CLI[@]}" db push --workdir "${W}" --db-url "$(url cli_ok)" --dry-run 2>&1 | grep -cE "m[12]_0[1-7]_")
[ "$((N))" -ge 7 ] || fail "dry-run did not list seven migrations"
ok "dry-run lists the migrations without applying (tables: $("${P[@]}" -d cli_ok -At -c "select count(*) from pg_class where relname='companies'"))"

echo "-- 2. real push applies 01-07 and records history"
"${CLI[@]}" db push --workdir "${W}" --db-url "$(url cli_ok)" --yes >"${WORK}/push.log" 2>&1 || { cat "${WORK}/push.log"; fail "db push"; }
[ "$("${P[@]}" -d cli_ok -At -c "select count(*) from supabase_migrations.schema_migrations")" = "7" ] || fail "history rows != 7"
[ "$("${P[@]}" -d cli_ok -At -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'")" = "12" ] || fail "expected 12 tables"
ok "seven migrations applied, seven history rows, twelve tables"

echo "-- 3. RLS suite + post-apply verification on the CLI-applied schema"
PASS=0
for f in "${ROOT}/tests/db/10_fixtures.sql" "${ROOT}"/tests/db/[2-8]*.sql; do
  out=$("${P[@]}" -d cli_ok -f "$f" 2>&1 >/dev/null) || { echo "${out}" | grep -E "FAIL|ERROR" | head -3; fail "$f"; }
  PASS=$((PASS + $(echo "${out}" | grep -c "PASS:")))
done
ok "${PASS} RLS assertions passed on the schema applied by the real CLI"
BAD=$("${P[@]}" -d cli_ok -At -F'|' -f "${ROOT}/docs/m1-post-apply-verification.sql" | grep -c '|f$' || true)
[ "${BAD}" = "0" ] || fail "post-apply verification has ${BAD} failing rows"
ok "docs/m1-post-apply-verification.sql: every check true"

echo "-- 4. re-push is a no-op"
"${CLI[@]}" db push --workdir "${W}" --db-url "$(url cli_ok)" --yes 2>&1 | grep -q "up to date" || fail "re-push not a no-op"
ok "remote database is up to date"

echo "-- 5. mid-file failure leaves nothing behind"
newdb cli_coll
"${P[@]}" -d cli_coll -c "create table public.subscriptions (preexisting int)" >/dev/null
OUT=$("${CLI[@]}" db push --workdir "${W}" --db-url "$(url cli_coll)" --yes 2>&1) && fail "push succeeded despite collision"
echo "${OUT}" | grep -q 'relation \\"subscriptions\\" already exists' || fail "unexpected failure reason: ${OUT}"
LEFT=$("${P[@]}" -d cli_coll -At -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ('profiles','founders','companies','company_members')")
PRIV=$("${P[@]}" -d cli_coll -At -c "select count(*) from pg_namespace where nspname='private'")
HIST=$("${P[@]}" -d cli_coll -At -c "select count(*) from supabase_migrations.schema_migrations")
[ "${LEFT}" = "0" ] && [ "${PRIV}" = "0" ] && [ "${HIST}" = "0" ] || fail "partial state: tables=${LEFT} private=${PRIV} history=${HIST}"
ok "collision reported at the right statement; 0 tables, no private schema, 0 history rows"

echo "-- 6. applied-but-unrecorded gap is detected and repairable"
"${P[@]}" -d cli_ok -c "delete from supabase_migrations.schema_migrations where version='20261013160000'" >/dev/null
OUT=$("${CLI[@]}" db push --workdir "${W}" --db-url "$(url cli_ok)" --yes 2>&1) && fail "push should refuse the out-of-order history"
echo "${OUT}" | grep -q "DbPushMissingRemoteError" || fail "unexpected response: ${OUT}"
"${CLI[@]}" migration repair --workdir "${W}" --db-url "$(url cli_ok)" --status applied 20261013160000 >/dev/null 2>&1 || fail "repair"
"${CLI[@]}" db push --workdir "${W}" --db-url "$(url cli_ok)" --yes 2>&1 | grep -q "up to date" || fail "not up to date after repair"
ok "CLI refuses to re-apply; 'migration repair --status applied' restores the history"

echo
echo "CLI runner test (${MODE} mode): all checks passed."
