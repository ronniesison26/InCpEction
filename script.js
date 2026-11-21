"use strict";
/* ===== storage helpers (browser only; may be unavailable) ===== */
const ls = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch (e) { return d } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)) } catch (e) { } } };
const $ = s => document.querySelector(s), now = () => new Date().toISOString();
const fmt = t => new Date(t).toLocaleString('en-US', { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/* ===== state ===== */
const cfg = ls.get('inc_cfg', { on: 28, off: 25, buzzer: true, notif: true, admin: 'admin', pass: 'admin123', device: '' });
const S = {
    temp: 27.4, hum: 61, fan: false, mode: 'AUTO', door: 'CLOSED', lock: 'LOCKED', batt: 78, vib: false, buzzer: false, alert: null, live: false,
    hist: ls.get('inc_hist', []), logs: ls.get('inc_logs', null), notifs: ls.get('inc_notifs', []), alerts: ls.get('inc_alerts', []),
    users: ls.get('inc_users', [{ id: 1, name: 'Administrator', user: 'admin', uid: '1047', role: 'Admin', active: true, date: '2026-11-01' }, { id: 2, name: 'Lab User One', user: 'User 1', uid: '2031', role: 'User', active: true, date: '2026-11-03' }, { id: 3, name: 'Lab User Two', user: 'User 2', uid: '3096', role: 'User', active: true, date: '2026-11-05' }])
};
if (!S.logs) {
    const t = Date.now(), m = x => new Date(t - x * 36e5).toISOString(); S.logs = [
        { t: m(1), user: 'Admin', uid: '1047', action: 'Access Attempt', status: 'Granted', details: 'Door Unlocked', sim: 1 },
        { t: m(3), user: 'User 1', uid: '2031', action: 'Access Attempt', status: 'Granted', details: 'Door Unlocked', sim: 1 },
        { t: m(5), user: 'Guest', uid: '0000', action: 'Access Attempt', status: 'Denied', details: 'Unauthorized Card', sim: 1 },
        { t: m(9), user: 'System', uid: '-', action: 'Security Alert', status: 'Alert', details: 'Vibration Detected', sim: 1 }]
}
if (!S.hist.length) { const t = Date.now(); for (let i = 200; i > 0; i--)S.hist.push({ t: new Date(t - i * 7 * 60e3).toISOString(), temp: +(26 + 2 * Math.sin(i / 12) + Math.random() - .5).toFixed(1), hum: Math.round(60 + 6 * Math.cos(i / 9)), sim: 1 }) }
const save = () => { ls.set('inc_hist', S.hist.slice(-1500)); ls.set('inc_logs', S.logs.slice(-500)); ls.set('inc_notifs', S.notifs.slice(-200)); ls.set('inc_alerts', S.alerts); ls.set('inc_users', S.users); ls.set('inc_cfg', cfg) };
let page = 'dashboard', lf = { q: '', st: '', range: 'all', pg: 1 }, uq = '';
const tag = () => S.live ? '' : ' <span class="chip sim" title="Simulated data">SIM</span>';
/* ===== UI helpers ===== */
function toast(m) { const e = document.createElement('div'); e.className = 'toast'; e.textContent = m; document.body.appendChild(e); setTimeout(() => e.remove(), 2800) }
function modal(title, fields, ok, okLabel, icon) {
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = `<div class="glass"><div class="mi">${icon || '📝'}</div><h3>${esc(title)}</h3>${fields.map(f => f.type === 'select' ? `<label>${f.l}</label><select name="${f.k}">${f.opts.map(o => `<option ${o == f.v ? 'selected' : ''}>${o}</option>`).join('')}</select>` : f.msg ? `<p>${esc(f.msg)}</p>` : `<label>${f.l}</label><input name="${f.k}" type="${f.type || 'text'}" value="${esc(f.v || '')}">`).join('')}<div class="err"></div><div class="row" style="margin:12px 0 0"><button class="btn" id="mok">${okLabel || 'Save changes'}</button><button class="btn g" id="mno">Cancel</button></div></div>`;
    document.body.appendChild(m); m.querySelector('#mno').onclick = () => m.remove();
    m.querySelector('#mok').onclick = () => { const v = {}; m.querySelectorAll('[name]').forEach(i => v[i.name] = i.value.trim()); const r = ok(v); if (r) m.querySelector('.err').textContent = r; else m.remove() }
}
const confirmBox = (msg, fn, l, icon) => modal('Please confirm', [{ msg }], () => { fn() }, l || 'Confirm', icon || '⚠️');
/* ===== core logic ===== */
function addAccessLog(r) {
    const last = S.logs[S.logs.length - 1]; if (last && last.details === r.details && last.uid === r.uid && last.status === r.status && Date.now() - new Date(last.t) < 1500) return;
    S.logs.push({ t: now(), sim: !S.live, ...r }); save(); if (page === 'logs') render()
}
function createNotification(type, msg) { if (!cfg.notif && type === 'info') return; S.notifs.push({ id: Date.now() + Math.random(), type, msg, t: now(), read: false, sim: !S.live }); save(); bell() }
const bell = () => { $('#bc').textContent = S.notifs.filter(n => !n.read).length };
function tempStatus() { return S.temp >= 32 ? ['Critical', 'd'] : S.temp >= cfg.on ? ['Warning', 'w'] : ['Normal', ''] }
function humStatus() { return S.hum > 70 || S.hum < 30 ? ['Warning', 'w'] : ['Normal', ''] }
/* Hysteresis: ON at >= on, OFF at <= off, hold state in between. Never runs in MANUAL mode. */
function controlFanAutomatically() {
    if (S.mode !== 'AUTO') return;
    if (S.temp >= cfg.on && !S.fan) { updateFanStatus(true); createNotification('warn', 'High temperature ' + S.temp.toFixed(1) + '°C – exhaust fan automatically activated') }
    else if (S.temp <= cfg.off && S.fan) { updateFanStatus(false); createNotification('info', 'Temperature returned to normal (' + S.temp.toFixed(1) + '°C) – fan turned off') }
}
function updateFanStatus(on) { S.fan = on; cmd('fan', { on }) }
function setManualFanControl(on) { S.mode = 'MANUAL'; updateFanStatus(on); toast('Manual mode: fan ' + (on ? 'ON' : 'OFF') + (S.live ? '' : ' (simulated, not sent to hardware)')); render() }
function enableAutomaticMode() { S.mode = 'AUTO'; cmd('mode', { mode: 'AUTO' }); controlFanAutomatically(); render() }
/* ===== sound (Web Audio; browsers allow it after the first click, e.g. the login click) ===== */
const snd = {
    ctx: null, iv: null,
    beep(f, d, t) { try { this.ctx = this.ctx || new (window.AudioContext || window.webkitAudioContext)(); const c = this.ctx; if (c.state === 'suspended') c.resume(); const o = c.createOscillator(), g = c.createGain(), a = c.currentTime + (t || 0); o.type = 'square'; o.frequency.value = f; g.gain.setValueAtTime(.12, a); g.gain.exponentialRampToValueAtTime(.001, a + d); o.connect(g); g.connect(c.destination); o.start(a); o.stop(a + d) } catch (e) { } },
    denied() { if (cfg.buzzer) [0, .25, .5].forEach(t => this.beep(900, .18, t)) }, /* unauthorized card: 3 short beeps */
    start() { if (this.iv || !cfg.buzzer) return; const p = () => { this.beep(1000, .3, 0); this.beep(700, .3, .35) }; p(); this.iv = setInterval(p, 800) }, /* siren until silenced */
    stop() { clearInterval(this.iv); this.iv = null }
};
/* One alert path for vibration and forced door. No duplicate while an alert is unresolved. */
function raiseAlert(title, msg) {
    if (S.alert && !S.alert.acked) return;
    const a = { id: Date.now(), t: now(), acked: false, sim: !S.live, title, msg }; S.alert = a; S.alerts.push(a); S.vib = /vibration/i.test(title);
    addAccessLog({ user: 'System', uid: '-', action: 'Security Alert', status: 'Alert', details: title });
    createNotification('sec', title + ' – ' + msg); activateBuzzer(); save(); render()
}
function detectVibration() { raiseAlert('Vibration Detected', 'Possible unauthorized access to the cabinet.') }
function activateBuzzer() { if (!cfg.buzzer || S.buzzer) return; S.buzzer = true; cmd('buzzer', { on: true }); snd.start() }
function silenceBuzzer() { S.buzzer = false; snd.stop(); cmd('buzzer', { on: false }); render() } /* alert stays active */
function acknowledgeAlert() { if (!S.alert) return; S.alert.acked = true; S.alert.ackT = now(); S.alert = null; S.vib = false; S.buzzer = false; snd.stop(); cmd('buzzer', { on: false }); createNotification('info', 'Security alert acknowledged'); save(); render() }
function processRFIDAccess(uid) {
    const u = S.users.find(x => x.uid === uid);
    if (u && u.active) { S.lock = S.lock === 'LOCKED' ? 'UNLOCKED' : 'LOCKED'; cmd('lock', { lock: S.lock }); addAccessLog({ user: u.user, uid, action: 'Access Attempt', status: 'Granted', details: S.lock === 'UNLOCKED' ? 'Door Unlocked' : 'Cabinet Locked' }) }
    else { snd.denied(); addAccessLog({ user: u ? u.user : 'Guest', uid: uid || '0000', action: 'Access Attempt', status: 'Denied', details: u ? 'Card deactivated' : 'Unauthorized Card' }); createNotification('sec', 'Unauthorized RFID access attempt (card #' + (uid || '0000') + ')') } render()
}
function updateDoorStatus(s) { const forced = s === 'OPEN' && S.door !== 'OPEN' && S.lock === 'LOCKED'; S.door = s; if (forced) raiseAlert('Door Forced Open', 'Door opened while the cabinet is locked.'); else render() }
function updateCabinetLockStatus(s) { S.lock = s; cmd('lock', { lock: s }); render() }
function updateTemperature(v) { S.temp = v; const h = { t: now(), temp: +v.toFixed(1), hum: Math.round(S.hum), sim: !S.live }; S.hist.push(h); controlFanAutomatically() }
function updateHumidity(v) { S.hum = v }
function updateDashboard() { render(); bell() }
/* ===== iot.js section: REST + WebSocket, validation, reconnect ===== */
const iot = {
    ws: null, tries: 0, url: '',
    valid(d) { return d && typeof d.temperature === 'number' && typeof d.humidity === 'number' && d.temperature > -40 && d.temperature < 125 },
    apply(d) { if (!this.valid(d)) return console.warn('Invalid sensor payload'); S.hum = d.humidity; S.fan = !!d.fanStatus; S.mode = d.fanMode === 'MANUAL' ? 'MANUAL' : 'AUTO'; S.door = d.doorStatus || S.door; S.lock = d.cabinetLock || S.lock; if (typeof d.batteryLevel === 'number') S.batt = d.batteryLevel; updateTemperature(d.temperature); if (d.vibrationDetected) detectVibration(); updateDashboard() },
    send(c, p) { if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify({ command: c, ...p })); return true } return false }
};
function connectToIoTDevice(url) {
    if (!url) { toast('Enter a WebSocket URL, e.g. ws://192.168.1.50:81'); return }
    iot.url = url; try {
        const w = new WebSocket(url); iot.ws = w;
        w.onopen = () => { S.live = true; iot.tries = 0; createNotification('info', 'System connection restored'); toast('Connected: LIVE HARDWARE MODE'); render() };
        w.onmessage = e => { try { iot.apply(JSON.parse(e.data)) } catch (x) { console.warn('Bad message', x) } };
        w.onclose = () => { if (S.live) { S.live = false; createNotification('warn', 'System connection lost – back to simulation'); render() } if (iot.url && iot.tries < 5) { iot.tries++; setTimeout(() => iot.url && connectToIoTDevice(iot.url), 2000 * iot.tries) } };
        w.onerror = () => toast('Could not reach the device. Staying in simulation mode.')
    } catch (e) { toast('Invalid device URL: ' + e.message) }
}
function disconnectFromIoTDevice() { iot.url = ''; if (iot.ws) iot.ws.close(); S.live = false; toast('Disconnected. Simulation mode.'); render() }
function cmd(c, p) { const sent = iot.send(c, p); if (!sent && S.live) toast('Command failed: device not connected') }
/* ===== simulation engine (never labelled as hardware data) ===== */
setInterval(() => {
    if (S.live) return;
    let d = (Math.random() - .42) * .7 - (S.fan ? .5 : 0); updateTemperature(Math.max(20, Math.min(36, S.temp + d)));
    updateHumidity(Math.max(35, Math.min(85, S.hum + (Math.random() - .5) * 2))); S.batt = Math.max(5, S.batt - .02);
    if (S.batt < 20 && !S.lowB) { S.lowB = 1; createNotification('warn', 'Low battery warning') }
    if (page !== 'logs' && page !== 'users' && page !== 'settings') render(); save()
}, 3000);
/* ===== charts (canvas, no libraries) ===== */
function chart(id, key, color, min, max, lines, range) {
    const c = $('#' + id); if (!c) return; const r = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight; c.width = W * r; c.height = H * r; const g = c.getContext('2d'); g.scale(r, r);
    const ms = { hour: 36e5, day: 864e5, week: 6048e5 }[range] || 864e5, d = S.hist.filter(h => Date.now() - new Date(h.t) <= ms);
    g.strokeStyle = 'rgba(120,160,255,.2)'; g.fillStyle = '#9db0d3'; g.font = '11px sans-serif';
    const Y = v => H - 18 - (v - min) / (max - min) * (H - 28);
    (lines || []).forEach(l => { g.setLineDash([5, 4]); g.strokeStyle = l >= 28 ? '#ef4444' : '#f59e0b'; g.beginPath(); g.moveTo(30, Y(l)); g.lineTo(W, Y(l)); g.stroke(); g.fillText(l + '°', 2, Y(l) + 4) }); g.setLineDash([]);
    if (d.length < 2) { g.fillText('Collecting data…', W / 2 - 40, H / 2); return }
    g.strokeStyle = color; g.lineWidth = 2; g.beginPath(); d.forEach((h, i) => { const x = 30 + i / (d.length - 1) * (W - 34); i ? g.lineTo(x, Y(h[key])) : g.moveTo(x, Y(h[key])) }); g.stroke(); g.fillText(min, 2, H - 6); g.fillText(max, 2, 10)
}
/* ===== pages ===== */
const NAV = [['dashboard', '🏠', 'Dashboard'], ['logs', '🕒', 'Access Logs'], ['temp', '🌡', 'Temperature Monitoring'], ['security', '🛡', 'Security Monitoring'], ['users', '👥', 'User Management'], ['notifs', '🔔', 'Notifications'], ['settings', '⚙', 'Settings']];
const P = {};
P.dashboard = () => {
    const [ts, tc] = tempStatus(), [hs, hc] = humStatus(), a = S.alert, recent = S.logs.slice(-3).reverse();
    return `<h2>Dashboard</h2><p class="sub">Real-time laboratory status overview.</p>
 <div class="grid"><div class="glass"><span class="mu">🌡 Temperature</span>${tag()}<div class="big">${S.temp.toFixed(1)} °C</div><span class="st ${tc}">${ts}</span></div>
 <div class="glass"><span class="mu">💧 Humidity</span>${tag()}<div class="big">${Math.round(S.hum)}%</div><span class="st ${hc}">${hs}</span></div>
 <div class="glass"><span class="mu">🌀 Exhaust Fan</span> <span class="st ${S.fan ? '' : 'i'}">${S.fan ? 'ON' : 'OFF'}</span> <span class="st ${S.mode === 'MANUAL' ? 'w' : 'i'}">${S.mode === 'MANUAL' ? 'MANUAL MODE' : 'AUTO MODE'}</span>
 <p class="mu" style="margin:8px 0">ON ≥ ${cfg.on}°C · OFF ≤ ${cfg.off}°C</p><button class="btn s" onclick="setManualFanControl(${!S.fan})">Turn ${S.fan ? 'Off' : 'On'}</button> ${S.mode === 'MANUAL' ? '<button class="btn g s" onclick="enableAutomaticMode()">Return to Auto</button>' : ''}</div></div>
 <div class="grid" style="margin-top:14px"><div class="glass">🔒 Cabinet Lock<br><span class="st ${S.lock === 'LOCKED' ? '' : 'w'}">${S.lock}</span></div>
 <div class="glass">🚪 Door<br><span class="st ${S.door === 'CLOSED' ? '' : 'w'}">${S.door}</span></div>
 <div class="glass">🛡 Security<br><span class="st ${a ? 'd' : ''}">${a ? 'ALERT' : 'NORMAL'}</span></div>
 <div class="glass">🔋 Battery${tag()}<br><b>${Math.round(S.batt)}%</b><div class="bar"><i style="width:${S.batt}%;background:${S.batt < 20 ? 'var(--rd)' : 'var(--ok)'}"></i></div></div></div>
 <div class="grid two" style="margin-top:14px"><div class="glass"><b>Latest Activity</b> <a class="mu" href="#logs" style="float:right">View All</a>
 ${recent.map(l => `<div class="ev"><span>${l.status === 'Granted' ? '✅' : l.status === 'Denied' ? '⛔' : '⚠️'}</span><div><b>RFID ${l.action === 'Security Alert' ? l.details : 'Access ' + l.status}</b>${l.sim ? ' <span class="chip sim">SIM</span>' : ''}<br><small>${fmt(l.t)} · ${esc(l.user)}</small></div></div>`).join('')}</div>
 <div class="glass ${a ? 'alert' : ''}"><b style="color:${a ? '#ff7b7b' : 'inherit'}">${a ? '🚨 SECURITY ALERT' : '🛡 Security Alert'}</b>
 ${a ? `<p><b>${esc(a.title || 'Vibration Detected')}!</b><br>${esc(a.msg || 'Possible unauthorized access to the cabinet.')}<br><small>${fmt(a.t)}${a.sim ? ' · simulated' : ''}</small></p><button class="btn r s" ${S.buzzer ? '' : 'disabled'} onclick="silenceBuzzer()">🔕 Silence Buzzer</button> <button class="btn s" onclick="acknowledgeAlert()">Acknowledge Alert</button>` : '<p class="mu">No active alerts.</p>'}</div></div>
 <div class="glass" style="margin-top:14px"><b>Simulation controls</b> <span class="mu">${S.live ? '(Live hardware connected: sim controls disabled)' : 'Generates clearly labelled simulated events'}</span><div class="row" style="margin-top:10px">${S.live ? '' : `
 <button class="btn s" onclick="detectVibration()">Simulate vibration</button><button class="btn s" onclick="processRFIDAccess('1047')">Scan Admin card</button><button class="btn s" onclick="processRFIDAccess('9999')">Scan unknown card</button><button class="btn s" onclick="updateDoorStatus(S.door==='OPEN'?'CLOSED':'OPEN')">Toggle door</button><button class="btn s" onclick="updateTemperature(S.temp+2)">+2°C</button><button class="btn s" onclick="updateTemperature(S.temp-2)">−2°C</button>`}</div></div>`
};
P.logs = () => {
    let r = S.logs.slice().reverse(); const q = lf.q.toLowerCase(), lim = { day: 864e5, week: 6048e5 }[lf.range];
    r = r.filter(l => (!lf.st || l.status === lf.st) && (!lim || Date.now() - new Date(l.t) < lim) && (!q || [l.user, l.uid, l.action, l.details, l.status].join(' ').toLowerCase().includes(q)));
    const cnt = s => S.logs.filter(l => l.status === s).length, pages = Math.max(1, Math.ceil(r.length / 5)); lf.pg = Math.min(lf.pg, pages);
    return `<h2>Access Logs</h2><p class="sub">Track all RFID access activities and security events.</p>
 <div class="row"><select onchange="lf.range=this.value;lf.pg=1;render()">${[['all', 'All time'], ['day', 'Last 24 Hours'], ['week', 'Last 7 Days']].map(o => `<option value="${o[0]}" ${lf.range === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select>
 <select onchange="lf.st=this.value;lf.pg=1;render()">${['', 'Granted', 'Denied', 'Alert'].map(o => `<option value="${o}" ${lf.st === o ? 'selected' : ''}>${o || 'All status'}</option>`).join('')}</select>
 <input id="lq" placeholder="Search by user, card ID, or event…" value="${esc(lf.q)}"><button class="btn s" onclick="exportAccessLogs()">Export Logs</button></div>
 <div class="glass tw"><table><tr><th>Date &amp; Time</th><th>User</th><th>Card UID</th><th>Action</th><th>Status</th><th>Details</th></tr>
 ${r.slice((lf.pg - 1) * 5, lf.pg * 5).map(l => `<tr><td>${fmt(l.t)}</td><td>${esc(l.user)}</td><td>${l.uid === '-' ? '-' : '#' + esc(l.uid)}</td><td>${l.action}</td><td><span class="st ${l.status === 'Granted' ? '' : l.status === 'Denied' ? 'd' : 'w'}">${l.status}</span></td><td>${esc(l.details)}${l.sim ? ' <span class="chip sim">SIM</span>' : ''}</td></tr>`).join('') || '<tr><td colspan=6 class="mu">No logs match. Clear the filters or scan a card.</td></tr>'}</table></div>
 <div class="row glass" style="margin-top:12px"><span>Total Logs: ${S.logs.length}</span><span class="st">Granted: ${cnt('Granted')}</span><span class="st d">Denied: ${cnt('Denied')}</span><span class="st w">Alerts: ${cnt('Alert')}</span>
 <span style="margin-left:auto"><button class="btn g s" onclick="lf.pg=Math.max(1,lf.pg-1);render()">‹</button> ${lf.pg}/${pages} <button class="btn g s" onclick="lf.pg=Math.min(${pages},lf.pg+1);render()">›</button></span></div>`
};
function exportAccessLogs() {
    const rows = [['Date', 'User', 'Card UID', 'Action', 'Status', 'Details', 'Simulated']].concat(S.logs.map(l => [l.t, l.user, l.uid, l.action, l.status, l.details, l.sim ? 'yes' : 'no']));
    const csv = rows.map(r => r.map(c => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'access-logs.csv'; a.click() } catch (e) { }
    if (navigator.clipboard) navigator.clipboard.writeText(csv).then(() => toast('CSV downloaded and copied to clipboard'), () => toast('CSV export started'))
}
P.temp = () => {
    const t = S.hist.map(h => h.temp), mn = Math.min(...t), mx = Math.max(...t), av = t.reduce((a, b) => a + b, 0) / t.length;
    return `<h2>Temperature Monitoring</h2><p class="sub">Readings, history and fan activity.</p>
 <div class="grid"><div class="glass">Current<div class="big">${S.temp.toFixed(1)}°C</div>${tag()}</div><div class="glass">Humidity<div class="big">${Math.round(S.hum)}%</div></div>
 <div class="glass">Min / Max / Avg<div style="font-size:20px;margin-top:8px">${mn.toFixed(1)} / ${mx.toFixed(1)} / ${av.toFixed(1)} °C</div></div><div class="glass">Fan<div class="big">${S.fan ? 'ON' : 'OFF'}</div><span class="mu">${S.mode}</span></div></div>
 <div class="row" style="margin-top:14px"><select id="rng" onchange="tr=this.value;render()">${[['hour', 'Last Hour'], ['day', 'Last 24 Hours'], ['week', 'Last 7 Days']].map(o => `<option value="${o[0]}" ${tr === o[0] ? 'selected' : ''}>${o[1]}</option>`).join('')}</select><span class="mu">Dashed lines: ${cfg.off}° and ${cfg.on}° thresholds</span></div>
 <div class="grid two"><div class="glass"><b style="color:var(--bl)">Temperature (°C)</b><canvas id="c1"></canvas></div><div class="glass"><b style="color:var(--cy)">Humidity (%)</b><canvas id="c2"></canvas></div></div>`};
let tr = 'day';
P.security = () => {
    const a = S.alert; return `<h2>Security Monitoring</h2><p class="sub">Cabinet, door, vibration and buzzer state.</p>
 <div class="grid"><div class="glass">🔒 Cabinet<br><span class="st ${S.lock === 'LOCKED' ? '' : 'w'}">${S.lock}</span></div><div class="glass">🚪 Door<br><span class="st ${S.door === 'CLOSED' ? '' : 'w'}">${S.door}</span></div>
 <div class="glass">📳 Vibration<br><span class="st ${S.vib ? 'd' : ''}">${S.vib ? 'DETECTED' : 'NONE'}</span></div><div class="glass">🔔 Buzzer<br><span class="st ${S.buzzer ? 'd' : 'i'}">${S.buzzer ? 'SOUNDING' : 'SILENT'}</span></div></div>
 ${a ? `<div class="glass alert" style="margin-top:14px"><b>Active alert</b> · ${fmt(a.t)}<br><button class="btn r s" onclick="silenceBuzzer()">Silence Buzzer</button> <button class="btn s" onclick="acknowledgeAlert()">Acknowledge Alert</button></div>` : ''}
 <div class="glass tw" style="margin-top:14px"><b>Security event history</b><table><tr><th>Time</th><th>Event</th><th>Alert status</th></tr>${S.alerts.slice().reverse().map(x => `<tr><td>${fmt(x.t)}${x.sim ? ' <span class="chip sim">SIM</span>' : ''}</td><td>${esc(x.title || 'Vibration Detected')}</td><td><span class="st ${x.acked ? 'i' : 'd'}">${x.acked ? 'Acknowledged ' + fmt(x.ackT) : 'Active'}</span></td></tr>`).join('') || '<tr><td colspan=3 class="mu">No security events recorded.</td></tr>'}</table></div>`
};
P.users = () => {
    const r = S.users.filter(u => (u.name + u.user + u.uid).toLowerCase().includes(uq.toLowerCase()));
    return `<h2>User Management</h2><p class="sub">Administrator only. Unknown cards are always denied.</p>
 <div class="row"><input id="uq" placeholder="Search users…" value="${esc(uq)}"><button class="btn" onclick="userForm()">Add User</button></div>
 <div class="glass tw"><table><tr><th>ID</th><th>Full Name</th><th>Username</th><th>RFID UID</th><th>Role</th><th>Access</th><th>Registered</th><th></th></tr>
 ${r.map(u => `<tr><td>${u.id}</td><td>${esc(u.name)}</td><td>${esc(u.user)}</td><td>${u.uid ? '#' + esc(u.uid) : '-'}</td><td>${u.role}</td><td><span class="st ${u.active ? '' : 'd'}">${u.active ? 'Active' : 'Inactive'}</span></td><td>${u.date}</td>
 <td style="white-space:nowrap"><button class="btn g s" onclick="userForm(${u.id})">Edit</button> <button class="btn g s" onclick="toggleUser(${u.id})">${u.active ? 'Deactivate' : 'Activate'}</button> <button class="btn r s" onclick="delUser(${u.id})">Delete</button></td></tr>`).join('') || '<tr><td colspan=8 class="mu">No users found.</td></tr>'}</table></div>`
};
function userForm(id) {
    const u = S.users.find(x => x.id === id) || {}; modal(id ? 'Edit User' : 'Add User', [{ k: 'name', l: 'Full name', v: u.name }, { k: 'user', l: 'Username', v: u.user }, { k: 'uid', l: 'RFID card UID', v: u.uid }, { k: 'role', l: 'Role', type: 'select', opts: ['User', 'Admin'], v: u.role || 'User' }], v => {
        if (!v.name || !v.user) return 'Name and username are required.';
        if (v.uid && S.users.some(x => x.uid === v.uid && x.id !== id)) return 'That card UID is already registered to another user.';
        if (id) Object.assign(u, v); else S.users.push({ id: Math.max(0, ...S.users.map(x => x.id)) + 1, ...v, active: true, date: now().slice(0, 10) }); save(); render()
    })
}
const toggleUser = id => { const u = S.users.find(x => x.id === id); u.active = !u.active; save(); render() };
const delUser = id => { const u = S.users.find(x => x.id === id); if (u.user === cfg.admin) return toast('The administrator account cannot be deleted.'); confirmBox('Delete ' + u.name + '? This cannot be undone.', () => { S.users = S.users.filter(x => x.id !== id); save(); render() }, 'Delete') };
P.notifs = () => `<h2>Notifications</h2><p class="sub">Red: security · Yellow: warnings · Blue: system.</p>
 <div class="row"><button class="btn s" onclick="S.notifs.forEach(n=>n.read=true);save();render();bell()">Mark All as Read</button><button class="btn r s" onclick="confirmBox('Clear all notification history?',()=>{S.notifs=[];save();render();bell()},'Clear')">Clear History</button></div>
 <div class="glass">${S.notifs.slice().reverse().map(n => `<div class="ev"><span class="st ${n.type === 'sec' ? 'd' : n.type === 'warn' ? 'w' : 'i'}">${n.type === 'sec' ? 'Security' : n.type === 'warn' ? 'Warning' : 'System'}</span><div style="flex:1"><b style="${n.read ? 'font-weight:400' : ''}">${esc(n.msg)}</b>${n.sim ? ' <span class="chip sim">SIM</span>' : ''}<br><small>${fmt(n.t)} · ${n.read ? 'Read' : 'Unread'}</small></div>${n.read ? '' : `<button class="btn g s" onclick="S.notifs.find(x=>x.id==${n.id}).read=true;save();render();bell()">Mark as Read</button>`}</div>`).join('') || '<p class="mu">No notifications yet.</p>'}</div>`;
P.settings = () => `<h2>Settings</h2><p class="sub">Browser settings are saved locally. Nothing is sent to hardware unless a device is connected.</p>
 <div class="grid two"><div class="glass"><b>Temperature</b><label>Fan ON threshold (°C)</label><input id="s_on" type="number" step=".5" value="${cfg.on}"><label>Fan OFF threshold (°C)</label><input id="s_off" type="number" step=".5" value="${cfg.off}">
 <label>Fan mode</label><select id="s_mode"><option ${S.mode === 'AUTO' ? 'selected' : ''}>AUTO</option><option ${S.mode === 'MANUAL' ? 'selected' : ''}>MANUAL</option></select>
 <label><input type="checkbox" id="s_buz" style="width:auto" ${cfg.buzzer ? 'checked' : ''}> Buzzer enabled on alerts</label><label><input type="checkbox" id="s_not" style="width:auto" ${cfg.notif ? 'checked' : ''}> Show system notifications</label>
 <div class="err" id="serr"></div><button class="btn" onclick="saveSettings()">Save settings</button> <span class="st i">Saved in browser only</span></div>
 <div class="glass"><b>IoT device</b><p>Mode: <span class="chip ${S.live ? 'live' : 'sim'}">${S.live ? 'LIVE HARDWARE' : 'SIMULATION'}</span></p><label>ESP32 WebSocket URL</label><input id="s_dev" placeholder="ws://192.168.1.50:81" value="${esc(cfg.device)}">
 <div class="row" style="margin-top:10px"><button class="btn s" onclick="cfg.device=$('#s_dev').value.trim();save();connectToIoTDevice(cfg.device)">Connect</button><button class="btn g s" onclick="disconnectFromIoTDevice()">Disconnect</button></div>
 <p class="mu">Sensor connection: ${S.live ? 'receiving device data' : 'no hardware – data is simulated'}. Hosted pages may block local-network connections; run the app locally for real devices.</p>
 <hr style="border-color:var(--bd)"><b>Account</b><label>Administrator username</label><input id="a_u" value="${esc(cfg.admin)}"><label>New password</label><input id="a_p" type="password" placeholder="Leave blank to keep">
 <div class="err" id="aerr"></div><button class="btn" onclick="saveAcct()">Update account</button></div></div>`;
function saveSettings() {
    const on = +$('#s_on').value, off = +$('#s_off').value; if (!(off < on)) return $('#serr').textContent = 'OFF threshold must be lower than ON threshold.';
    cfg.on = on; cfg.off = off; cfg.buzzer = $('#s_buz').checked; cfg.notif = $('#s_not').checked; const m = $('#s_mode').value; if (m !== S.mode) { m === 'AUTO' ? enableAutomaticMode() : (S.mode = 'MANUAL') } save(); toast('Settings saved in this browser' + (S.live ? '' : ' (not sent to a device)')); render()
}
function saveAcct() { const u = $('#a_u').value.trim(), p = $('#a_p').value; if (!u) return $('#aerr').textContent = 'Username is required.'; if (p && p.length < 6) return $('#aerr').textContent = 'Password needs at least 6 characters.'; cfg.admin = u; if (p) cfg.pass = p; save(); toast('Account updated'); $('#a_p').value = '' }
/* ===== routing + render ===== */
function render() {
    if (!$('#app') || $('#app').classList.contains('hid')) return;
    $('#nav').innerHTML = NAV.map(n => `<a class="${n[0] === page ? 'on' : ''}" href="#${n[0]}">${n[1]} ${n[2]}</a>`).join('') + '<a id="lo">🚪 Logout</a>'; $('#lo').onclick = () => confirmBox('Are you sure you want to log out?', logout, 'Log out', '🚪');
    $('#main').innerHTML = P[page]();
    $('#modechip').className = 'chip ' + (S.live ? 'live' : 'sim'); $('#modechip').textContent = S.live ? 'LIVE HARDWARE MODE' : 'SIMULATION MODE';
    if (page === 'temp') { chart('c1', 'temp', '#2f7bff', 18, 38, [cfg.off, cfg.on], tr); chart('c2', 'hum', '#22d3ee', 20, 90, [], tr) }
    const lq = $('#lq'); if (lq) lq.oninput = e => { lf.q = e.target.value; lf.pg = 1; const p = e.target.selectionStart; render(); const n = $('#lq'); n.focus(); n.setSelectionRange(p, p) };
    const uqe = $('#uq'); if (uqe) uqe.oninput = e => { uq = e.target.value; const p = e.target.selectionStart; render(); const n = $('#uq'); n.focus(); n.setSelectionRange(p, p) }
}
function route() { const h = location.hash.slice(1); page = P[h] ? h : 'dashboard'; $('#side').classList.remove('open'); render() }
addEventListener('hashchange', route); addEventListener('resize', () => page === 'temp' && render());
$('#burger').onclick = () => $('#side').classList.toggle('open'); $('#bell').onclick = () => location.hash = 'notifs';
/* ===== auth (demo only; frontend login is NOT secure) ===== */
function showApp() { const ok = ls.get('inc_auth', false); $('#login').classList.toggle('hid', ok); $('#app').classList.toggle('hid', !ok); if (ok) { route(); bell() } }
function logout() { ls.set('inc_auth', false); location.hash = ''; showApp() }
$('#eye').onclick = () => { const p = $('#lp'); p.type = p.type === 'password' ? 'text' : 'password' };
function login() { if ($('#lu').value.trim() === cfg.admin && $('#lp').value === cfg.pass) { ls.set('inc_auth', true); $('#lerr').textContent = ''; showApp() } else $('#lerr').textContent = 'Incorrect username or password. Try again.' }
$('#lgo').onclick = login; $('#lp').onkeydown = e => { if (e.key === 'Enter') login() };
showApp();
