#!/bin/bash
# Mock avrdude v2: writes all output to STDERR like the real avrdude does
LOG=/tmp/mock_avrdude.log
{
echo "=== $(date) ==="
echo "ARGS ($#): $*"
for a in "$@"; do echo "  arg: [$a]"; done
} >> "$LOG"

cat >&2 <<'EOF'
avrdude: Version 8.0
         Copyright (c) Brian Dean, http://www.bdmicro.com/
         Copyright (c) Joerg Wunsch

         System wide configuration file is "avrdude.conf"

         Using Port                    : /dev/ttyUSB0
         Using Programmer              : arduino
         AVR Part                      : ATmega328P
         Programmer Type : Arduino
         Description     : Arduino

avrdude: AVR device initialized and ready to accept instructions

Reading | ################################################## | 100% 0.00s

avrdude: Device signature = 0x1e950f (probably m328p)
avrdude: Using flash programming algorithm specialists ... ok
EOF

for i in 16 33 50 66 83; do
  echo "Writing | ##################################################                                      | $i% 0.05s" >&2
  sleep 0.3
done
echo "Writing | ################################################## | 100% 0.17s" >&2

cat >&2 <<'EOF'

avrdude: reading on-chip flash data:

Reading | ################################################## | 100% 0.11s

avrdude: verifying ...
avrdude: 256 bytes of flash verified

avrdude done.  Thank you.
EOF
exit 0
