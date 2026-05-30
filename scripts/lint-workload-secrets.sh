#!/usr/bin/env bash
# lint-workload-secrets.sh — Detect hardcoded credentials in workload YAML files.
# Exits non-zero if any literal password/secret values are found.
#
# Usage:
#   ./scripts/lint-workload-secrets.sh                # scan workloads/*.yml
#   ./scripts/lint-workload-secrets.sh path/to/file    # scan a specific file
#
# What it checks:
#   Lines containing PASSWORD, _PASS, _SECRET, or _KEY (case-insensitive)
#   whose value is a bare literal (not a ${...} variable substitution).

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Determine files to scan
if [[ $# -gt 0 ]]; then
  FILES=("$@")
else
  shopt -s nullglob
  FILES=("$REPO_ROOT"/workloads/*.yml "$REPO_ROOT"/workloads/*.yaml)
  shopt -u nullglob
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No workload YAML files found."
  exit 0
fi

FOUND=0
# Literal '${' substring marking a Compose variable substitution; ANSI-C
# quoting avoids triggering shellcheck SC2016 (single-quote expansion warning).
SUBST_MARKER=$'\x24{'

for file in "${FILES[@]}"; do
  if [[ ! -f "$file" ]]; then
    echo "Warning: $file not found, skipping."
    continue
  fi

  # Match lines like:  SOME_PASSWORD: literal_value
  # but NOT lines like: SOME_PASSWORD: ${VAR...}
  # Ignore comment lines (starting with #)
  while IFS= read -r line; do
    FOUND=$((FOUND + 1))
    echo "ERROR: Hardcoded credential in $(basename "$file"): $line"
  done < <(grep -iE '(PASSWORD|_PASS|_SECRET|_KEY)\s*[:=]' "$file" \
    | grep -v '^\s*#' \
    | grep -vF "$SUBST_MARKER" \
    || true)
done

if [[ $FOUND -gt 0 ]]; then
  echo ""
  echo "Found $FOUND hardcoded credential(s). Use \${VAR:?msg} or \${VAR:-default} substitution."
  exit 1
fi

echo "OK: No hardcoded credentials found in workload files."
exit 0
