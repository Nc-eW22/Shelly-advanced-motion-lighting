// ⚡ SPARK_LABS — Advanced Motion Pro · Brain v1.5
// Clockless Native Schedule-Driven Logic Engine (Event-Driven Core Blueprint).

const VERSION = '1.5';
const LP = '[AM-PRO] ';
const THROTTLE_MS = 250;

// ── STATE & RUNTIME ARRAYS ──────────────────────────────────────
let C = {}; let DEFAULTS = {}; let S_LIST = [];
let S_AM = []; let S_PM = []; let S_NT = [];
let EXPECTED_SCHEDULES = [];

let H = { mode: null, hold: null, m_hold: null, window: null, count: null, en: null, wled_en: null, m_active: null, ticker: null };
let TIMERS = { sync_lock: null, end_hold: null, manual_hold: null };
let LAST_VC = { brightness: null, mode: null };
let LAST_TK = '';

let STATE = { triggers: [], manualHold: false, isDimming: false, syncBusy: false, lastWledPct: -1, lastMotionBri: -1 };
let ACTIVE_SENSORS = {};

// ── DISPATCH QUEUE MATRIX ────────────────────────────────────────
let Q = { busy: false, cool_timer: null, dimmer: null, wled: null };

function dbg(m) { if (C.debug) console.log(LP + m); }

function safeParse(raw, lbl) {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
}

function dispatch() {
    if (Q.busy || Q.cool_timer !== null) return;
    if (Q.dimmer !== null) { flushDimmer(); return; }
    if (Q.wled !== null) { flushWled(); return; }
}

function afterCall() {
    Q.busy = false;
    Q.cool_timer = Timer.set(THROTTLE_MS, false, function() {
        Q.cool_timer = null;
        dispatch();
    });
}

function qDimmer(on, bri, transMs) { Q.dimmer = { on: on, bri: bri, tr: transMs }; dispatch(); }
function qWled(on, bri, transMs, isMotion) { Q.wled = { on: on, bri: bri, tr: transMs, isMotion: isMotion }; dispatch(); }

function flushDimmer() {
    Q.busy = true; let d = Q.dimmer; Q.dimmer = null;
    let url = 'http://127.0.0.1/rpc/Light.Set?id=' + (C.l_id || 1) + '&on=' + (d.on ? 'true' : 'false');
    if (d.on && typeof d.bri === 'number') url = url + '&brightness=' + d.bri;
    if (typeof d.tr === 'number' && d.tr > 0) url = url + '&transition=' + d.tr;
    STATE.scriptIsControlling = true;
    Shelly.call('HTTP.GET', { url: url, timeout: 3 }, function() {
        Timer.set(500, false, function() { STATE.scriptIsControlling = false; });
        afterCall();
    });
}

function flushWled() {
    if (!C.wled.en) { Q.wled = null; dispatch(); return; }
    Q.busy = true; let w = Q.wled; Q.wled = null;
    let bri = Math.round(w.bri * 255 / 100); if (bri < 1 && w.bri > 0) bri = 1;
    let payload = { on: w.on, bri: bri, transition: Math.round((w.tr || 0) / 100) };
    let wc = C.wled;
    if (w.on && w.isMotion) {
        if (wc.pl > 0) payload.pl = wc.pl;
        else if (wc.ps > 0) payload.ps = wc.ps;
        else if (wc.fx > 0) payload.fx = wc.fx;
        else { payload.cct = wc.cct || 127; }
    } else if (w.on) { payload.cct = wc.cct || 127; }
    Shelly.call('HTTP.POST', { url: 'http://' + wc.ip + '/json/state', body: JSON.stringify(payload), timeout: 2 }, function() { afterCall(); });
}

// ── SCENE SELECTION MATRIX ───────────────────────────────────────
function pushTrigger() {
    let t = Date.now();
    let winMin = H.window ? H.window.getValue() : 10;
    STATE.triggers.push(t);
    let cutoff = t - (winMin * 60 * 1000);
    let kept = []; let i;
    for (i = 0; i < STATE.triggers.length; i++) { if (STATE.triggers[i] >= cutoff) kept.push(STATE.triggers[i]); }
    STATE.triggers = kept; 
    if (H.count) H.count.setValue(STATE.triggers.length);
    return STATE.triggers.length;
}

