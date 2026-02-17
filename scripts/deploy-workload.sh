#!/bin/bash
# Deploy multi-stack dummy workloads to Portainer
# Usage: ./scripts/deploy-workload.sh [start|stop|delete|status|restart]
#
# Stacks (deployed in this order):
#   1. data-services    — Postgres, Redis, RabbitMQ
#   2. web-platform     — Web tier + API gateway + cron
#   3. workers          — Workers + app-api + app-worker-queue
#   4. staging-dev      — Staging + dev environments + monitoring
#   5. issue-simulators — Issue containers + heavy-load stress containers
#
# Shared external networks:
#   app-frontend-net — web-platform <-> issue-simulators (net-chatter)
#   app-backend-net  — data-services <-> workers <-> web-platform (gateway)

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_DIR="$PROJECT_DIR/workloads"

# Stack names in deployment order (data-services first since others depend on it)
STACK_NAMES=("data-services" "web-platform" "workers" "staging-dev" "issue-simulators")
EXTERNAL_NETWORKS=("app-frontend-net" "app-backend-net")

# Load environment variables
if [ -f "$PROJECT_DIR/.env" ]; then
  # shellcheck disable=SC2046
  export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

PORTAINER_URL="${PORTAINER_API_URL:-http://localhost:9000}"
API_KEY="${PORTAINER_API_KEY}"

if [ -z "$API_KEY" ]; then
  echo "Error: PORTAINER_API_KEY not set in .env file"
  exit 1
fi

# Get endpoint ID (assumes first endpoint)
get_endpoint_id() {
  curl -s -H "X-API-Key: $API_KEY" "$PORTAINER_URL/api/endpoints" | jq -r '.[0].Id'
}

# Get stack ID by name
get_stack_id() {
  local name="$1"
  curl -s -H "X-API-Key: $API_KEY" "$PORTAINER_URL/api/stacks" | \
    jq -r ".[] | select(.Name == \"$name\") | .Id"
}

# Check if Portainer is available
check_portainer() {
  if ! curl -s -f "$PORTAINER_URL/api/status" > /dev/null 2>&1; then
    echo "Error: Cannot connect to Portainer at $PORTAINER_URL"
    exit 1
  fi
}

# Create external Docker networks (idempotent)
create_external_networks() {
  echo "==> Ensuring external networks exist..."
  for NET in "${EXTERNAL_NETWORKS[@]}"; do
    if docker network inspect "$NET" > /dev/null 2>&1; then
      echo "    $NET: already exists"
    else
      docker network create "$NET"
      echo "    $NET: created"
    fi
  done
  echo ""
}

# Remove external Docker networks
remove_external_networks() {
  echo "==> Removing external networks..."
  for NET in "${EXTERNAL_NETWORKS[@]}"; do
    if docker network inspect "$NET" > /dev/null 2>&1; then
      docker network rm "$NET" 2>/dev/null && echo "    $NET: removed" || echo "    $NET: in use, skipped"
    else
      echo "    $NET: not found"
    fi
  done
  echo ""
}

# Deploy a single stack
deploy_one_stack() {
  local STACK_NAME="$1"
  local COMPOSE_FILE="$COMPOSE_DIR/$STACK_NAME.yml"
  local ENDPOINT_ID="$2"

  if [ ! -f "$COMPOSE_FILE" ]; then
    echo "    Error: $COMPOSE_FILE not found"
    return 1
  fi

  EXISTING_STACK_ID=$(get_stack_id "$STACK_NAME")

  if [ -n "$EXISTING_STACK_ID" ] && [ "$EXISTING_STACK_ID" != "null" ]; then
    echo "    Already exists (ID: $EXISTING_STACK_ID), starting..."

    RESULT=$(curl -s -X POST \
      -H "X-API-Key: $API_KEY" \
      "$PORTAINER_URL/api/stacks/$EXISTING_STACK_ID/start?endpointId=$ENDPOINT_ID")

    if echo "$RESULT" | jq -e '.message' > /dev/null 2>&1; then
      MSG=$(echo "$RESULT" | jq -r '.message')
      if [[ "$MSG" == *"already running"* ]] || [[ "$MSG" == *"active"* ]]; then
        echo "    Already running"
      else
        echo "    Warning: $MSG"
      fi
    else
      echo "    Started"
    fi
  else
    echo "    Creating new stack..."

    STACK_CONTENT=$(cat "$COMPOSE_FILE")

    RESULT=$(curl -s -X POST \
      -H "X-API-Key: $API_KEY" \
      -H "Content-Type: application/json" \
      "$PORTAINER_URL/api/stacks/create/standalone/string?endpointId=$ENDPOINT_ID" \
      -d "$(jq -n --arg name "$STACK_NAME" --arg content "$STACK_CONTENT" \
        '{Name: $name, StackFileContent: $content}')")

    if echo "$RESULT" | jq -e '.Id' > /dev/null 2>&1; then
      STACK_ID=$(echo "$RESULT" | jq -r '.Id')
      echo "    Created (ID: $STACK_ID)"
    else
      echo "    Error: $(echo "$RESULT" | jq -r '.message // .details // "Unknown error"')"
      return 1
    fi
  fi
}

# Deploy all stacks
deploy_stacks() {
  check_portainer
  create_external_networks

  ENDPOINT_ID=$(get_endpoint_id)
  if [ -z "$ENDPOINT_ID" ] || [ "$ENDPOINT_ID" == "null" ]; then
    echo "Error: No endpoints found in Portainer"
    exit 1
  fi

  echo "==> Deploying ${#STACK_NAMES[@]} stacks..."
  echo ""

  for STACK_NAME in "${STACK_NAMES[@]}"; do
    echo "--- $STACK_NAME ---"
    deploy_one_stack "$STACK_NAME" "$ENDPOINT_ID"
    echo ""
    # Brief pause between stacks to let services start
    sleep 2
  done

  echo "All stacks deployed."
}

