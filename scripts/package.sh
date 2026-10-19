#!/usr/bin/env bash
# Build the distributable ZIPs of the STK500 Flasher plugin.
#
#   candle-plugin-stk500flasher-<ver>.zip        (lite: plugin files only)
#   candle-plugin-stk500flasher-<ver>-full.zip   (full: + bundled avrdude 8.0 Win x64)
#
# The full ZIP is only built when stk500flasher/avrdude/avrdude.exe exists
# (the binary is not stored in git - unpack the previous full ZIP or download
# avrdude 8.0 for Windows into that folder first).
#
# Usage: scripts/package.sh [output-dir]   (default: current dir)

set -e
cd "$(dirname "$0")/.."

VER=$(sed -n 's/^version="\(.*\)"/\1/p' stk500flasher/config.ini)
if [ -z "$VER" ]; then echo "ERROR: cannot read version from stk500flasher/config.ini"; exit 1; fi

OUT=${1:-.}
mkdir -p "$OUT"

# lite: plugin files only, no avrdude
zip -q "$OUT/candle-plugin-stk500flasher-$VER.zip" \
    stk500flasher/config.ini \
    stk500flasher/script.js \
    stk500flasher/widget.ui \
    stk500flasher/settings.ui \
    stk500flasher/README.md
echo "built: $OUT/candle-plugin-stk500flasher-$VER.zip (lite)"

# full: everything incl. bundled avrdude for Windows
if [ -f stk500flasher/avrdude/avrdude.exe ]; then
    zip -qr "$OUT/candle-plugin-stk500flasher-$VER-full.zip" stk500flasher
    echo "built: $OUT/candle-plugin-stk500flasher-$VER-full.zip (full)"
else
    echo "NOTE: stk500flasher/avrdude/avrdude.exe not found - full ZIP skipped."
    echo "      Put avrdude 8.0 Win x64 (avrdude.exe, avrdude.conf, LICENSE) there"
    echo "      and re-run to build it."
fi
