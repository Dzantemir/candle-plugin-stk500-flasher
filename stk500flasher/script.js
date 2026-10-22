// STK500 Flasher - plugin for Candle (v2)
// Panel for flashing AVR/Arduino control boards (GRBL etc.) over the
// Arduino STK500 v1 protocol (Optiboot), exactly like the Arduino IDE does.
//
// Flash engine: avrdude. The programmer type is FIXED (v2.2): -c stk500v1,
// i.e. the Arduino STK500 v1 protocol via the board's own USB-UART
// bootloader - there is no programmer selection in the UI anymore.
//   - avrdude path can be selected in the plugin settings page
//   - auto-search: plugin folder (avrdude subfolder), app folder,
//     Arduino IDE, PlatformIO, system PATH
//   - Windows avrdude 8.0 can be bundled in the "avrdude" subfolder
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
var PROGRAMMER = "stk500v1";

var lastParsedPath = "";
var lastParsedInfo = null;

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

// ------------------------------------------------------------------ i18n

var STR_EN = {
    "port": "Port", "baud": "Baud", "mcu": "MCU",
    "hex": "HEX", "options": "Opt.",
    "flash": "Flash", "cancel": "Stop", "log": "Log",
    "refreshTooltip": "Rescan available serial ports",
    "refresh": "Refresh",
    "logTooltip": "Show/hide avrdude output log",
    "optionsTooltip": "Additional avrdude options, space separated (e.g. -D or -V)",
    "noPort": "Select a serial port",
    "noMcu": "Select a controller (MCU)",
    "noHex": "Select a HEX file",
    "hexNotFound": "HEX file not found",
    "hexTooBig": "HEX does not fit into MCU flash",
    "bootloaderWarn": "Warning: HEX reaches the bootloader area",
    "noAvrdude": "avrdude not found",
    "noAvrdudeHelp": "Select the avrdude executable in the plugin settings (Settings - STK500 Flasher). Windows: unpack avrdude into the 'avrdude' subfolder of this plugin; Linux: install avrdude (sudo apt install avrdude); macOS: brew install avrdude",
    "flashing": "Flashing...",
    "done": "Done! Firmware flashed successfully",
    "doneMsg": "avrdude finished OK",
    "reconnectHint": "You can reconnect to the board in Candle now",
    "failed": "Flashing failed",
    "failedHelp": "Check: 1) Candle is disconnected from the board, 2) port/baud are correct, 3) MCU is correct, 4) the board is in the bootloader (press RESET right after clicking Flash if auto-reset is disabled)",
    "portBusyHint": "Port is busy or access denied - disconnect in Candle first (Connection - Disconnect)",
    "connectedWarn": "Candle is connected to this port - flashing will most likely fail. Disconnect in Candle first.",
    "signatureHint": "Device signature mismatch: wrong MCU selected. Check the MCU field (can be forced with -F in options, use with care)",
    "canceled": "Canceled",
    "canceling": "Canceling...",
    "timeout": "Timeout - process did not finish",
    "startFailed": "Could not start avrdude",
    "procError": "Process error",
    "selectHex": "Select firmware HEX file",
    "hexFilter": "HEX files (*.hex *.ihx *.hex32);;All files (*)",
    "detected": "Detected",
    "none": "not found",
    "avrdudeLabel": "avrdude executable",
    "confLabel": "avrdude.conf (optional)",
    "emptyForAuto": "auto",
    "hexSpan": "HEX image",
    "bytes": "bytes",
    "openAvrdude": "Select avrdude executable",
    "openConf": "Select avrdude.conf",
    "exeFilter": "Executables (avrdude* avrdude.exe);;All files (*)",
    "confFilter": "avrdude.conf (avrdude.conf*);;All files (*)",
    "invalidHex": "Invalid HEX file",
    "settingsHelp": "Leave empty to search avrdude automatically: plugin folder (avrdude subfolder), application folder, Arduino IDE, PlatformIO, system PATH. Windows: avrdude can be bundled with this plugin. Linux/macOS: install avrdude or select your own binary here."
};

