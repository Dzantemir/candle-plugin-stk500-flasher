# Tests

The plugin was verified end-to-end against **Candle built from sources**
(Candle 11.x, Qt 5.15) run with the offscreen platform, with a mock avrdude
that reproduces the real one's behavior (all progress output on stderr).

## Files

| File | Purpose |
|------|---------|
| `mock_avrdude.sh` | Fake avrdude: logs its arguments, emits a realistic stderr stream (signature, write/verify progress bars, "avrdude done. Thank you."), exits 0. Put it at `candleplugins/<plugin>/avrdude/avrdude`. |
| `testdriver.js` | Appended to a *copy* of the plugin's `script.js` (e.g. `candleplugins/stk500test/script.js`): waits for the panel, checks layout metrics (minimumSizeHint, scrollbar maxima), toggles the log, fills Port/HEX, clicks Flash, and prints `ST3|...|EOT` markers plus PASS=true/false to stdout. |

## Typical run

```bash
cp mock_avrdude.sh <candleplugins>/stk500test/avrdude/avrdude && chmod +x <candleplugins>/stk500test/avrdude/avrdude
cat testdriver.js >> <candleplugins>/stk500test/script.js

QT_QPA_PLATFORM=offscreen ./candle 2>&1 | grep "ST3|"
```

Expected result: `PASS=true`, scrollbars maxima = 0 before and after flashing,
progress reaching 100, status "Done! / Готово!". The avrdude arguments are
logged by the mock to `/tmp/mock_avrdude.log` and must contain
`-c stk500v1 -P <port> -b <baud> -p <mcu> -U flash:w:<hex>:i`.
