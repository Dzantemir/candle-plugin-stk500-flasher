// STK500 Flasher - plugin for Candle (v2)
// Panel for flashing AVR/Arduino control boards (GRBL etc.) over the
// Arduino STK500 v1 protocol (Optiboot), exactly like the Arduino IDE does.
//
// Flash engine: avrdude. The programmer type is FIXED (v2.2): -c arduino,
// i.e. the STK500 v1 protocol through the board's own USB-UART bootloader
// with DTR auto-reset - the exact combination the Arduino IDE uses
// ("arduino" == STK500 v1 + auto-reset in avrdude).
//   - avrdude path can be selected in the plugin settings page
//   - auto-search: plugin folder (avrdude subfolder), app folder,
//     Arduino IDE, PlatformIO, system PATH
//   - Windows avrdude 8.0 can be bundled in the "avrdude" subfolder
//
// v2.5: stricter Intel HEX EOF/type validation, MCU Flash-size-only bounds,
// and graceful cancellation before force-killing avrdude.
//
// v2.4 (unified localization - the official Candle mechanism):
//   - the custom STR_EN/STR_RU dictionaries + RU flag + T() + the runtime
//     localizePanel()/localizeSettings() rewrites are GONE.
//   - ALL strings go through ONE translation file translation_<lang>.qm
//     which Candle installs before loading script.js:
//       * static .ui strings (labels, tooltips, placeholders, window titles)
//         are translated by QUiLoader itself, context = <class> of the .ui;
//       * runtime strings use qsTr() (empty translation context) - exactly
//         like the official usercommands plugin.
//   - result: the UI is either fully English or fully Russian (same label
//     style in both languages), never a mix of translated and raw strings.
//
// v2.4 (unified localization - the official Candle mechanism):
//   - the custom STR_EN/STR_RU dictionaries + RU flag + T() + the runtime
//     localizePanel()/localizeSettings() rewrites are GONE.
//   - ALL strings go through ONE translation file translation_<lang>.qm
//     which Candle installs before loading script.js:
//       * static .ui strings (labels, tooltips, placeholders, window titles)
//         are translated by QUiLoader itself, context = <class> of the .ui;
//       * runtime strings use qsTr() (empty translation context) - exactly
//         like the official usercommands plugin.
//   - result: the UI is either fully English or fully Russian (same label
//     style in both languages), never a mix of translated and raw strings.
//
// v2.3: single dual-action button - "Flash" when idle, "Stop" while
// flashing. The former separate Flash/Stop buttons are merged into one
// (cmdFlash); the button is never disabled, it switches its label/tooltip.
//
// v2 fixes (binding compatibility with Candle's QtScript engine):
//   - never call QPushButton.setText()/setToolTip()/QComboBox.setEditable():
//     these methods are missing in the script bindings -> use property
//     assignment (btn.text = "...") instead
//   - QProcess.MergedChannels is not exposed -> default SeparateChannels,
//     both stdout AND stderr are read (avrdude writes all progress to stderr)
//   - compact panel that fits Candle's user panel area (~250 px)
//   - serial port / baud default to Candle connection settings
//
// License: GPL-3.0 (same as Candle). This file must be saved in UTF-8.

script.importExtension("qt.core");
script.importExtension("qt.gui");
script.importExtension("qt.widgets");
script.importExtension("qt.uitools");

// Candle installs translator functions (qsTr/qsTranslate/...) into the
// engine via installTranslatorFunctions() before evaluating this script.
// Older builds may lack them - fall back to the English source text.
if (typeof qsTr !== "function") {
    qsTr = function(sourceText) { return String(sourceText); };
}

// Candle installs translator functions (qsTr/qsTranslate/...) into the
// engine via installTranslatorFunctions() before evaluating this script.
// Older builds may lack them - fall back to the English source text.
if (typeof qsTr !== "function") {
    qsTr = function(sourceText) { return String(sourceText); };
}

// ------------------------------------------------------------------ vars

var pluginPath = script.path;
var appPath = app.path;
var loader = new QUiLoader();

var uiPanel = null;
var uiSettings = null;

var storage = app.storage.group("Stk500Flasher");

var proc = null;
var procRunning = false;
var procCanceled = false;
var procBuffer = "";
var procOutAll = "";
var startCheckTimer = null;
var watchdogTimer = null;
var cancelKillTimer = null;
var cancelFallbackTimer = null;

var MCUS = [
    ["m328p", "ATmega328P (Uno/Nano)"],
    ["m328", "ATmega328"],
    ["m2560", "ATmega2560 (Mega)"],
    ["m1280", "ATmega1280"],
    ["m1284p", "ATmega1284P (Sang.)"],
    ["m644p", "ATmega644P"],
    ["m168p", "ATmega168P"],
    ["m168", "ATmega168"],
    ["m88", "ATmega88"],
    ["m8", "ATmega8"]
];

var MCU_FLASH = {
    "m328p": 32768, "m328": 32768, "m2560": 262144, "m1280": 131072,
    "m1284p": 131072, "m644p": 65536, "m168p": 16384, "m168": 16384,
    "m88": 8192, "m8": 8192
};

