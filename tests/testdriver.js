// Test driver appended to the stk500test plugin copy of script.js.
// Prints ST3|...|EOT markers to stdout for automated verification.
function ST3L(s) { print("ST3|" + String(s) + "|EOT"); }

// Find Candle's user-panel QScrollArea from our widget upwards:
// uiPanel -> bw -> QGroupBox -> scrollContentsUser -> scrollArea_3
function st3FindScroll(w)
{
    var p = w;
    for (var i = 0; i < 8; i++) {
        try {
            p = p.parentWidget();
            if (!p) return null;
            if (String(p.className) == "QScrollArea"
                || String(p).indexOf("QScrollArea") >= 0) return p;
        } catch (e) { return null; }
    }
    return null;
}

var t0 = new QTimer();
t0.singleShot = true;
t0.timeout.connect(function () {
    try {
        // ---- layout metrics (panel shown by now) ----
        var msh = uiPanel.minimumSizeHint;
        var mw, mh;
        try { mw = msh.width(); mh = msh.height(); }
        catch (e2) { mw = String(msh); mh = ""; }
        ST3L("panel minSizeHint w=" + mw + " h=" + mh);
        try { ST3L("lang=" + String(app.settings.language)); } catch (e) { ST3L("lang ERR " + e); }
        try { var __qs = new QSettings(); ST3L("ini=" + String(__qs.fileName())
            + " val=" + String(__qs.value("General/language", "MISSING"))); } catch (e) { ST3L("ini ERR " + e); }
        ST3L("panel visible=" + uiPanel.visible
            + " logVisible=" + uiPanel.txtLog.visible);

        // ---- v2.2: no programmer combo must exist ----
        var hasProgCombo = false;
        try { uiPanel.cmbProgrammer.className; hasProgCombo = true; } catch (e) {}
        ST3L("cmbProgrammerGone=" + (!hasProgCombo));

        // ---- log toggle test ----
        var before = uiPanel.txtLog.visible;
        uiPanel.btnLog.click();
        var afterClick = uiPanel.txtLog.visible;
        uiPanel.btnLog.click();
        var afterClick2 = uiPanel.txtLog.visible;
        ST3L("logToggle before=" + before + " after1=" + afterClick
            + " after2=" + afterClick2);

        // ---- scroll area metrics ----
        var sa = st3FindScroll(uiPanel);
        if (sa) {
            ST3L("scroll vmax=" + sa.verticalScrollBar().maximum
                + " hmax=" + sa.horizontalScrollBar().maximum);
        } else {
            ST3L("scroll not found");
        }

        // ---- screenshot at normal window size ----
        try {
            uiPanel.window().grab().save("/tmp/st3_window_normal.png");
            uiPanel.grab().save("/tmp/st3_panel_normal.png");
            ST3L("shots normal saved");
        } catch (e) { ST3L("shot err: " + e); }
    } catch (e) { ST3L("metrics ERR: " + e); }

    // ---- prepare & run flash test ----
    try {
        if (uiPanel.cmbPort.count == 0) { uiPanel.cmbPort.addItem("/dev/ttyUSB0"); }
        setComboText(uiPanel.cmbPort, "/dev/ttyUSB0");
        uiPanel.txtHex.setText("/tmp/test_fw.hex");
        uiPanel.cmdFlash.click();
        ST3L("flash clicked");
    } catch (e) { ST3L("setup ERR: " + e); }
});
t0.start(2500);

var t1 = new QTimer();
t1.singleShot = true;
t1.timeout.connect(function () {
    ST3L("mid: running=" + procRunning + " progress=" + uiPanel.prgFlash.value
        + " logVisible=" + uiPanel.txtLog.visible);
});
t1.start(4000);

var t2 = new QTimer();
t2.singleShot = true;
t2.timeout.connect(function () {
    ST3L("final: running=" + procRunning + " progress=" + uiPanel.prgFlash.value);
    ST3L("status=" + String(uiPanel.lblStatus.text));
    ST3L("settings detected=" + String(uiSettings.lblDetected.text));
    ST3L("logVisibleFinal=" + uiPanel.txtLog.visible);
    var saF = st3FindScroll(uiPanel);
    if (saF) ST3L("finalScroll vmax=" + saF.verticalScrollBar().maximum
                 + " hmax=" + saF.horizontalScrollBar().maximum);
    try {
        ST3L("panelH=" + uiPanel.height + " logH=" + uiPanel.txtLog.height
            + " grpH=" + uiPanel.parentWidget().parentWidget().height);
    } catch (e) { ST3L("geom ERR " + e); }
    try {
        uiPanel.grab().save("/tmp/st3_panel_done.png");
        uiPanel.window().grab().save("/tmp/st3_window_done.png");
        ST3L("shots done saved");
    } catch (e) {}
    var stTxt = String(uiPanel.lblStatus.text);
    ST3L("PASS=" + (!procRunning && uiPanel.prgFlash.value == 100
        && (stTxt.indexOf("Done") >= 0 || stTxt.indexOf("Готово") >= 0)));
});
t2.start(9000);
