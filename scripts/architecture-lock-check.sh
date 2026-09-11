#!/usr/bin/env bash
# Phase 5 — Architecture lock static guards
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

failures=()

fail() {
  failures+=("$1")
}

echo "Architecture lock check (Phase 5)..."

while IFS= read -r -d '' file; do
  rel="${file#"$ROOT"/}"
  while IFS= read -r line; do
    if [[ "$line" =~ supabase\.from\( ]]; then
      if [[ "$rel" != "src/lib/stateRemote.js" ]]; then
        fail "supabase.from outside allowlist: $rel"
      fi
    fi
  done < "$file"
done < <(find src -name '*.js' -print0)

while IFS= read -r -d '' file; do
  rel="${file#"$ROOT"/}"
  if grep -qE "from ['\"].*supabase" "$file"; then
    fail "Static supabase import in module: $rel"
  fi
done < <(find src/modules -name '*.js' -print0)

legacy_patterns=(
  'persistAccountToSupabase'
  'executeLegacyMutation'
  'runLegacyFallback'
  'createAccountLegacy'
)
for pattern in "${legacy_patterns[@]}"; do
  if grep -rq "$pattern" src; then
    fail "Legacy pattern '$pattern' still present"
  fi
done

strict_modules=(
  src/modules/categories.js
  src/modules/obligations.js
  src/modules/debts.js
  src/modules/history.js
)
mutation_re='state\.(accounts|categories|obligations|savings|debts)\.(push|filter)|state\.exchangeRate\s*=(?!=)'
for mod in "${strict_modules[@]}"; do
  if [[ -f "$mod" ]] && grep -qE "$mutation_re" "$mod"; then
    fail "Direct state mutation in strict UI module: $mod"
  fi
done

if grep -nE 'state\.exchangeRate\s*=(?!=)' src/modules/accounts.js | grep -qv 'DEFAULT_EXCHANGE_RATE'; then
  fail "Forbidden exchangeRate assignment in accounts.js"
fi

if grep -qE 'notImplementedResult|Phase 2 pending' src/modules/actionRegistry.js; then
  fail "actionRegistry.js still contains Phase 2 pending handlers"
fi

if ((${#failures[@]} == 0)); then
  echo "PASS — all architecture lock checks passed."
  exit 0
fi

echo "FAIL — ${#failures[@]} violation(s):"
for item in "${failures[@]}"; do
  echo "  - $item"
done
exit 1