// v2.2: the programmer type is not selectable anymore - STK500 v1 only.
// (Other avrdude programmer types are external hardware programmers,
//  useless when flashing through the board's own serial port.)
// "arduino" in avrdude IS STK500 v1 plus the DTR auto-reset pulse -
// exactly what the Arduino IDE passes, so it is used here.
var PROGRAMMER = "arduino";

var lastParsedPath = "";
var lastParsedInfo = null;
var lastParsedKey = "";
var procPhase = "";

// QByteArray -> String converter (utf-8).
// NOTE: String(QByteArray) in Candle's QtScript returns the literal class
// name "QByteArray" - the official conversion pattern is QTextCodec (see
// the usercommands plugin).
var TEXTCODEC = null;
try { TEXTCODEC = QTextCodec.codecForMib(106); } catch (e) {}

function bytesToString(b)
{
    try {
        if (TEXTCODEC) return sstr(TEXTCODEC.toUnicode(b));
    } catch (e) {}
    return "";
}

// ------------------------------------------------------------------ helpers

function sstr(v)
{
    if (v === undefined || v === null) return "";
    return String(v);
}

function trimStr(s)
{
    return sstr(s).replace(/^\s+/, "").replace(/\s+$/, "");
}

function inArray(arr, v)
{
    for (var i = 0; i < arr.length; i++) if (arr[i] == v) return true;
    return false;
}

function fileExists(path)
{
    try { return (new QFile(path)).exists(); } catch (e) { return false; }
}
function fileKey(path)
{
    try {
        var fi = new QFileInfo(path);
        return path + "|" + sstr(fi.lastModified()) + "|" + sstr(fi.size());
    } catch (e) {
        return path;
    }
}

function readFileText(path)
{
    try {
        var f = new QFile(path);
        if (!f.open(QIODevice.ReadOnly)) return null;
        var ts = new QTextStream(f);
        var content = ts.readAll();
        f.close();
        return sstr(content);
    } catch (e) { return null; }
}

var WIN = false;
try {
    var _env = QProcess.systemEnvironment().join(" ");
    WIN = (_env.indexOf("SystemRoot=") >= 0 || _env.indexOf("OS=Windows_NT") >= 0);
} catch (e) {}
if (!WIN) {
    try { WIN = fileExists("C:/Windows") || fileExists("C:/winnt"); } catch (e) {}
}
function envVar(name)
{
    try {
        var env = QProcess.systemEnvironment();
        var prefix = name + "=";
        for (var i = 0; i < env.length; i++) {
            if (env[i].indexOf(prefix) == 0) return env[i].substring(prefix.length);
        }
    } catch (e) {}
    return "";
}

// Candle's own connection settings ------------------------------------

function candlePort()
{
    try { return trimStr(sstr(app.settings.port)); } catch (e) { return ""; }
}

// ------------------------------------------------------------------ entry points

function init()
{
    loader.setWorkingDirectory(new QDir(pluginPath));
    try { loader.addPluginPath(appPath + "/designerplugins"); } catch (e) {}

    app.settingsAboutToShow.connect(onSettingsAboutToShow);
    app.settingsAccepted.connect(onSettingsAccepted);
}

function createPanelWidget()
{
    var f = new QFile(pluginPath + "/widget.ui");
    if (f.open(QIODevice.ReadOnly)) {
        uiPanel = loader.load(f);
        f.close();
        setupPanel();
    }
    return uiPanel;
}

function createWindowWidget()
{
    return null;
}

function createSettingsWidget()
{
    var f = new QFile(pluginPath + "/settings.ui");
    if (f.open(QIODevice.ReadOnly)) {
        uiSettings = loader.load(f);
        f.close();
        setupSettings();
    }
    return uiSettings;
}

// ------------------------------------------------------------------ panel

