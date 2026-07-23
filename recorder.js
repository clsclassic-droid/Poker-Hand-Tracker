'use strict';
/* recorder.js — Detailed Action Recorder (optional feature)
   ถอดออกได้ทั้งก้อน: ลบไฟล์นี้ + เอา <script> ออกจาก index.html
   ไม่แตะ app.js (ยกเว้น 5 บรรทัด hook ใน openHandDetail) */
(function () {

// ── Constants ─────────────────────────────────────────────────────────────────
const LS_CONFIG  = 'pht_table_config';
const LS_ENABLED = 'pht_recorder_on';
const SHEET_TAB  = 'Hands';

const POS_PRESETS = {
    3:  ['BT','SB','BB'],
    4:  ['CO','BT','SB','BB'],
    5:  ['HJ','CO','BT','SB','BB'],
    6:  ['UTG','HJ','CO','BT','SB','BB'],
    7:  ['UTG','LJ','HJ','CO','BT','SB','BB'],
    8:  ['UTG','UTG+1','LJ','HJ','CO','BT','SB','BB'],
    9:  ['UTG','UTG+1','Mid','LJ','HJ','CO','BT','SB','BB'],
    10: ['UTG','UTG+1','Mid','Mid+1','LJ','HJ','CO','BT','SB','BB'],
};

// Action order: preflop (UTG first, BB last), postflop (SB first, BT last)
const PF_ORDER   = ['UTG','UTG+1','Mid','Mid+1','LJ','HJ','CO','BT','SB','BB'];
const POST_ORDER = ['SB','BB','UTG','UTG+1','Mid','Mid+1','LJ','HJ','CO','BT'];
const STREET_SEQ = ['preflop','flop','turn','river'];
const STREET_LBL = { preflop:'PREFLOP', flop:'FLOP', turn:'TURN', river:'RIVER' };
const STREET_TAB_CLS = { preflop:'preflop-tab', flop:'flop-tab', turn:'turn-tab', river:'river-tab' };

// ── Module state ──────────────────────────────────────────────────────────────
let cfg = null;   // { players: [{pos, stack, isHero}] }
let rec = null;   // per-hand recording state

// ── Helpers ───────────────────────────────────────────────────────────────────
function isOn() {
    return document.getElementById('toggle-recorder')?.checked || false;
}

function toast(msg, type) {
    if (window.showToast) { window.showToast(msg, type || 'success'); return; }
}

function loadConfig() {
    try { return JSON.parse(localStorage.getItem(LS_CONFIG)) || null; }
    catch (_) { return null; }
}

function saveConfig(c) {
    cfg = c;
    localStorage.setItem(LS_CONFIG, JSON.stringify(c));
}

function buildDefaultPlayers(n) {
    const positions = POS_PRESETS[n] || POS_PRESETS[6];
    return positions.map(pos => ({ pos, stack: 1000, isHero: pos === 'BT' }));
}

function sortByOrder(posArr, order) {
    return posArr.slice().sort((a, b) => {
        const ai = order.indexOf(a); const bi = order.indexOf(b);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
}

// ── Toggle ────────────────────────────────────────────────────────────────────
function applyToggle() {
    const on = isOn();
    const setupEl = document.getElementById('recorder-setup');
    const panelEl = document.getElementById('recorder-panel');
    if (setupEl) setupEl.style.display = on ? '' : 'none';
    if (panelEl && !on) panelEl.style.display = 'none';
    if (on) { cfg = loadConfig(); renderSetup(); }
}

// ── Player Setup UI ───────────────────────────────────────────────────────────
function renderSetup() {
    const el = document.getElementById('recorder-setup');
    if (!el) return;

    const count   = cfg?.players?.length || 6;
    const players = cfg?.players || buildDefaultPlayers(count);

    const countOpts = Array.from({ length: 8 }, (_, i) => i + 3)
        .map(n => `<option value="${n}"${n === count ? ' selected' : ''}>${n} คน</option>`)
        .join('');

    const rows = players.map((p, i) => `
        <tr>
            <td><input class="rec-pos-in" data-i="${i}" value="${p.pos}" maxlength="6"></td>
            <td><input class="rec-stack-in" data-i="${i}" type="number" value="${p.stack || 1000}" min="0" step="10"></td>
            <td style="text-align:center">
                <input type="radio" class="rec-hero-radio" name="rec-hero" value="${i}"${p.isHero ? ' checked' : ''}>
            </td>
        </tr>`).join('');

    el.innerHTML = `
        <div class="rec-setup-box">
            <div class="rec-setup-header">
                <span class="rec-setup-title">ตั้งค่าโต๊ะ</span>
                <div class="rec-count-wrap">
                    <span class="rec-small-lbl">ผู้เล่น</span>
                    <div class="rec-dd-wrap">
                        <select id="rec-count">${countOpts}</select>
                        <span class="rec-dd-arr">▾</span>
                    </div>
                </div>
            </div>
            <table class="rec-player-table">
                <thead><tr><td>ตำแหน่ง</td><td>Stack</td><td>Hero</td></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <div class="rec-setup-footer">
                <button id="rec-save-cfg" class="rec-btn-secondary">💾 บันทึกการตั้งค่า</button>
                <button id="rec-start-btn" class="rec-btn-primary">🎯 เริ่มบันทึก Action</button>
            </div>
        </div>`;

    bindSetupEvents();
}

function collectConfig() {
    const poses   = [...document.querySelectorAll('.rec-pos-in')].map(el => el.value.trim().toUpperCase() || '?');
    const stacks  = [...document.querySelectorAll('.rec-stack-in')].map(el => parseFloat(el.value) || 1000);
    const heroEl  = document.querySelector('input[name="rec-hero"]:checked');
    const heroIdx = heroEl ? parseInt(heroEl.value) : 0;
    return { players: poses.map((pos, i) => ({ pos, stack: stacks[i], isHero: i === heroIdx })) };
}

function bindSetupEvents() {
    document.getElementById('rec-count')?.addEventListener('change', e => {
        const n     = parseInt(e.target.value);
        const fresh = buildDefaultPlayers(n);
        // Preserve stacks & hero for matching positions
        const prev  = {};
        cfg?.players?.forEach(p => { prev[p.pos] = p; });
        fresh.forEach(p => { if (prev[p.pos]) { p.stack = prev[p.pos].stack; p.isHero = prev[p.pos].isHero; } });
        cfg = { players: fresh };
        renderSetup();
    });

    document.getElementById('rec-save-cfg')?.addEventListener('click', () => {
        saveConfig(collectConfig());
        toast('บันทึกการตั้งค่าแล้ว');
    });

    document.getElementById('rec-start-btn')?.addEventListener('click', () => {
        saveConfig(collectConfig());
        if (!cfg.players || cfg.players.length < 2) { toast('กรุณาตั้งค่าผู้เล่นก่อน', 'error'); return; }
        startRecording();
    });
}

// ── Action Recorder — state machine ──────────────────────────────────────────
function startRecording() {
    rec = {
        streets:      { preflop: [], flop: [], turn: [], river: [] },
        playersInHand: cfg.players.map(p => p.pos),
        stackByPos:   {},
        pot:          0,
        currentStreet: null,
    };
    cfg.players.forEach(p => { rec.stackByPos[p.pos] = p.stack; });

    const panelEl = document.getElementById('recorder-panel');
    if (panelEl) { panelEl.style.display = ''; panelEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }

    initStreet('preflop');
    renderPanel();
}

function initStreet(street) {
    rec.currentStreet     = street;
    rec.currentBet        = 0;
    rec.raisingRound      = 0;
    rec.potContrib        = {};
    rec.playersInHand.forEach(pos => { rec.potContrib[pos] = 0; });

    const order        = street === 'preflop' ? PF_ORDER : POST_ORDER;
    rec.actionOrder    = sortByOrder(rec.playersInHand, order);
    rec.needToAct      = [...rec.actionOrder];
}

function recordAction(pos, action, amount) {
    const street = rec.currentStreet;
    const entry  = { pos, a: action };
    if (amount > 0) entry.v = amount;
    rec.streets[street].push(entry);

    // Update pot & contribution
    if (action !== 'fold' && action !== 'check' && amount > 0) {
        const prev = rec.potContrib[pos] || 0;
        const add  = Math.max(0, amount - prev);
        rec.pot            += add;
        rec.potContrib[pos] = amount;
        rec.stackByPos[pos] = (rec.stackByPos[pos] || 0) - add;
    }

    const isAggressive = action === 'raise' || action === 'reraise' || action === 'bet';

    if (action === 'fold') {
        rec.playersInHand = rec.playersInHand.filter(p => p !== pos);
        rec.needToAct     = rec.needToAct.filter(p => p !== pos);
    } else if (isAggressive) {
        rec.currentBet   = amount;
        rec.raisingRound++;
        // Everyone in hand except raiser must act again (re-sort by position order)
        const order = rec.currentStreet === 'preflop' ? PF_ORDER : POST_ORDER;
        rec.needToAct = sortByOrder(rec.playersInHand.filter(p => p !== pos), order);
    } else {
        // check or call — just remove from queue
        rec.needToAct = rec.needToAct.filter(p => p !== pos);
    }

    appendToFeed(entry, isAggressive);
    updatePotBar();

    if (rec.needToAct.length === 0 || rec.playersInHand.length <= 1) {
        showStreetComplete();
    } else {
        renderActorBlock();
    }
}

// ── Panel render ──────────────────────────────────────────────────────────────
function renderPanel() {
    const el = document.getElementById('recorder-panel');
    if (!el) return;

    const street = rec.currentStreet;
    const tabs   = STREET_SEQ.map(s => {
        const idx    = STREET_SEQ.indexOf(s);
        const curIdx = STREET_SEQ.indexOf(street);
        const cls    = idx === curIdx ? `rec-st-tab rec-st-active ${STREET_TAB_CLS[s]}`
                     : idx < curIdx  ? 'rec-st-tab rec-st-done'
                     : 'rec-st-tab';
        return `<span class="${cls}">${STREET_LBL[s]}</span>`;
    }).join('');

    el.innerHTML = `
        <div class="rec-panel-box">
            <div class="rec-panel-header">
                <div class="rec-street-tabs">${tabs}</div>
                <div class="rec-pot-display">Pot <b>${rec.pot.toLocaleString()}</b>฿</div>
            </div>
            <div id="rec-bet-bar-wrap"></div>
            <div id="rec-feed" class="rec-feed"></div>
            <div id="rec-actor-block" class="rec-actor-block"></div>
            <div id="rec-street-footer" class="rec-street-footer"></div>
        </div>`;

    renderActorBlock();
}

function updatePotBar() {
    const el = document.querySelector('.rec-pot-display');
    if (el) el.innerHTML = `Pot <b>${rec.pot.toLocaleString()}</b>฿`;
    renderBetBar();
}

function renderBetBar() {
    const wrap = document.getElementById('rec-bet-bar-wrap');
    if (!wrap) return;
    if (rec.currentBet <= 0) { wrap.innerHTML = ''; return; }

    const roundLabel = rec.raisingRound <= 0 ? '' :
        rec.raisingRound === 1 ? '3-BET' :
        rec.raisingRound === 2 ? '4-BET' :
        `${rec.raisingRound + 2}-BET`;

    wrap.innerHTML = `
        <div class="rec-bet-bar">
            <span class="rec-bet-lbl">Bet ปัจจุบัน</span>
            <span class="rec-bet-val">${rec.currentBet.toLocaleString()} ฿</span>
            ${roundLabel ? `<span class="rec-raise-badge">${roundLabel} ↑</span>` : ''}
        </div>`;
}

function appendToFeed(entry, isAggressive) {
    const feed = document.getElementById('rec-feed');
    if (!feed) return;

    const { pos, a, v } = entry;
    const isHero  = cfg.players.find(p => p.pos === pos)?.isHero;
    const actCls  = a === 'fold'  ? 'rec-act-fold'
                  : a === 'check' ? 'rec-act-check'
                  : (a === 'raise' || a === 'reraise' || a === 'bet') ? 'rec-act-raise'
                  : 'rec-act-call';
    const label   = a === 'reraise' ? `re-raise ${v}`
                  : v ? `${a} ${v.toLocaleString()}` : a;

    const row = document.createElement('div');
    row.className = `rec-feed-row${isHero ? ' rec-feed-hero' : ''}`;
    row.innerHTML = `
        <span class="rec-fr-pos${isHero ? ' rec-fr-hero-pos' : ''}">${pos}</span>
        <span class="rec-fr-name">${isHero ? '● Hero' : ''}</span>
        <span class="rec-fr-act ${actCls}">${label}</span>`;
    feed.appendChild(row);

    // Raise divider (appears after the raise entry when there are people still to act)
    if (isAggressive && rec.needToAct.length > 0) {
        const roundLabel = rec.raisingRound === 1 ? '3-BET ↑' :
            rec.raisingRound === 2 ? '4-BET ↑' : `${rec.raisingRound + 2}-BET ↑`;
        const div = document.createElement('div');
        div.className = 'rec-feed-divider';
        div.innerHTML = `<div class="rec-div-line"></div><span class="rec-div-lbl">${roundLabel}</span><div class="rec-div-line"></div>`;
        feed.appendChild(div);
    }

    feed.scrollTop = feed.scrollHeight;
}

function renderActorBlock() {
    const el = document.getElementById('rec-actor-block');
    if (!el) return;

    const pos = rec.needToAct[0];
    if (!pos) { el.innerHTML = ''; return; }

    const player    = cfg.players.find(p => p.pos === pos);
    const isHero    = player?.isHero;
    const stack     = Math.round(rec.stackByPos[pos] || 0);
    const alreadyIn = rec.potContrib[pos] || 0;
    const toCall    = Math.max(0, rec.currentBet - alreadyIn);
    const canCheck  = toCall === 0;

    const pot        = rec.pot;
    const minRaise   = rec.currentBet > 0 ? rec.currentBet * 2 : 20;
    const halfPot    = Math.max(minRaise, Math.round(pot / 2 / 10) * 10);
    const fullPot    = Math.max(minRaise, Math.round(pot / 10) * 10);

    const callHtml = canCheck
        ? `<button class="rec-ab rec-ab-check" onclick="window.recorderModule._act('${pos}','check',0)">CHECK</button>`
        : `<button class="rec-ab rec-ab-call"  onclick="window.recorderModule._act('${pos}','call',${rec.currentBet})">CALL ${toCall.toLocaleString()}</button>`;

    // Determine raise label
    const hasOpenedBet = rec.streets[rec.currentStreet].some(e => e.a === 'raise' || e.a === 'bet' || e.a === 'reraise');
    const raiseLabel   = !hasOpenedBet && rec.currentBet === 0 ? 'BET' : hasOpenedBet ? 'RE-RAISE' : 'RAISE';

    el.innerHTML = `
        <div class="rec-actor-header">
            <div class="rec-actor-who${isHero ? ' rec-actor-hero' : ''}">
                ${isHero ? '● ' : ''}${pos}${isHero ? ' <span class="rec-hero-tag">คุณ</span>' : ''}
            </div>
            <span class="rec-actor-stack">${stack.toLocaleString()} ฿</span>
        </div>
        ${toCall > 0 ? `<div class="rec-to-call">ต้อง call เพิ่ม ${toCall.toLocaleString()} ฿ (รวม ${rec.currentBet.toLocaleString()} ฿)</div>` : ''}
        <div class="rec-act-row">
            <button class="rec-ab rec-ab-fold" onclick="window.recorderModule._act('${pos}','fold',0)">FOLD</button>
            ${callHtml}
            <button class="rec-ab rec-ab-raise" onclick="window.recorderModule._doRaise('${pos}','${raiseLabel}')">${raiseLabel}</button>
        </div>
        <div class="rec-amount-row">
            <span class="rec-amt-lbl">${raiseLabel.toLowerCase()}</span>
            <input class="rec-amt-in" id="rec-raise-amt" type="number" value="${minRaise}" min="1" step="10">
            <span class="rec-amt-lbl">฿</span>
            <div class="rec-quick-btns">
                <button class="rec-qb" onclick="document.getElementById('rec-raise-amt').value=${minRaise}">Min</button>
                <button class="rec-qb" onclick="document.getElementById('rec-raise-amt').value=${halfPot}">½P</button>
                <button class="rec-qb" onclick="document.getElementById('rec-raise-amt').value=${fullPot}">Pot</button>
                <button class="rec-qb" onclick="document.getElementById('rec-raise-amt').value=${stack}">All-in</button>
            </div>
        </div>`;
}

function showStreetComplete() {
    const actorEl = document.getElementById('rec-actor-block');
    if (actorEl) actorEl.innerHTML = '';

    const footer   = document.getElementById('rec-street-footer');
    if (!footer) return;

    const curIdx   = STREET_SEQ.indexOf(rec.currentStreet);
    const hasMore  = curIdx < STREET_SEQ.length - 1 && rec.playersInHand.length > 1;

    if (hasMore) {
        const next = STREET_SEQ[curIdx + 1];
        footer.innerHTML = `
            <div class="rec-street-done">
                <span class="rec-done-lbl">✓ ${STREET_LBL[rec.currentStreet]} · Pot ${rec.pot.toLocaleString()} ฿</span>
                <button class="rec-btn-next" onclick="window.recorderModule._nextStreet('${next}')">→ ${STREET_LBL[next]}</button>
            </div>`;
    } else {
        footer.innerHTML = `
            <div class="rec-street-done">
                <span class="rec-done-lbl">✓ ครบทุก street · Pot ${rec.pot.toLocaleString()} ฿</span>
                <button class="rec-btn-save" id="rec-save-btn" onclick="window.recorderModule._saveLog()">💾 Save Action Log</button>
            </div>`;
    }
}

// ── Save to Sheet (column X = r[23]) ─────────────────────────────────────────
function buildJson() {
    if (!rec || !cfg) return null;
    return JSON.stringify({ players: cfg.players, actions: rec.streets });
}

async function _saveLog() {
    const json = buildJson();
    if (!json) return;

    const spreadsheetId = window.state?.spreadsheetId;
    if (!spreadsheetId || !window.gapi?.client?.sheets) {
        toast('ไม่พบ spreadsheet', 'error'); return;
    }

    const histLen = window.state?.history?.length || 0;
    if (histLen === 0) { toast('ยังไม่มีมือที่บันทึก', 'error'); return; }

    const sheetRow = histLen + 1; // +1 for header row
    const btn      = document.getElementById('rec-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }

    try {
        await gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${SHEET_TAB}!X${sheetRow}`,
            valueInputOption: 'RAW',
            resource: { values: [[json]] },
        });
        if (window.state?.history?.[histLen - 1]) window.state.history[histLen - 1][23] = json;
        toast('✓ บันทึก Action Log แล้ว');
        if (btn) { btn.textContent = '✓ บันทึกแล้ว'; }
    } catch (err) {
        console.error('recorder save:', err);
        toast('บันทึกไม่สำเร็จ', 'error');
        if (btn) { btn.disabled = false; btn.textContent = '💾 Save Action Log'; }
    }
}

// ── Public action handlers (called from inline onclick) ───────────────────────
function _act(pos, action, amount) {
    if (!rec) return;
    recordAction(pos, action, Number(amount) || 0);
}

function _doRaise(pos, raiseLabel) {
    if (!rec) return;
    const amt    = parseFloat(document.getElementById('rec-raise-amt')?.value) || 0;
    if (amt <= 0) { toast('กรุณาใส่จำนวนเงิน', 'error'); return; }
    const hasOpened  = rec.streets[rec.currentStreet].some(e => e.a === 'raise' || e.a === 'bet' || e.a === 'reraise');
    const actionType = !hasOpened && rec.currentBet === 0 ? 'bet' : hasOpened ? 'reraise' : 'raise';
    recordAction(pos, actionType, amt);
}

function _nextStreet(street) {
    // Reset feed for next street, update tab bar
    const feed   = document.getElementById('rec-feed');
    if (feed)    feed.innerHTML = '';
    const footer = document.getElementById('rec-street-footer');
    if (footer)  footer.innerHTML = '';

    initStreet(street);

    // Re-render tabs + bet bar
    const tabs = STREET_SEQ.map(s => {
        const idx    = STREET_SEQ.indexOf(s);
        const curIdx = STREET_SEQ.indexOf(street);
        const cls    = idx === curIdx ? `rec-st-tab rec-st-active ${STREET_TAB_CLS[s]}`
                     : idx < curIdx  ? 'rec-st-tab rec-st-done'
                     : 'rec-st-tab';
        return `<span class="${cls}">${STREET_LBL[s]}</span>`;
    }).join('');
    const tabsEl = document.querySelector('.rec-street-tabs');
    if (tabsEl) tabsEl.innerHTML = tabs;

    updatePotBar();
    renderActorBlock();
}

// ── Render Action Log for Hand Detail Modal ───────────────────────────────────
function renderActionLog(jsonStr) {
    try {
        const data = JSON.parse(jsonStr);
        if (!data?.actions) return '';

        let runningPot = 0;
        let streetHtml = '';

        STREET_SEQ.forEach(street => {
            const acts = data.actions[street];
            if (!acts || acts.length === 0) return;

            // Calculate pot added this street
            const contrib = {};
            acts.forEach(e => {
                if (e.v) contrib[e.pos] = Math.max(contrib[e.pos] || 0, e.v);
            });
            runningPot += Object.values(contrib).reduce((s, v) => s + v, 0);

            // Render actions — grouping re-raise sequences with dividers
            let actionItems = '';
            let lastRaisingRound = 0;
            acts.forEach(e => {
                const isAgg = e.a === 'raise' || e.a === 'reraise' || e.a === 'bet';
                const cls   = e.a === 'fold'  ? 'rec-log-fold'
                            : e.a === 'check' ? 'rec-log-check'
                            : isAgg           ? 'rec-log-raise'
                            : 'rec-log-call';
                const lbl   = e.a === 'reraise' ? `re-raise ${(e.v||'').toLocaleString()}`
                            : e.v ? `${e.a} ${Number(e.v).toLocaleString()}` : e.a;
                if (actionItems) actionItems += ' · ';
                actionItems += `<b>${e.pos}</b> <span class="${cls}">${lbl}</span>`;
            });

            const stCls = { preflop:'rec-st-pf', flop:'rec-st-fl', turn:'rec-st-tu', river:'rec-st-rv' }[street];
            streetHtml += `
                <div class="rec-modal-row">
                    <span class="rec-modal-street ${stCls}">${STREET_LBL[street]}</span>
                    <div class="rec-modal-acts">
                        ${actionItems}
                        <div class="rec-modal-pot">Pot ${runningPot.toLocaleString()} ฿</div>
                    </div>
                </div>`;
        });

        if (!streetHtml) return '';

        // Find hero from players data
        const heroPos = data.players?.find(p => p.isHero)?.pos || '';
        const heroLine = heroPos ? `<span style="font-size:10px;color:#4a6580">Hero: <b style="color:#22c55e">${heroPos}</b></span>` : '';

        return `
            <div class="rec-modal-log">
                <div class="rec-modal-log-title">Action Log ${heroLine}</div>
                ${streetHtml}
            </div>`;
    } catch (_) { return ''; }
}

// ── Init ──────────────────────────────────────────────────────────────────────
function init() {
    const tog = document.getElementById('toggle-recorder');
    if (!tog) return;
    tog.checked = localStorage.getItem(LS_ENABLED) === '1';
    tog.addEventListener('change', () => {
        localStorage.setItem(LS_ENABLED, tog.checked ? '1' : '0');
        applyToggle();
    });
    applyToggle();
}

// ── Public API ────────────────────────────────────────────────────────────────
window.recorderModule = { init, renderActionLog, _act, _doRaise, _nextStreet, _saveLog };

document.addEventListener('DOMContentLoaded', init);

})();
