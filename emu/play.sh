#!/bin/sh
# The interactive player in one command: the play server on the JS lab, opened in the default browser.
# Checks node (26 or newer), then runs bin/play.mjs with any options given: --model CODE picks the camera model
# (default OM_EMU_MODEL, else E143; --model list shows them and their firmware), and the play options (for example
# --device evf, --start menu, --idle off). The model's firmware is provisioned on first use (host/firmware.mjs: the
# .BIN from fw/ or a download, verified, unpacked). Ctrl+C stops it; the session log goes to
# emu/out/play/<model>/<time>/.
#   emu/play.sh [--model CODE|list] [play options]
set -e
here=$(cd "$(dirname "$0")" && pwd)
if ! command -v node >/dev/null 2>&1; then
  echo "play.sh: node is not installed (node 26 or newer is needed)" >&2; exit 1
fi
major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$major" -lt 26 ]; then
  echo "play.sh: node $(node -v) is too old (node 26 or newer is needed)" >&2; exit 1
fi
exec node "$here/bin/play.mjs" "$@"