function setupPanel()
{
    // Panel labels/tooltips/placeholders are translated by QUiLoader from
    // translation_<lang>.qm (context Stk500Flasher) - no runtime rewrites.

    // MCUs
    var mcuItems = [];
    for (var i = 0; i < MCUS.length; i++) mcuItems.push(MCUS[i][0] + " - " + MCUS[i][1]);
    uiPanel.cmbMcu.addItems(mcuItems);

    // Baud rates
    uiPanel.cmbBaud.addItems(["115200", "57600", "38400", "19200", "9600"]);

    // Restore persistent fields
    // NOTE: baud default is 115200 (Optiboot/STK500 v1 standard), NOT Candle's
    // GRBL connection baud - those are different things.
    var savedMcu = sstr(storage.value("mcu", ""));
    if (savedMcu.length > 0) setComboText(uiPanel.cmbMcu, savedMcu);

    var savedBaud = sstr(storage.value("baud", ""));
    setComboText(uiPanel.cmbBaud, savedBaud.length > 0 ? savedBaud : "115200");

    uiPanel.txtHex.setText(sstr(storage.value("hexFile", "")));
    uiPanel.txtExtra.setText(sstr(storage.value("extra", "")));

    // Ports (defaults to Candle's port)
    refreshPorts(true);

    // Signals
    uiPanel.btnRefresh.clicked.connect(function () { refreshPorts(false); });
    uiPanel.btnBrowse.clicked.connect(onBrowse);
    // v2.3: single dual-action button - starts flashing when idle,
    // stops the running avrdude process while flashing.
    uiPanel.cmdFlash.clicked.connect(onFlashStop);
    uiPanel.txtHex.textChanged.connect(updateHexInfo);
    // NOTE: QComboBox::currentIndexChanged is overloaded (int)/(QString),
    // a plain connect() throws "ambiguous connect" - select by signature.
    uiPanel.cmbMcu["currentIndexChanged(int)"].connect(function () {
        lastParsedPath = "";
        lastParsedKey = "";
        updateHexInfo();
    });

    // Log toggle: the panel is compact, the log is collapsed by default and
    // is restored from persistent storage.
    setLogVisible(sstr(storage.value("logVisible", "")) == "true");
    // NOTE: QAbstractButton::toggled(bool) is not overloaded, a plain
    // connect() is safe, but keep the explicit signature for consistency.
    uiPanel.btnLog["toggled(bool)"].connect(function (on) { setLogVisible(on); });

    updateHexInfo();
}

function setComboText(cmb, text)
{
    if (!text || text.length == 0) return;
    var i = cmb.findText(text);
    if (i >= 0) { cmb.setCurrentIndex(i); return; }
    // editable combos accept arbitrary text
    if (cmb.editable) cmb.setEditText(text);
}

function currentMcu()
{
    return trimStr(sstr(uiPanel.cmbMcu.currentText)).split(/\s+/)[0];
}

// ------------------------------------------------------------------ ports

function scanPorts()
{
    var ports = [];

    if (WIN) {
        try {
            var reg = new QSettings("HKEY_LOCAL_MACHINE\\HARDWARE\\DEVICEMAP\\SERIALCOMM", QSettings.NativeFormat);
            var keys = reg.childKeys();
            for (var i = 0; i < keys.length; i++) {
                var v = trimStr(sstr(reg.value(keys[i], "")));
                if (v.length > 0 && !inArray(ports, v)) ports.push(v);
            }
        } catch (e) {}
        ports.sort();
    } else {
        try {
            var d = new QDir("/dev");
            var names = d.entryList(["ttyUSB*", "ttyACM*", "tty.usbmodem*",
                                     "tty.usbserial*", "cu.usbmodem*", "cu.usbserial*"]);
            for (var i = 0; i < names.length; i++) ports.push("/dev/" + names[i]);
        } catch (e) {}
    }

    return ports;
}

function refreshPorts(initial)
{
    if (!uiPanel) return;

    var cmb = uiPanel.cmbPort;
    var current = trimStr(sstr(cmb.currentText));

    cmb.clear();

    var ports = scanPorts();
    var items = [];

    // Candle's own port always goes first and is the default selection
    var cp = candlePort();
    if (cp.length > 0 && !inArray(items, cp)) items.push(cp);
    for (var i = 0; i < ports.length; i++) {
        if (!inArray(items, ports[i])) items.push(ports[i]);
    }
    if (items.length > 0) cmb.addItems(items);

    if (!initial && current.length > 0 && inArray(items, current)) {
        setComboText(cmb, current);
    } else if (cp.length > 0 && inArray(items, cp)) {
        setComboText(cmb, cp);
    } else if (items.length > 0) {
        cmb.setCurrentIndex(0);
    }
}

// ------------------------------------------------------------------ intel hex

