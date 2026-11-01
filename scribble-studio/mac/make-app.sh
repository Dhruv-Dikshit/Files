#!/bin/bash
# Builds "Scribble Studio.app" — a double-clickable Mac app that starts the helper (server.py)
# and opens Scribble Studio in its own window. No Xcode needed.
#
#   bash mac/make-app.sh            → ~/Applications/Scribble Studio.app
#   bash mac/make-app.sh /Applications
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"          # the scribble-studio folder
DEST_DIR="${1:-$HOME/Applications}"
APP="$DEST_DIR/Scribble Studio.app"

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Scribble Studio</string>
  <key>CFBundleDisplayName</key><string>Scribble Studio</string>
  <key>CFBundleIdentifier</key><string>com.scribblestudio.app</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleExecutable</key><string>scribble-studio</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>LSMinimumSystemVersion</key><string>11.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

cat > "$APP/Contents/MacOS/scribble-studio" <<LAUNCH
#!/bin/bash
# Finder doesn't load your shell profile, so add Homebrew paths for ffmpeg.
export PATH="/opt/homebrew/bin:/usr/local/bin:\$PATH"
APPDIR="$HERE"
URL="http://localhost:8000/"
if curl -s -o /dev/null "\${URL}api/status"; then
  # already running — just open another window
  exec /usr/bin/python3 -c "import sys; sys.path.insert(0, '\$APPDIR'); import server; server.open_app('\$URL')"
fi
cd "\$APPDIR"
exec /usr/bin/python3 server.py --open >> "\$HOME/Library/Logs/scribble-studio.log" 2>&1
LAUNCH
chmod +x "$APP/Contents/MacOS/scribble-studio"

echo "Built: $APP"
echo "Double-click it (first time: right-click → Open, because it isn't notarised)."
echo "It runs the helper in the background; quit it with:  pkill -f 'server.py --open'"
