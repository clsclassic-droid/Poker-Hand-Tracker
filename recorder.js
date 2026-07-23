'use strict';
/* recorder.js — Detailed Action Recorder (optional feature)
   ถอดออกได้ทั้งก้อน: ลบไฟล์นี้ + เอา <script> ออกจาก index.html */
(function () {

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

const PF_ORDER   = ['UTG','UTG+1','Mid','Mid+1','LJ','HJ','CO','BT','SB','BB'];
const POST_ORDER = ['SB','BB','UTG','UTG+1','Mid','Mid+1','LJ','HJ','CO','BT'];
const STREET_SEQ = ['preflop','flop','turn','river'];
const STREET_LBL = { preflop:'PREFLOP', flop:'FLOP', turn:'TURN', river:'RIVER' };
const STREET_TAB_CLS = { preflop:'preflop-tab', flop:'flop-tab', turn:'turn-tab', river:'river-tab' };

let cfg = null;
let rec = null;
let recActivePlayer = -1;

// ── Card picker helpers ───────────────────────────────────────────────────────
function parseCards(str) {
    if (!str) return [];
    return (String(str).match(/[AKQJT2-9][hdcs]/gi) || [])
        .map(c => c[0].toUpperCase() + c[1].toLowerCase()).slice(0, 2);
}

const _SUIT_SYM = { h: '♥', d: '♦', c: '♣', s: '♠' };
const _SUIT_CLS = { h: 'rec-cs-heart', d: 'rec-cs-diam', c: 'rec-cs-club', s: '' };

function renderCardSlotHTML(cardsStr) {
    const cards = parseCards(cardsStr);
    return [0, 1].map(i => {
        if (cards[i]) {
            const rank = cards[i][0], suit = cards[i][1];
            return `<span class="rec-cs-card ${_SUIT_CLS[suit]}">${rank}${_SUIT_SYM[suit]}</span>`;
        }
        return `<span class="rec-cs-empty">—</span>`;
    }).join('');
}

function updateCardsSlot(playerIdx) {
    const el = document.querySelector(`.rec-cards-slot[data-i="${playerIdx}"]`);
    if (el) el.innerHTML = renderCardSlotHTML(cfg?.players?.[playerIdx]?.cards || '');
}

function _syncRecUsedCards() {
    // Rebuild app usedCards, then add recorder cards from OTHER players on top
    if (typeof rebuildUsed === 'function') rebuildUsed();
    if (!window.state?.usedCards) return;
    cfg?.players?.forEach((p, i) => {
        if (i !== recActivePlayer) parseCards(p.cards).forEach(c => window.state.usedCards.add(c));
    });
}

function _activatePlayerPicker(playerIdx) {
    if (recActivePlayer === playerIdx) { _deactivatePlayerPicker(); return; }
    recActivePlayer = playerIdx;

    const p    = cfg?.players?.[playerIdx];
    const lbl  = p?.name ? `${p.name} (${p.pos})` : (p?.pos || '');
    const sel  = parseCards(p?.cards || '');

    // Hijack the picker header
    const nameEl  = document.getElementById('picker-field-name');
    const countEl = document.getElementById('picker-count');
    const labelEl = document.getElementById('picker-label');
    if (labelEl)  labelEl.textContent = 'ไพ่ที่ถือ:';
    if (nameEl)  { nameEl.textContent = lbl; nameEl.style.color = '#a78bfa'; }
    if (countEl) { countEl.textContent = `${sel.length} / 2`; countEl.classList.toggle('full', sel.length >= 2); }

    // Mark active slot visually
    document.querySelectorAll('.rec-cards-slot').forEach(el => el.classList.remove('active'));
    document.querySelector(`.rec-cards-slot[data-i="${playerIdx}"]`)?.classList.add('active');

    _syncRecUsedCards();
    if (typeof refreshCardGrid === 'function') refreshCardGrid();

    // Scroll picker into view
    document.getElementById('card-picker-section')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _deactivatePlayerPicker() {
    if (recActivePlayer === -1) return;
    recActivePlayer = -1;
    document.querySelectorAll('.rec-cards-slot').forEach(el => el.classList.remove('active'));

    // Restore picker label
    const labelEl = document.getElementById('picker-label');
    if (labelEl) labelEl.textContent = 'กำลังเลือก:';

    // Rebuild used + restore grid to current field
    if (typeof rebuildUsed === 'function') rebuildUsed();
    if (typeof refreshPickerHeader === 'function') refreshPickerHeader();
    if (typeof refreshCardGrid === 'function') refreshCardGrid();
}

function _interceptCard(cardId) {
    if (recActivePlayer < 0) return false;
    const p = cfg?.players?.[recActivePlayer];
    if (!p) return false;

    let sel = parseCards(p.cards);
    const idx = sel.indexOf(cardId);
    if (idx >= 0) {
        sel.splice(idx, 1);
    } else {
        if (sel.length >= 2) return true; // full — consume event, do nothing
        sel.push(cardId);
    }
    p.cards = sel.join('');
    updateCardsSlot(recActivePlayer);

    // Update count badge
    const countEl = document.getElementById('picker-count');
    if (countEl) { countEl.textContent = `${sel.length} / 2`; countEl.classList.toggle('full', sel.length >= 2); }

    _syncRecUsedCards();
    if (typeof refreshCardGrid === 'function') refreshCardGrid();
    return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isOn() { return document.getElementById('toggle-recorder')?.checked || false; }
function toast(msg, type) { if (window.showToast) window.showToast(msg, type || 'success'); }
function loadConfig() { try { return JSON.parse(localStorage.getItem(LS_CONFIG)) || null; } catch (_) { return null; } }
function saveConfig(c) { cfg = c; localStorage.setItem(LS_CONFIG, JSON.stringify(c)); syncPositionChips(); }

function buildDefaultPlayers(n) {
    const positions = POS_PRESETS[n] || POS_PRESETS[6];
    return positions.map(pos => ({ pos, name: '', stack: 1000, isHero: false }));
}

// Show only positions configured in recorder setup; restore all when recorder is off
function syncPositionChips() {
    const chips     = document.querySelectorAll('#position-chips .pos-chip');
    const configPos = (cfg?.players || []).map(p => p.pos);
    const filterOn  = isOn() && configPos.length > 0;
    chips.forEach(ch => {
        const hide = filterOn && !configPos.includes(ch.dataset.pos);
        ch.style.display = hide ? 'none' : '';
        if (hide) ch.classList.remove('selected');
    });
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
    syncPositionChips();
}

// ── Player Setup UI ───────────────────────────────────────────────────────────
function renderSetup() {
    const el = document.getElementById('recorder-setup');
    if (!el) return;

    const count   = cfg?.players?.length || 6;
    const players = cfg?.players || buildDefaultPlayers(count);
    const sb      = cfg?.sb ?? 10;
    const bb      = cfg?.bb ?? 20;

    const countOpts = Array.from({ length: 8 }, (_, i) => i + 3)
        .map(n => `<option value="${n}"${n === count ? ' selected' : ''}>${n} คน</option>`)
        .join('');

    const rows = players.map((p, i) => `
        <tr>
            <td><input class="rec-pos-in"  data-i="${i}" value="${p.pos}"        maxlength="6"></td>
            <td><input class="rec-name-in" data-i="${i}" value="${p.name || ''}" placeholder="ชื่อเล่น" maxlength="12"></td>
            <td><input class="rec-stack-in rec-player-stack" data-i="${i}" type="number" value="${p.stack || 1000}" min="0" step="10"></td>
            <td><button class="rec-cards-slot" data-i="${i}">${renderCardSlotHTML(p.cards || '')}</button></td>
        </tr>`).join('');

    el.innerHTML = `
        <div class="rec-setup-box">
            <div class="rec-setup-header">
                <span class="rec-setup-title">ตั้งค่าโต๊ะ</span>
                <div class="rec-header-right">
                    <span class="rec-small-lbl">SB</span>
                    <input class="rec-stack-in rec-blind-in" id="rec-sb" type="number" value="${sb}" min="1" step="1">
                    <span class="rec-small-lbl">BB</span>
                    <input class="rec-stack-in rec-blind-in" id="rec-bb" type="number" value="${bb}" min="1" step="1">
                    <span class="rec-small-lbl rec-hdr-sep">ผู้เล่น</span>
                    <div class="rec-dd-wrap">
                        <select id="rec-count">${countOpts}</select>
                        <span class="rec-dd-arr">▾</span>
                    </div>
                    <button class="rec-collapse-btn" id="rec-collapse-btn" title="ซ่อน/แสดง">▲</button>
                </div>
            </div>
            <div class="rec-setup-body">
                <table class="rec-player-table">
                    <thead><tr><td>ตำแหน่ง</td><td>ชื่อ</td><td>Stack</td><td>ไพ่ที่ถือ</td></tr></thead>
                    <tbody>${rows}</tbody>
                </table>
                <div class="rec-setup-footer">
                    <button id="rec-start-btn" class="rec-btn-primary">🎯 เริ่มบันทึก Action</button>
                </div>
            </div>
        </div>`;

    bindSetupEvents();
}

function collectConfig() {
    const poses   = [...document.querySelectorAll('.rec-pos-in')].map(el => el.value.trim().toUpperCase() || '?');
    const names   = [...document.querySelectorAll('.rec-name-in')].map(el => el.value.trim());
    const stacks  = [...document.querySelectorAll('.rec-player-stack')].map(el => parseFloat(el.value) || 1000);
    const heroPos = document.querySelector('#position-chips .pos-chip.selected')?.dataset.pos || '';
    const sb      = parseFloat(document.getElementById('rec-sb')?.value) ?? 10;
    const bb      = parseFloat(document.getElementById('rec-bb')?.value) ?? 20;
    return {
        players: poses.map((pos, i) => ({ pos, name: names[i] || '', stack: stacks[i], isHero: pos === heroPos, cards: cfg?.players?.[i]?.cards || '' })),
        sb, bb,
    };
}

function bindSetupEvents() {
    document.getElementById('rec-count')?.addEventListener('change', e => {
        const n     = parseInt(e.target.value);
        const fresh = buildDefaultPlayers(n);
        const prev  = {};
        cfg?.players?.forEach(p => { prev[p.pos] = p; });
        fresh.forEach(p => {
            if (prev[p.pos]) { p.stack = prev[p.pos].stack; p.isHero = prev[p.pos].isHero; p.name = prev[p.pos].name || ''; p.cards = prev[p.pos].cards || ''; }
        });
        cfg = { ...cfg, players: fresh };
        renderSetup();
        syncPositionChips();
    });

    document.querySelector('.rec-player-table')?.addEventListener('click', e => {
        const slot = e.target.closest('.rec-cards-slot');
        if (slot) _activatePlayerPicker(parseInt(slot.dataset.i));
    });

    document.getElementById('rec-collapse-btn')?.addEventListener('click', () => {
        const box = document.querySelector('.rec-setup-box');
        const btn = document.getElementById('rec-collapse-btn');
        if (!box) return;
        const collapsed = box.classList.toggle('rec-setup-collapsed');
        if (btn) btn.textContent = collapsed ? '▼' : '▲';
    });

    document.getElementById('rec-start-btn')?.addEventListener('click', () => {
        saveConfig(collectConfig());
        if (!cfg.players || cfg.players.length < 2) { toast('กรุณาตั้งค่าผู้เล่นก่อน', 'error'); return; }
        startRecording();
    });
}

// ── Recording — state machine ─────────────────────────────────────────────────
function startRecording() {
    rec = {
        streets:       { preflop: [], flop: [], turn: [], river: [] },
        playersInHand: cfg.players.map(p => p.pos),
        stackByPos:    {},
        pot:           0,
        currentStreet: null,
        undoStack:     [],
    };
    cfg.players.forEach(p => { rec.stackByPos[p.pos] = p.stack; });

    const panelEl = document.getElementById('recorder-panel');
    if (panelEl) { panelEl.style.display = ''; panelEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }

    initStreet('preflop');
    renderPanel();
}

function initStreet(street) {
    rec.currentStreet = street;
    rec.currentBet    = 0;
    rec.raisingRound  = 0;
    rec.potContrib    = {};
    rec.playersInHand.forEach(pos => { rec.potContrib[pos] = 0; });

    const order     = street === 'preflop' ? PF_ORDER : POST_ORDER;
    rec.actionOrder = sortByOrder(rec.playersInHand, order);
    rec.needToAct   = [...rec.actionOrder];

    // Auto-post blinds preflop
    if (street === 'preflop') {
        const sb    = cfg.sb ?? 10;
        const bb    = cfg.bb ?? 20;
        const sbPos = rec.playersInHand.find(p => p === 'SB');
        const bbPos = rec.playersInHand.find(p => p === 'BB');

        if (sbPos) {
            rec.streets.preflop.push({ pos: sbPos, a: 'post', v: sb });
            rec.pot               += sb;
            rec.potContrib[sbPos]  = sb;
            rec.stackByPos[sbPos] -= sb;
        }
        if (bbPos) {
            rec.streets.preflop.push({ pos: bbPos, a: 'post', v: bb });
            rec.pot               += bb;
            rec.potContrib[bbPos]  = bb;
            rec.stackByPos[bbPos] -= bb;
        }
        rec.currentBet = bb;
    }
}

function pushUndoState() {
    rec.undoStack.push({
        streets:       JSON.parse(JSON.stringify(rec.streets)),
        playersInHand: [...rec.playersInHand],
        stackByPos:    { ...rec.stackByPos },
        pot:           rec.pot,
        potContrib:    { ...rec.potContrib },
        currentBet:    rec.currentBet,
        raisingRound:  rec.raisingRound,
        needToAct:     [...rec.needToAct],
    });
}

function recordAction(pos, action, amount) {
    pushUndoState();

    const street       = rec.currentStreet;
    const isAggressive = action === 'raise' || action === 'reraise' || action === 'bet';
    const entry  = { pos, a: action };
    if (amount > 0) entry.v = amount;
    rec.streets[street].push(entry);

    if (action !== 'fold' && action !== 'check' && amount > 0) {
        const prev = rec.potContrib[pos] || 0;
        // Aggressive: amount = ADDITIONAL (raise size); total = prev + amount
        // Call: amount = total commitment level; add = difference
        const newTotal = isAggressive ? prev + amount : amount;
        const add      = newTotal - prev;
        rec.pot            += add;
        rec.potContrib[pos] = newTotal;
        rec.stackByPos[pos] = (rec.stackByPos[pos] || 0) - add;

        const heroPlayer = cfg.players.find(p => p.isHero);
        if (heroPlayer && pos === heroPlayer.pos) updateHeroBetInput(street, pos);
    }

    if (action === 'fold') {
        rec.playersInHand = rec.playersInHand.filter(p => p !== pos);
        rec.needToAct = rec.needToAct.filter(p => p !== pos);
    } else if (isAggressive) {
        rec.currentBet   = rec.potContrib[pos]; // total commitment of raiser
        rec.raisingRound++;
        const order     = rec.currentStreet === 'preflop' ? PF_ORDER : POST_ORDER;
        const remaining = rec.playersInHand.filter(p => p !== pos);
        const raiserIdx = order.indexOf(pos);

        let startIdx = -1;
        for (let i = raiserIdx + 1; i < order.length; i++) {
            if (remaining.includes(order[i])) { startIdx = i; break; }
        }
        if (startIdx === -1) {
            for (let i = 0; i <= raiserIdx; i++) {
                if (remaining.includes(order[i])) { startIdx = i; break; }
            }
        }

        rec.needToAct = [];
        if (startIdx !== -1) {
            for (let i = startIdx; i < order.length; i++) {
                if (remaining.includes(order[i])) rec.needToAct.push(order[i]);
            }
            for (let i = 0; i < startIdx; i++) {
                if (remaining.includes(order[i])) rec.needToAct.push(order[i]);
            }
        }
    } else {
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

// ── Undo ──────────────────────────────────────────────────────────────────────
function _undo() {
    if (!rec || !rec.undoStack.length) { toast('ไม่มีอะไรให้ย้อนกลับ', 'error'); return; }

    const prev = rec.undoStack.pop();
    rec.streets       = prev.streets;
    rec.playersInHand = prev.playersInHand;
    rec.stackByPos    = prev.stackByPos;
    rec.pot           = prev.pot;
    rec.potContrib    = prev.potContrib;
    rec.currentBet    = prev.currentBet;
    rec.raisingRound  = prev.raisingRound;
    rec.needToAct     = prev.needToAct;

    rerenderFeed();
    updatePotBar();

    const footer = document.getElementById('rec-street-footer');
    if (footer) footer.innerHTML = '';

    renderActorBlock();
}

// ── Panel render ──────────────────────────────────────────────────────────────
function renderPanel() {
    const el = document.getElementById('recorder-panel');
    if (!el) return;

    const street = rec.currentStreet;
    const cards  = STREET_SEQ.map(s => {
        const idx    = STREET_SEQ.indexOf(s);
        const curIdx = STREET_SEQ.indexOf(street);
        const cls    = idx === curIdx ? 'rec-sc-active'
                     : idx < curIdx   ? 'rec-sc-done'
                     : 'rec-sc-future';
        return `
            <div class="rec-street-card rec-sc-${s} ${cls}" id="rec-card-${s}">
                <div class="rec-sc-label">${STREET_LBL[s]}</div>
                <div class="rec-sc-feed" id="rec-feed-${s}"></div>
            </div>`;
    }).join('');

    el.innerHTML = `
        <div class="rec-panel-box">
            <div class="rec-panel-header">
                <div class="rec-pot-display">Pot <b>${rec.pot.toLocaleString()}</b>฿</div>
                <div class="rec-panel-header-right">
                    <button class="rec-undo-btn" onclick="window.recorderModule._toggleSetup()" title="ตั้งค่าโต๊ะ">⚙</button>
                    <button class="rec-undo-btn" onclick="window.recorderModule._undo()">↩ ย้อน</button>
                </div>
            </div>
            <div class="rec-streets-row">${cards}</div>
            <div id="rec-bet-bar-wrap"></div>
            <div id="rec-actor-block" class="rec-actor-block"></div>
            <div id="rec-street-footer" class="rec-street-footer"></div>
        </div>`;

    // Render pre-posted blind entries
    const feed = document.getElementById(`rec-feed-${street}`);
    (rec.streets[street] || []).forEach(entry => appendFeedRow(feed, entry, false));

    renderBetBar();
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

// ── Feed helpers ──────────────────────────────────────────────────────────────
function appendFeedRow(feed, entry, isAgg) {
    if (!feed) return;
    const { pos, a, v } = entry;
    const player = cfg.players.find(p => p.pos === pos);
    const isHero = player?.isHero;
    const name   = player?.name || '';
    const actCls = a === 'fold'  ? 'rec-act-fold'
                 : a === 'check' ? 'rec-act-check'
                 : a === 'post'  ? 'rec-act-post'
                 : isAgg         ? 'rec-act-raise'
                 : 'rec-act-call';
    const label  = a === 'reraise' ? `re-raise ${v ? Number(v).toLocaleString() : ''}`
                 : a === 'post'    ? `post ${v ? Number(v).toLocaleString() : ''}`
                 : v ? `${a} ${Number(v).toLocaleString()}` : a;

    const row = document.createElement('div');
    row.className = `rec-feed-row${isHero ? ' rec-feed-hero' : ''}`;
    row.innerHTML = `
        <span class="rec-fr-pos${isHero ? ' rec-fr-hero-pos' : ''}">${pos}</span>
        <span class="rec-fr-name">${name || (isHero ? '● Hero' : '')}</span>
        <span class="rec-fr-act ${actCls}">${label}</span>`;
    feed.appendChild(row);
}

function appendDividerRow(feed, raisingRound) {
    const roundLabel = raisingRound === 1 ? '3-BET ↑' :
        raisingRound === 2 ? '4-BET ↑' : `${raisingRound + 2}-BET ↑`;
    const div = document.createElement('div');
    div.className = 'rec-feed-divider';
    div.innerHTML = `<div class="rec-div-line"></div><span class="rec-div-lbl">${roundLabel}</span><div class="rec-div-line"></div>`;
    feed.appendChild(div);
}

function appendToFeed(entry, isAggressive) {
    const feed = document.getElementById(`rec-feed-${rec.currentStreet}`);
    if (!feed) return;
    appendFeedRow(feed, entry, isAggressive);
    if (isAggressive && rec.needToAct.length > 0) {
        appendDividerRow(feed, rec.raisingRound);
    }
    feed.scrollTop = feed.scrollHeight;
}

function rerenderFeed() {
    const feed = document.getElementById(`rec-feed-${rec.currentStreet}`);
    if (!feed) return;
    feed.innerHTML = '';

    const actions     = rec.streets[rec.currentStreet] || [];
    let tempRaiseRound = 0;

    actions.forEach((entry, idx) => {
        const isAgg = entry.a === 'raise' || entry.a === 'reraise' || entry.a === 'bet';
        appendFeedRow(feed, entry, isAgg);
        if (isAgg) {
            tempRaiseRound++;
            if (actions[idx + 1]) appendDividerRow(feed, tempRaiseRound);
        }
    });

    // Show live divider if last action was a raise and actors remain
    const last    = actions[actions.length - 1];
    const lastAgg = last && (last.a === 'raise' || last.a === 'reraise' || last.a === 'bet');
    if (lastAgg && rec.needToAct.length > 0) appendDividerRow(feed, rec.raisingRound);

    feed.scrollTop = feed.scrollHeight;
}

function renderActorBlock() {
    const el = document.getElementById('rec-actor-block');
    if (!el) return;

    // Only 1 player left = everyone else folded; hand is over
    if (rec.playersInHand.length <= 1) {
        el.innerHTML = '';
        showStreetComplete();
        return;
    }

    const pos = rec.needToAct[0];
    if (!pos) { el.innerHTML = ''; return; }

    const player    = cfg.players.find(p => p.pos === pos);
    const isHero    = player?.isHero;
    const name      = player?.name || '';
    const stack     = Math.round(rec.stackByPos[pos] || 0);
    const alreadyIn = rec.potContrib[pos] || 0;
    const toCall    = Math.max(0, rec.currentBet - alreadyIn);
    const canCheck  = toCall === 0;

    const pot      = rec.pot;
    const snap10   = v => Math.ceil(v / 10) * 10;
    const minRaise = snap10(rec.currentBet > 0 ? rec.currentBet * 2 : (cfg.bb || 20));
    const thirdPot = Math.max(minRaise, snap10(pot / 3));
    const halfPot  = Math.max(minRaise, snap10(pot / 2));
    const threeQPot= Math.max(minRaise, snap10(pot * 0.75));
    const fullPot  = Math.max(minRaise, snap10(pot));

    const callHtml = canCheck
        ? `<button class="rec-ab rec-ab-check" onclick="window.recorderModule._act('${pos}','check',0)">CHECK</button>`
        : `<button class="rec-ab rec-ab-call"  onclick="window.recorderModule._act('${pos}','call',${rec.currentBet})">CALL ${toCall.toLocaleString()}</button>`;

    const hasOpened = rec.streets[rec.currentStreet].some(e => e.a === 'raise' || e.a === 'bet' || e.a === 'reraise');
    const raiseLabel = !hasOpened && rec.currentBet === 0 ? 'BET'
                     : !hasOpened && rec.currentBet > 0   ? 'RAISE'
                     : 'RE-RAISE';

    const nameHtml = name
        ? `${isHero ? '● ' : ''}${name} <span class="rec-pos-tag">${pos}</span>${isHero ? ' <span class="rec-hero-tag">คุณ</span>' : ''}`
        : `${isHero ? '● ' : ''}${pos}${isHero ? ' <span class="rec-hero-tag">คุณ</span>' : ''}`;

    el.innerHTML = `
        <div class="rec-actor-header">
            <div class="rec-actor-who${isHero ? ' rec-actor-hero' : ''}">${nameHtml}</div>
            <span class="rec-actor-stack">${stack.toLocaleString()} ฿</span>
        </div>
        ${toCall > 0 ? `<div class="rec-to-call">ต้อง call เพิ่ม ${toCall.toLocaleString()} ฿ (รวม ${rec.currentBet.toLocaleString()} ฿)</div>` : ''}
        <div class="rec-act-row">
            <button class="rec-ab rec-ab-fold"  onclick="window.recorderModule._act('${pos}','fold',0)">FOLD</button>
            ${callHtml}
            <button class="rec-ab rec-ab-raise" onclick="window.recorderModule._doRaise('${pos}')">${raiseLabel}</button>
        </div>
        <div class="rec-amount-row">
            <span class="rec-amt-lbl">${raiseLabel.toLowerCase()}</span>
            <input class="rec-amt-in" id="rec-raise-amt" type="number" value="${minRaise}" min="${minRaise}" step="10">
            <span class="rec-amt-lbl">฿</span>
            <div class="rec-quick-btns">
                <button class="rec-qb" onclick="document.getElementById('rec-raise-amt').value=${minRaise}">Min</button>
                <button class="rec-qb" onclick="document.getElementById('rec-raise-amt').value=${thirdPot}">⅓P</button>
                <button class="rec-qb" onclick="document.getElementById('rec-raise-amt').value=${halfPot}">½P</button>
                <button class="rec-qb" onclick="document.getElementById('rec-raise-amt').value=${threeQPot}">¾P</button>
                <button class="rec-qb" onclick="document.getElementById('rec-raise-amt').value=${fullPot}">Pot</button>
                <button class="rec-qb" onclick="document.getElementById('rec-raise-amt').value=${stack}">All-in</button>
            </div>
        </div>`;
}

function showStreetComplete() {
    const actorEl = document.getElementById('rec-actor-block');
    if (actorEl) actorEl.innerHTML = '';

    const footer  = document.getElementById('rec-street-footer');
    if (!footer) return;

    const curIdx  = STREET_SEQ.indexOf(rec.currentStreet);
    const hasMore = curIdx < STREET_SEQ.length - 1 && rec.playersInHand.length > 1;

    if (hasMore) {
        const next = STREET_SEQ[curIdx + 1];
        footer.innerHTML = `
            <div class="rec-street-done">
                <span class="rec-done-lbl">✓ ${STREET_LBL[rec.currentStreet]} · Pot ${rec.pot.toLocaleString()} ฿</span>
                <button class="rec-btn-next" onclick="window.recorderModule._nextStreet('${next}')">→ ${STREET_LBL[next]}</button>
            </div>`;
    } else {
        const endLbl = rec.playersInHand.length <= 1
            ? `✓ ทุกคน fold · Pot ${rec.pot.toLocaleString()} ฿`
            : `✓ ครบทุก street · Pot ${rec.pot.toLocaleString()} ฿`;
        footer.innerHTML = `
            <div class="rec-street-done">
                <span class="rec-done-lbl">${endLbl}</span>
                <span class="rec-done-hint">กด บันทึก Hand เพื่อเซฟทั้ง hand + action log</span>
            </div>`;
    }
}

// ── Public action handlers ────────────────────────────────────────────────────
function _act(pos, action, amount) {
    if (!rec) return;
    recordAction(pos, action, Number(amount) || 0);
}

function _doRaise(pos) {
    if (!rec) return;
    const amt = parseFloat(document.getElementById('rec-raise-amt')?.value) || 0;
    if (amt <= 0) { toast('กรุณาใส่จำนวนเงิน', 'error'); return; }
    const hasOpened  = rec.streets[rec.currentStreet].some(e => e.a === 'raise' || e.a === 'bet' || e.a === 'reraise');
    const actionType = !hasOpened && rec.currentBet === 0 ? 'bet' : hasOpened ? 'reraise' : 'raise';
    recordAction(pos, actionType, amt);
}

function updateStreetCards(street) {
    STREET_SEQ.forEach(s => {
        const card = document.getElementById(`rec-card-${s}`);
        if (!card) return;
        const idx    = STREET_SEQ.indexOf(s);
        const curIdx = STREET_SEQ.indexOf(street);
        card.className = `rec-street-card rec-sc-${s} ${
            idx === curIdx ? 'rec-sc-active' :
            idx < curIdx   ? 'rec-sc-done'   : 'rec-sc-future'
        }`;
    });
}

function _nextStreet(street) {
    const footer = document.getElementById('rec-street-footer');
    if (footer) footer.innerHTML = '';

    rec.undoStack = [];
    initStreet(street);
    updateStreetCards(street);
    updatePotBar();

    // Guard: if only 1 player remains, don't start the street — go to save
    if (rec.playersInHand.length <= 1) {
        showStreetComplete();
        return;
    }
    renderActorBlock();
}

// ── Save to Sheet (column X = r[23]) ─────────────────────────────────────────
function buildJson() {
    if (!rec || !cfg) return null;
    return JSON.stringify({ players: cfg.players, actions: rec.streets, sb: cfg.sb, bb: cfg.bb });
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

    const sheetRow = histLen + 1;
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

// ── Render Action Log for Hand Detail Modal ───────────────────────────────────
function renderActionLog(jsonStr) {
    try {
        const data = JSON.parse(jsonStr);
        if (!data?.actions) return '';

        const heroPos  = data.players?.find(p => p.isHero)?.pos || '';
        let runningPot = 0;
        let hasAny     = false;
        let colsHtml   = '';

        STREET_SEQ.forEach(street => {
            const acts = data.actions[street];
            const hasActs = acts && acts.length > 0;

            if (hasActs) {
                hasAny = true;
                const contrib = {};
                acts.forEach(e => {
                    if (e.v && e.a !== 'fold' && e.a !== 'check') {
                        contrib[e.pos] = Math.max(contrib[e.pos] || 0, e.v);
                    }
                });
                runningPot += Object.values(contrib).reduce((s, v) => s + v, 0);

                let rows = '';
                acts.forEach(e => {
                    const isAgg   = e.a === 'raise' || e.a === 'reraise' || e.a === 'bet';
                    const cls     = e.a === 'fold'  ? 'rec-log-fold'
                                  : e.a === 'check' ? 'rec-log-check'
                                  : e.a === 'post'  ? 'rec-log-post'
                                  : isAgg           ? 'rec-log-raise'
                                  : 'rec-log-call';
                    const lbl     = e.a === 'reraise' ? `re↑${e.v ? Number(e.v).toLocaleString() : ''}`
                                  : e.v ? `${e.a} ${Number(e.v).toLocaleString()}` : e.a;
                    const heroRow = heroPos && e.pos === heroPos ? ' rec-log-row-hero' : '';
                    rows += `
                        <div class="rec-log-row${heroRow}">
                            <span class="rec-log-pos">${e.pos}</span>
                            <span class="rec-log-act ${cls}">${lbl}</span>
                        </div>`;
                });

                colsHtml += `
                    <div class="rec-log-col rec-log-col-${street}">
                        <div class="rec-log-col-hd">${STREET_LBL[street]}</div>
                        <div class="rec-log-col-body">${rows}</div>
                        <div class="rec-log-col-pot">Pot ${runningPot.toLocaleString()} ฿</div>
                    </div>`;
            } else {
                colsHtml += `
                    <div class="rec-log-col rec-log-col-${street} rec-log-col-empty">
                        <div class="rec-log-col-hd">${STREET_LBL[street]}</div>
                        <div class="rec-log-col-body"></div>
                    </div>`;
            }
        });

        if (!hasAny) return '';

        const hero     = data.players?.find(p => p.isHero);
        const heroDisp = hero ? (hero.name ? `${hero.name} (${heroPos})` : heroPos) : '';
        const heroLine = heroDisp ? `<span class="rec-log-hero-tag">Hero: <b>${heroDisp}</b></span>` : '';

        return `
            <div class="rec-modal-log">
                <div class="rec-modal-log-title">ACTION LOG ${heroLine}</div>
                <div class="rec-log-grid">${colsHtml}</div>
            </div>`;
    } catch (_) { return ''; }
}

// ── Setup toggle (from panel gear button) ────────────────────────────────────
function _toggleSetup() {
    const el = document.getElementById('recorder-setup');
    if (!el) return;
    el.style.display = el.style.display === 'none' ? '' : 'none';
}

// ── Auto-fill hero bet into main bet row ──────────────────────────────────────
const STREET_BET_ID = { preflop: 'bet-pf', flop: 'bet-flop', turn: 'bet-turn', river: 'bet-river' };

function updateHeroBetInput(street, heroPos) {
    const contrib = rec.potContrib[heroPos] || 0;
    if (contrib <= 0) return;
    const input = document.getElementById(STREET_BET_ID[street]);
    if (!input) return;
    input.value = contrib;
    input.dispatchEvent(new Event('input', { bubbles: true }));
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

window.recorderModule = { init, renderActionLog, _act, _doRaise, _nextStreet, _saveLog, _undo, _toggleSetup, _interceptCard, _deactivatePlayerPicker };
document.addEventListener('DOMContentLoaded', init);

})();
