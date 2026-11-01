#!/bin/bash
# Installs the Scribble Studio panel into Premiere Pro / After Effects (macOS).
# Afterwards: restart the app → Window → Extensions → Scribble Studio.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
APPDIR="$(dirname "$SRC")"   # the scribble-studio folder (where server.py lives)
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/scribble-studio"

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
rm -f "$DEST/install.sh"

# Tell the panel where the helper lives, so it can start it by itself.
printf 'window.SCRIBBLE = { serverDir: %s };\n' "$(/usr/bin/python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$APPDIR")" > "$DEST/config.js"

# The panel isn't signed by Adobe, so allow unsigned extensions (CEP 9–12 cover Premiere/AE 2020–2025+).
for v in 9 10 11 12; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done

echo "✓ Installed to: $DEST"
echo "  Helper folder: $APPDIR"
echo
echo "Now quit and reopen Premiere Pro / After Effects → Window → Extensions → Scribble Studio"
echo "(re-run this script if you move the scribble-studio folder)"
