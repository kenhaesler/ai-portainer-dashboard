#!/usr/bin/env bash
set -euo pipefail

files=()
while IFS= read -r file; do
  files+=("$file")
done < <(git ls-files '*.sh')

if [ "${#files[@]}" -eq 0 ]; then
  echo "No bash scripts found."
  exit 0
fi

if command -v shellcheck >/dev/null 2>&1; then
  echo "Running shellcheck on ${#files[@]} script(s)..."
  shellcheck -x "${files[@]}"
  exit 0
fi

echo "shellcheck not found; running bash -n syntax check instead."
for file in "${files[@]}"; do
  bash -n "$file"
done
