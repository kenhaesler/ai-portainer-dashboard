---
name: pr-reviewer
description: Review pull requests by running CI checks, Docker smoke tests, LLM code analysis, and story validation against linked issues. Posts structured review on GitHub, auto-fixes findings, commits and pushes, and sets labels.
---

# PR Reviewer Skill

Review pull requests by validating code quality, running CI checks, starting the app in Docker, smoke-testing endpoints, analyzing code for bugs, verifying acceptance criteria, and validating the original story intent. Posts a structured review on GitHub, then auto-fixes all findings and CI failures, tests fixes locally, commits and pushes to the PR branch, and sets labels based on results.

## Shell State

Each shell command runs in a fresh shell. Store persistent values in `/tmp/pr-review-<PR>.state` and `source` it at the start of every command. Every command MUST start with:

```bash
source /tmp/pr-review-<PR_NUMBER>.state && cd "$REPO_ROOT"
```

## Workflow

### Phase 0: Pre-flight Safety

1. **Parse input, record state, write cleanup script** (single command):
   ```bash
   PR_NUMBER=<PR_NUMBER>
   ORIGINAL_BRANCH=$(git rev-parse --abbrev-ref HEAD)
   REPO_ROOT=$(git rev-parse --show-toplevel)
   COMPOSE_PROJECT="pr-review-${PR_NUMBER}"
   STATE_FILE="/tmp/pr-review-${PR_NUMBER}.state"
   VOLUMES_FILE="/tmp/pr-review-${PR_NUMBER}-volumes.yml"
   COMPOSE_CMD="docker compose -f docker/docker-compose.dev.yml -f ${VOLUMES_FILE} --project-name ${COMPOSE_PROJECT}"

   echo "PR_NUMBER=${PR_NUMBER}" > "$STATE_FILE"
   echo "ORIGINAL_BRANCH=${ORIGINAL_BRANCH}" >> "$STATE_FILE"
   echo "REPO_ROOT=${REPO_ROOT}" >> "$STATE_FILE"
   echo "COMPOSE_PROJECT=${COMPOSE_PROJECT}" >> "$STATE_FILE"
   echo "COMPOSE_CMD=\"${COMPOSE_CMD}\"" >> "$STATE_FILE"
   echo "VOLUMES_FILE=${VOLUMES_FILE}" >> "$STATE_FILE"

   # Compose overlay to isolate named volumes from user's dev stack
   cat > "$VOLUMES_FILE" <<'VOLEOF'
   version: "3"
   volumes:
     postgres-app-data:
       name: "PRPREFIX-pg-app"
     timescale-data:
       name: "PRPREFIX-ts"
     backend-data:
       name: "PRPREFIX-backend"
     timescale-backups:
       name: "PRPREFIX-ts-backup"
   VOLEOF
   sed -i.bak "s/PRPREFIX/pr-review-${PR_NUMBER}/g" "$VOLUMES_FILE" && rm -f "${VOLUMES_FILE}.bak"

   # Cleanup script
   cat > "/tmp/pr-review-${PR_NUMBER}-cleanup.sh" <<CLEANUP
   #!/bin/bash
   STATE_FILE="/tmp/pr-review-${PR_NUMBER}.state"
   source "\$STATE_FILE" 2>/dev/null || ORIGINAL_BRANCH="dev"
   docker compose -f docker/docker-compose.dev.yml -f /tmp/pr-review-${PR_NUMBER}-volumes.yml --project-name pr-review-${PR_NUMBER} down -v --remove-orphans 2>/dev/null || true
   cd "\${REPO_ROOT:-.}" 2>/dev/null
   git checkout "\$ORIGINAL_BRANCH" 2>/dev/null || git checkout dev 2>/dev/null || true
   rm -f "\$STATE_FILE" "/tmp/pr-review-${PR_NUMBER}-cleanup.sh" "/tmp/pr-review-${PR_NUMBER}-volumes.yml" "/tmp/pr-review-${PR_NUMBER}-comment.md"
   echo "Cleanup complete for PR #${PR_NUMBER}."
   CLEANUP
   chmod +x "/tmp/pr-review-${PR_NUMBER}-cleanup.sh"
   ```

2. **Check for dirty working tree**: Abort if uncommitted changes exist.

3. **Check for NO AI label** on linked issues. If found, refuse to review.

4. **Check diff size**: Warn if > 3000 lines.

5. **Check for port conflicts** (3051, 5273, 5433). If blocked, set `DOCKER_BLOCKED=true` in state file and skip Docker phases.

6. **Clean up orphaned review containers**: `$COMPOSE_CMD down -v --remove-orphans`

### Phase 1: PR Context & Story Understanding