var STR_RU = {
    "port": "Порт", "baud": "Бод", "mcu": "МК",
    "hex": "HEX", "options": "Опции",
    "flash": "Прошить", "cancel": "Стоп", "log": "Лог",
    "refreshTooltip": "Обновить список портов",
    "refresh": "Обновить",
    "logTooltip": "Показать/скрыть журнал avrdude",
    "optionsTooltip": "Дополнительные опции avrdude через пробел (например -D или -V)",
    "noPort": "Выберите последовательный порт",
    "noMcu": "Выберите контроллер (MCU)",
    "noHex": "Выберите HEX-файл",
    "hexNotFound": "HEX-файл не найден",
    "hexTooBig": "HEX не помещается во flash-память контроллера",
    "bootloaderWarn": "Внимание: HEX доходит до области загрузчика",
    "noAvrdude": "avrdude не найден",
    "noAvrdudeHelp": "Укажите файл avrdude в настройках плагина (Настройки - STK500 Flasher). Windows: распакуйте avrdude в подпапку 'avrdude' этого плагина; Linux: установите avrdude (sudo apt install avrdude); macOS: brew install avrdude",
    "flashing": "Прошивка...",
    "done": "Готово! Прошивка успешно записана",
    "doneMsg": "avrdude завершился без ошибок",
    "reconnectHint": "Теперь можно снова подключиться к плате в Candle",
    "failed": "Не удалось прошить",
    "failedHelp": "Проверьте: 1) Candle отключён от платы, 2) правильность порта и скорости, 3) правильность контроллера, 4) плата находится в загрузчике (нажмите RESET сразу после нажатия «Прошить», если авто-сброс на плате отключён)",
    "portBusyHint": "Порт занят или нет доступа — сначала отключитесь в Candle (Соединение - Отключиться)",
    "connectedWarn": "Candle подключён к этому порту — прошивка скорее всего не удастся. Сначала отключитесь в Candle.",
    "signatureHint": "Сигнатура устройства не совпала: выбран неверный контроллер. Проверьте поле «Контроллер» (можно принудительно продолжить, добавив -F в опции — осторожно)",
    "canceled": "Отменено",
    "canceling": "Отмена...",
    "timeout": "Таймаут — процесс не завершился",
    "startFailed": "Не удалось запустить avrdude",
    "procError": "Ошибка процесса",
    "selectHex": "Выберите HEX-файл прошивки",
    "hexFilter": "HEX-файлы (*.hex *.ihx *.hex32);;Все файлы (*)",
    "detected": "Определено",
    "none": "не найден",
    "avrdudeLabel": "Программа avrdude",
    "confLabel": "avrdude.conf (необязательно)",
    "emptyForAuto": "авто",
    "hexSpan": "Образ HEX",
    "bytes": "байт",
    "openAvrdude": "Выберите файл avrdude",
    "openConf": "Выберите avrdude.conf",
    "exeFilter": "Исполняемые файлы (avrdude* avrdude.exe);;Все файлы (*)",
    "confFilter": "avrdude.conf (avrdude.conf*);;Все файлы (*)",
    "invalidHex": "Некорректный HEX-файл",
    "settingsHelp": "Оставьте пустым для автоматического поиска avrdude: папка плагина (подпапка avrdude), папка программы, Arduino IDE, PlatformIO, системный PATH. Windows: avrdude можно положить в комплект плагина. Linux/macOS: установите avrdude или выберите свой файл здесь."
};

var RU = false;
try { RU = (sstr(app.settings.language) == "ru"); } catch (e) {}

