#!/bin/sh
# Renders tools/og.html to og.png (the social share image) with headless Chrome.
# Needs the dev server running: npm run dev
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
cd "$(dirname "$0")/.." || exit 1
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --window-size=1200,630 \
  --virtual-time-budget=5000 --screenshot="$PWD/og.png" http://localhost:5173/tools/og.html
