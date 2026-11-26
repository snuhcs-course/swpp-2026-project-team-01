#!/usr/bin/env bash
# Wipe every account and all app data on the shared QA project, so QA starts clean.
# Usage: reset.sh            dry run: show what would be deleted
#        reset.sh --yes      wipe, then verify
set -euo pipefail

PROJECT="anelszynxtvxoxqvzgqt"   # the shared project; the only one this script touches
KEEP="'email_receivers'"          # operator-registered inbound email config, not user data
ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"

TOKEN="${SUPABASE_ACCESS_TOKEN:-}"
if [[ -z "$TOKEN" && -f "$ROOT/.env" ]]; then
  TOKEN="$(grep -E '^SUPABASE_ACCESS_TOKEN=' "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '"'"'")"
fi
[[ -n "$TOKEN" ]] || { echo "qa-reset: SUPABASE_ACCESS_TOKEN is not set (env or .env)" >&2; exit 1; }

q() {
  local body
  body="$(python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1]}))' "$1")"
  local out
  # The token goes to curl on stdin, not argv, so it never shows in a process list.
  if ! out="$(curl -sS --max-time 120 --fail-with-body -K - -X POST \
      "https://api.supabase.com/v1/projects/$PROJECT/database/query" \
      -H "Content-Type: application/json" --data-binary "$body" \
      <<<"header = \"Authorization: Bearer $TOKEN\"")"; then
    echo "qa-reset: query failed: $out" >&2
    return 1
  fi
  printf '%s' "$out"
}

COUNTS="select coalesce(json_agg(json_build_object('table', t, 'rows', n) order by n desc), '[]') as tables
from (select schemaname || '.' || tablename as t,
             (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, tablename), false, true, '')))[1]::text::bigint as n
      from pg_tables where schemaname = 'app' and tablename not in ($KEEP)
      union all select 'auth.users', count(*) from auth.users) s where n > 0"

echo "Project: $PROJECT"
echo "Rows that would be deleted:"
q "$COUNTS" | python3 -c 'import json,sys; r=json.load(sys.stdin)[0]["tables"]; [print("  %s: %s" % (x["table"], x["rows"])) for x in r] or print("  (none, already clean)")'

if [[ "${1:-}" != "--yes" ]]; then
  echo "Dry run only. Re-run with --yes to wipe."
  exit 0
fi

# One statement, so it is one transaction: either everything goes or nothing does.
WIPE="DO \$\$
DECLARE tables text;
BEGIN
  SELECT string_agg(format('%I.%I', schemaname, tablename), ', ') INTO tables
  FROM pg_tables WHERE schemaname = 'app' AND tablename NOT IN ($KEEP);
  IF tables IS NOT NULL THEN
    EXECUTE 'TRUNCATE ' || tables || ' RESTART IDENTITY';
  END IF;
  DELETE FROM auth.users;              -- cascades to identities, sessions, refresh tokens, MFA
  DELETE FROM auth.sessions;
  DELETE FROM auth.refresh_tokens;
  DELETE FROM auth.saml_relay_states;  -- references flow_state, so DELETE rather than TRUNCATE
  DELETE FROM auth.flow_state;
  DELETE FROM auth.one_time_tokens;
  DELETE FROM auth.audit_log_entries;
END \$\$"

echo "Wiping..."
q "$WIPE" >/dev/null

echo "Verifying:"
q "select (select count(*) from auth.users) as auth_users,
          (select coalesce(sum((xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, tablename), false, true, '')))[1]::text::bigint), 0)
             from pg_tables where schemaname = 'app' and tablename not in ($KEEP)) as app_rows,
          (select count(*) from app.email_receivers) as email_receivers_kept" \
  | python3 -c 'import json,sys; r=json.load(sys.stdin)[0]; print("  ", r); sys.exit(0 if int(r["auth_users"])==0 and int(r["app_rows"])==0 else 1)'
echo "  findmeatime.com: $(curl -s --max-time 15 -o /dev/null -w '%{http_code}' https://findmeatime.com || true)"
echo "Done. The shared project is clean."
