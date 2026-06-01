// ⚡ SPARK_LABS — Advanced Motion Pro · Setup Wizard v1.5
// Production Installer: Strict mJS compliance, KVS Split Safety, and Dynamic Loopback Crons.

// ── OPERATION TOGGLES ─────────────────────────────────────────
const DELETE_VCS = false; 
const DELETE_KVS = false;
const SET_KVS    = false;
const CREATE_VCS = false;
const SET_SCHEDULES = true; 
// ──────────────────────────────────────────────────────────────

// ── SITE_CONFIG ───────────────────────────────────────────────
const SITE_CONFIG = {
    l_id: 1, // Mapped to Dimmer light output channel 1
    wled: {
        en: true,
        ip: "192.168.4.175",
        pl: 0, 
        ps: 22, 
        fx: 0, 
        cct: 0
    },
    hold_s: 12,
    m_hold_s: 1800,
    poll_ms: 2000,
    trans: { on: 300, off: 1500 },
    debug: true,
    
    sensors: [
        { id: "1", url: "http://192.168.0.161/status" },
        { id: "2", url: "http://192.168.0.162/status" }
    ],

    // 📅 DYNAMIC CRON CONFIGURATION (AquaSmart Matrix Alignment)
    schedules: [
        { name: "AM_START", timespec: "0 0 6 * * SUN,MON,TUE,WED,THU,FRI,SAT", period: "AM" },
        { name: "PM_START", timespec: "0 0 17 * * SUN,MON,TUE,WED,THU,FRI,SAT", period: "PM" },
        { name: "NIGHT_START", timespec: "0 0 22 * * SUN,MON,TUE,WED,THU,FRI,SAT", period: "Night" }
    ]
};

// ── COMPACT STEP MATRICES ────────────────────────────────────────
const STEPS_AM = [1, 20, 20, 3, 40, 40, 6, 60, 60];
const STEPS_PM = [1, 15, 15, 5, 30, 20, 10, 40, 40];
const STEPS_NT = [1, 2, 2, 3, 20, 3, 6, 10, 10];

const DEFAULTS = {
    am: { d_b: 20, w_b: 20, d_t: 5000, w_t: 2500 },
    pm: { d_b: 15, w_b: 15, d_t: 6000, w_t: 3000 },
    nt: { d_b: 2, w_b: 2, d_t: 12000, w_t: 6000, ad_dis: false }
};

// ── ENGINE BUILDER ───────────────────────────────────────────
const VERSION = "1.5";
let _q = []; let _qi = 0;

function qadd(method, params, delay_ms) {
    _q.push({ m: method, p: params, d: (delay_ms || 600) });
}

function qrun() {
    if (_qi >= _q.length) { onComplete(); return; }
    let task = _q[_qi]; _qi++;
    if (task.m === '_PAUSE_') {
        console.log('[SETUP] Settle execution window: ' + task.d + 'ms...');
        Timer.set(task.d, false, qrun);
        return;
    }
    Shelly.call(task.m, task.p, function(res, err, msg) {
        Timer.set(task.d, false, qrun);
    });
}

function buildConfigObject() {
    return {
        l_id: SITE_CONFIG.l_id,
        wled: SITE_CONFIG.wled,
        hold_s: SITE_CONFIG.hold_s,
        m_hold_s: SITE_CONFIG.m_hold_s,
        poll_ms: SITE_CONFIG.poll_ms,
        trans: SITE_CONFIG.trans,
        debug: SITE_CONFIG.debug
    };
}

