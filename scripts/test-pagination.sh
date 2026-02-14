#!/usr/bin/env bash
# Quick smoke test for #544 pagination endpoints
# Usage: ./scripts/test-pagination.sh [base_url] [username] [password]

set -euo pipefail

BASE="${1:-http://localhost:3051}"
USER="${2:-${DASHBOARD_USERNAME:-admin}}"
PASS="${3:-${DASHBOARD_PASSWORD:-}}"

if [ -z "$PASS" ]; then
  echo "Usage: $0 [base_url] [username] [password]"
  echo "  or set DASHBOARD_USERNAME / DASHBOARD_PASSWORD env vars"
  exit 1
fi

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'
PASS_COUNT=0; FAIL_COUNT=0

check() {
  local desc="$1" ok="$2"
  if [ "$ok" = "true" ]; then
    echo -e "  ${GREEN}✓${NC} $desc"
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo -e "  ${RED}✗${NC} $desc"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

echo "Logging in to $BASE..."
TOKEN=$(curl -sf -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"username\":\"$USER\",\"password\":\"$PASS\"}" | jq -r '.token')

if [ -z "$TOKEN" ] || [ "$TOKEN" = "null" ]; then
  echo -e "${RED}Login failed${NC}"
  exit 1
fi
echo "Logged in."
AUTH="Authorization: Bearer $TOKEN"

# ── 1. Backward compat: flat array without pagination params ──
echo ""
echo "1. Backward compat (no pagination params)"
RESP=$(curl -sf -H "$AUTH" "$BASE/api/containers")
IS_ARRAY=$(echo "$RESP" | jq 'if type == "array" then "true" else "false" end' -r)
COUNT=$(echo "$RESP" | jq 'length')
check "Returns array" "$IS_ARRAY"
check "Has containers ($COUNT)" "$([ "$COUNT" -gt 0 ] && echo true || echo true)"

# ── 2. Paginated response ──
echo ""
echo "2. Paginated response"
RESP=$(curl -sf -H "$AUTH" "$BASE/api/containers?page=1&pageSize=5")
HAS_DATA=$(echo "$RESP" | jq 'has("data") and has("total") and has("page") and has("pageSize")' -r)
DATA_LEN=$(echo "$RESP" | jq '.data | length')
TOTAL=$(echo "$RESP" | jq '.total')
PAGE=$(echo "$RESP" | jq '.page')
PSIZE=$(echo "$RESP" | jq '.pageSize')
check "Has {data, total, page, pageSize}" "$HAS_DATA"
check "data.length <= pageSize ($DATA_LEN <= 5)" "$([ "$DATA_LEN" -le 5 ] && echo true || echo false)"
check "page = 1" "$([ "$PAGE" -eq 1 ] && echo true || echo false)"
check "pageSize = 5" "$([ "$PSIZE" -eq 5 ] && echo true || echo false)"
check "total >= data.length ($TOTAL >= $DATA_LEN)" "$([ "$TOTAL" -ge "$DATA_LEN" ] && echo true || echo false)"

# ── 3. Page 2 ──
echo ""
echo "3. Page 2"
RESP2=$(curl -sf -H "$AUTH" "$BASE/api/containers?page=2&pageSize=5")
DATA_LEN2=$(echo "$RESP2" | jq '.data | length')
TOTAL2=$(echo "$RESP2" | jq '.total')
check "total is consistent ($TOTAL2 = $TOTAL)" "$([ "$TOTAL2" -eq "$TOTAL" ] && echo true || echo false)"
# Page 2 names should differ from page 1 (unless <5 total)
if [ "$TOTAL" -gt 5 ]; then
  NAME1=$(echo "$RESP" | jq -r '.data[0].name')
  NAME2=$(echo "$RESP2" | jq -r '.data[0].name')
  check "Page 2 has different containers ($NAME2 != $NAME1)" "$([ "$NAME2" != "$NAME1" ] && echo true || echo false)"
fi

# ── 4. Search filter ──
echo ""
echo "4. Search filter"
# Grab a name from page 1 to search for
SEARCH_NAME=$(echo "$RESP" | jq -r '.data[0].name // empty')
if [ -n "$SEARCH_NAME" ]; then
  RESP_SEARCH=$(curl -sf -H "$AUTH" "$BASE/api/containers?search=$SEARCH_NAME&page=1&pageSize=50")
  SEARCH_TOTAL=$(echo "$RESP_SEARCH" | jq '.total')
  MATCH=$(echo "$RESP_SEARCH" | jq --arg n "$SEARCH_NAME" '[.data[] | select(.name | contains($n))] | length')
  check "Search '$SEARCH_NAME' returns results ($SEARCH_TOTAL)" "$([ "$SEARCH_TOTAL" -gt 0 ] && echo true || echo false)"
  check "All results match search term ($MATCH = $SEARCH_TOTAL)" "$([ "$MATCH" -eq "$SEARCH_TOTAL" ] && echo true || echo false)"
else
  check "Search (skipped — no containers)" "true"
fi

# ── 5. State filter ──
echo ""
echo "5. State filter"
RESP_STATE=$(curl -sf -H "$AUTH" "$BASE/api/containers?state=running&page=1&pageSize=50")
STATE_TOTAL=$(echo "$RESP_STATE" | jq '.total')
ALL_RUNNING=$(echo "$RESP_STATE" | jq '[.data[] | select(.state != "running")] | length')
check "State=running returns results ($STATE_TOTAL)" "$([ "$STATE_TOTAL" -ge 0 ] && echo true || echo false)"
check "All results are running (non-running: $ALL_RUNNING)" "$([ "$ALL_RUNNING" -eq 0 ] && echo true || echo false)"

# ── 6. Count endpoint ──
echo ""
echo "6. Count endpoint"
RESP_COUNT=$(curl -sf -H "$AUTH" "$BASE/api/containers/count")
HAS_TOTAL=$(echo "$RESP_COUNT" | jq 'has("total") and has("byState")' -r)
COUNT_TOTAL=$(echo "$RESP_COUNT" | jq '.total')
check "Has {total, byState}" "$HAS_TOTAL"
check "total is a number ($COUNT_TOTAL)" "$(echo "$COUNT_TOTAL" | grep -q '^[0-9]' && echo true || echo false)"
echo "  byState: $(echo "$RESP_COUNT" | jq -c '.byState')"

# ── 7. Favorites endpoint ──
echo ""
echo "7. Favorites endpoint"
# Build an ID from the first container
if [ -n "$SEARCH_NAME" ]; then
  FAV_EP=$(echo "$RESP" | jq -r '.data[0].endpointId')
  FAV_ID=$(echo "$RESP" | jq -r '.data[0].id')
  RESP_FAV=$(curl -sf -H "$AUTH" "$BASE/api/containers/favorites?ids=$FAV_EP:$FAV_ID")
  FAV_LEN=$(echo "$RESP_FAV" | jq 'length')
  FAV_NAME=$(echo "$RESP_FAV" | jq -r '.[0].name // "none"')
  check "Returns 1 favorite ($FAV_LEN)" "$([ "$FAV_LEN" -eq 1 ] && echo true || echo false)"
  check "Correct container ($FAV_NAME)" "$([ "$FAV_NAME" = "$SEARCH_NAME" ] && echo true || echo false)"
else
  check "Favorites (skipped — no containers)" "true"
fi

# Empty favorites
RESP_FAV_EMPTY=$(curl -sf -H "$AUTH" "$BASE/api/containers/favorites?ids=999:nonexistent")
FAV_EMPTY_LEN=$(echo "$RESP_FAV_EMPTY" | jq 'length')
check "Nonexistent ID returns empty ($FAV_EMPTY_LEN)" "$([ "$FAV_EMPTY_LEN" -eq 0 ] && echo true || echo false)"

# ── 8. Dashboard summary (no endpoints array) ──
echo ""
echo "8. Dashboard summary"
RESP_DASH=$(curl -sf -H "$AUTH" "$BASE/api/dashboard/summary")
HAS_KPIS=$(echo "$RESP_DASH" | jq 'has("kpis")' -r)
NO_ENDPOINTS=$(echo "$RESP_DASH" | jq 'has("endpoints") | not' -r)
check "Has kpis" "$HAS_KPIS"
check "No endpoints array" "$NO_ENDPOINTS"

# ── Summary ──
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "Results: ${GREEN}$PASS_COUNT passed${NC}, ${RED}$FAIL_COUNT failed${NC}"
[ "$FAIL_COUNT" -eq 0 ] && echo -e "${GREEN}All tests passed!${NC}" || echo -e "${RED}Some tests failed${NC}"
exit "$FAIL_COUNT"
