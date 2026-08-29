#!/bin/sh
# Builds Lectern.app (macOS): a tiny launcher that opens Lectern.html in Chrome.
set -e
cd "$(dirname "$0")/.."
HTML="$(pwd)/Lectern.html"
rm -rf Lectern.app
osacompile -o Lectern.app -e "do shell script \"open -a 'Google Chrome' '$HTML' || open '$HTML'\""
echo "built $(pwd)/Lectern.app → opens $HTML"
