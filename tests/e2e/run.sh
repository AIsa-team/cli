#!/usr/bin/env bash
# DEFAULT-OFF Mock E2E: compiled CLI vs real Router HTTP + MCP adapters.
# Not wired into npm test / CI.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec node "$ROOT/tests/e2e/harness.mjs" "$@"
