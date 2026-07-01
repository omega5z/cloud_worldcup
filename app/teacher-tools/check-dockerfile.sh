#!/usr/bin/env bash
set -euo pipefail

DOCKERFILE_PATH="${1:-Dockerfile}"

if [ ! -f "$DOCKERFILE_PATH" ]; then
  echo "Dockerfile not found: $DOCKERFILE_PATH" >&2
  exit 2
fi

score=0

# 1) Base image check: last FROM must be node:<fixed>-alpine|slim and not latest
last_from=$(grep -Ei '^[[:space:]]*FROM[[:space:]]+[^[:space:]]+' "$DOCKERFILE_PATH" | tail -n1 || true)
if echo "$last_from" | grep -Eiq 'FROM[[:space:]]+node:[0-9][^[:space:]]*-(alpine|slim)([[:space:]]|$)'; then
  if ! echo "$last_from" | grep -Eiq 'FROM[[:space:]]+node:latest([[:space:]]|$)'; then
    score=$((score + 1))
  fi
fi

# 2) USER instruction present
if grep -Eiq '^[[:space:]]*USER[[:space:]]+' "$DOCKERFILE_PATH"; then
  score=$((score + 1))
fi

# 3) Multi-stage build (>= 2 FROM)
from_count=$(grep -Eic '^[[:space:]]*FROM[[:space:]]+' "$DOCKERFILE_PATH" || true)
if [ "$from_count" -ge 2 ]; then
  score=$((score + 1))
fi

# 4) .dockerignore present next to Dockerfile
dockerfile_dir=$(cd "$(dirname "$DOCKERFILE_PATH")" && pwd)
if [ -f "$dockerfile_dir/.dockerignore" ]; then
  score=$((score + 1))
fi

# 5) Layer order: first COPY package* before first RUN npm install/ci before last COPY . .
first_copy_pkg_line=$(grep -Ein '^[[:space:]]*COPY[[:space:]].*package.*' "$DOCKERFILE_PATH" | head -n1 | cut -d: -f1 || true)
first_run_npm_line=$(grep -Ein '^[[:space:]]*RUN[[:space:]].*npm[[:space:]]+(install|ci)\b' "$DOCKERFILE_PATH" | head -n1 | cut -d: -f1 || true)
last_copy_all_line=$(grep -Ein '^[[:space:]]*COPY[[:space:]]+\.[[:space:]]+\.[[:space:]]*$' "$DOCKERFILE_PATH" | tail -n1 | cut -d: -f1 || true)

if [ -n "$first_copy_pkg_line" ] && [ -n "$first_run_npm_line" ] && [ -n "$last_copy_all_line" ]; then
  if [ "$first_copy_pkg_line" -lt "$first_run_npm_line" ] && [ "$first_run_npm_line" -lt "$last_copy_all_line" ]; then
    score=$((score + 1))
  fi
fi

echo "$score/5 checks passed"

if [ "$score" -eq 5 ]; then
  exit 0
fi

exit 1
