#!/usr/bin/env sh
set -eu

cd "$(dirname "$0")"

if ! command -v corepack >/dev/null 2>&1; then
  echo "Corepack was not found. Install Node.js 20+ or enable Corepack, then try again." >&2
  exit 1
fi

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies with Corepack pnpm..."
  corepack pnpm install
fi

case "${1:-}" in
  --yes|--no-interactive)
    corepack pnpm start:local:quick
    ;;
  *)
    corepack pnpm start:local
    ;;
esac