function T(key)
{
    if (RU && STR_RU[key]) return STR_RU[key];
    if (STR_EN[key]) return STR_EN[key];
    return key;
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
    if (RU) localizePanel();

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
    uiPanel.cmdFlash.clicked.connect(onFlash);
    uiPanel.cmdCancel.clicked.connect(onCancel);
    uiPanel.txtHex.textChanged.connect(updateHexInfo);
    // NOTE: QComboBox::currentIndexChanged is overloaded (int)/(QString),
    // a plain connect() throws "ambiguous connect" - select by signature.
    uiPanel.cmbMcu["currentIndexChanged(int)"].connect(function () {
        lastParsedPath = "";
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

function localizePanel()
{
    // NOTE: property assignment only - setText()/setToolTip() methods are
    // missing for buttons in Candle's QtScript bindings!
    uiPanel.lblPort.text = T("port") + ":";
    uiPanel.lblBaud.text = T("baud") + ":";
    uiPanel.lblMcu.text = T("mcu") + ":";
    uiPanel.lblHex.text = T("hex") + ":";
    uiPanel.lblOptions.text = T("options") + ":";
    uiPanel.btnRefresh.toolTip = T("refreshTooltip");
    uiPanel.btnRefresh.text = T("refresh");
    uiPanel.btnBrowse.toolTip = T("selectHex");
    uiPanel.cmdFlash.text = T("flash");
    uiPanel.cmdCancel.text = T("cancel");
    uiPanel.btnLog.text = T("log");
    uiPanel.btnLog.toolTip = T("logTooltip");
    uiPanel.lblOptions.toolTip = T("optionsTooltip");
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

    var lines = text.split("\n");
    var base = 0;
    var minAddr = -1;
    var maxAddr = -1;
    var count = 0;

    for (var li = 0; li < lines.length; li++) {
        var line = lines[li];
        line = line.replace(/\r/g, "");
        line = line.replace(/^\s+/, "").replace(/\s+$/, "");
        if (line.length == 0) continue;

        if (line.charAt(0) != ":") return { error: "format" };

        var n = (line.length - 1) / 2;
        if (Math.floor(n) != n) return { error: "format" };

        var bytes = [];
        var sum = 0;
        for (var i = 0; i < n; i++) {
            var b = parseInt(line.substr(1 + i * 2, 2), 16);
            if (isNaN(b)) return { error: "format" };
            bytes.push(b);
            sum += b;
        }
        if ((sum & 0xFF) != 0) return { error: "checksum" };

        var len = bytes[0];
        if (bytes.length != len + 5) return { error: "format" };

        var addr = bytes[1] * 256 + bytes[2];
        var type = bytes[3];

        if (type == 0) {
            for (var i = 0; i < len; i++) {
                var a = base + addr + i;
                if (minAddr < 0 || a < minAddr) minAddr = a;
                if (a > maxAddr) maxAddr = a;
            }
            count += len;
        } else if (type == 1) {
            break;
        } else if (type == 2) {
            base = (bytes[4] * 256 + bytes[5]) * 16;
        } else if (type == 4) {
            base = (bytes[4] * 256 + bytes[5]) * 65536;
        }
        // type 5 (start address) and others are ignored
    }

    if (count == 0) return { error: "empty" };
    return { bytes: count, minAddr: minAddr, maxAddr: maxAddr };
}

function hexErrorText(e)
{
    if (e == "read") return T("hexNotFound");
    if (e == "checksum") return "checksum";
    if (e == "empty") return "no data";
    return "format";
}

function updateHexInfo()
{
    if (!uiPanel) return;

    var path = trimStr(sstr(uiPanel.txtHex.text));
    if (path == lastParsedPath) return;
    lastParsedPath = path;
    lastParsedInfo = null;

    if (path.length == 0) { uiPanel.lblStatus.text = ""; return; }

    lastParsedInfo = parseHex(path);

    if (lastParsedInfo.error) {
        setStatus(T("invalidHex") + " (" + hexErrorText(lastParsedInfo.error) + ")", true);
        return;
    }

    var flash = MCU_FLASH[currentMcu()] || 0;
    var end = lastParsedInfo.maxAddr + 1;
    var msg = T("hexSpan") + ": " + lastParsedInfo.bytes + " " + T("bytes")
            + " [0x" + lastParsedInfo.minAddr.toString(16)
            + " - 0x" + end.toString(16) + "]";

    if (flash > 0 && end > flash) {
        setStatus(msg + " - " + T("hexTooBig"), true);
    } else if (flash > 0 && end > flash - 512) {
        setStatus(msg + " - " + T("bootloaderWarn"), true);
    } else {
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
        if (logIt) appendLog(T("noAvrdude") + ": " + custom);
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
    return { exe: "avrdude", conf: null };
}

// ------------------------------------------------------------------ flash

function onBrowse()
{
    var path = QFileDialog.getOpenFileName(app.window, T("selectHex"),
                                            sstr(uiPanel.txtHex.text), T("hexFilter"));
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
        setStatus(T("noPort"), true); return;
    }
    if (mcu.length == 0) { setStatus(T("noMcu"), true); return; }
    if (hex.length == 0) { setStatus(T("noHex"), true); return; }
    if (!fileExists(hex)) { setStatus(T("hexNotFound"), true); return; }

    // HEX sanity check
    var info = parseHex(hex);
    if (info.error) { setStatus(T("invalidHex") + " (" + hexErrorText(info.error) + ")", true); return; }

    var flash = MCU_FLASH[mcu] || 0;
    if (flash > 0 && info.maxAddr + 1 > flash) {
        setStatus(T("hexTooBig"), true); return;
    }
    if (flash > 0 && info.maxAddr + 1 > flash - 512) {
        setStatus(T("bootloaderWarn"), true);
    }

    var avr = detectAvrdude(true);
    if (!avr) {
        setStatus(T("noAvrdude"), true);
        setLogVisible(true);
        appendLog(T("noAvrdudeHelp"));
        return;
    }

    // Warn if Candle is connected to this port
    try {
        var devState = Number(app.device.state);
        if (devState != -1 && port.length > 0 && port == candlePort()) {
            appendLog(T("connectedWarn"));
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
    args.push("-U"); args.push("flash:w:" + hex + ":i");
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
    appendLog(T("flashing") + " " + mcu + " @ " + port
            + " (" + PROGRAMMER + (isNaN(b) ? "" : ", " + b) + ")");
    appendLog(T("hexSpan") + ": " + info.bytes + " " + T("bytes"));
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

    proc.readyReadStandardOutput.connect(onProcReadyReadStdout);
    proc.readyReadStandardError.connect(onProcReadyReadStderr);
    // NOTE: QProcess::finished is overloaded (int) / (int, QProcess::ExitStatus)
    // - a plain connect() throws "ambiguous connect" in Candle's QtScript,
    // so the exact signature must be selected by name.
    proc["finished(int)"].connect(onProcFinished);
    try { proc.error.connect(onProcError); } catch (e) {}

    proc.start(avr.exe, args);

    procRunning = true;
    setBusy(true);
    setProgress(0);
    setStatus(T("flashing"), false);

    // Detect "failed to start" (avrdude missing / not executable)
    startCheckTimer = new QTimer();
    startCheckTimer.singleShot = true;
    startCheckTimer.timeout.connect(function () {
        if (procRunning && proc && sstr(proc.state()).indexOf("NotRunning") == 0) {
            onProcFailedToStart();
        }
    });
    startCheckTimer.start(800);

    // Watchdog
    watchdogTimer = new QTimer();
    watchdogTimer.singleShot = true;
    watchdogTimer.timeout.connect(function () {
        if (procRunning) {
            appendLog(T("timeout"));
            onCancel();
        }
    });
    watchdogTimer.start(600000);
}

function onCancel()
{
    if (!procRunning || !proc) return;
    procCanceled = true;
    appendLog(T("canceling"));
    try {
        var pid = Number(proc.processId());
        if (pid > 0) {
            if (WIN) QProcess.execute("taskkill", ["/F", "/T", "/PID", String(pid)]);
            else QProcess.execute("kill", ["-9", String(pid)]);
        }
    } catch (e) {}
}

function onProcError(err)
{
    var s = sstr(err);
    // enum may arrive as number: 0=FailedToStart 1=Crashed 2=Timedout 3=ReadError...
    if (s == "0" || s == "") s = "FailedToStart";
    if (s.indexOf("FailedToStart") >= 0) {
        onProcFailedToStart();
    } else {
        appendLog(T("procError") + ": " + s);
    }
}

function onProcFailedToStart()
{
    if (!procRunning) return;
    procRunning = false;
    cleanupTimers();
    setBusy(false);
    setStatus(T("startFailed"), true);
    setLogVisible(true);
    appendLog(T("startFailed") + ": " + (proc ? sstr(proc.program()) : "avrdude"));
    appendLog(T("noAvrdudeHelp"));
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

    // Progress: latest "NN%" in the buffer, mapped to write/verify phase
    var wIdx = procBuffer.lastIndexOf("Writing |");
    var rIdx = procBuffer.lastIndexOf("Reading |");
    var pct = lastPercent(procBuffer);
    if (pct >= 0) {
        var base = 0;
        var range = 5;
        if (wIdx >= 0 && rIdx > wIdx) { base = 65; range = 35; }   // verify read
        else if (wIdx >= 0) { base = 5; range = 60; }              // writing
        setProgress(base + Math.round(pct * range / 100));
    }

    // Complete lines to the log
    var idx;
    while ((idx = procBuffer.indexOf("\n")) >= 0) {
        var line = procBuffer.substring(0, idx);
        procBuffer = procBuffer.substring(idx + 1);
        line = line.replace(/\r/g, "");
        if (trimStr(line).length > 0) appendLog(line);
    }
}

function onProcFinished(exitCode)
{
    if (!procRunning) return;

    procRunning = false;
    cleanupTimers();

    // Flush the remaining buffer
    if (procBuffer.length > 0) {
        var tail = procBuffer.replace(/\r/g, "");
        if (trimStr(tail).length > 0) appendLog(tail);
        procBuffer = "";
    }

    setBusy(false);

    if (procCanceled) {
        setStatus(T("canceled"), true);
        appendLog(T("canceled"));
    } else if (Number(exitCode) == 0) {
        setProgress(100);
        setStatus(T("done"), false);
        appendLog(T("doneMsg"));
        appendLog(T("reconnectHint"));
    } else {
        setStatus(T("failed") + " (exit " + Number(exitCode) + ")", true);
        setLogVisible(true);
        appendLog(T("failedHelp"));
        analyzeOutputHints();
    }

    proc = null;
    procCanceled = false;
}

function analyzeOutputHints()
{
    var out = procOutAll;
    if (/signature mismatch|invalid device signature|expected signature/i.test(out)) {
        appendLog(T("signatureHint"));
    }
    if (/can'?t open|access is denied|permission denied|device busy|resource busy/i.test(out)) {
        appendLog(T("portBusyHint"));
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
}

function setBusy(busy)
{
    uiPanel.cmdFlash.setEnabled(!busy);
    uiPanel.cmdCancel.setEnabled(busy);
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
    uiPanel.txtLog.appendPlainText(sstr(line));
}

function setProgress(v)
{
    var val = v;
    if (val < 0) val = 0;
    if (val > 100) val = 100;
    uiPanel.prgFlash.setValue(val);
}

// ------------------------------------------------------------------ settings

function setupSettings()
{
    if (RU) localizeSettings();

    // show the detected engine right away (also refreshed when the
    // settings dialog is about to open)
    try {
        var avr = detectAvrdude(false);
        uiSettings.lblDetected.text = (avr && avr.exe ? avr.exe : T("none"));
    } catch (e) {}

    uiSettings.btnAvrdudeBrowse.clicked.connect(function () {
        var path = QFileDialog.getOpenFileName(app.window, T("openAvrdude"), "", T("exeFilter"));
        path = sstr(path);
        if (path.length > 0) uiSettings.txtAvrdude.setText(path);
    });

    uiSettings.btnConfBrowse.clicked.connect(function () {
        var path = QFileDialog.getOpenFileName(app.window, T("openConf"), "", T("confFilter"));
        path = sstr(path);
        if (path.length > 0) uiSettings.txtConf.setText(path);
    });
}

function localizeSettings()
{
    // property assignment only (see note in localizePanel)
    uiSettings.lblAvrdude.text = T("avrdudeLabel");
    uiSettings.lblConf.text = T("confLabel");
    uiSettings.lblDetectedTitle.text = T("detected") + ":";
    uiSettings.lblHelp.text = T("settingsHelp");
    uiSettings.txtAvrdude.placeholderText = T("emptyForAuto");
    uiSettings.txtConf.placeholderText = T("emptyForAuto");
}

function onSettingsAboutToShow()
{
    if (!uiSettings) return;
    uiSettings.txtAvrdude.setText(sstr(storage.value("avrdudePath", "")));
    uiSettings.txtConf.setText(sstr(storage.value("avrdudeConf", "")));
    var avr = detectAvrdude(false);
    uiSettings.lblDetected.text = (avr && avr.exe ? avr.exe : T("none"));
}

function onSettingsAccepted()
{
    if (uiSettings) {
        storage.setValue("avrdudePath", trimStr(sstr(uiSettings.txtAvrdude.text)));
        storage.setValue("avrdudeConf", trimStr(sstr(uiSettings.txtConf.text)));
    }

    // Candle's port may have changed - resync the panel default
    if (uiPanel) {
        refreshPorts(false);
    }
}
