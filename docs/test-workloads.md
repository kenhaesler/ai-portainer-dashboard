# Test Workloads

Five Docker Compose stacks are provided to spin up realistic test containers across multiple Portainer stacks.

## Deploy Script

```bash
# Deploy all 5 stacks via script (reads .env for Portainer credentials)
./scripts/deploy-workload.sh start

# Check status of all stacks
./scripts/deploy-workload.sh status

# Stop / delete all stacks
./scripts/deploy-workload.sh stop
./scripts/deploy-workload.sh delete
```

## Stacks

| Stack | Services | Purpose |
|-------|----------|---------|
| `data-services` | db-postgres, db-redis, mq-rabbitmq | Database, cache, message queue |
| `web-platform` | web-frontend, web-backend-1/2, app-gateway, app-cron | Web tier + API gateway |
| `workers` | worker-1/2, app-api, app-worker-queue | Workers + backend API |
| `staging-dev` | staging-web, staging-api, dev-web, monitoring-prometheus | Non-prod environments |
| `issue-simulators` | 10 issue containers + 6 heavy-load stress containers | Anomaly, security, health, CPU/memory/network stress |

## Heavy-Load Containers

Heavy-load containers (`stress-cpu`, `stress-memory`, `stress-io`, `net-server`, `net-client`, `net-chatter`) generate real CPU, memory, disk I/O, and network traffic for testing metrics and network topology visualization.