function init() {
    console.log('[SETUP] Running Advanced Motion Pro Provisioning Matrix...');
    
    if (DELETE_VCS) {
        qadd('Virtual.Delete', { key: 'enum:200' });
        qadd('Virtual.Delete', { key: 'number:200' });
        qadd('Virtual.Delete', { key: 'number:201' });
        qadd('Virtual.Delete', { key: 'number:202' });
        qadd('Virtual.Delete', { key: 'number:203' });
        qadd('Virtual.Delete', { key: 'boolean:200' });
        qadd('Virtual.Delete', { key: 'boolean:201' });
        qadd('Virtual.Delete', { key: 'boolean:202' });
        qadd('Virtual.Delete', { key: 'text:200' });
        qadd('Virtual.Delete', { key: 'group:200' });
        qadd('_PAUSE_', {}, 1500);
    }

    if (SET_KVS) {
        let coreConfig = buildConfigObject();
        let sensorConfig = []; let i;
        for (i = 0; i < SITE_CONFIG.sensors.length; i++) { sensorConfig.push(SITE_CONFIG.sensors[i]); }

        qadd('KVS.Set', { key: 'am_config', value: JSON.stringify(coreConfig) }, 400);
        qadd('KVS.Set', { key: 'am_sensors', value: JSON.stringify(sensorConfig) }, 400);
        qadd('KVS.Set', { key: 'am_steps_am', value: JSON.stringify(STEPS_AM) }, 400);
        qadd('KVS.Set', { key: 'am_steps_pm', value: JSON.stringify(STEPS_PM) }, 400);
        qadd('KVS.Set', { key: 'am_steps_nt', value: JSON.stringify(STEPS_NT) }, 400);
        qadd('KVS.Set', { key: 'am_defaults', value: JSON.stringify(DEFAULTS) }, 400);
        
        let trackingScheds = []; let s;
        for (s = 0; s < SITE_CONFIG.schedules.length; s++) { trackingScheds.push(SITE_CONFIG.schedules[s].name); }
        qadd('KVS.Set', { key: 'am_schedules', value: JSON.stringify(trackingScheds) }, 400);
        qadd('KVS.Set', { key: 'am_schema', value: VERSION }, 400);
        qadd('_PAUSE_', {}, 1000);
    }

    if (CREATE_VCS) {
        let periods = ["AM", "PM", "Night"];
        qadd('Virtual.Add', { type: 'enum', id: 200, config: { name: 'Active Period', options: periods, default_value: 'AM' }}, 800);
        qadd('Virtual.Add', { type: 'number', id: 200, config: { name: 'End Hold Time', default_value: SITE_CONFIG.hold_s, min: 5, max: 300 }}, 800);
        qadd('Virtual.Add', { type: 'number', id: 201, config: { name: 'Manual Hold Time', default_value: 30, min: 5, max: 240 }}, 800);
        qadd('Virtual.Add', { type: 'number', id: 202, config: { name: 'Trigger Window', default_value: 10, min: 1, max: 60 }}, 800);
        qadd('Virtual.Add', { type: 'number', id: 203, config: { name: 'Current Activity', default_value: 0 }}, 800);
        qadd('Virtual.Add', { type: 'boolean', id: 200, config: { name: 'Motion Logic Switch', default_value: true }}, 800);
        qadd('Virtual.Add', { type: 'boolean', id: 201, config: { name: 'WLED Sync Switch', default_value: true }}, 800);
        qadd('Virtual.Add', { type: 'boolean', id: 202, config: { name: 'Motion Active', default_value: false }}, 800);
        qadd('Virtual.Add', { type: 'text', id: 200, config: { name: 'System Status', default_value: 'INITIALIZING' }}, 800);
        qadd('Virtual.Add', { type: 'group', id: 200, config: { name: 'Advanced Motion Control' }}, 800);
        
        qadd('_PAUSE_', {}, 1500);

        qadd('Enum.SetConfig', { id: 200, config: { name: 'Active Period', options: periods, default_value: 'AM', meta: { ui: { view: 'dropdown', icon: 'https://img.icons8.com/?size=100&id=nZF8SFgVUZZJ&format=png&color=000000', titles: { 'AM': '🌅 AM Period', 'PM': '🌇 PM Period', 'Night': '🌙 Night Period' } } } } }, 700);
        qadd('Number.SetConfig', { id: 200, config: { name: 'End Hold Time', min: 5, max: 300, meta: { ui: { view: 'slider', unit: 's', icon: 'https://img.icons8.com/?size=100&id=4FL3UKeYVGFI&format=png&color=000000' } } } }, 700);
        qadd('Number.SetConfig', { id: 201, config: { name: 'Manual Hold Time', min: 5, max: 240, meta: { ui: { view: 'slider', unit: 'm', icon: 'https://img.icons8.com/?size=100&id=TWgnOuDDzAih&format=png&color=000000' } } } }, 700);
        qadd('Number.SetConfig', { id: 202, config: { name: 'Trigger Window', min: 1, max: 60, meta: { ui: { view: 'slider', unit: 'm', icon: 'https://img.icons8.com/?size=100&id=ddHq816KEsxh&format=png&color=000000' } } } }, 700);
        qadd('Number.SetConfig', { id: 203, config: { name: 'Current Activity', min: 0, max: 999, meta: { ui: { view: 'label', step: 1, icon: 'https://img.icons8.com/?size=100&id=XpgUyFyd18ju&format=png&color=000000' } } } }, 700);
        qadd('Boolean.SetConfig', { id: 200, config: { name: 'Motion Logic Switch', default_value: true, meta: { ui: { view: 'toggle', icon: 'https://img.icons8.com/?size=100&id=lsZBoVE2zMo3&format=png&color=000000' } } } }, 700);
        qadd('Boolean.SetConfig', { id: 201, config: { name: 'WLED Sync Switch', default_value: true, meta: { ui: { view: 'toggle', icon: 'https://img.icons8.com/?size=100&id=rcvmSKzkbMQV&format=png&color=000000' } } } }, 700);
        qadd('Boolean.SetConfig', { id: 202, config: { name: 'Motion Active', default_value: false, meta: { ui: { view: 'label', icon: 'https://img.icons8.com/?size=100&id=lsZBoVE2zMo3&format=png&color=000000' } } } }, 700);
        qadd('Text.SetConfig', { id: 200, config: { name: 'System Status', max_len: 50, default_value: 'CLEAR', meta: { ui: { view: 'label', icon: 'https://img.icons8.com/?size=100&id=43660&format=png&color=000000' } } } }, 700);
        qadd('Group.SetConfig', { id: 200, config: { name: 'Advanced Motion Control', meta: { ui: { view: 'list' } } } }, 700);
        
        let members = ['enum:200', 'text:200', 'number:203', 'boolean:202', 'boolean:200', 'boolean:201', 'number:200', 'number:201', 'number:202'];
        qadd('Group.Set', { id: 200, value: members }, 700);
    }

    if (SET_SCHEDULES) {
        let sc;
        for (sc = 0; sc < SITE_CONFIG.schedules.length; sc++) {
            let item = SITE_CONFIG.schedules[sc];
            // Uses AquaSmart style code trigger generation parameters cleanly
            let loopbackCall = {
                enable: true, timespec: item.timespec,
                calls: [{ method: "Enum.Set", params: { id: 200, value: item.period } }]
            };
            qadd('Schedule.Create', loopbackCall, 800);
        }
    }

    qrun();
}

function onComplete() {
    console.log('[SETUP] ===============================================');
    console.log('[SETUP] ALL SYSTEM PACKAGES FULLY PROVISIONED');
    console.log('[SETUP] ===============================================');
    // Removed broken stopStatusChangesObserver method call completely
    Shelly.call('Script.Stop', { id: Shelly.getCurrentScriptId() });
}

init();