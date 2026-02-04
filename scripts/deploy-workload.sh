#!/bin/bash
# Deploy dummy workload stack to Portainer
# Usage: ./scripts/deploy-workload.sh [start|stop|status]

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load environment variables
if [ -f "$PROJECT_DIR/.env" ]; then
  export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

PORTAINER_URL="${PORTAINER_API_URL:-http://localhost:9000}"
API_KEY="${PORTAINER_API_KEY}"
STACK_NAME="dummy-workload"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.workload.yml"

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
  curl -s -H "X-API-Key: $API_KEY" "$PORTAINER_URL/api/stacks" | \
    jq -r ".[] | select(.Name == \"$STACK_NAME\") | .Id"
}

# Check if Portainer is available
check_portainer() {
  if ! curl -s -f "$PORTAINER_URL/api/status" > /dev/null 2>&1; then
    echo "Error: Cannot connect to Portainer at $PORTAINER_URL"
    exit 1
  fi
}

# Deploy stack
deploy_stack() {
  check_portainer

  ENDPOINT_ID=$(get_endpoint_id)
  if [ -z "$ENDPOINT_ID" ] || [ "$ENDPOINT_ID" == "null" ]; then
    echo "Error: No endpoints found in Portainer"
    exit 1
  fi

  EXISTING_STACK_ID=$(get_stack_id)

  if [ -n "$EXISTING_STACK_ID" ] && [ "$EXISTING_STACK_ID" != "null" ]; then
    echo "Stack '$STACK_NAME' already exists (ID: $EXISTING_STACK_ID)"
    echo "Starting existing stack..."

    RESULT=$(curl -s -X POST \
      -H "X-API-Key: $API_KEY" \
      "$PORTAINER_URL/api/stacks/$EXISTING_STACK_ID/start?endpointId=$ENDPOINT_ID")

    if echo "$RESULT" | jq -e '.message' > /dev/null 2>&1; then
      # Check if it's just "already running"
      MSG=$(echo "$RESULT" | jq -r '.message')
      if [[ "$MSG" == *"already running"* ]] || [[ "$MSG" == *"active"* ]]; then
        echo "Stack is already running"
      else
        echo "Warning: $MSG"
      fi
    else
      echo "Stack started successfully"
    fi
  else
    echo "Creating new stack '$STACK_NAME'..."

    STACK_CONTENT=$(cat "$COMPOSE_FILE")

    RESULT=$(curl -s -X POST \
      -H "X-API-Key: $API_KEY" \
      -H "Content-Type: application/json" \
      "$PORTAINER_URL/api/stacks/create/standalone/string?endpointId=$ENDPOINT_ID" \
      -d "$(jq -n --arg name "$STACK_NAME" --arg content "$STACK_CONTENT" \
        '{Name: $name, StackFileContent: $content}')")

    if echo "$RESULT" | jq -e '.Id' > /dev/null 2>&1; then
      STACK_ID=$(echo "$RESULT" | jq -r '.Id')
      echo "Stack created successfully (ID: $STACK_ID)"
    else
      echo "Error: $(echo "$RESULT" | jq -r '.message // .details // "Unknown error"')"
      exit 1
    fi
  fi
}

# Stop stack
stop_stack() {
  check_portainer

  ENDPOINT_ID=$(get_endpoint_id)
  STACK_ID=$(get_stack_id)

  if [ -z "$STACK_ID" ] || [ "$STACK_ID" == "null" ]; then
    echo "Stack '$STACK_NAME' not found"
    exit 0
  fi

  echo "Stopping stack '$STACK_NAME' (ID: $STACK_ID)..."

  RESULT=$(curl -s -X POST \
    -H "X-API-Key: $API_KEY" \
    "$PORTAINER_URL/api/stacks/$STACK_ID/stop?endpointId=$ENDPOINT_ID")

  if echo "$RESULT" | jq -e '.message' > /dev/null 2>&1; then
    MSG=$(echo "$RESULT" | jq -r '.message')
    if [[ "$MSG" == *"already"* ]] || [[ "$MSG" == *"inactive"* ]]; then
      echo "Stack is already stopped"
    else
      echo "Warning: $MSG"
    fi
  else
    echo "Stack stopped successfully"
  fi
}

# Delete stack
delete_stack() {
  check_portainer

  ENDPOINT_ID=$(get_endpoint_id)
  STACK_ID=$(get_stack_id)

  if [ -z "$STACK_ID" ] || [ "$STACK_ID" == "null" ]; then
    echo "Stack '$STACK_NAME' not found"
    exit 0
  fi

  echo "Deleting stack '$STACK_NAME' (ID: $STACK_ID)..."

  curl -s -X DELETE \
    -H "X-API-Key: $API_KEY" \
    "$PORTAINER_URL/api/stacks/$STACK_ID?endpointId=$ENDPOINT_ID" > /dev/null

  echo "Stack deleted successfully"
}

# Show stack status
show_status() {
  check_portainer

  STACK_ID=$(get_stack_id)

  if [ -z "$STACK_ID" ] || [ "$STACK_ID" == "null" ]; then
    echo "Stack '$STACK_NAME' not found in Portainer"
    exit 0
  fi

  STACK_INFO=$(curl -s -H "X-API-Key: $API_KEY" "$PORTAINER_URL/api/stacks/$STACK_ID")

  echo "Stack: $STACK_NAME"
  echo "ID: $STACK_ID"
  echo "Status: $(echo "$STACK_INFO" | jq -r 'if .Status == 1 then "Active" else "Inactive" end')"

  # Count containers
  ENDPOINT_ID=$(get_endpoint_id)
  CONTAINERS=$(curl -s -H "X-API-Key: $API_KEY" \
    "$PORTAINER_URL/api/endpoints/$ENDPOINT_ID/docker/containers/json?all=true" | \
    jq "[.[] | select(.Labels[\"com.docker.compose.project\"] == \"$STACK_NAME\")] | length")

  echo "Containers: $CONTAINERS"
}

# Main
case "${1:-start}" in
  start|deploy)
    deploy_stack
    ;;
  stop)
    stop_stack
    ;;
  delete|remove)
    delete_stack
    ;;
  status)
    show_status
    ;;
  restart)
    stop_stack
    sleep 2
    deploy_stack
    ;;
  *)
    echo "Usage: $0 [start|stop|delete|status|restart]"
    exit 1
    ;;
esac
