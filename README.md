# STK500 Flasher — board flashing plugin for Candle

A plugin that adds a panel to Candle for flashing control boards
(Arduino / AVR, GRBL and compatible) over the **Arduino STK500 v1** protocol
(Optiboot) — the same way the Arduino IDE does it. The flashing engine is
**avrdude**; the protocol is fixed: `-c arduino` (STK500 v1 + DTR auto-reset,
as in the Arduino IDE; the programmer selection was removed from the UI as
redundant).

<img width="235" height="257" alt="{B4CD80D5-6A16-400B-BECB-F0249973D66D}" src="https://github.com/user-attachments/assets/0bd4177b-6c4e-4e86-b1c2-875c649dcf54" />


Tested with Candle 11.x (current master branch). Requires a Candle build
with JS plugin support (the `candleplugins` folder).

## Features

- flash AVR/Arduino boards right from Candle — like "Upload" in the Arduino
  IDE (STK500 v1 + DTR auto-reset), no external programmer needed;
- a single dual-action **Flash/Stop** button — starts and interrupts flashing
  without ever getting blocked;
- the serial port is taken from Candle's connection settings; default baud
  115200 (the Optiboot standard);
- MCUs: ATmega328P/328/2560/1280/1284P/644P/168P/168/88/8 (Uno/Nano,
  Sanguino, Mega…); baud rates: 115200/57600/38400/19200/9600;
- a live avrdude log (stdout+stderr) that auto-opens on flashing start and
  on errors, collapsed by default;
- avrdude auto-search: plugin folder → Candle folder → Arduino IDE →
  PlatformIO → PATH; on Windows a bundled avrdude 8.0 is supported;
- a compact ~156×212 px panel — fits into Candle's panel area without
  scrollbars or clipping.

---

## What's new in version 2.3

1. **The "Flash" and "Stop" buttons are merged into one** — a dual-action
   button: when idle it starts flashing, and while avrdude is running it
   turns into "Stop" — pressing it again interrupts the process. The button
   is never disabled, only its label and tooltip change; the panel became
   even simpler (one button instead of two).

## What's new in version 2.2

1. **The programmer selection was removed from the panel** — the flashing
   protocol is fixed: STK500 v1 through the board's own USB-UART
   (`avrdude -c arduino` — the same STK500 v1 with DTR auto-reset the
   Arduino IDE uses). The list of options (`arduino`/`wiring`/`usbasp`/
   `usbtinyisp`/`avrisp`…) was redundant: those are external hardware
   programmers or the STK500 v2 protocol (Mega 2560) — they are not used
   when flashing through the board's own port. The panel became simpler and
   slightly narrower.
2. If a board does not enter the bootloader over STK500 v1 (rare clones),
   this is fixed by trying a different baud rate, not by choosing a
   programmer.

## What's new in version 2.1 (compact panel)

1. **The panel was shrunk considerably**: a minimum of ~156×212 px instead
   of ~250×390 — it now reliably fits into Candle's panel area without
   vertical or horizontal scrollbars and without clipping:
   - 5 rows instead of 6: baud rate and programmer combined into one row;
   - short labels (Port / Baud / MCU / HEX / Options);
   - hard minimum widths on all fields — the panel squeezes down to ~150 px;
   - **the log is collapsed by default** and expands via the "Log" button
     (the state is remembered). When flashing starts or an error occurs the
     log opens automatically; its height is limited to 72 px (with its own
     scrolling inside), so the panel never "bloats".

2. Fixed the Russian localization: removed the reference to the deleted
   programmer label (the panel no longer breaks in the Russian locale).

## What was in version 2.0

1. **The plugin was completely rewritten for the real limitations of
   Candle's script engine** — all discovered causes of non-working behavior
   were eliminated:
   - pressing "Flash" no longer raises the `ambiguous connect` error
     (the `QProcess::finished` and `currentIndexChanged` signals are
     connected with an explicit signature);
   - avrdude output now really reaches the log: `String(QByteArray)` in
     Candle's engine returns the class name instead of the content — the
     official pattern `QTextCodec.codecForMib(106).toUnicode(...)` is used;
   - **both** process streams are read (avrdude writes all progress to
     stderr);
   - the Russian localization no longer breaks the panel (property
     assignment only, no `setText()` on buttons — those methods are missing
     in the bindings).