function parseHex(path)
{
    var text = readFileText(path);
    if (text === null) return { error: "read" };
    if (text.length > 0 && text.charCodeAt(0) == 0xFEFF) text = text.substring(1);

    var lines = text.split("\n");
    var base = 0;
    var minAddr = -1;
    var maxAddr = -1;
    var count = 0;
    var eofSeen = false;

    for (var li = 0; li < lines.length; li++) {
        var line = lines[li].replace(/\r/g, "");
        line = line.replace(/^\s+/, "").replace(/\s+$/, "");
        if (line.length == 0) continue;
        if (eofSeen) return { error: "format" };
        if (line.charAt(0) != ":") return { error: "format" };

        var payload = line.substring(1);
        if (payload.length < 10 || (payload.length % 2) != 0 || !/^[0-9a-fA-F]+$/.test(payload)) {
            return { error: "format" };
        }

        var bytes = [];
        var sum = 0;
        for (var i = 0; i < payload.length; i += 2) {
            var b = parseInt(payload.substr(i, 2), 16);
            if (isNaN(b)) return { error: "format" };
            bytes.push(b);
            sum += b;
        }
        if ((sum & 0xFF) != 0) return { error: "checksum" };

        var len = bytes[0];
        if (bytes.length != len + 5) return { error: "format" };

        var addr = bytes[1] * 256 + bytes[2];
        var type = bytes[3];

        if (type == 0x00) {
            for (var di = 0; di < len; di++) {
                var a = base + addr + di;
                if (a < 0 || a > 0xFFFFFFFF) return { error: "format" };
                if (minAddr < 0 || a < minAddr) minAddr = a;
                if (a > maxAddr) maxAddr = a;
            }
            count += len;
        } else if (type == 0x01) {
            // Intel HEX EOF is a zero-length record at address zero.
            if (len != 0 || addr != 0) return { error: "format" };
            eofSeen = true;
        } else if (type == 0x02) {
            if (len != 2) return { error: "format" };
            base = (bytes[4] * 256 + bytes[5]) * 16;
        } else if (type == 0x03) {
            if (len != 4 || addr != 0) return { error: "format" };
        } else if (type == 0x04) {
            if (len != 2) return { error: "format" };
            base = (bytes[4] * 256 + bytes[5]) * 65536;
        } else if (type == 0x05) {
            if (len != 4 || addr != 0) return { error: "format" };
        } else {
            // Reject undefined record types instead of silently ignoring them.
            return { error: "format" };
        }
    }

    if (!eofSeen) return { error: "format" };
    if (count == 0 || minAddr < 0 || maxAddr < 0) return { error: "empty" };
    return { bytes: count, minAddr: minAddr, maxAddr: maxAddr };
}

function hexErrorText(e)
{
    if (e == "read") return qsTr("HEX file not found");
    if (e == "checksum") return qsTr("checksum");
    if (e == "empty") return qsTr("no data");
    return qsTr("format");
}

function updateHexInfo()
{
    if (!uiPanel) return;

    var path = trimStr(sstr(uiPanel.txtHex.text));
    var key = fileKey(path);
    if (key == lastParsedKey) return;
    lastParsedKey = key;
    lastParsedPath = path;
    lastParsedInfo = null;

    if (path.length == 0) { uiPanel.lblStatus.text = ""; return; }

    lastParsedInfo = parseHex(path);

    if (lastParsedInfo.error) {
        setStatus(qsTr("Invalid HEX file") + " (" + hexErrorText(lastParsedInfo.error) + ")", true);
        return;
    }

    var flash = MCU_FLASH[currentMcu()] || 0;
    var end = lastParsedInfo.maxAddr + 1;
    var msg = qsTr("HEX image") + ": " + lastParsedInfo.bytes + " " + qsTr("bytes")
            + " [0x" + lastParsedInfo.minAddr.toString(16)
            + " - 0x" + end.toString(16) + "]";

    if (flash > 0 && end > flash) {
        setStatus(msg + " - " + qsTr("HEX does not fit into MCU flash"), true);
    } else {
        // Bootloader placement/size varies by MCU, board and bootloader build.
        // Only report what is actually known: the image must fit in Flash.
        setStatus(msg, false);
    }
}

function setStatus(msg, isError)
{
    if (isError) {
        uiPanel.lblStatus.text = '<span style="color:#c62828">' + msg + "</span>";
    } else {
        uiPanel.lblStatus.text = msg;
    }
}

// ------------------------------------------------------------------ avrdude

function findConfFor(exePath)
{
    try {
        var dir = new QFileInfo(exePath).absolutePath();
        var candidates = [dir + "/avrdude.conf",
                          dir + "/../etc/avrdude.conf",
                          dir + "/etc/avrdude.conf"];
        if (!WIN) {
            candidates.push("/etc/avrdude.conf");
            candidates.push("/usr/local/etc/avrdude.conf");
            candidates.push("/opt/homebrew/etc/avrdude.conf");
            candidates.push("/opt/local/etc/avrdude.conf");
        }
        for (var i = 0; i < candidates.length; i++) {
            if (fileExists(candidates[i])) return candidates[i];
        }
    } catch (e) {}
    return null;
}