1. **Fetch PR metadata**:
   ```bash
   gh pr view $PR_NUMBER --json title,body,headRefName,baseRefName,files,closingIssuesReferences,additions,deletions > /tmp/pr-review-${PR_NUMBER}-metadata.json
   gh pr diff $PR_NUMBER
   ```

2. **Verify branch target**: `feature/*` must target `dev`, never `main`.

3. **Identify linked issues** from metadata, PR body (`Closes #NNN`), and title.

4. **Fetch each linked issue**: `gh issue view <ISSUE> --json title,body,labels,comments`

5. **Extract acceptance criteria** (AC-1, AC-2, ...) from issue checkboxes.

6. **Checkout the PR branch**: `gh pr checkout $PR_NUMBER`

7. **Install dependencies**: `npm ci 2>&1 | tail -20`

### Phase 2: Static Checks

Run each check and record pass/fail:

1. **TypeScript**: `npm run typecheck`
2. **Lint**: `npm run lint`
3. **Backend tests**: `npm run test -w backend`
4. **Frontend tests**: `npm run test -w frontend`
5. **Production build**: `npm run build`
6. **Dependency audit**: `npm audit --omit=dev --audit-level=high`

### Phase 3: Docker App Test

**Skip if `DOCKER_BLOCKED=true`.**

1. Pre-clean: `$COMPOSE_CMD down -v --remove-orphans`
2. Build: `$COMPOSE_CMD build`
3. Start: `$COMPOSE_CMD up -d --wait --wait-timeout 180 backend frontend redis postgres-app timescaledb`
4. Check migrations: `$COMPOSE_CMD logs backend | grep -iE 'migration|migrate'`
5. API smoke tests:
   - Login with dev defaults (`admin`/`changeme123`) -- NEVER read .env or expose real credentials
   - `GET /health` (unauthenticated)
   - `GET /api/dashboard`, `/api/containers`, `/api/settings` (authenticated)
   - Frontend serves HTML at port 5273
6. Log inspection for errors

### Phase 4: Playwright E2E Tests

**Skip if Docker was skipped or failed.**

```bash
npx playwright install chromium --with-deps
npx playwright test --project=auth --reporter=list --timeout=60000
npx playwright test --project=setup --project=chromium --reporter=list --timeout=60000
```

**Always tear down Docker after**: `$COMPOSE_CMD down -v --remove-orphans`

### Phase 5: Code Review

For each changed file, read the full file (not just the diff) to understand context.

Analyze for:

1. **Logic bugs**: off-by-one, race conditions, missing null checks
2. **Security** (OWASP top 10): SQL injection, XSS, command injection, hardcoded secrets
3. **Project security rules**:
   - RBAC: every POST/PUT/DELETE needs `fastify.requireRole('admin')`
   - Zod validation on all API boundaries
   - Parameterized SQL only (no concatenation)
   - LLM routes must use prompt injection guard
   - Observer-first: no container-mutating actions without role + remediation approval
4. **Error handling gaps**: missing try/catch, swallowed errors
5. **Performance**: N+1 queries, unbounded loops, memory leaks
6. **Debug artifacts**: `console.log`, `debugger`, commented-out code
7. **Test quality**: behavioral tests with real assertions
8. **Migration safety**: flag `DROP COLUMN/TABLE`, check defaults on NOT NULL
9. **API contract breakage**: search frontend for changed endpoint consumers
10. **New dependency review**: duplication, size, maintenance, license

Severity levels:
- **CRITICAL**: Must fix (security, data loss, crash)
- **WARNING**: Should fix (logic bugs, missing validation)
- **INFO**: Suggestion only (style, minor optimization)

### Phase 6: Story Validation

For each linked issue:
1. Does the PR solve the problem described?
2. Would the issue author be satisfied?
3. Are there gaps between intent and implementation?
4. Trace the user journey: Before -> After

Rate: FULLY ADDRESSED / PARTIALLY ADDRESSED / NOT ADDRESSED / EXCEEDS SCOPE

### Phase 7: Post Review

**Dismiss previous automated reviews**:
```bash
REPO=$(gh repo view --json nameWithOwner --jq '.nameWithOwner')
gh api "repos/${REPO}/pulls/${PR_NUMBER}/reviews" --jq '.[] | select(.body | contains("Reviewed by PR Reviewer Agent")) | .id' | while read REVIEW_ID; do
  gh api --method PUT "repos/${REPO}/pulls/${PR_NUMBER}/reviews/${REVIEW_ID}/dismissals" -f message="Superseded by updated review" 2>/dev/null || true
done
```

