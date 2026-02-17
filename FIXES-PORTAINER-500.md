# Fix: Portainer HTTP 500 Errors on Startup

## Problem

Production backend logs showed:
1. **Unhandled promise rejections** - "Unhandled promise rejection (process kept alive)"
2. **PortainerError: HTTP 500** during cache warming and metrics collection
3. Errors occurred immediately on startup despite Portainer being healthy

## Root Causes

### 1. Unhandled Promise in cachedFetchSWR (PRIMARY ISSUE)

**File**: `backend/src/services/portainer-cache.ts`

The stale-while-revalidate (SWR) background revalidation created a floating promise:

```typescript
// ❌ BEFORE (line 737)
revalidate.finally(() => { inFlight.delete(key); });
```

The `.finally()` returns a new promise that wasn't caught, triggering the global unhandled rejection handler in `index.ts`.

**Fix**: Moved cleanup into the async function and added explicit `.catch()`:

```typescript
// ✅ AFTER
async () => {
  try {
    const data = await fetcher();
    await cache.set(key, data, ttlSeconds);
  } catch (err) {
    log.warn({ key, err }, 'SWR background revalidation failed');
  } finally {
    inFlight.delete(key);  // Cleanup inside the async function
  }
})();
// Attach .catch() to prevent unhandled rejection if something unexpected happens
revalidate.catch(() => {});
```

### 2. Missing Portainer Readiness Check (SECONDARY ISSUE)

**File**: `backend/src/scheduler/setup.ts`

The scheduler started immediately and tried to warm the cache before Portainer was fully ready. Some of your 26 endpoints were likely:
- Still starting up
- Docker daemons offline
- Edge endpoints unreachable

**Fix**: Added `waitForPortainer()` function that:
- Retries 10 times with 2-second delays
- Verifies Portainer connectivity before starting background tasks
- Logs clear warnings if Portainer isn't reachable

### 3. Poor Error Diagnostics

**File**: `backend/src/scheduler/setup.ts` (line 165-171)

When metrics collection failed, the logs didn't show *which* endpoint was failing.

**Fix**: Added endpoint ID and name to error logs:

```typescript
log.warn({
  endpointId: endpoint.Id,
  endpointName: endpoint.Name,
  err: result.reason
}, 'Failed to collect metrics for endpoint');
```

## Changes Made

1. **backend/src/services/portainer-cache.ts**
   - Fixed SWR background revalidation to prevent unhandled rejections
   - Moved cleanup into async function's finally block
   - Added explicit `.catch()` on background promise

2. **backend/src/scheduler/setup.ts**
   - Added `waitForPortainer()` with 10 retries
   - Enhanced error logging to show failing endpoint details
   - Scheduler now waits for Portainer before starting

## Testing

```bash
# Run cache tests
cd backend && npx vitest run src/services/portainer-cache.test.ts

# Type check
npm run typecheck

# Build
cd backend && npm run build
```

All tests passed ✅

## Deployment

1. **Rebuild Docker image**:
   ```bash
   docker compose -f docker/docker-compose.prod.yml build backend
   ```

2. **Deploy updated backend**:
   ```bash
   docker compose -f docker/docker-compose.prod.yml up -d backend
   ```

3. **Monitor logs**:
   ```bash
   docker logs -f $(docker ps -qf "name=backend") 2>&1 | grep -E "(Portainer|PortainerError|Unhandled)"
   ```

## Expected Behavior After Fix

### On Startup (Clean Logs)
```
[INFO] Portainer connectivity verified (attempt: 1)
[INFO] Warming cache: endpoints + containers
[INFO] Cache warmed successfully (endpoints: 26)
[INFO] Server started (port: 3051)
```

### If Some Endpoints Are Down
```
[WARN] Failed to collect metrics for endpoint (endpointId: 5, endpointName: "edge-server-03", err: {...})
```

### No More
- ❌ "Unhandled promise rejection (process kept alive)"
- ❌ Generic "Failed to collect metrics for endpoint" without details

## Investigating Specific 500 Errors

If you still see HTTP 500 errors after this fix, they're likely from **specific endpoints** having issues, not the dashboard backend. To diagnose:

1. **Check which endpoints are failing**:
   ```bash
   docker logs $(docker ps -qf "name=backend") 2>&1 | grep "Failed to collect metrics" | jq -r '.endpointName'
   ```

2. **Verify those Docker environments**:
   - Are the Docker daemons running?
   - Are the networks accessible?
   - Check Portainer UI → Endpoints → Status

3. **Test the failing endpoint directly**:
   ```bash
   # Get your Portainer API key
   PORTAINER_API_KEY="your-api-key"
   ENDPOINT_ID=5  # From logs

   # Test endpoint health
   curl -H "X-API-Key: $PORTAINER_API_KEY" \
     http://localhost:9000/api/endpoints/$ENDPOINT_ID
   ```

## Monitoring

The fix includes better logging. Watch for these patterns:

**Good**:
```
[INFO] Portainer connectivity verified
[INFO] Cache warmed successfully (endpoints: 26)
```

**Warning (expected if some endpoints are down)**:
```
[WARN] Failed to collect metrics for endpoint
  endpointId: 5
  endpointName: "edge-server-03"
```

**Bad (should NOT occur after fix)**:
```
[ERROR] Unhandled promise rejection
[ERROR] Portainer not reachable after maximum retries
```

## Files Changed

- `backend/src/services/portainer-cache.ts` - Fixed SWR unhandled rejection
- `backend/src/scheduler/setup.ts` - Added Portainer readiness check + better logging

---

**Status**: ✅ Ready for deployment
**Breaking Changes**: None
**Tests**: All passing
**Next Steps**: Deploy to production and monitor startup logs