function detectAvrdude(logIt)
{
    // 1. Manual override from plugin settings
    var custom = trimStr(sstr(storage.value("avrdudePath", "")));
    if (custom.length > 0) {
        if (fileExists(custom)) {
            // manual conf too
            var mconf = trimStr(sstr(storage.value("avrdudeConf", "")));
            return { exe: custom, conf: (mconf.length > 0 && fileExists(mconf)) ? mconf : findConfFor(custom) };
        }
        if (logIt) appendLog(qsTr("avrdude not found") + ": " + custom);
        return null;
    }

    // 2. Bundled with this plugin
    var bundled = pluginPath + "/avrdude/avrdude" + (WIN ? ".exe" : "");
    if (fileExists(bundled)) {
        var bconf = pluginPath + "/avrdude/avrdude.conf";
        return { exe: bundled, conf: fileExists(bconf) ? bconf : findConfFor(bundled) };
    }

    // 3. Next to the Candle executable
    var nearApp = appPath + "/avrdude" + (WIN ? ".exe" : "");
    if (fileExists(nearApp)) return { exe: nearApp, conf: findConfFor(nearApp) };

    // 4. Well-known locations
    var candidates = [];
    if (WIN) {
        candidates.push("C:/Program Files (x86)/Arduino/hardware/tools/avr/bin/avrdude.exe");
        candidates.push("C:/Program Files/Arduino/hardware/tools/avr/bin/avrdude.exe");
        var lad = envVar("LOCALAPPDATA").replace(/\\/g, "/");
        if (lad.length > 0) candidates.push(lad + "/Programs/Arduino/hardware/tools/avr/bin/avrdude.exe");
        var up = envVar("USERPROFILE").replace(/\\/g, "/");
        if (up.length > 0) candidates.push(up + "/.platformio/packages/tool-avrdude/bin/avrdude.exe");
    } else {
        candidates.push("/usr/bin/avrdude");
        candidates.push("/usr/local/bin/avrdude");
        candidates.push("/opt/homebrew/bin/avrdude");
        candidates.push("/opt/local/bin/avrdude");
        var home = envVar("HOME");
        if (home.length > 0) candidates.push(home + "/.platformio/packages/tool-avrdude/bin/avrdude");
    }
    for (var i = 0; i < candidates.length; i++) {
        if (fileExists(candidates[i])) return { exe: candidates[i], conf: findConfFor(candidates[i]) };
    }

    // 5. PATH
        try {
        if (typeof QStandardPaths != "undefined") {
            var found = sstr(QStandardPaths.findExecutable("avrdude"));
            if (found.length > 0) return { exe: found, conf: findConfFor(found), fromPath: true };
        }
    } catch (e) {}
    return { exe: "avrdude", conf: null, fromPath: true };
}

// ------------------------------------------------------------------ flash

// v2.3: dual-action handler for the single button - Flash <-> Stop.
// Idle: starts flashing; while avrdude is running: stops (kills) it.
function onFlashStop()
{
    if (!uiPanel) return;
    if (procRunning) {
        onCancel();
    } else {
        onFlash();
    }
}

function onBrowse()
{
    var path = QFileDialog.getOpenFileName(app.window, qsTr("Select firmware HEX file"),
                                            sstr(uiPanel.txtHex.text), qsTr("HEX files (*.hex *.ihx *.hex32);;All files (*)"));
    path = sstr(path);
    if (path.length > 0) {
        uiPanel.txtHex.setText(path);
        storage.setValue("hexFile", path);
        updateHexInfo();
    }
}

