This folder may hold a bundled avrdude for Windows:

    avrdude.exe    avrdude 8.0, Windows x64
    avrdude.conf   matching configuration file
    LICENSE        avrdude license (GPLv2)

The binaries are NOT stored in git (repository size). Either unpack the
"full" release ZIP of this plugin here, or skip this folder entirely and
let the plugin use a system-wide avrdude:

    Windows:  unpack the full ZIP (recommended), or install the Arduino IDE,
              or pick avrdude.exe manually in Candle:
              Settings -> STK500 Flasher
    Linux:    sudo apt install avrdude        (or dnf / pacman / zypper)
    macOS:    brew install avrdude

Search order used by the plugin: this folder -> Candle app folder ->
Arduino IDE -> PlatformIO -> system PATH -> the path set in plugin settings.