2. **The UART port is taken from Candle's settings by default** (and updated
   when the settings change). The default baud rate is 115200 (the Optiboot /
   STK500 v1 standard), because Candle's GRBL connection speed has nothing
   to do with the bootloader speed.

3. **avrdude selection in the plugin settings** (as in the first version):
   the path to the avrdude binary and (optionally) to avrdude.conf — works
   on both Linux and Windows. For Windows there is a full (full) archive
   build with avrdude 8.0 bundled.

---

## Installation

1. Locate your Candle program folder (next to `candle.exe` / `candle`).
2. Copy the whole `stk500flasher` folder into `candleplugins`
   (create it if needed):

```
Candle/
├── candle(.exe)
└── candleplugins/
    └── stk500flasher/
        ├── config.ini
        ├── script.js
        ├── widget.ui
        ├── settings.ui
        ├── README.md
        └── avrdude/            (Windows only)
            ├── avrdude.exe
            ├── avrdude.conf
            └── LICENSE
```

3. Restart Candle — an "STK500 Flasher" block appears in the right panel
   area.

## Usage

1. **Disconnect from the board in Candle** (Connection → Disconnect) —
   otherwise the port will be busy.
2. In the "STK500 Flasher" panel:
   - **Port** — pre-filled from Candle's settings; if necessary refresh the
     list with the "Refresh" button and pick another one;
   - **Baud** — 115200 for Uno/Nano (Optiboot), 57600/38400/19200 for older
     boards (available: 115200/57600/38400/19200/9600). Flashing always goes
     over STK500 v1 — like "Upload" in the Arduino IDE; the programmer is
     fixed and not selectable;
   - **MCU** — ATmega328P for Uno/Nano/GRBL, ATmega1284P for Sanguino
     (ATmega2560 for Mega — only if the board runs Optiboot); in the list:
     328P, 328, 2560, 1280, 1284P, 644P, 168P, 168, 88, 8;
   - **HEX** — the firmware file (Intel HEX), e.g. `grbl.hex`;
   - **Options** — extra avrdude parameters (`-D` don't erase the chip,
     `-V` don't verify, `-F` ignore the signature — use with care).
3. Press **"Flash"**. Write/verify progress is shown in the indicator, the
   detailed avrdude output — in the log (the "Log" button; it opens
   automatically during flashing). At the end — "Done!" or an error
   description. While flashing is running the button turns into
   **"Stop"** — press it again to interrupt the process.
4. If the board does not enter the bootloader automatically — press
   **RESET** on the board right after pressing "Flash".

## avrdude configuration (Settings → STK500 Flasher)

- **avrdude binary** — the path to avrdude. Empty = auto-search:
  1) the plugin folder (`avrdude/avrdude.exe`, Windows);
  2) the Candle program folder;
  3) Arduino IDE (Program Files / LOCALAPPDATA);
  4) PlatformIO (`~/.platformio/packages/tool-avrdude/bin`);
  5) the system PATH.
- **avrdude.conf (optional)** — your own config; empty = taken next to
  avrdude (`avrdude.conf`, `../etc/avrdude.conf`, `etc/avrdude.conf`).

**Linux:** `sudo apt install avrdude` (or `pacman -S avrdude`,
`dnf install avrdude`) — it will be found in `/usr/bin/avrdude`, or point to
your own binary in the settings. **macOS:** `brew install avrdude`.

## Limitations

- Flashing goes through avrdude — the same mechanism the Arduino IDE uses
  (STK500 v1 + DTR auto-reset).
- Close Candle's connection to the port before flashing.
- The board must have a bootloader (Optiboot etc.). "Clean" chips without a
  bootloader can only be flashed with an external programmer (`usbasp`…).
- A Mega 2560 with its stock bootloader speaks the STK500 v2 protocol (the
  "wiring" variant) and does not answer v1 — flash it with an external
  programmer or flash Optiboot first.

## License

GPL-3.0, same as Candle itself. Bundled: avrdude 8.0 (Windows x64, GPLv2,
Brian Dean / Joerg Wunsch).