function onFlash()
{
    if (procRunning || !uiPanel) return;

    var port = trimStr(sstr(uiPanel.cmbPort.currentText));
    var baud = trimStr(sstr(uiPanel.cmbBaud.currentText));
    var mcu = currentMcu();
    var hex = trimStr(sstr(uiPanel.txtHex.text));
    var extra = trimStr(sstr(uiPanel.txtExtra.text));

    if (port.length == 0) {
        setStatus(qsTr("Select a serial port"), true); return;
    }
    if (mcu.length == 0) { setStatus(qsTr("Select a controller (MCU)"), true); return; }
    if (hex.length == 0) { setStatus(qsTr("Select a HEX file"), true); return; }
    if (!fileExists(hex)) { setStatus(qsTr("HEX file not found"), true); return; }

    // HEX sanity check
    var info = parseHex(hex);
    if (info.error) { setStatus(qsTr("Invalid HEX file") + " (" + hexErrorText(info.error) + ")", true); return; }

    var flash = MCU_FLASH[mcu] || 0;
    if (flash > 0 && info.maxAddr + 1 > flash) {
        setStatus(qsTr("HEX does not fit into MCU flash"), true); return;
    }
    var avr = detectAvrdude(true);
    if (!avr) {
        setStatus(qsTr("avrdude not found"), true);
        setLogVisible(true);
        appendLog(qsTr("Select the avrdude executable in the plugin settings (Settings - STK500 Flasher). Windows: unpack avrdude into the 'avrdude' subfolder of this plugin; Linux: install avrdude (sudo apt install avrdude); macOS: brew install avrdude"));
        return;
    }

    // Warn if Candle is connected to this port
    try {
        var devState = Number(app.device.state);
        if (devState != -1 && port.length > 0 && port == candlePort()) {
            appendLog(qsTr("Candle is connected to this port - flashing will most likely fail. Disconnect in Candle first."));
        }
    } catch (e) {}

    // Build avrdude arguments
    var args = [];
    if (avr.conf) { args.push("-C"); args.push(avr.conf); }
    args.push("-c"); args.push(PROGRAMMER);
    args.push("-P"); args.push(port);
    var b = parseInt(baud, 10);
    if (!isNaN(b) && b > 0) { args.push("-b"); args.push(String(b)); }
    args.push("-p"); args.push(mcu);
    args.push("-U"); args.push("flash:w:" + hex + ":a");
    args.push("-v");
    if (extra.length > 0) {
        var parts = extra.split(/\s+/);
        for (var i = 0; i < parts.length; i++) {
            if (parts[i].length > 0) args.push(parts[i]);
        }
    }

    // Remember UI state
    storage.setValue("hexFile", hex);
    storage.setValue("mcu", sstr(uiPanel.cmbMcu.currentText));
    storage.setValue("baud", baud);
    storage.setValue("extra", extra);

    // Log header
    setLogVisible(true);
    appendLog("--------------------------------------------------");
    appendLog(qsTr("Flashing...") + " " + mcu + " @ " + port
            + " (" + PROGRAMMER + (isNaN(b) ? "" : ", " + b) + ")");
    appendLog(qsTr("HEX image") + ": " + info.bytes + " " + qsTr("bytes"));
    appendLog("> " + avr.exe + " " + args.join(" "));

    // Run avrdude.
    // NOTE: QProcess.MergedChannels is NOT exposed in Candle's script
    // bindings (setProcessChannelMode silently does nothing), so the default
    // SeparateChannels is used and BOTH stdout and stderr are read.
    // avrdude writes all progress output to stderr.
    proc = new QProcess();
    procBuffer = "";
    procOutAll = "";
    procCanceled = false;
    procPhase = "";

    proc.readyReadStandardOutput.connect(onProcReadyReadStdout);
    proc.readyReadStandardError.connect(onProcReadyReadStderr);
    // NOTE: QProcess::finished is overloaded (int) / (int, QProcess::ExitStatus)
    // - a plain connect() throws "ambiguous connect" in Candle's QtScript,
    // so the exact signature must be selected by name.
    proc["finished(int)"].connect(onProcFinished);
        var errorConnected = false;
    try { proc.errorOccurred.connect(onProcError); errorConnected = true; } catch (e) {}
    if (!errorConnected) {
        try { proc.error.connect(onProcError); } catch (e) {}
    }

    proc.start(avr.exe, args);

    procRunning = true;
    setBusy(true);
    setProgress(0);
    setStatus(qsTr("Flashing..."), false);

    // Detect "failed to start" (avrdude missing / not executable)
    startCheckTimer = new QTimer();
    startCheckTimer.singleShot = true;
    startCheckTimer.timeout.connect(function () {
        if (!procRunning || !proc) return;
        var notRunning = false;
        try {
            var st = proc.state();
            var stNum = Number(st);
            var stStr = sstr(st);
            notRunning = (stNum === 0) || (stStr == "0") || (stStr.indexOf("NotRunning") === 0);
        } catch (e) {}
        if (notRunning) onProcFailedToStart();
    });
    startCheckTimer.start(800);

    // Watchdog
    watchdogTimer = new QTimer();
    watchdogTimer.singleShot = true;
    watchdogTimer.timeout.connect(function () {
        if (procRunning) {
            appendLog(qsTr("Timeout - process did not finish"));
            onCancel();
        }
    });
    watchdogTimer.start(600000);
}

function onCancel()
{
    if (!procRunning || !proc || procCanceled) return;
    procCanceled = true;
    appendLog(qsTr("Canceling..."));
    appendLog("Warning / Внимание: canceling during programming may leave firmware incomplete / отмена во время записи может оставить прошивку неполной; flash again to recover / для восстановления запишите прошивку заново.");

    // Ask avrdude to exit normally first. A hard kill is delayed so the tool
    // can close its serial port and clean up; firmware may still be partial.
    try { if (watchdogTimer) watchdogTimer.stop(); } catch (e) {}
    try { if (startCheckTimer) startCheckTimer.stop(); } catch (e) {}
    try { proc.terminate(); } catch (e) {}

    if (cancelKillTimer) { try { cancelKillTimer.stop(); } catch (e) {} }
    cancelKillTimer = new QTimer();
    cancelKillTimer.singleShot = true;
    cancelKillTimer.timeout.connect(function () {
        if (!procRunning || !proc || !procCanceled) return;
        var running = true;
        try {
            var st = Number(proc.state());
            if (st === 0) running = false;
        } catch (e) {}
        if (!running) return;
        try { proc.kill(); } catch (e) {}

        // Last-resort tree kill only if QProcess still hasn't exited after
        // kill(). This avoids the old immediate terminate+kill sequence.
        if (cancelFallbackTimer) { try { cancelFallbackTimer.stop(); } catch (e) {} }
        cancelFallbackTimer = new QTimer();
        cancelFallbackTimer.singleShot = true;
        cancelFallbackTimer.timeout.connect(function () {
            if (!procRunning || !proc || !procCanceled) return;
            var stillRunning = true;
            try {
                var stateValue = Number(proc.state());
                if (stateValue === 0) stillRunning = false;
            } catch (e) {}
            if (!stillRunning) return;
            try {
                var pid = Number(proc.processId());
                if (pid > 0) {
                    if (WIN) QProcess.execute("taskkill", ["/F", "/T", "/PID", String(pid)]);
                    else QProcess.execute("kill", ["-9", String(pid)]);
                }
            } catch (e) {}
        });
        cancelFallbackTimer.start(800);
    });
    cancelKillTimer.start(1200);
}

