#!/usr/bin/env bash
# pika — global launcher for the Pika teacher CLI.
#
# Install (symlink from somewhere on PATH):
#   ln -sf "$HOME/.pika-cli/scripts/pika-global.sh" "$HOME/bin/pika"
#
# Points at a checkout of this repo kept on `main`. Override with PIKA_CLI_HOME.
# The CLI must run with CWD at the repo root because src/lib uses `@/` tsconfig
# path aliases, which tsx resolves from the working directory. We therefore cd
# in, but pass the caller's directory through so relative paths the user typed
# (--out, course dirs) still resolve where they expect.

set -euo pipefail

PIKA_CLI_HOME="${PIKA_CLI_HOME:-$HOME/.pika-cli}"

if [[ ! -f "$PIKA_CLI_HOME/scripts/pika.ts" ]]; then
  echo "pika: no CLI checkout at $PIKA_CLI_HOME" >&2
  echo "  Set PIKA_CLI_HOME, or create it:" >&2
  echo "    git clone https://github.com/codepetca/pika.git \"$PIKA_CLI_HOME\" && (cd \"$PIKA_CLI_HOME\" && pnpm install)" >&2
  exit 1
fi

TSX="$PIKA_CLI_HOME/node_modules/.bin/tsx"
if [[ ! -x "$TSX" ]]; then
  echo "pika: dependencies missing in $PIKA_CLI_HOME (run: cd $PIKA_CLI_HOME && pnpm install)" >&2
  exit 1
fi

export PIKA_ORIGIN_PWD="$PWD"
cd "$PIKA_CLI_HOME"
exec "$TSX" scripts/pika.ts "$@"