function computeAdaptiveScene() {
    let activePeriod = H.mode ? H.mode.getValue() : "AM";
    let stepArray = S_AM; let defs = DEFAULTS.am;
    
    if (activePeriod === "PM") { stepArray = S_PM; defs = DEFAULTS.pm; }
    if (activePeriod === "Night") { stepArray = S_NT; defs = DEFAULTS.nt; }

    let scene = { briDimmer: defs.d_b, briWled: defs.w_b, transDimmer: defs.d_t, transWled: defs.w_t };
    if (activePeriod === "Night" && defs.ad_dis) return scene;

    let n = STATE.triggers.length;
    let i;
    for (i = stepArray.length - 3; i >= 0; i = i - 3) {
        if (n >= stepArray[i]) {
            scene.briDimmer = stepArray[i + 1];
            scene.briWled = stepArray[i + 2];
            return scene;
        }
    }
    return scene;
}

// ── OR MATRIX MULTI-SENSOR DISPATCH ──────────────────────────────
function isAnySensorActive() { let k; for (k in ACTIVE_SENSORS) { if (ACTIVE_SENSORS[k] === true) return true; } return false; }

function onMotionDetected(sensorId) {
    if (TIMERS.end_hold !== null) { Timer.clear(TIMERS.end_hold); TIMERS.end_hold = null; }
    ACTIVE_SENSORS[sensorId] = true;
    
    if (H.m_active) H.m_active.setValue(true);
    let motionEnabled = H.en ? H.en.getValue() : true;
    if (!motionEnabled || STATE.manualHold) return;

    let trigs = pushTrigger(); let scene = computeAdaptiveScene();
    STATE.lastMotionBri = scene.briDimmer;
    updateTicker(false);

    qDimmer(true, scene.briDimmer, scene.transDimmer);
    qWled(true, scene.briWled, scene.transWled, true);
    startSyncLoop();
}

function onMotionCleared(sensorId) {
    if (ACTIVE_SENSORS[sensorId] !== undefined) ACTIVE_SENSORS[sensorId] = false;
    Timer.set(250, false, function() {
        let activeNow = isAnySensorActive();
        if (H.m_active) H.m_active.setValue(activeNow);
        if (activeNow) return;
        
        Shelly.call('Light.GetStatus', { id: C.l_id || 1 }, function(st) {
            if (!st || !st.output) return;
            let motionEnabled = H.en ? H.en.getValue() : true;
            if (!motionEnabled || STATE.manualHold) return;

            updateTicker(true);
            let holdPeriodS = H.hold ? H.hold.getValue() : 12;
            if (TIMERS.end_hold !== null) Timer.clear(TIMERS.end_hold);
            TIMERS.end_hold = Timer.set(holdPeriodS * 1000, false, function() {
                TIMERS.end_hold = null;
                qDimmer(false, null, C.trans.off);
            });
        });
    });
}

// ── SYNC MONITOR LOOP ────────────────────────────────────────────
function startSyncLoop() {
    let wledSyncEnabled = H.wled_en ? H.wled_en.getValue() : true;
    if (!C.wled.en || !wledSyncEnabled) return;
    if (TIMERS.sync_lock !== null) Timer.clear(TIMERS.sync_lock);
    TIMERS.sync_lock = Timer.set(C.poll_ms || 2000, true, function() {
        if (STATE.syncBusy || STATE.isDimming) return;
        STATE.syncBusy = true;
        Shelly.call('Light.GetStatus', { id: C.l_id || 1 }, function(st) {
            STATE.syncBusy = false; if (!st) return;
            let on = !!st.output; let bri = (typeof st.brightness === 'number') ? st.brightness : (on ? 100 : 0);
            if (!on) {
                if (STATE.lastWledPct !== 0) qWled(false, 0, C.trans.off, false);
                if (TIMERS.sync_lock !== null) { Timer.clear(TIMERS.sync_lock); TIMERS.sync_lock = null; }
                return;
            }
            if (bri !== STATE.lastWledPct) { STATE.lastWledPct = bri; qWled(true, bri, C.trans.on, false); }
        });
    });
}

// ── MONITOR TEXT GENERATOR ───────────────────────────────────────
function updateTicker(isHolding) {
    if (!H.ticker) return; let text = 'CLEAR';
    if (STATE.manualHold) { text = '🛑 MANUAL HOLD'; } 
    else if (isHolding && TIMERS.end_hold !== null) { text = '⏳ HOLDING | ' + (H.hold ? H.hold.getValue() : 12) + 's'; } 
    else if (isAnySensorActive()) { text = '🟢 ' + (H.mode ? H.mode.getValue() : 'AM') + ' | ' + STATE.triggers.length + ' trigs | ' + (STATE.lastMotionBri > 0 ? STATE.lastMotionBri : '--') + '%'; }
    if (text !== LAST_TK) { LAST_TK = text; H.ticker.setValue(text); }
}