function onProcError(err)
{
    var s = sstr(err);
    // enum may arrive as number: 0=FailedToStart 1=Crashed 2=Timedout 3=ReadError...
    if (s == "0" || s == "") s = "FailedToStart";
    if (s.indexOf("FailedToStart") >= 0) {
        onProcFailedToStart();
    } else {
        appendLog(qsTr("Process error") + ": " + s);
    }
}

function onProcFailedToStart()
{
    if (!procRunning) return;
    procRunning = false;
    cleanupTimers();
    setBusy(false);
    setStatus(qsTr("Could not start avrdude"), true);
    setLogVisible(true);
    appendLog(qsTr("Could not start avrdude") + ": " + (proc ? sstr(proc.program()) : "avrdude"));
    appendLog(qsTr("Select the avrdude executable in the plugin settings (Settings - STK500 Flasher). Windows: unpack avrdude into the 'avrdude' subfolder of this plugin; Linux: install avrdude (sudo apt install avrdude); macOS: brew install avrdude"));
    proc = null;
    procCanceled = false;
}

function onProcReadyReadStdout()
{
    if (!proc) return;
    var chunk = bytesToString(proc.readAllStandardOutput());
    if (chunk.length > 0) feedOutput(chunk);
}

function onProcReadyReadStderr()
{
    if (!proc) return;
    var chunk = bytesToString(proc.readAllStandardError());
    if (chunk.length > 0) feedOutput(chunk);
}

function feedOutput(chunk)
{
    procBuffer += chunk;
    procOutAll += chunk;

    if (watchdogTimer) {
        try { watchdogTimer.start(600000); } catch (e) {}
    }

    if (procOutAll.indexOf("Reading |") >= 0) {
        procPhase = "verify";
    } else if (procOutAll.indexOf("Writing |") >= 0) {
        procPhase = "write";
    }

    // Progress: latest "NN%" in the buffer, mapped to write/verify phase
    var pct = lastPercent(procBuffer);
    if (pct >= 0) {
        var base = 0;
        var range = 5;
        if (procPhase == "verify") { base = 65; range = 35; }      // verify read
        else if (procPhase == "write") { base = 5; range = 60; }   // writing
        setProgress(base + Math.round(pct * range / 100));
    }

    // Keep the un-logged progress buffer from growing without bound
    if (procBuffer.length > 8192 && procBuffer.indexOf("\n") < 0) {
        procBuffer = procBuffer.substring(procBuffer.length - 4096);
    }

    // Complete lines to the log. avrdude redraws its progress line with \r
    // ("Writing | ### | 25%|\rWriting | ... | 50%|\r...") - keep only the
    // last snapshot of every \n-terminated line, like a terminal shows it.
    var idx;
    while ((idx = procBuffer.indexOf("\n")) >= 0) {
        var line = procBuffer.substring(0, idx);
        procBuffer = procBuffer.substring(idx + 1);
        var rIdx = line.lastIndexOf("\r");
        if (rIdx >= 0) line = line.substring(rIdx + 1);
        line = line.replace(/\r/g, "");
        if (trimStr(line).length > 0) appendLog(line);
    }
}

function onProcFinished(exitCode)
{
    if (!procRunning) return;

    procRunning = false;
    cleanupTimers();

    // Flush the remaining buffer (same \r handling as feedOutput)
    if (procBuffer.length > 0) {
        var tail = procBuffer.replace(/\r/g, "");
        var rIdx = tail.lastIndexOf("\n");
        if (rIdx >= 0) tail = tail.substring(rIdx + 1);
        if (trimStr(tail).length > 0) appendLog(tail);
        procBuffer = "";
    }

    setBusy(false);

    if (procCanceled) {
        // A process can exit with code 0 after receiving a termination request;
        // cancellation must never be reported as a successful flash.
        setStatus(qsTr("Canceled"), true);
        appendLog(qsTr("Canceled"));
        appendLog("Firmware contents may be incomplete / прошивка может быть неполной; run Flash again to recover / для восстановления запишите прошивку заново.");
    } else if (Number(exitCode) == 0) {
        setProgress(100);
        setStatus(qsTr("Done! Firmware flashed successfully"), false);
        appendLog(qsTr("avrdude finished OK"));
        appendLog(qsTr("You can reconnect to the board in Candle now"));
    } else {
        setStatus(qsTr("Flashing failed") + " (exit " + Number(exitCode) + ")", true);
        setLogVisible(true);
        appendLog(qsTr("Check: 1) Candle is disconnected from the board, 2) port/baud are correct, 3) MCU is correct, 4) the board is in the bootloader (press RESET right after clicking Flash if auto-reset is disabled)"));
        analyzeOutputHints();
    }

    proc = null;
    procCanceled = false;
}

function analyzeOutputHints()
{
    var out = procOutAll;
    if (/signature mismatch|invalid device signature|expected signature/i.test(out)) {
        appendLog(qsTr("Device signature mismatch: wrong MCU selected. Check the MCU field (can be forced with -F in options, use with care)"));
    }
    if (/can'?t open|access is denied|permission denied|device busy|resource busy/i.test(out)) {
        appendLog(qsTr("Port is busy or access denied - disconnect in Candle first (Connection - Disconnect)"));
    }
}