# Stop a single stack
stop_one_stack() {
  local STACK_NAME="$1"
  local ENDPOINT_ID="$2"

  STACK_ID=$(get_stack_id "$STACK_NAME")

  if [ -z "$STACK_ID" ] || [ "$STACK_ID" == "null" ]; then
    echo "    Not found, skipping"
    return 0
  fi

  RESULT=$(curl -s -X POST \
    -H "X-API-Key: $API_KEY" \
    "$PORTAINER_URL/api/stacks/$STACK_ID/stop?endpointId=$ENDPOINT_ID")

  if echo "$RESULT" | jq -e '.message' > /dev/null 2>&1; then
    MSG=$(echo "$RESULT" | jq -r '.message')
    if [[ "$MSG" == *"already"* ]] || [[ "$MSG" == *"inactive"* ]]; then
      echo "    Already stopped"
    else
      echo "    Warning: $MSG"
    fi
  else
    echo "    Stopped"
  fi
}

# Stop all stacks (reverse order)
stop_stacks() {
  check_portainer

  ENDPOINT_ID=$(get_endpoint_id)

  echo "==> Stopping stacks (reverse order)..."
  echo ""

  # Reverse iteration
  for (( i=${#STACK_NAMES[@]}-1; i>=0; i-- )); do
    STACK_NAME="${STACK_NAMES[$i]}"
    echo "--- $STACK_NAME ---"
    stop_one_stack "$STACK_NAME" "$ENDPOINT_ID"
    echo ""
  done

  echo "All stacks stopped."
}

# Delete a single stack
delete_one_stack() {
  local STACK_NAME="$1"
  local ENDPOINT_ID="$2"

  STACK_ID=$(get_stack_id "$STACK_NAME")

  if [ -z "$STACK_ID" ] || [ "$STACK_ID" == "null" ]; then
    echo "    Not found, skipping"
    return 0
  fi

  curl -s -X DELETE \
    -H "X-API-Key: $API_KEY" \
    "$PORTAINER_URL/api/stacks/$STACK_ID?endpointId=$ENDPOINT_ID" > /dev/null

  echo "    Deleted"
}

# Delete all stacks + external networks
delete_stacks() {
  check_portainer

  ENDPOINT_ID=$(get_endpoint_id)

  echo "==> Deleting stacks (reverse order)..."
  echo ""

  for (( i=${#STACK_NAMES[@]}-1; i>=0; i-- )); do
    STACK_NAME="${STACK_NAMES[$i]}"
    echo "--- $STACK_NAME ---"
    delete_one_stack "$STACK_NAME" "$ENDPOINT_ID"
    echo ""
  done

  remove_external_networks

  echo "All stacks and networks removed."
}

# Show status of all stacks
show_status() {
  check_portainer

  ENDPOINT_ID=$(get_endpoint_id)

  echo "==> Stack Status"
  echo ""
  printf "%-20s %-8s %-12s %s\n" "STACK" "ID" "STATUS" "CONTAINERS"
  printf "%-20s %-8s %-12s %s\n" "-----" "--" "------" "----------"

  for STACK_NAME in "${STACK_NAMES[@]}"; do
    STACK_ID=$(get_stack_id "$STACK_NAME")

    if [ -z "$STACK_ID" ] || [ "$STACK_ID" == "null" ]; then
      printf "%-20s %-8s %-12s %s\n" "$STACK_NAME" "-" "Not found" "-"
      continue
    fi

    STACK_INFO=$(curl -s -H "X-API-Key: $API_KEY" "$PORTAINER_URL/api/stacks/$STACK_ID")
    STATUS=$(echo "$STACK_INFO" | jq -r 'if .Status == 1 then "Active" else "Inactive" end')

    CONTAINERS=$(curl -s -H "X-API-Key: $API_KEY" \
      "$PORTAINER_URL/api/endpoints/$ENDPOINT_ID/docker/containers/json?all=true" | \
      jq "[.[] | select(.Labels[\"com.docker.compose.project\"] == \"$STACK_NAME\")] | length")

    printf "%-20s %-8s %-12s %s\n" "$STACK_NAME" "$STACK_ID" "$STATUS" "$CONTAINERS"
  done

  echo ""

  # Show network status
  echo "==> External Networks"
  for NET in "${EXTERNAL_NETWORKS[@]}"; do
    if docker network inspect "$NET" > /dev/null 2>&1; then
      ATTACHED=$(docker network inspect "$NET" --format '{{len .Containers}}')
      echo "    $NET: active ($ATTACHED containers)"
    else
      echo "    $NET: not found"
    fi
  done
}

# Main
case "${1:-start}" in
  start|deploy)
    deploy_stacks
    ;;
  stop)
    stop_stacks
    ;;
  delete|remove)
    delete_stacks
    ;;
  status)
    show_status
    ;;
  restart)
    stop_stacks
    sleep 3
    deploy_stacks
    ;;
  *)
    echo "Usage: $0 [start|stop|delete|status|restart]"
    echo ""
    echo "Commands:"
    echo "  start    Deploy all workload stacks (default)"
    echo "  stop     Stop all stacks (reverse order)"
    echo "  delete   Delete all stacks and external networks"
    echo "  status   Show status of all stacks"
    echo "  restart  Stop then start all stacks"
    echo ""
    echo "Stacks: ${STACK_NAMES[*]}"
    exit 1
    ;;
esac