**Determine verdict**:
- **APPROVE**: All checks pass, no CRITICAL/WARNING findings, Docker passes, story FULLY ADDRESSED
- **REQUEST_CHANGES**: Any CRITICAL finding, story NOT ADDRESSED, tests/typecheck/build fail, wrong branch target
- **COMMENT**: Everything else (warnings, partial story, Docker skipped)

**Write review to temp file** `/tmp/pr-review-<PR>-comment.md` using this template:

```markdown
## Automated PR Review

**PR**: #<NUMBER> -- <TITLE>
**Branch**: <HEAD> -> <BASE>
**Diff size**: <LINES> lines (+<ADD>/-<DEL>)
**Reviewed at**: <DATE>

---

### Static Checks
| Check | Status | Details |
|-------|--------|---------|
| TypeScript | PASS/FAIL | |
| Lint | PASS/FAIL | |
| Backend Tests | PASS/FAIL | |
| Frontend Tests | PASS/FAIL | |
| Production Build | PASS/FAIL | |
| npm audit | PASS/FAIL | |
| Branch Target | PASS/FAIL | |

### Docker App Test
| Check | Status |
|-------|--------|
| Containers Healthy | PASS/FAIL/SKIPPED |
| Login | PASS/FAIL/SKIPPED |
| Backend /health | PASS/FAIL/SKIPPED |
| API /dashboard | PASS/FAIL/SKIPPED |
| API /containers | PASS/FAIL/SKIPPED |
| Frontend loads | PASS/FAIL/SKIPPED |
| Migrations | PASS/FAIL/N/A |
| No error logs | PASS/FAIL/SKIPPED |

### Code Review Findings
| # | Severity | File:Line | Finding |
|---|----------|-----------|---------|

### Acceptance Criteria (Issue #<NUM>)
| AC | Criterion | Status | Evidence |
|----|-----------|--------|----------|

### Story Validation
**Issue intent**: <summary>
**Story completion**: <FULLY/PARTIALLY/NOT ADDRESSED>
**User journey**: Before: <problem> -> After: <solution>
**Gaps**: <list or None>

### Suggested Actions
1. **[REQUIRED/SHOULD FIX/OPTIONAL]** <description>

### Verdict: <APPROVE / REQUEST_CHANGES / COMMENT>
**Reason**: <justification>

---
Reviewed by PR Reviewer Agent | <DATE>
```

**Post**: `gh pr review $PR_NUMBER --<approve|request-changes|comment> --body-file /tmp/pr-review-${PR_NUMBER}-comment.md`

### Phase 8: Auto-Fix Findings

**Skip if APPROVE with no findings.**

Fix in order: CI failures -> CRITICAL -> WARNING -> INFO

- Minimal surgical edits only
- Read full file context before editing
- Fix one finding at a time
- Track all fixes applied

### Phase 9: Verify Fixes

Re-run static checks. Max 3 retry cycles. Re-run Docker tests if not blocked. Tear down Docker after.

### Phase 10: Commit and Push

1. Stage specific files only (never `git add -A`)
2. Verify no secrets staged
3. Commit:
   ```bash
   git commit -m "fix: address review findings for PR #<NUMBER>

   - <fix descriptions>

   Co-Authored-By: Codex <noreply@openai.com>"
   ```
4. Push to the PR branch only. Never push to `main` or `dev`.

### Phase 11: Set Labels

Use GitHub REST API for label operations:

- **All fixed + checks pass** -> "Ready to Merge"
- **Some issues remain** -> "Reviewed by Agent"

Post a follow-up comment listing fixes applied.

### Phase 12: Cleanup (ALWAYS runs)

1. Tear down Docker: `$COMPOSE_CMD down -v --remove-orphans`
2. Return to original branch: `git checkout "${ORIGINAL_BRANCH:-dev}"`
3. Clean temp files

## Rules

- Post review BEFORE making fixes
- Fix ALL severity levels (CRITICAL, WARNING, INFO, CI failures)
- Stage specific files only -- never `git add -A`
- Never push to `main` or `dev`
- Never commit secrets
- Use REST API for labels (`gh api` not `gh pr edit --remove-label`)
- Max 3 retry cycles for fix verification
- Cleanup is mandatory regardless of which phase failed
- Volume isolation via compose overlay makes `down -v` safe
- No credential exposure in review comments
- Docker failure is not fatal -- skip and use COMMENT verdict
- No linked issue = COMMENT verdict (except docs/CI/deps-only PRs)
- Evidence-based findings only with specific file:line citations
- Always read full file context, never review diffs in isolation

## Input

Expects a PR number. Example: `codex "review PR #769"`

For multiple PRs, process sequentially with full cleanup between each.

## Emergency Cleanup

```bash
/tmp/pr-review-<PR_NUMBER>-cleanup.sh
```