function lastPercent(s)
{
    var i = s.lastIndexOf("%");
    if (i < 1) return -1;
    var j = i - 1;
    while (j >= 0 && s.charAt(j) >= "0" && s.charAt(j) <= "9") j--;
    var n = parseInt(s.substring(j + 1, i), 10);
    return isNaN(n) ? -1 : n;
}

function cleanupTimers()
{
    if (startCheckTimer) {
        try { startCheckTimer.stop(); } catch (e) {}
        startCheckTimer = null;
    }
    if (watchdogTimer) {
        try { watchdogTimer.stop(); } catch (e) {}
        watchdogTimer = null;
    }
    if (cancelKillTimer) {
        try { cancelKillTimer.stop(); } catch (e) {}
        cancelKillTimer = null;
    }
    if (cancelFallbackTimer) {
        try { cancelFallbackTimer.stop(); } catch (e) {}
        cancelFallbackTimer = null;
    }
}

function setBusy(busy)
{
    // v2.3: the single action button is NEVER disabled - it switches its
    // label and tooltip between "Flash" (idle) and "Stop" (flashing), so
    // the same click that started flashing can also abort it.
    uiPanel.cmdFlash.text = busy ? qsTr("Stop") : qsTr("Flash");
    uiPanel.cmdFlash.toolTip = busy ? qsTr("Stop the running flashing process") : qsTr("Flash the firmware. While flashing, this button turns into Stop.");
    uiPanel.cmbPort.setEnabled(!busy);
    uiPanel.cmbBaud.setEnabled(!busy);
    uiPanel.cmbMcu.setEnabled(!busy);
    uiPanel.txtHex.setEnabled(!busy);
    uiPanel.txtExtra.setEnabled(!busy);
    uiPanel.btnBrowse.setEnabled(!busy);
    uiPanel.btnRefresh.setEnabled(!busy);
}

function setLogVisible(v)
{
    if (!uiPanel) return;
    // NOTE: always ASSIGN, never compare-then-assign: QWidget.isVisible
    // reads false while the parent panel is not shown yet, a comparison
    // would skip the assignment and the log would pop up again.
    uiPanel.txtLog.visible = v;
    uiPanel.btnLog.checked = v;
    storage.setValue("logVisible", v ? "true" : "false");
}

function appendLog(line)
{
    if (uiPanel && uiPanel.txtLog) uiPanel.txtLog.appendPlainText(sstr(line));
}

function setProgress(v)
{
    var val = v;
    if (val < 0) val = 0;
    if (val > 100) val = 100;
    if (uiPanel && uiPanel.prgFlash) uiPanel.prgFlash.setValue(val);
}

// ------------------------------------------------------------------ settings

function setupSettings()
{
    // Settings labels/placeholders are translated by QUiLoader from
    // translation_<lang>.qm (context Stk500FlasherSettings).

    // show the detected engine right away (also refreshed when the
    // settings dialog is about to open)
    try {
        var avr = detectAvrdude(false);
        var label = (avr && avr.exe ? avr.exe : qsTr("not found"));
        if (avr && avr.fromPath && avr.exe == "avrdude") label += " (PATH)";
        uiSettings.lblDetected.text = label;
    } catch (e) {}

    uiSettings.btnAvrdudeBrowse.clicked.connect(function () {
        var path = QFileDialog.getOpenFileName(app.window, qsTr("Select avrdude executable"), "", qsTr("Executables (avrdude* avrdude.exe);;All files (*)"));
        path = sstr(path);
        if (path.length > 0) uiSettings.txtAvrdude.setText(path);
    });

    uiSettings.btnConfBrowse.clicked.connect(function () {
        var path = QFileDialog.getOpenFileName(app.window, qsTr("Select avrdude.conf"), "", qsTr("avrdude.conf (avrdude.conf*);;All files (*)"));
        path = sstr(path);
        if (path.length > 0) uiSettings.txtConf.setText(path);
    });
}

function onSettingsAboutToShow()
{
    if (!uiSettings) return;
    uiSettings.txtAvrdude.setText(sstr(storage.value("avrdudePath", "")));
    uiSettings.txtConf.setText(sstr(storage.value("avrdudeConf", "")));
    var avr = detectAvrdude(false);
    var label = (avr && avr.exe ? avr.exe : qsTr("not found"));
    if (avr && avr.fromPath && avr.exe == "avrdude") label += " (PATH)";
    uiSettings.lblDetected.text = label;
}

function onSettingsAccepted()
{
    if (uiSettings) {
        storage.setValue("avrdudePath", trimStr(sstr(uiSettings.txtAvrdude.text)));
        storage.setValue("avrdudeConf", trimStr(sstr(uiSettings.txtConf.text)));
    }

    // Candle's port may have changed - resync the panel default
    if (uiPanel && !procRunning) {
        refreshPorts(false);
    }
}
