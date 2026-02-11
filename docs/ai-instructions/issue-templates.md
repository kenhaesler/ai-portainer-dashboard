# GitHub Issue Templates

This project uses specific issue formats. Follow these templates exactly when creating issues.

## Available Labels

| Label | Use When |
|-------|----------|
| `enhancement` | New feature or improvement |
| `bug` | Something is broken |
| `UI` | Involves frontend/visual changes |
| `security` | Security-related issue |
| `needs-refinement` | Requires more research or design before implementation |
| `needs-discussion` | Needs team discussion before committing to approach |
| `documentation` | Docs-only change |

## Feature Issue Template

**Title:** `Feature: <Descriptive Name>`
**Labels:** Always `enhancement`. Add `needs-refinement`, `needs-discussion`, `UI` as appropriate.

```markdown
## Problem Statement

<1-2 paragraphs: WHY this feature is needed. Concrete examples of what users can't do today.>

## Proposed Solution

<Overview paragraph.>

### <Sub-section per component>

<Use TABLES for structured data, ASCII ART MOCKUPS for UI, CODE BLOCKS for algorithms.>

| Feature | Description |
|---------|-------------|
| **Name** | What it does |

## Use Cases

1. **Use case**: Concrete scenario with specific container/service names
2. **Use case**: Another scenario
3. **Use case**: Edge case or advanced usage

## Acceptance Criteria

- [ ] <Specific, testable requirement>
- [ ] <Include backend AND frontend criteria>
- [ ] <Include test requirements>

## Technical Considerations

- Architecture: which files/modules affected
- Dependencies: new or existing libraries
- Performance: complexity, caching, real-time needs
- Storage: database changes
- Observer-only: confirm read-only if relevant

**Effort Estimate:** Small | Medium | Large | Very Large
**Impact Estimate:** Low | High | Very High
**Priority Score:** X.X/10

> **Needs Refinement**: <Open questions, only when labeled `needs-refinement`.>
```

**Rules:**
1. Problem Statement must explain "why" — not just "we should add X"
2. Use tables for structured data, ASCII mockups for UI features
3. Acceptance criteria must be checkbox items, specific and testable
4. Technical considerations must reference actual files in this codebase
5. Reference related issues with `#number`

## Bug Issue Template

**Title:** Descriptive problem statement (NO "Bug:" prefix).
**Labels:** Always `bug`. Add `UI`, `security`, `enhancement` as appropriate.

```markdown
## Summary

<1-2 sentences describing the bug.>

## Root Cause

<WHY the bug happens. Reference files and line numbers:>

In `path/to/file.ts` line XX:
```typescript
// problematic code
```

## Steps to Reproduce

1. <Step>
2. <Step>
3. Observe: <what you see>

## Expected Behavior

<What should happen.>

## Actual Behavior

<What happens. Include error messages if relevant.>

## Fix Approach

1. <Step — reference specific files>
2. <Step>

## Relevant Files

- `path/to/file.ts` — Why it matters (line XX)
```

**Rules:**
1. Always include file paths where the bug exists
2. Include line numbers when possible
3. Show problematic code in fenced code blocks
4. Explain root cause (why), not just symptoms (what)
5. Steps to reproduce must be numbered and specific

## General Rules

1. Use GitHub-flavored markdown
2. Reference existing issues with `#number`
3. Reference actual file paths — do not invent paths
4. Respect observer-only constraint
5. One concern per issue (unless tightly related bugs in same component)
6. No duplicates — check `gh issue list --state open` first
7. Ask before creating if request is vague or missing key details

## CLI Examples

```bash
# Feature
gh issue create \
  --title "Feature: <Title>" \
  --label "enhancement" \
  --body "$(cat <<'EOF'
<body>
EOF
)"

# Bug
gh issue create \
  --title "<Problem summary>" \
  --label "bug" \
  --body "$(cat <<'EOF'
<body>
EOF
)"
```
