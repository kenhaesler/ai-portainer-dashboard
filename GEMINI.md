# AI Portainer Dashboard

## Project Overview

This is a full-stack container monitoring platform that extends Portainer with AI-powered insights, anomaly detection, and a modern glassmorphism UI. It's a monorepo with a `backend` and a `frontend` workspace.

**Backend:**

*   **Framework:** Fastify
*   **Language:** TypeScript
*   **Database:** SQLite
*   **Real-time:** Socket.IO
*   **Authentication:** JWT-based auth
*   **Key Dependencies:** `fastify`, `socket.io`, `better-sqlite3`, `zod`, `jose`, `bcrypt`, `ollama`

**Frontend:**

*   **Framework:** React 19
*   **Language:** TypeScript
*   **Bundler:** Vite
*   **UI:** Tailwind CSS v4, Radix UI, Recharts, `cmdk`
*   **State Management:** TanStack Query, Zustand
*   **Key Dependencies:** `react`, `react-router-dom`, `@tanstack/react-query`, `zustand`, `socket.io-client`, `recharts`

## Building and Running

The project is managed with `npm` workspaces.

### Development

To run the application in development mode, use the following command:

```bash
docker compose -f docker-compose.dev.yml up -d
```

This will start the following services:

*   **`backend`:** The Fastify backend server on port `3001` with hot-reloading.
*   **`frontend`:** The React frontend development server on port `5173`.
*   **`ollama`:** The Ollama AI service.

### Production

To build and run the application in production mode, use:

```bash
docker compose up -d
```

This will build the production-ready frontend and backend containers and serve the application on port `8080`.

## Development Conventions

### Scripts

The root `package.json` contains the following scripts that run across both workspaces:

*   `npm run dev`: Starts the development servers for both `backend` and `frontend`.
*   `npm run build`: Builds both workspaces for production.
*   `npm run lint`: Lints the code in both workspaces.
*   `npm run typecheck`: Runs the TypeScript compiler to check for type errors.
*   `npm run test`: Runs tests in both workspaces.

### Testing

Tests are written with `vitest`. You can run tests for each workspace individually:

*   **Backend:** `npm run test -w backend`
*   **Frontend:** `npm run test -w frontend`

### CI/CD

The project uses GitHub Actions for continuous integration. The CI pipeline (`.github/workflows/ci.yml`) runs the following checks on every push and pull request to `main`:

1.  **Type Check:** `npm run typecheck`
2.  **Linting:** `npm run lint`
3.  **Testing:** `npm run test`
4.  **Build:** `npm run build`

## Keyboard Shortcuts

The following keyboard shortcuts are available for power user navigation:

| Shortcut             | Action                       |
| :------------------- | :--------------------------- |
| `Cmd+K` or `Ctrl+K`  | Toggle Command Palette       |
| `Ctrl+Shift+H`       | Navigate to Home             |
| `Ctrl+Shift+W`       | Navigate to Workloads        |
| `Ctrl+Shift+F`       | Navigate to Fleet Overview   |
| `Ctrl+Shift+S`       | Navigate to Stacks           |
| `Ctrl+Shift+L`       | Navigate to Container Health |
| `Ctrl+Shift+I`       | Navigate to Image Footprint  |
| `Ctrl+Shift+T`       | Navigate to Network Topology |
| `Ctrl+Shift+A`       | Navigate to AI Monitor       |
| `Ctrl+Shift+M`       | Navigate to Metrics Dashboard |
| `Ctrl+Shift+R`       | Navigate to Remediation      |
| `Ctrl+Shift+E`       | Navigate to Trace Explorer   |
| `Ctrl+Shift+X`       | Navigate to LLM Assistant    |
| `Ctrl+Shift+G`       | Navigate to Edge Agent Logs  |
| `Ctrl+Shift+Shift+S` | Navigate to Settings         |