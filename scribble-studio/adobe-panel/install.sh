#!/bin/bash
# Installs the Scribble Studio panel into Premiere Pro / After Effects (macOS).
# Afterwards: restart the app → Window → Extensions → Scribble Studio.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/scribble-studio"

mkdir -p "$(dirname "$DEST")"
rm -rf "$DEST"
cp -R "$SRC" "$DEST"
rm -f "$DEST/install.sh"

# The panel isn't signed by Adobe, so allow unsigned extensions (CEP 9–12 cover Premiere/AE 2020–2025+).
for v in 9 10 11 12; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done

echo "Installed to: $DEST"
echo "1) Start the helper:   python3 \"$(dirname "$SRC")/server.py\""
echo "2) Restart Premiere Pro / After Effects → Window → Extensions → Scribble Studio"
