#!/bin/bash
# SessionStart hook for Claude Code cloud sessions.
# The cloud sandbox's proxy blocks download.cypress.io, so the Cypress
# postinstall fails and aborts `pnpm install`. Skip the Cypress binary there;
# unit tests, typecheck and lint don't need it. Local sessions are untouched.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

export CYPRESS_INSTALL_BINARY=0
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo 'export CYPRESS_INSTALL_BINARY=0' >> "$CLAUDE_ENV_FILE"
fi

# Install only if the manifests changed since the last successful install
hashes=node_modules/.session-start.sha256
if ! sha256sum --check --status "$hashes" 2>/dev/null; then
  rm -f "$hashes"
  pnpm install --frozen-lockfile
  sha256sum .claude/hooks/session-start.sh package.json pnpm-lock.yaml > "$hashes" || rm -f "$hashes"
fi