// ── SYSTEM ENDPOINTS ─────────────────────────────────────────────
function registerEndpoints() {
    HTTPServer.registerEndpoint('motion', function(req, res) {
        let q = req.query ? parseQuery(req.query) : {};
        if (q.sensor) onMotionDetected(q.sensor);
        res.code = 200; res.body = 'OK'; res.send();
    });
    HTTPServer.registerEndpoint('motion_end', function(req, res) {
        let q = req.query ? parseQuery(req.query) : {};
        if (q.sensor) onMotionCleared(q.sensor);
        res.code = 200; res.body = 'OK'; res.send();
    });
}

function parseQuery(q) {
    let obj = {}; if (!q) return obj;
    let parts = q.split('&'); let i;
    for (i = 0; i < parts.length; i++) {
        let kv = parts[i].split('=');
        if (kv.length === 2) obj[kv[0]] = kv[1];
    }
    return obj;
}

// ── BOOT VERIFICATION PIPELINE ───────────────────────────────────
function kvsGet(k, cb) { Shelly.call('KVS.Get', { key: k }, function(res, err) { if (err !== 0 || !res || res.value === undefined) { cb(null); return; } cb(res.value); }); }

function loadKVS(cb) {
    kvsGet('am_config', function(v1) {
        if (!v1) { console.log(LP + 'CRITICAL CONFIG LOSS. EXECUTE SETUP UTILITY.'); return; }
        C = safeParse(v1, 'am_config');
        kvsGet('am_sensors', function(vSens) {
            S_LIST = safeParse(vSens, 'am_sensors') || [];
            kvsGet('am_steps_am', function(v2) {
                S_AM = safeParse(v2, 'am_steps_am') || [];
                kvsGet('am_steps_pm', function(v3) {
                    S_PM = safeParse(v3, 'am_steps_pm') || [];
                    kvsGet('am_steps_nt', function(v4) {
                        S_NT = safeParse(v4, 'am_steps_nt') || [];
                        kvsGet('am_defaults', function(v5) {
                            DEFAULTS = safeParse(v5, 'am_defaults') || {};
                            kvsGet('am_schedules', function(v6) {
                                EXPECTED_SCHEDULES = safeParse(v6, 'am_schedules') || [];
                                cb();
                            });
                        });
                    });
                });
            });
        });
    });
}

function verifySchedules(cb) {
    Shelly.call('Schedule.List', {}, function(res, err) {
        let foundCount = 0;
        if (err === 0 && res && res.jobs) {
            let i, j;
            for (i = 0; i < res.jobs.length; i++) {
                let job = res.jobs[i];
                if (job.calls && job.calls[0] && job.calls[0].method === "Enum.Set") {
                    let params = job.calls[0].params || {};
                    if (params.id === 200) {
                        for (j = 0; j < EXPECTED_SCHEDULES.length; j++) { if (job.timespec !== undefined) foundCount++; }
                    }
                }
            }
        }
        if (foundCount < 3) {
            console.log(LP + '🚨 ERROR: CRON TIMING MATRICES BROKEN OR UNSET.');
            console.log(LP + '🚨 ACTION REQUIRED: Execute am_pro_setup.js to restore loopback schedules.');
        } else {
            dbg('✅ Schedule verification pass: Active chronometers locked and synchronized.');
        }
        cb();
    });
}

function pollSensorsAtBoot() {
    if (S_LIST.length === 0) return;
    let completed = 0; let idx;
    for (idx = 0; idx < S_LIST.length; idx++) {
        let s = S_LIST[idx];
        Shelly.call('HTTP.GET', { url: s.url, timeout: 4 }, function(res) {
            completed++;
            if (res && res.code === 200) {
                let data = safeParse(res.body, 'boot');
                if (data && data.sensor && data.sensor.motion === true) onMotionDetected(s.id);
            }
        });
    }
}

function init() {
    loadKVS(function() {
        H.mode = Virtual.getHandle('enum:200');
        H.hold = Virtual.getHandle('number:200');
        H.m_hold = Virtual.getHandle('number:201');
        H.window = Virtual.getHandle('number:202');
        H.count = Virtual.getHandle('number:203');
        H.en = Virtual.getHandle('boolean:200');
        H.wled_en = Virtual.getHandle('boolean:201');
        H.m_active = Virtual.getHandle('boolean:202');
        H.ticker = Virtual.getHandle('text:200');
        
        registerEndpoints();
        verifySchedules(function() {
            pollSensorsAtBoot();
            updateTicker(false);
            console.log(LP + 'ONLINE · Version ' + VERSION);
        });
    });
}
init();