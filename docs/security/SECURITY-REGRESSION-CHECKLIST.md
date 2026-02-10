# Security Regression Checklist

> Maps each finding from [SECURITY-REPORT-2026-02-07.md](SECURITY-REPORT-2026-02-07.md) to its automated regression test or manual verification step. This ensures security fixes are not silently reintroduced.

## High Severity

| Finding | Status | Test File | Test Name |
|---------|--------|-----------|-----------|
| **H1. Unauthenticated Prometheus Metrics** | Fixed | `backend/src/routes/metrics-export.test.ts` | `rejects unauthenticated requests` |
| **H2. Unauthenticated Ollama Access** | Mitigated (external) | N/A — Ollama runs externally | Manual: verify Ollama is not exposed on 0.0.0.0 |
| **H3. Swagger UI Exposed** | Fixed | `backend/src/plugins/swagger.test.ts` | `does not register in production` |
| **H4. Settings LLM URL Hijack** | Mitigated | `backend/src/routes/settings.test.ts` | `requires authentication` |
| **H5. Cache Admin No RBAC** | Fixed | `backend/src/routes/cache-admin.test.ts` | `rejects non-admin users` |
| **H6. Default Credentials** | Documented | `backend/src/config/index.test.ts` | `validates JWT_SECRET minimum length` |

## Medium Severity

| Finding | Status | Test File | Test Name |
|---------|--------|-----------|-----------|
| **M1. Missing Security Headers** | Fixed | `backend/src/plugins/security-headers.test.ts` | `sets all required security headers` |
| **M2. SSRF via Webhook URL** | Mitigated | Manual: verify webhook URL validation | N/A — webhook feature under development |
| **M3. CORS credentials always sent** | Fixed | `backend/src/plugins/cors.test.ts` | `does not send credentials header when request has no Origin` |
| **M4. Information Disclosure via Labels** | Accepted risk | N/A | Manual: labels are read-only, no credential exposure |
| **M5. Webhook Creation Broken** | Known issue | N/A | Manual: tracked as separate bug |

## Low Severity

| Finding | Status | Test File | Test Name |
|---------|--------|-----------|-----------|
| **L1. BPF Filter Regex Allows Shell Operators** | Fixed | `backend/src/routes/pcap.test.ts` | `rejects filters with shell operators` |
| **L2. Nginx Default Page** | Fixed | Manual: verify custom error pages | N/A — nginx config updated |
| **L3. Remediation Without Admin Role** | Fixed | `backend/src/routes/remediation.test.ts` | `requires authentication for all endpoints` |

## Additional Security Tests

| Category | Test File | Key Tests |
|----------|-----------|-----------|
| JWT validation | `backend/src/utils/crypto.test.ts` | `rejects expired tokens`, `rejects invalid signatures` |
| Session management | `backend/src/services/session-store.test.ts` | `invalidates sessions on logout` |
| Rate limiting | `backend/src/plugins/rate-limit.test.ts` | `enforces login rate limit` |
| Input validation | Various route test files | All routes validate Zod schemas |
| SQL injection | All route tests with DB queries | Parameterized queries only |
| LLM prompt injection | `backend/src/routes/llm.test.ts` | `sanitizes user input` |
| OIDC state validation | `backend/src/routes/oidc.test.ts` | `rejects forged callback states` |
| WebSocket auth | `backend/src/plugins/socket-io.test.ts` | `rejects connections without valid tokens` |
| Backup RBAC | `backend/src/routes/backup.test.ts` | `requires admin role` |
| Observer-only | `backend/src/routes/remediation.test.ts` | `gates all mutating actions` |

## How to Run Security Tests

```bash
# Run all backend tests (includes all security regression tests)
npm run test -w backend

# Run specific security-related test files
cd backend
npx vitest run src/plugins/cors.test.ts
npx vitest run src/plugins/security-headers.test.ts
npx vitest run src/plugins/swagger.test.ts
npx vitest run src/routes/cache-admin.test.ts
npx vitest run src/routes/backup.test.ts
npx vitest run src/routes/remediation.test.ts
npx vitest run src/routes/llm.test.ts
```

## Maintenance

When adding new security fixes:
1. Add a regression test to the relevant test file
2. Update this checklist with the finding, test file, and test name
3. Ensure CI passes before merging
