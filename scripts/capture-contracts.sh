#!/usr/bin/env bash
# Regenerates tests/fixtures/contracts/*.json from the REAL SQL functions running on a
# throwaway local PostgreSQL (after the full test suite), then normalises ids and
# timestamps so the committed fixtures are stable. Run: npm run capture:contracts
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DB_TEST_MODES=explicit DB_TEST_EXTRA="${ROOT}/tests/db/capture_contracts.sql" "${ROOT}/scripts/test-db.sh" >/dev/null
python3 - "$ROOT/tests/fixtures/contracts" <<'PY'
import json, re, sys, pathlib
d = pathlib.Path(sys.argv[1])
uuid_re = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
ts_re = re.compile(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?[+-]\d{2}:\d{2}')
for f in sorted(d.glob('*.json')):
    text = f.read_text()
    if not text.strip():
        raise SystemExit(f"empty capture: {f.name}")
    ids = {}
    def uu(m):
        ids.setdefault(m.group(0), "00000000-0000-4000-8000-%012d" % (len(ids) + 1))
        return ids[m.group(0)]
    text = uuid_re.sub(uu, text)
    text = ts_re.sub("2026-01-01T00:00:00+00:00", text)
    json.loads(text)  # must be valid JSON
    f.write_text(text.rstrip() + "\n")
print("captured", len(list(d.glob('*.json'))), "contract fixtures")
PY
