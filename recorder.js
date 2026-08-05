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

// Action-log modal: hide non-Hero showdown cards (per-session toggle, not persisted)
let _hideVillainCards = false;
let _lastLogJson  = null;
let _lastHeroCards = null;

// Table setup: SB/BB popover open state (per-session, not persisted)
let _blindsPopOpen = false;

let cfg = null;
let rec = null;
let recActivePlayer = -1;

// ── Card picker helpers ───────────────────────────────────────────────────────
// max defaults to 2 (hole cards) — board strings need up to 3 (flop), so callers
// rendering a board pass a higher max explicitly.
function parseCards(str, max = 2) {
    if (!str) return [];
    return (String(str).match(/[AKQJT2-9][hdcs]/gi) || [])
        .map(c => c[0].toUpperCase() + c[1].toLowerCase()).slice(0, max);
}

const _SUIT_SYM = { h: '♥', d: '♦', c: '♣', s: '♠' };

function _cardTextSpan(rank, suit) {
    const col = typeof suitInlineCol === 'function' ? suitInlineCol(suit) : (suit==='h'||suit==='d' ? '#f87171' : '#e2e8f0');
    return `<span style="color:${col}">${rank}${_SUIT_SYM[suit]}</span>`;
}

// Tiny inline hole cards for feed rows — respects card size setting
// Returns HTML for N hidden (face-down) cards — "?" card in graphic mode, blur in text mode.
function _hiddenCardsHTML(count) {
    const smCls = window.state?.settings?.cardSmall ? ' mini-card-sm' : '';
    if (!window.state?.settings?.textCards) {
        return Array(count).fill(
            `<span class="mini-card${smCls} mc-hidden"><span class="mc-rank">?</span><span class="mc-suit"></span></span>`
        ).join('');
    }
    return `<span style="filter:blur(3px)">●●</span>`;
}

function holeCardsInlineHTML(cardsStr, isHero = false) {
    const cards = parseCards(cardsStr);
    if (!cards.length) return '';
    const useCards = !window.state?.settings?.textCards;
    const smCls    = window.state?.settings?.cardSmall ? ' mini-card-sm' : '';
    if (window.state?.hideHand && isHero) {
        return _hiddenCardsHTML(cards.length);
    }
    return cards.map(c => {
        const rank = c[0], suit = c[1];
        if (useCards) {
            const cls = typeof suitCvClass === 'function' ? suitCvClass(suit) : (suit==='h'||suit==='d' ? 'cv-red' : 'cv-black');
            return `<span class="mini-card${smCls}"><span class="mc-rank ${cls}">${rank}</span><span class="mc-suit ${cls}">${_SUIT_SYM[suit]}</span></span>`;
        }
        return _cardTextSpan(rank, suit);
    }).join('');
}

// Board cards for street header — size follows cardSmall setting
function boardCardsHTML(street) {
    const cards = window.state?.sel?.[street];
    if (!cards || !cards.length) return '';
    const useCards = !window.state?.settings?.textCards;
    const smCls = window.state?.settings?.cardSmall ? ' mini-card-sm' : '';
    return cards.map(c => {
        const rank = c[0], suit = c[1];
        if (useCards) {
            const cls = typeof suitCvClass === 'function' ? suitCvClass(suit) : (suit==='h'||suit==='d' ? 'cv-red' : 'cv-black');
            return `<span class="mini-card${smCls}"><span class="mc-rank ${cls}">${rank}</span><span class="mc-suit ${cls}">${_SUIT_SYM[suit]}</span></span>`;
        }
        return _cardTextSpan(rank, suit);
    }).join('');
}

function renderCardSlotHTML(cardsStr, isHero = false) {
    const cards    = parseCards(cardsStr);
    const useCards = !window.state?.settings?.textCards;
    const smCls    = window.state?.settings?.cardSmall ? ' mini-card-sm' : '';
    if (window.state?.hideHand && isHero && cards.length > 0) {
        return _hiddenCardsHTML(cards.length);
    }
    return [0, 1].map(i => {
        if (cards[i]) {
            const rank = cards[i][0], suit = cards[i][1];
            if (useCards) {
                const cls = typeof suitCvClass === 'function' ? suitCvClass(suit) : (suit==='h'||suit==='d' ? 'cv-red' : 'cv-black');
                return `<span class="mini-card${smCls}"><span class="mc-rank ${cls}">${rank}</span><span class="mc-suit ${cls}">${_SUIT_SYM[suit]}</span></span>`;
            } else {
                const col = typeof suitInlineCol === 'function' ? suitInlineCol(suit) : (suit==='h'||suit==='d' ? '#f87171' : '#e2e8f0');
                return `<span style="color:${col}">${rank}${_SUIT_SYM[suit]}</span>`;
            }
        }
        if (useCards)
            return `<span class="mini-card${smCls} rec-card-placeholder"><span class="mc-rank" style="color:var(--text-muted)">?</span><span class="mc-suit"></span></span>`;
        return `<span style="color:var(--text-muted)">?</span>`;
    }).join(useCards ? '' : ' ');
}

function updateCardsSlot(playerIdx) {
    const el = document.querySelector(`.rec-cards-slot[data-i="${playerIdx}"]`);
    if (!el || !cfg?.players?.[playerIdx]) return;
    const heroPos = document.querySelector('#position-chips .pos-chip.selected')?.dataset.pos || '';
    const isHero  = heroPos ? cfg.players[playerIdx].pos === heroPos : !!cfg.players[playerIdx].isHero;
    el.innerHTML = renderCardSlotHTML(cfg.players[playerIdx].cards || '', isHero);
}

function _refreshAllCardSlots() {
    cfg?.players?.forEach((_, i) => updateCardsSlot(i));
}

function _refreshAllFeedCards() {
    cfg?.players?.forEach((_, i) => _updateFeedCards(i));
}

// Live-update hole-card spans in all recorded street feed rows for one player.
// Called whenever p.cards changes (picker or hero slot) so rows reflect current data.
function _updateFeedCards(playerIdx) {
    if (!cfg?.players?.[playerIdx] || !rec) return;
    const p        = cfg.players[playerIdx];
    const cardsStr = p.isHero
        ? (window.state?.sel?.hand?.join('') || '')
        : (p.cards || '');
    const hcHtml = holeCardsInlineHTML(cardsStr, p.isHero);

    STREET_SEQ.forEach(street => {
        const feed = document.getElementById(`rec-feed-${street}`);
        if (!feed) return;
        feed.querySelectorAll('.rec-feed-row').forEach(row => {
            const posEl = row.querySelector('.rec-fr-pos');
            if (!posEl || posEl.textContent.trim() !== p.pos) return;
            const cardsEl = row.querySelector('.rec-fr-cards');
            if (cardsEl) cardsEl.innerHTML = hcHtml;
        });
    });
}

function getHeroIdx() {
    if (!cfg?.players) return -1;
    return cfg.players.findIndex(p => p.name === (cfg.heroName || 'Hero'));
}

function _addRecorderUsedCards() {
    // Called by rebuildUsed() in app.js — adds all recorder hole cards (except active picker player) to usedCards
    // Hero's cards come from state.sel.hand and are already added by the main rebuildUsed(); skip them here.
    if (!window.state?.usedCards || !cfg?.players) return;
    const heroIdx = getHeroIdx();
    cfg.players.forEach((p, i) => {
        if (i !== recActivePlayer && i !== heroIdx) parseCards(p.cards).forEach(c => window.state.usedCards.add(c));
    });
}

function _syncRecUsedCards() {
    if (typeof rebuildUsed === 'function') rebuildUsed(); // calls _addRecorderUsedCards via hook
}

// Called at the END of app.js refreshCardGrid() — completely re-renders grid state
// for recorder picker context, overriding whatever refreshCardGrid just set.
// Uses querySelectorAll to avoid needing SUITS/RANKS from app.js scope.
function _overrideCardGrid() {
    if (recActivePlayer < 0) return;
    const p       = cfg?.players?.[recActivePlayer];
    const holeSel = parseCards(p?.cards || '');
    const holeSet = new Set(holeSel);
    const used    = window.state?.usedCards || new Set();
    const isFull  = holeSel.length >= 2;

    document.querySelectorAll('#card-grid .card-btn').forEach(btn => {
        const id = btn.id.slice(3); // strip 'cb-' prefix
        btn.classList.remove('selected', 'used', 'field-full');
        btn.disabled = false;
        if (holeSet.has(id)) {
            btn.classList.add('selected');
        } else if (used.has(id)) {
            btn.classList.add('used');
            btn.disabled = true;
        } else if (isFull) {
            btn.classList.add('field-full');
            btn.disabled = true;
        }
    });
}

// _applyRecPickerToGrid: rebuild used-cards then trigger a normal refreshCardGrid
// (which calls _overrideCardGrid at the end automatically)
function _applyRecPickerToGrid() {
    _syncRecUsedCards();
    if (typeof refreshCardGrid === 'function') refreshCardGrid();
}

function _activatePlayerPicker(playerIdx) {
    if (playerIdx === getHeroIdx()) {
        // Hero's cards come from the HAND field — redirect to main card picker
        if (recActivePlayer >= 0) _deactivatePlayerPicker();
        if (typeof setActive === 'function') setActive('hand');
        return;
    }
    if (recActivePlayer === playerIdx) { _deactivatePlayerPicker(); return; }
    _deactivatePlayerPicker(); // clean up previous if any
    recActivePlayer = playerIdx;

    const p   = cfg?.players?.[playerIdx];
    const lbl = p?.name ? `${p.name} (${p.pos})` : (p?.pos || '');
    const sel = parseCards(p?.cards || '');

    // Override picker header manually — don't touch state.activeField
    const labelEl = document.getElementById('picker-label');
    const nameEl  = document.getElementById('picker-field-name');
    const countEl = document.getElementById('picker-count');
    if (labelEl)  labelEl.textContent = 'ไพ่ที่ถือ:';
    if (nameEl)  { nameEl.textContent = lbl; nameEl.style.color = '#a78bfa'; }
    if (countEl) { countEl.textContent = `${sel.length} / 2`; countEl.classList.toggle('full', sel.length >= 2); }

    // Mark active slot visually
    document.querySelectorAll('.rec-cards-slot').forEach(el => el.classList.remove('active'));
    document.querySelector(`.rec-cards-slot[data-i="${playerIdx}"]`)?.classList.add('active');

    _applyRecPickerToGrid(); // rebuilds usedCards + refreshCardGrid (which calls _overrideCardGrid)

    document.getElementById('card-picker-section')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _deactivatePlayerPicker() {
    if (recActivePlayer === -1) return;
    recActivePlayer = -1;
    document.querySelectorAll('.rec-cards-slot').forEach(el => el.classList.remove('active'));

    const labelEl = document.getElementById('picker-label');
    if (labelEl) labelEl.textContent = 'กำลังเลือก:';

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
        if (sel.length >= 2) return true; // full — consume, do nothing
        sel.push(cardId);
    }
    p.cards = sel.join('');

    updateCardsSlot(recActivePlayer);
    _updateFeedCards(recActivePlayer); // retroactively update any already-rendered feed rows

    // Update header count badge
    const countEl = document.getElementById('picker-count');
    if (countEl) { countEl.textContent = `${sel.length} / 2`; countEl.classList.toggle('full', sel.length >= 2); }

    _applyRecPickerToGrid(); // rebuilds usedCards + refreshCardGrid → _overrideCardGrid auto-applies

    if (sel.length >= 2) setTimeout(() => _deactivatePlayerPicker(), 160);
    return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function isOn() { return document.getElementById('toggle-recorder')?.checked || false; }
function toast(msg, type) { if (window.showToast) window.showToast(msg, type || 'success'); }
function loadConfig() { try { return JSON.parse(localStorage.getItem(LS_CONFIG)) || null; } catch (_) { return null; } }
function saveConfig(c) {
    cfg = c;
    // Strip hole cards before persisting — cards are session-only and should not survive a page refresh
    const persisted = { ...c, players: c.players?.map(p => ({ ...p, cards: '' })) || [] };
    localStorage.setItem(LS_CONFIG, JSON.stringify(persisted));
    syncPositionChips();
    _syncRotateBtns();
}

// Keep the recorder-setup rotate toggle and the simple-mode one in sync — both
// just reflect/flip the same cfg.autoRotate flag.
function _syncRotateBtns() {
    const active = !!cfg?.autoRotate;
    document.getElementById('rec-rotate-btn')?.classList.toggle('active', active);
    document.getElementById('pos-rotate-btn')?.classList.toggle('active', active);
}

function buildDefaultPlayers(n) {
    const positions = POS_PRESETS[n] || POS_PRESETS[6];
    return positions.map(pos => ({ pos, name: '', stack: 1000, isHero: false }));
}

// Hide the entire position-row when recorder is on (redundant with setup table);
// restore when off, and filter the individual chips to whichever positions the
// table-setup player count actually uses (e.g. 6-max hides UTG+1/Mid/Mid+1/LJ).
function syncPositionChips() {
    const row = document.getElementById('position-row');
    if (row) row.style.display = isOn() ? 'none' : '';

    const validPos = new Set((cfg?.players || []).map(p => p.pos));
    document.querySelectorAll('#position-chips .pos-chip').forEach(btn => {
        btn.style.display = (validPos.size === 0 || validPos.has(btn.dataset.pos)) ? '' : 'none';
    });
}

function sortByOrder(posArr, order) {
    return posArr.slice().sort((a, b) => {
        const ai = order.indexOf(a); const bi = order.indexOf(b);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
}

// Base seating order for a street, adjusted for an active UTG straddle: the
// straddler posted a live blind, so they act last preflop (same "closes the
// round" spot BB normally has) instead of first.
function streetOrder(street) {
    const base = street === 'preflop' ? PF_ORDER : POST_ORDER;
    if (street === 'preflop' && rec?.straddleActive) {
        return [...base.filter(p => p !== 'UTG'), 'UTG'];
    }
    return base;
}

// ── Toggle ────────────────────────────────────────────────────────────────────
function applyToggle() {
    const on = isOn();
    const setupEl = document.getElementById('recorder-setup');
    const panelEl = document.getElementById('recorder-panel');
    if (setupEl) setupEl.style.display = on ? '' : 'none';
    if (panelEl && !on) panelEl.style.display = 'none';
    // Load persisted table config even when the recorder is off, so the
    // simple-mode position row can still filter to the configured seats.
    cfg = loadConfig();
    _syncRotateBtns();
    if (on) renderSetup();
    const startBtn = document.getElementById('rec-start-btn');
    if (startBtn) startBtn.style.display = on && !rec ? '' : 'none';
    syncPositionChips();
    ['fi-sd1', 'fi-sd2'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = on ? 'none' : '';
    });
    // The simple top-bar Fold button sets state.foldStreet, which doesn't talk to
    // rec.playersInHand — hide it in detailed mode so fold only ever comes from the
    // per-street actor button, and clear any stale state.foldStreet left over from
    // before the toggle so it can't silently disagree with the recorder's own fold.
    const foldBtn = document.getElementById('fold-btn');
    if (foldBtn) foldBtn.style.display = on ? 'none' : '';
    if (on && window.state) {
        window.state.foldStreet = null;
        window.refreshFoldBtn?.();
    }
    if (on) {
        const af = document.querySelector('.field-item.active')?.dataset?.field;
        if (af === 'sd1' || af === 'sd2') document.getElementById('fi-river')?.click();
    }
    if (typeof updateShowdownHeader === 'function') updateShowdownHeader();
}

// ── Player Setup UI ───────────────────────────────────────────────────────────
function renderSetup() {
    const el = document.getElementById('recorder-setup');
    if (!el) return;

    const count   = cfg?.players?.length || 6;
    const players = cfg?.players || buildDefaultPlayers(count);
    const sb      = cfg?.sb ?? 10;
    const bb      = cfg?.bb ?? 20;
    const hasUTG      = players.some(p => p.pos === 'UTG');
    const straddleAmt = cfg?.straddleAmt || bb * 2;

    const countOpts = Array.from({ length: 8 }, (_, i) => i + 3)
        .map(n => `<option value="${n}"${n === count ? ' selected' : ''}>${n} คน</option>`)
        .join('');

    const heroPos = document.querySelector('#position-chips .pos-chip.selected')?.dataset.pos || '';
    const heroIdx = heroPos ? players.findIndex(p => p.pos === heroPos) : players.findIndex(p => p.name === (cfg?.heroName || 'Hero'));
    const rows = players.map((p, i) => {
        const isHero  = i === heroIdx;
        const cardStr = isHero ? (window.state?.sel?.hand?.join('') || '') : (p.cards || '');
        return `
        <tr>
            <td><input class="rec-pos-in${p.pos === heroPos ? ' selected' : ''}" data-i="${i}" value="${p.pos}" maxlength="6"${rec ? ' disabled' : ''}></td>
            <td><div class="rec-name-cell">
                <input class="rec-name-in" data-i="${i}" value="${p.name || ''}" placeholder="ชื่อเล่น" maxlength="12">
                ${isHero ? `<button class="rec-mv-btn" onclick="window.recorderModule._moveHero(-1)" title="เลื่อนขึ้น">↑</button><button class="rec-mv-btn" onclick="window.recorderModule._moveHero(1)" title="เลื่อนลง">↓</button>` : ''}
            </div></td>
            <td><input class="rec-stack-in rec-player-stack" data-i="${i}" type="number" value="${p.stack || 1000}" min="0" step="10"${rec ? ' disabled' : ''}></td>
            <td><button class="rec-cards-slot${isHero ? ' rec-cards-hero-slot' : ''}" data-i="${i}"${isHero ? ' title="ไพ่ Hero = ช่อง HAND"' : ''}>${renderCardSlotHTML(cardStr, isHero)}</button></td>
        </tr>`;
    }).join('');

    el.innerHTML = `
        <div class="rec-setup-box">
            <div class="rec-setup-header">
                <div class="rec-header-left">
                    <span class="rec-setup-title">ตั้งค่าโต๊ะ</span>
                    <span class="rec-small-lbl rec-hdr-sep">Hero</span>
                    <input class="rec-stack-in rec-hero-name-in" id="rec-hero-name" value="${cfg?.heroName || 'Hero'}" maxlength="12" placeholder="Hero">
                    <button class="rec-rotate-btn${cfg?.autoRotate ? ' active' : ''}" id="rec-rotate-btn" title="เลื่อนตำแหน่งอัตโนมัติหลังบันทึก Hand">เลื่อนอัตโนมัติ</button>
                </div>
                <div class="rec-header-right">
                    <div class="rec-blinds-wrap">
                        <button class="rec-gear-btn" id="rec-blinds-gear" title="ตั้งค่า Blind (SB/BB)">⚙ Blind</button>
                        <div class="rec-blinds-pop${_blindsPopOpen ? ' open' : ''}" id="rec-blinds-pop">
                            <label class="rec-small-lbl" for="rec-sb">SB</label>
                            <input class="rec-stack-in rec-blind-in" id="rec-sb" type="number" value="${sb}" min="1" step="1">
                            <label class="rec-small-lbl" for="rec-bb">BB</label>
                            <input class="rec-stack-in rec-blind-in" id="rec-bb" type="number" value="${bb}" min="1" step="1">
                        </div>
                    </div>
                    ${hasUTG ? `
                    <button class="rec-rotate-btn${cfg?.straddle ? ' active' : ''}" id="rec-straddle-btn" title="UTG straddle (บอดที่ 3, ปิดท้าย preflop)">Straddle</button>
                    ${cfg?.straddle ? `<input class="rec-stack-in rec-blind-in" id="rec-straddle-amt" type="number" value="${straddleAmt}" min="1" step="1">` : ''}
                    ` : ''}
                    <span class="rec-small-lbl rec-hdr-sep">ผู้เล่น</span>
                    <div class="rec-dd-wrap">
                        <select id="rec-count"${rec ? ' disabled' : ''}>${countOpts}</select>
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
            </div>
        </div>`;

    bindSetupEvents();
}

// Normalize a typed position to its canonical casing (e.g. "mid" -> "Mid") so it still
// matches PF_ORDER/POST_ORDER/POS_PRESETS; unrecognized custom text is just uppercased.
function normalizePos(v) {
    const raw = (v || '').trim();
    if (!raw) return '?';
    const known = PF_ORDER.find(t => t.toLowerCase() === raw.toLowerCase());
    return known || raw.toUpperCase();
}

function collectConfig() {
    const poses   = [...document.querySelectorAll('.rec-pos-in')].map(el => normalizePos(el.value));
    const names   = [...document.querySelectorAll('.rec-name-in')].map(el => el.value.trim());
    const stacks  = [...document.querySelectorAll('.rec-player-stack')].map(el => parseFloat(el.value) || 1000);
    const heroPos = document.querySelector('#position-chips .pos-chip.selected')?.dataset.pos || '';
    const sb      = parseFloat(document.getElementById('rec-sb')?.value) ?? 10;
    const bb      = parseFloat(document.getElementById('rec-bb')?.value) ?? 20;
    const straddle    = cfg?.straddle || false;
    const straddleAmt = parseFloat(document.getElementById('rec-straddle-amt')?.value) || cfg?.straddleAmt || (bb * 2);
    return {
        players: poses.map((pos, i) => ({ pos, name: names[i] || '', stack: stacks[i], isHero: pos === heroPos, cards: cfg?.players?.[i]?.cards || '' })),
        sb, bb,
        straddle, straddleAmt,
        heroName:   cfg?.heroName   || 'Hero',
        autoRotate: cfg?.autoRotate || false,
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
        saveConfig({ ...cfg, players: fresh });
        renderSetup();
    });

    document.querySelector('.rec-player-table')?.addEventListener('click', e => {
        const posInput = e.target.closest('.rec-pos-in');
        if (posInput) {
            if (rec) return; // lock position during recording
            const idx      = parseInt(posInput.dataset.i);
            const pos      = posInput.value;
            const heroName = cfg?.heroName || 'Hero';
            // Update pos-chip selection first (renderSetup reads from this)
            document.querySelectorAll('#position-chips .pos-chip').forEach(b => {
                b.classList.toggle('selected', b.dataset.pos === pos);
            });
            if (cfg?.players?.[idx]) {
                // Sync whatever the user has typed in name inputs → cfg before modifying
                document.querySelectorAll('.rec-name-in').forEach((el, i) => {
                    if (cfg.players[i]) cfg.players[i].name = el.value.trim();
                });
                // Clear heroName from any other row; set it on the clicked row
                cfg.players.forEach((p, i) => { if (i !== idx && p.name === heroName) p.name = ''; });
                cfg.players[idx].name = heroName;
                cfg.players.forEach((p, i) => { p.isHero = (i === idx); });
                saveConfig(cfg);
                renderSetup();
            }
            return;
        }
        const slot = e.target.closest('.rec-cards-slot');
        if (slot) _activatePlayerPicker(parseInt(slot.dataset.i));
    });

    document.getElementById('rec-hero-name')?.addEventListener('input', e => {
        if (cfg) { cfg.heroName = e.target.value.trim() || 'Hero'; saveConfig(cfg); }
    });

    document.getElementById('rec-blinds-gear')?.addEventListener('click', e => {
        e.stopPropagation();
        _blindsPopOpen = !_blindsPopOpen;
        document.getElementById('rec-blinds-pop')?.classList.toggle('open', _blindsPopOpen);
    });

    document.querySelectorAll('.rec-name-in').forEach((input, idx) => {
        input.addEventListener('input', () => {
            if (!cfg?.players?.[idx]) return;
            cfg.players[idx].name = input.value.trim();
            saveConfig(cfg);
            if (rec) {
                renderPosChips();
                updateStreetActorLabel();
                refreshFeedNames(cfg.players[idx].pos);
            }
        });
    });
    document.querySelectorAll('.rec-player-stack').forEach((input, idx) => {
        input.addEventListener('input', () => {
            if (!cfg?.players?.[idx]) return;
            cfg.players[idx].stack = parseFloat(input.value) || 1000;
            saveConfig(cfg);
        });
    });

    document.getElementById('rec-rotate-btn')?.addEventListener('click', () => {
        if (cfg) { cfg.autoRotate = !cfg.autoRotate; saveConfig(cfg); }
        renderSetup();
    });

    document.getElementById('rec-straddle-btn')?.addEventListener('click', () => {
        if (cfg) {
            cfg.straddle = !cfg.straddle;
            if (cfg.straddle && !cfg.straddleAmt) cfg.straddleAmt = (cfg.bb || 20) * 2;
            saveConfig(cfg);
        }
        renderSetup();
    });
    document.getElementById('rec-straddle-amt')?.addEventListener('input', e => {
        if (cfg) { cfg.straddleAmt = parseFloat(e.target.value) || (cfg.bb || 20) * 2; saveConfig(cfg); }
    });

    document.getElementById('rec-collapse-btn')?.addEventListener('click', () => {
        const box = document.querySelector('.rec-setup-box');
        const btn = document.getElementById('rec-collapse-btn');
        if (!box) return;
        const collapsed = box.classList.toggle('rec-setup-collapsed');
        if (btn) btn.textContent = collapsed ? '▼' : '▲';
    });

}

// Editing a past hand restores that hand's historical hole cards into cfg.players
// (via _loadLogForEdit, so the recorder panel can replay it correctly) — nothing
// cleared that back afterward, so e.g. an old showdown opponent's cards kept
// showing as already-dealt on every hand recorded since. Call once the edit is
// done and we're back to "ready for the next hand".
function _clearPlayerCards() {
    if (!cfg?.players?.length) return;
    cfg.players.forEach(p => { p.cards = ''; });
    saveConfig(cfg);
    renderSetup();
}

// Rotate player names left by 1 seat after saving a hand (keeping positions fixed)
function _rotatePositions() {
    if (!cfg?.players?.length) return;
    const heroName = cfg.heroName || 'Hero';
    const names    = cfg.players.map(p => p.name || '');
    names.push(names.shift()); // [A,B,C,D,E] → [B,C,D,E,A]
    cfg.players.forEach((p, i) => { p.name = names[i]; p.cards = ''; });
    saveConfig(cfg);

    // Update pos-chip selection to follow the hero name
    const heroIdx = cfg.players.findIndex(p => p.name === heroName);
    if (heroIdx >= 0) {
        const heroPos = cfg.players[heroIdx].pos;
        document.querySelectorAll('#position-chips .pos-chip').forEach(b => {
            b.classList.toggle('selected', b.dataset.pos === heroPos);
        });
    }
    renderSetup();
    _refreshAllCardSlots();
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

    const panelEl  = document.getElementById('recorder-panel');
    const startBtn = document.getElementById('rec-start-btn');
    if (panelEl)  { panelEl.style.display = ''; panelEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    if (startBtn) startBtn.style.display = 'none';

    _setPosLock(true);
    initStreet('preflop');
    renderPanel();
}

function _setPosLock(locked) {
    document.querySelectorAll('.rec-pos-in').forEach(el => { el.disabled = locked; });
    // Reshaping the table mid-hand (e.g. 9-max -> 8-max) rebuilds cfg.players, but the
    // in-progress rec.playersInHand/needToAct snapshot from hand start doesn't change —
    // that desync is what let a position like "Mid" vanish from the header while still
    // showing up in the action log. Lock the seat-count picker for the same duration as
    // the position inputs so the table can't be reshaped while a hand is being recorded.
    const countEl = document.getElementById('rec-count');
    if (countEl) countEl.disabled = locked;
    // Same story for Stack: editing it only touched cfg.players[i].stack, never
    // rec.stackByPos (the number actually driving the live actor panel/all-in caps),
    // so a mid-hand edit silently didn't apply. Lock it instead of trying to re-derive
    // "how much of the new stack is still behind" after bets already happened this hand.
    document.querySelectorAll('.rec-player-stack').forEach(el => { el.disabled = locked; });
}

function initStreet(street) {
    rec.currentStreet = street;
    rec.currentBet    = 0;
    rec.raisingRound  = 0;
    rec.potContrib    = {};
    rec.playersInHand.forEach(pos => { rec.potContrib[pos] = 0; });

    if (street === 'preflop') {
        const utgPos = rec.playersInHand.find(p => p === 'UTG');
        rec.straddleActive = !!cfg.straddle && !!utgPos;
    }

    rec.actionOrder = sortByOrder(rec.playersInHand, streetOrder(street));
    rec.needToAct   = rec.actionOrder.filter(p => (rec.stackByPos[p] || 0) > 0);

    // Auto-post blinds (+ straddle) preflop
    if (street === 'preflop') {
        const sb    = cfg.sb ?? 10;
        const bb    = cfg.bb ?? 20;
        const sbPos = rec.playersInHand.find(p => p === 'SB');
        const bbPos = rec.playersInHand.find(p => p === 'BB');
        const utgPos = rec.playersInHand.find(p => p === 'UTG');

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
        if (rec.straddleActive) {
            const straddleAmt = cfg.straddleAmt || bb * 2;
            rec.streets.preflop.push({ pos: utgPos, a: 'post', v: straddleAmt });
            rec.pot                += straddleAmt;
            rec.potContrib[utgPos]  = straddleAmt;
            rec.stackByPos[utgPos] -= straddleAmt;
            rec.currentBet = straddleAmt;
        } else {
            rec.currentBet = bb;
        }
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
        currentStreet: rec.currentStreet,
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
        // amount is always TOTAL pot contribution (raise: total to, call: total)
        const newTotal = amount;
        const add      = newTotal - prev;
        rec.pot            += add;
        rec.potContrib[pos] = newTotal;
        rec.stackByPos[pos] = (rec.stackByPos[pos] || 0) - add;

        const heroPlayer = cfg.players.find(p => p.isHero);
        if (heroPlayer && pos === heroPlayer.pos) updateHeroBetInput(street, pos);
    }

    if (action === 'fold') {
        rec.playersInHand = rec.playersInHand.filter(p => p !== pos);
        rec.needToAct = rec.needToAct.filter(p => p !== pos && (rec.stackByPos[p] || 0) > 0);
    } else if (isAggressive) {
        rec.currentBet   = rec.potContrib[pos]; // total commitment of raiser
        rec.raisingRound++;
        const order     = streetOrder(rec.currentStreet);
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
        // Skip all-in players — they can't act with 0 chips
        rec.needToAct = rec.needToAct.filter(p => (rec.stackByPos[p] || 0) > 0);
    } else {
        rec.needToAct = rec.needToAct.filter(p => p !== pos && (rec.stackByPos[p] || 0) > 0);
    }

    appendToFeed(entry, isAggressive);
    updatePotBar();

    if (rec.needToAct.length === 0 || rec.playersInHand.length <= 1) {
        showStreetComplete();
    } else {
        renderActorBlock();
    }
    updateStreetActorLabel();
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
    if (prev.currentStreet) rec.currentStreet = prev.currentStreet;

    // Clear feeds for streets that are now "future" after restoring
    const restoredIdx = STREET_SEQ.indexOf(rec.currentStreet);
    STREET_SEQ.forEach((s, i) => {
        if (i > restoredIdx) {
            const feed = document.getElementById(`rec-feed-${s}`);
            if (feed) feed.innerHTML = '';
            const pot = document.getElementById(`rec-sc-pot-${s}`);
            if (pot) pot.innerHTML = '';
        }
    });

    updateStreetCards(rec.currentStreet);
    rerenderFeed();
    updatePotBar();

    const footer = document.getElementById('rec-street-footer');
    if (footer) footer.innerHTML = '';

    if (rec.needToAct.length === 0 || rec.playersInHand.length <= 1) {
        showStreetComplete();
    } else {
        renderActorBlock();
    }
}

// Discard the in-progress hand without saving — the escape hatch for a mistyped
// stack/position/count noticed only after "เริ่มบันทึก" was already clicked, since
// those inputs lock for the duration of a hand. cfg (table setup) is untouched.
function _cancelHand() {
    if (!rec) return;
    if (!confirm('ยกเลิกมือนี้? ข้อมูลที่บันทึกไปในมือนี้จะหายไปทั้งหมด (ยังไม่ได้บันทึกลงชีต)')) return;

    rec = null;
    _setPosLock(false);
    const panelEl  = document.getElementById('recorder-panel');
    const startBtn = document.getElementById('rec-start-btn');
    if (panelEl)  panelEl.style.display = 'none';
    if (startBtn) startBtn.style.display = '';
    renderSetup();
    toast('ยกเลิกมือนี้แล้ว');
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
        const boardDiv = `<div class="rec-sc-board-cards" id="rec-sc-board-${s}">${s !== 'preflop' ? boardCardsHTML(s) : ''}</div>`;
        return `
            <div class="rec-street-card rec-sc-${s} ${cls}" id="rec-card-${s}">
                <div class="rec-sc-label">${STREET_LBL[s]}</div>
                ${boardDiv}
                <div class="rec-sc-feed" id="rec-feed-${s}"></div>
                <div class="rec-sc-actor" id="rec-sc-actor-${s}"></div>
                <div class="rec-sc-pot" id="rec-sc-pot-${s}"></div>
            </div>`;
    }).join('');

    el.innerHTML = `
        <div class="rec-panel-box">
            <div class="rec-panel-header">
                <div class="rec-pot-display">Pot <b>${rec.pot.toLocaleString()}</b>฿</div>
                <div class="rec-pos-chips" id="rec-pos-chips"></div>
                <div class="rec-panel-header-right">
                    <button class="rec-undo-btn" onclick="window.recorderModule._toggleSetup()" title="ตั้งค่าโต๊ะ">⚙</button>
                    <button class="rec-undo-btn" onclick="window.recorderModule._undo()">↩ ย้อน</button>
                    <button class="rec-undo-btn" onclick="window.recorderModule._cancelHand()" title="ยกเลิกมือนี้ (ไม่บันทึก)">✕ ยกเลิก</button>
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
    const initPotEl = document.getElementById(`rec-sc-pot-${street}`);
    if (initPotEl && rec.pot > 0) initPotEl.textContent = `Pot ${rec.pot.toLocaleString()} ฿`;
    _syncPotInput();
    renderPosChips();
    updateStreetActorLabel();
}

function updateStreetActorLabel() {
    const street = rec?.currentStreet;
    if (!street) return;
    const el = document.getElementById(`rec-sc-actor-${street}`);
    if (!el) return;
    const pos = rec?.needToAct?.[0];
    if (!pos) { el.innerHTML = ''; return; }
    const player = cfg?.players?.find(p => p.pos === pos);
    const name = player?.name || '';
    const isHero = player?.isHero;
    const cardsStr = isHero ? (window.state?.sel?.hand?.join('') || '') : (player?.cards || '');
    const hcHtml = holeCardsInlineHTML(cardsStr, isHero);
    el.innerHTML = `<div class="rec-sc-actor-bar">
        <span class="rec-sc-actor-pos">${pos}</span>
        ${name ? `<span class="rec-sc-actor-name">${name}</span>` : ''}
        ${hcHtml ? `<span class="rec-sc-actor-cards">${hcHtml}</span>` : ''}
        <span class="rec-sc-acting-dot">▶</span>
    </div>`;
}

function renderPosChips() {
    const el = document.getElementById('rec-pos-chips');
    if (!el || !cfg?.players) return;
    const currentActor = rec?.needToAct?.[0] || null;
    const inHand = new Set(rec?.playersInHand || []);
    el.innerHTML = cfg.players.map(p => {
        const isActive = p.pos === currentActor;
        const isFolded = !inHand.has(p.pos);
        const cls = isActive ? 'rec-pc-active'
                  : isFolded ? 'rec-pc-fold'
                  : p.isHero ? 'rec-pc-hero'
                  : 'rec-pc-neutral';
        const name = p.name || '';
        return `<div class="rec-pc-col ${cls}">
            <span class="rec-pc-pos">${p.pos}${isActive ? ' ●' : ''}</span>
            ${name ? `<span class="rec-pc-name">${name}</span>` : ''}
        </div>`;
    }).join('');
}

// Update already-logged feed rows in place so a mid-hand name edit doesn't
// leave earlier streets showing the old (or blank) name.
function refreshFeedNames(pos) {
    const player  = cfg?.players?.find(p => p.pos === pos);
    const display = player?.name || (player?.isHero ? '● Hero' : '');
    document.querySelectorAll('.rec-sc-feed .rec-feed-row').forEach(row => {
        const posEl = row.querySelector('.rec-fr-pos');
        if (posEl?.textContent.trim() !== pos) return;
        const nameEl = row.querySelector('.rec-fr-name');
        if (nameEl) nameEl.textContent = display;
    });
}

function updatePotBar() {
    const el = document.querySelector('.rec-pot-display');
    if (el) el.innerHTML = `Pot <b>${rec.pot.toLocaleString()}</b>฿`;
    renderBetBar();
    const potEl = document.getElementById(`rec-sc-pot-${rec.currentStreet}`);
    if (potEl) potEl.textContent = `Pot ${rec.pot.toLocaleString()} ฿`;
    _syncPotInput();
    renderPosChips();
}

function _syncPotInput() {
    const pi = document.getElementById('pot-input');
    if (pi && !pi.disabled) pi.value = rec.pot > 0 ? rec.pot : '';
    if (typeof refreshResultDisplay === 'function') refreshResultDisplay();
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

    // Hero cards come from HAND field; other players from p.cards
    const cardsStr = isHero ? (window.state?.sel?.hand?.join('') || '') : (player?.cards || '');
    const hcHtml   = holeCardsInlineHTML(cardsStr, isHero);
    const row = document.createElement('div');
    row.className = `rec-feed-row${isHero ? ' rec-feed-hero' : ''}${isHero && a === 'fold' ? ' rec-feed-hero-fold' : ''}`;
    row.innerHTML = `
        <span class="rec-fr-pos${isHero ? ' rec-fr-hero-pos' : ''}">${pos}</span>
        <span class="rec-fr-name">${name || (isHero ? '● Hero' : '')}</span>
        <span class="rec-fr-cards">${hcHtml}</span>
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
    const maxRaise  = alreadyIn + stack; // total all-in
    const cap       = v => Math.min(v, maxRaise);
    const minRaise  = cap(snap10(rec.currentBet > 0 ? rec.currentBet * 2 : (cfg.bb || 20)));
    const thirdPot  = cap(Math.max(minRaise, snap10(alreadyIn + pot / 3)));
    const halfPot   = cap(Math.max(minRaise, snap10(alreadyIn + pot / 2)));
    const threeQPot = cap(Math.max(minRaise, snap10(alreadyIn + pot * 0.75)));
    const fullPot   = cap(Math.max(minRaise, snap10(alreadyIn + pot)));

    const callAmt  = Math.min(rec.currentBet, alreadyIn + stack); // cap call at all-in amount
    const callDisp = Math.min(toCall, stack);
    const callHtml = canCheck
        ? `<button class="rec-ab rec-ab-check" onclick="window.recorderModule._act('${pos}','check',0)">CHECK</button>`
        : `<button class="rec-ab rec-ab-call"  onclick="window.recorderModule._act('${pos}','call',${callAmt})">CALL ${callDisp.toLocaleString()}${stack < toCall ? ' ⚡' : ''}</button>`;

    const hasOpened = rec.streets[rec.currentStreet].some(e => e.a === 'raise' || e.a === 'bet' || e.a === 'reraise');
    const raiseLabel = !hasOpened && rec.currentBet === 0 ? 'BET'
                     : !hasOpened && rec.currentBet > 0   ? 'RAISE'
                     : 'RE-RAISE';

    const nameHtml = name
        ? `${isHero ? '● ' : ''}<span class="rec-actor-pos">${pos}</span> ${name}${isHero ? ' <span class="rec-hero-tag">คุณ</span>' : ''}`
        : `${isHero ? '● ' : ''}<span class="rec-actor-pos">${pos}</span>${isHero ? ' <span class="rec-hero-tag">คุณ</span>' : ''}`;

    el.innerHTML = `
        <div class="rec-actor-header">
            <div class="rec-actor-who${isHero ? ' rec-actor-hero' : ''}">${nameHtml} <span class="rec-actor-stack-inline">Stack ${stack.toLocaleString()} ฿</span></div>
        </div>
        ${toCall > 0 ? `<div class="rec-to-call">ต้อง call เพิ่ม ${callDisp.toLocaleString()} ฿${stack < toCall ? ' ⚡ all-in' : ` (รวม ${rec.currentBet.toLocaleString()} ฿)`}</div>` : ''}
        <div class="rec-act-row">
            <button class="rec-ab rec-ab-fold"  onclick="window.recorderModule._act('${pos}','fold',0)">FOLD</button>
            ${callHtml}
            ${stack > 0 ? `<button class="rec-ab rec-ab-raise" onclick="window.recorderModule._doRaise('${pos}')">${raiseLabel}</button>` : ''}
        </div>
        ${stack > 0 ? `<div class="rec-amount-row">
            <span class="rec-amt-lbl">${raiseLabel.toLowerCase()}</span>
            <button class="rec-qb rec-bb-btn" onclick="(function(el){el.value=Math.max((parseFloat(el.value)||0)-${cfg.bb||20},${minRaise});})(document.getElementById('rec-raise-amt'))">−</button>
            <input class="rec-amt-in" id="rec-raise-amt" type="number" value="${minRaise}" min="${minRaise}" max="${maxRaise}" step="10">
            <button class="rec-qb rec-bb-btn" onclick="(function(el){el.value=Math.min((parseFloat(el.value)||0)+${cfg.bb||20},${maxRaise});})(document.getElementById('rec-raise-amt'))">+</button>
            <span class="rec-amt-lbl">฿</span>
            <div class="rec-quick-btns">
                <button class="rec-qb" onclick="document.getElementById('rec-raise-amt').value=${minRaise}">Min</button>
                <button class="rec-qb" onclick="document.getElementById('rec-raise-amt').value=${thirdPot}">⅓P</button>
                <button class="rec-qb" onclick="document.getElementById('rec-raise-amt').value=${halfPot}">½P</button>
                <button class="rec-qb" onclick="document.getElementById('rec-raise-amt').value=${threeQPot}">¾P</button>
                <button class="rec-qb" onclick="document.getElementById('rec-raise-amt').value=${fullPot}">Pot</button>
                <button class="rec-qb" onclick="document.getElementById('rec-raise-amt').value=${maxRaise}">All-in</button>
            </div>
        </div>` : ''}`;
}

function _markWinners() {
    const evalFn = window.evaluatePokerHand;
    const cmpFn  = window._cmpScore;
    if (!rec || !cfg || !evalFn || !cmpFn || rec.playersInHand.length < 2) return;

    const heroIdx = getHeroIdx();
    const board = [
        ...(window.state?.sel?.flop  || []),
        ...(window.state?.sel?.turn  || []),
        ...(window.state?.sel?.river || []),
    ];
    if (board.length < 3) return;

    const entries = rec.playersInHand.map(pos => {
        const pIdx = cfg.players.findIndex(pl => pl.pos === pos);
        const p    = cfg.players[pIdx];
        const cardsStr = (pIdx === heroIdx)
            ? (window.state?.sel?.hand?.join('') || '')
            : (p?.cards || '');
        const cards = parseCards(cardsStr);
        if (cards.length < 2) return null;
        const result = evalFn(cards, board);
        return result ? { pos, score: result.score } : null;
    }).filter(Boolean);

    if (entries.length < 2) return;

    let best = entries[0].score;
    for (const e of entries) { if (cmpFn(e.score, best) > 0) best = e.score; }
    const winners = new Set(entries.filter(e => cmpFn(e.score, best) === 0).map(e => e.pos));

    const feed = document.getElementById(`rec-feed-${rec.currentStreet}`);
    if (!feed) return;
    feed.querySelectorAll('.rec-feed-row').forEach(row => {
        const posEl = row.querySelector('.rec-fr-pos');
        if (!posEl || !winners.has(posEl.textContent.trim())) return;
        const cardsEl = row.querySelector('.rec-fr-cards');
        if (!cardsEl || cardsEl.querySelector('.w-badge')) return;
        const badge = document.createElement('span');
        badge.className = 'w-badge';
        badge.title = 'ผู้ชนะ';
        badge.textContent = 'W';
        cardsEl.appendChild(badge);
    });
}

function showStreetComplete() {
    const actorEl = document.getElementById('rec-actor-block');
    if (actorEl) actorEl.innerHTML = '';
    updateStreetActorLabel();

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
        if (rec.playersInHand.length > 1) _markWinners();
    }
}

// ── Public action handlers ────────────────────────────────────────────────────
function _act(pos, action, amount) {
    if (!rec) return;
    recordAction(pos, action, Number(amount) || 0);
}

function _doRaise(pos) {
    if (!rec) return;
    let amt = parseFloat(document.getElementById('rec-raise-amt')?.value) || 0;
    if (amt <= 0) { toast('กรุณาใส่จำนวนเงิน', 'error'); return; }
    const alreadyIn = rec.potContrib[pos] || 0;
    const stack     = Math.round(rec.stackByPos[pos] || 0);
    amt = Math.min(amt, alreadyIn + stack); // clamp to total all-in
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

    pushUndoState();
    initStreet(street);
    updateStreetCards(street);
    updatePotBar();

    // Refresh board cards for new street (cards may have been selected since panel rendered)
    const boardEl = document.getElementById(`rec-sc-board-${street}`);
    if (boardEl) boardEl.innerHTML = boardCardsHTML(street);

    // Guard: if only 1 player remains, don't start the street — go to save
    if (rec.playersInHand.length <= 1) {
        showStreetComplete();
        return;
    }
    renderActorBlock();
    updateStreetActorLabel();
}

// ── Save to Sheet (column X = r[23]) ─────────────────────────────────────────
function buildJson() {
    if (!rec || !cfg) return null;
    const heroIdx = getHeroIdx();
    const boards = {
        flop:  [...(window.state?.sel?.flop  || [])],
        turn:  [...(window.state?.sel?.turn  || [])],
        river: [...(window.state?.sel?.river || [])],
    };
    // Hero's cards come from HAND field, not from p.cards
    const players = cfg.players.map((p, i) =>
        i === heroIdx ? { ...p, cards: (window.state?.sel?.hand || []).join('') } : p
    );
    return JSON.stringify({ players, actions: rec.streets, sb: cfg.sb, bb: cfg.bb, boards, showdown: rec.playersInHand });
}

function _getShowdownCards() {
    if (!rec || !cfg) return [];
    const heroIdx = getHeroIdx();
    const heroPos = heroIdx >= 0 ? cfg.players[heroIdx].pos : null;
    return rec.playersInHand
        .filter(pos => pos !== heroPos)
        .map(pos => {
            const p = cfg.players.find(pl => pl.pos === pos);
            return { pos, cards: parseCards(p?.cards || '') };
        })
        .filter(item => item.cards.length >= 2);
}

function _isRecording() { return rec !== null; }

async function _saveLog() {
    const json = buildJson();
    if (!json) return;

    const spreadsheetId = window.state?.spreadsheetId;
    if (!spreadsheetId || !window.gapi?.client?.sheets) {
        toast('ไม่พบ spreadsheet', 'error'); return;
    }

    const isEdit = rec.editMode && rec.editHistIdx !== undefined;
    let rowIdx, sheetRow;
    if (isEdit) {
        rowIdx   = rec.editHistIdx;
        sheetRow = rowIdx + 2;
    } else {
        const histLen = window.state?.history?.length || 0;
        if (histLen === 0) { toast('ยังไม่มีมือที่บันทึก', 'error'); return; }
        rowIdx   = histLen - 1;
        sheetRow = histLen + 1;
    }

    const btn = document.getElementById('rec-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }

    try {
        await gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId,
            range: `${SHEET_TAB}!X${sheetRow}`,
            valueInputOption: 'RAW',
            resource: { values: [[json]] },
        });
        if (window.state?.history?.[rowIdx]) window.state.history[rowIdx][23] = json;
        toast(isEdit ? '✓ อัปเดต Action Log แล้ว' : '✓ บันทึก Action Log แล้ว');
        if (btn) { btn.textContent = '✓ บันทึกแล้ว'; }
        rec = null;
        _setPosLock(false);
        const panelEl  = document.getElementById('recorder-panel');
        const startBtn = document.getElementById('rec-start-btn');
        if (panelEl)  panelEl.style.display = 'none';
        if (startBtn) startBtn.style.display = '';
        if (!isEdit && cfg?.autoRotate) setTimeout(_rotatePositions, 300);
    } catch (err) {
        console.error('recorder save:', err);
        toast('บันทึกไม่สำเร็จ', 'error');
        if (btn) { btn.disabled = false; btn.textContent = '💾 Save Action Log'; }
    }
}

// ── Edit-mode: load a saved action log back into the panel ───────────────────
function _loadLogForEdit(jsonStr, histIdx) {
    if (!jsonStr) return;
    let data;
    try { data = JSON.parse(jsonStr); } catch(e) { return; }
    if (!data.actions) return;

    // Bootstrap cfg from JSON snapshot when no config exists yet
    if (!cfg) {
        if (!Array.isArray(data.players) || data.players.length === 0) return;
        cfg = { players: [], sb: data.sb || 10, bb: data.bb || 20, heroName: '', autoRotate: false };
    }

    // Restore player snapshot so feed rows show correct names/isHero
    if (Array.isArray(data.players) && data.players.length > 0) {
        cfg.players = data.players.map(p => ({ ...p }));
    }
    if (data.sb !== undefined) cfg.sb = data.sb;
    if (data.bb !== undefined) cfg.bb = data.bb;

    const lastStreet = [...STREET_SEQ].reverse().find(s => (data.actions[s]?.length > 0)) || 'preflop';

    rec = {
        streets:       Object.assign({ preflop: [], flop: [], turn: [], river: [] },
                                     JSON.parse(JSON.stringify(data.actions))),
        playersInHand: Array.isArray(data.showdown) ? [...data.showdown] : cfg.players.map(p => p.pos),
        stackByPos:    {},
        pot:           0,
        potContrib:    {},
        currentStreet: lastStreet,
        currentBet:    0,
        raisingRound:  0,
        needToAct:     [],
        actionOrder:   [],
        undoStack:     [],
        editMode:      true,
        editHistIdx:   histIdx,
    };
    (data.players || []).forEach(p => { rec.stackByPos[p.pos] = p.stack || 0; });

    // Calculate final pot by replaying per-street contributions
    // v = total commitment of that player in the street (not incremental)
    let computedPot = 0;
    STREET_SEQ.forEach(s => {
        const contrib = {};
        (rec.streets[s] || []).forEach(e => {
            if ((e.v || 0) > 0 && e.a !== 'fold' && e.a !== 'check') {
                const prev = contrib[e.pos] || 0;
                computedPot += e.v - prev;
                contrib[e.pos] = e.v;
            }
        });
    });
    rec.pot = computedPot;

    const panelEl  = document.getElementById('recorder-panel');
    const startBtn = document.getElementById('rec-start-btn');
    if (panelEl)  panelEl.style.display = '';
    if (startBtn) startBtn.style.display = 'none';

    renderPanel();  // builds DOM, renders lastStreet feed (will be cleared below)

    // Re-render ALL street feeds with correct isAgg + divider logic
    STREET_SEQ.forEach(s => {
        const feed = document.getElementById(`rec-feed-${s}`);
        if (!feed) return;
        feed.innerHTML = '';
        const actions = rec.streets[s] || [];
        let rr = 0;
        actions.forEach((entry, idx) => {
            const isAgg = entry.a === 'raise' || entry.a === 'reraise' || entry.a === 'bet';
            appendFeedRow(feed, entry, isAgg);
            if (isAgg) { rr++; if (actions[idx + 1]) appendDividerRow(feed, rr); }
        });
    });

    // Show read-only footer with re-record and update buttons
    const actorEl = document.getElementById('rec-actor-block');
    if (actorEl) actorEl.innerHTML = '';
    const footer = document.getElementById('rec-street-footer');
    if (footer) {
        footer.innerHTML = `
            <div class="rec-street-done">
                <span class="rec-done-lbl">📋 Action Log ของ Hand นี้</span>
                <div style="display:flex;gap:8px;margin-top:6px">
                    <button class="rec-btn-next" onclick="window.recorderModule._rerecordLog()">🔄 บันทึกใหม่</button>
                    <button class="rec-btn-save" id="rec-save-btn" onclick="window.recorderModule._saveLog()">💾 อัปเดต Action Log</button>
                </div>
            </div>`;
    }

    _setPosLock(true);

    // Hide undo in view mode — undoStack is empty; button reappears when _rerecordLog re-renders
    document.querySelectorAll('.rec-undo-btn').forEach(b => {
        if (b.textContent.includes('ย้อน')) b.style.display = 'none';
    });

    if (panelEl) panelEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function _rerecordLog() {
    if (!rec?.editMode || !cfg) return;
    const editMode    = true;
    const editHistIdx = rec.editHistIdx;

    rec = {
        streets:       { preflop: [], flop: [], turn: [], river: [] },
        playersInHand: cfg.players.map(p => p.pos),
        stackByPos:    {},
        pot:           0,
        currentStreet: null,
        undoStack:     [],
        editMode,
        editHistIdx,
    };
    cfg.players.forEach(p => { rec.stackByPos[p.pos] = p.stack || 0; });

    initStreet('preflop');
    renderPanel();
}

// ── Render Action Log for Hand Detail Modal ───────────────────────────────────
function renderActionLog(jsonStr, heroCardsStr) {
    // Render a card string as mini-cards or coloured text per settings.
    // Pass hidden=true for Hero cards when hideHand is on.
    function _actionLogCardHtml(cardsStr, hidden = false, maxCards = 2) {
        const cards = parseCards(cardsStr, maxCards);
        if (!cards.length && !hidden) return '';
        if (hidden) return _hiddenCardsHTML(cards.length || 2);
        const useCards = !window.state?.settings?.textCards;
        const smCls    = window.state?.settings?.cardSmall ? ' mini-card-sm' : '';
        return cards.map(c => {
            const rank = c[0], suit = c[1];
            if (useCards) {
                const cls = typeof suitCvClass === 'function' ? suitCvClass(suit) : (suit==='h'||suit==='d' ? 'cv-red' : 'cv-black');
                return `<span class="mini-card${smCls}"><span class="mc-rank ${cls}">${rank}</span><span class="mc-suit ${cls}">${_SUIT_SYM[suit]}</span></span>`;
            }
            const col = typeof suitInlineCol === 'function' ? suitInlineCol(suit) : (suit==='h'||suit==='d' ? '#f87171' : '#e2e8f0');
            return `<span style="color:${col}">${rank}${_SUIT_SYM[suit]}</span>`;
        }).join(useCards ? '' : ' ');
    }

    try {
        const data = JSON.parse(jsonStr);
        if (!data?.actions) return '';

        _lastLogJson   = jsonStr;
        _lastHeroCards = heroCardsStr;

        const heroPos  = data.players?.find(p => p.isHero)?.pos || '';
        const boards   = data.boards || {};
        let runningPot = 0;
        let hasAny     = false;
        let colsHtml   = '';

        // Determine winner positions for W badge
        const showdownPositions = data.showdown || [];
        let winners = new Set();
        if (showdownPositions.length === 1) {
            winners.add(showdownPositions[0]);
        } else if (showdownPositions.length >= 2) {
            const evalFn = window.evaluatePokerHand;
            const cmpFn  = window._cmpScore;
            if (evalFn && cmpFn) {
                const boardCards = [
                    ...(boards.flop  || []),
                    ...(boards.turn  || []),
                    ...(boards.river || []),
                ];
                if (boardCards.length >= 3) {
                    const entries = showdownPositions.map(pos => {
                        const pd = data.players?.find(p => p.pos === pos);
                        const cardsStr = (pos === heroPos)
                            ? (pd?.cards || heroCardsStr || '')
                            : (pd?.cards || '');
                        const cards = parseCards(cardsStr);
                        if (cards.length < 2) return null;
                        const result = evalFn(cards, boardCards);
                        return result ? { pos, score: result.score } : null;
                    }).filter(Boolean);
                    if (entries.length >= 1) {
                        let best = entries[0].score;
                        for (const e of entries) { if (cmpFn(e.score, best) > 0) best = e.score; }
                        entries.filter(e => cmpFn(e.score, best) === 0).forEach(e => winners.add(e.pos));
                    }
                }
            }
        }

        // Detect last-player-standing: when no showdown, the one player who never folded wins
        if (winners.size === 0) {
            const allPlayerPos = (data.players || []).map(p => p.pos);
            const foldedPos    = new Set();
            STREET_SEQ.forEach(s => {
                (data.actions[s] || []).forEach(e => { if (e.a === 'fold') foldedPos.add(e.pos); });
            });
            const remaining = allPlayerPos.filter(pos => !foldedPos.has(pos));
            if (remaining.length === 1) winners.add(remaining[0]);
        }

        // Track each player's last-action street so W badge lands on that row
        const lastActStreet = {};
        STREET_SEQ.forEach(s => {
            (data.actions[s] || []).forEach(e => { lastActStreet[e.pos] = s; });
        });

        // Last street with actions (still needed for all-in showdown detection below)
        const lastStreetWithActs = [...STREET_SEQ].reverse().find(s => data.actions[s]?.length > 0);

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

                // Board cards in column header — always emit div for fixed height alignment
                const streetBoard = boards[street] || [];
                const boardHtml   = `<div class="rec-log-col-board">${
                    streetBoard.length ? _actionLogCardHtml(streetBoard.join(''), false, 5) : ''
                }</div>`;

                let rows = '';
                acts.forEach(e => {
                    const isAgg        = e.a === 'raise' || e.a === 'reraise' || e.a === 'bet';
                    const cls          = e.a === 'fold'  ? 'rec-log-fold'
                                      : e.a === 'check' ? 'rec-log-check'
                                      : e.a === 'post'  ? 'rec-log-post'
                                      : isAgg           ? 'rec-log-raise'
                                      : 'rec-log-call';
                    const lbl          = e.a === 'reraise' ? `re↑${e.v ? Number(e.v).toLocaleString() : ''}`
                                      : e.v ? `${e.a} ${Number(e.v).toLocaleString()}` : e.a;
                    const heroRow      = heroPos && e.pos === heroPos ? ' rec-log-row-hero' : '';
                    const playerInData = data.players?.find(p => p.pos === e.pos);
                    const wBadge       = (winners.has(e.pos) && lastActStreet[e.pos] === street)
                                      ? '<span class="w-badge" title="ผู้ชนะ">W</span>' : '';
                    // Always emit .rec-log-hc span to keep grid column occupied even when empty
                    const isHero       = heroPos && e.pos === heroPos;
                    const shouldHide   = isHero ? !!window.state?.hideHand : _hideVillainCards;
                    const hcHtml       = `<span class="rec-log-hc">${
                        playerInData?.cards ? _actionLogCardHtml(playerInData.cards, shouldHide) : ''
                    }${wBadge}</span>`;
                    const nameHtml = playerInData?.name
                        ? `<span class="rec-log-name"> ${playerInData.name}</span>` : '';
                    rows += `
                        <div class="rec-log-row${heroRow}">
                            <span class="rec-log-pos">${e.pos}${nameHtml}</span>
                            ${hcHtml}
                            <span class="rec-log-act ${cls}">${lbl}</span>
                        </div>`;
                });

                colsHtml += `
                    <div class="rec-log-col rec-log-col-${street}">
                        <div class="rec-log-col-hd">
                            <span>${STREET_LBL[street]}</span>
                            ${boardHtml}
                        </div>
                        <div class="rec-log-col-body">${rows}</div>
                        <div class="rec-log-col-pot">Pot ${runningPot.toLocaleString()} ฿</div>
                    </div>`;
            } else {
                // Detect all-in showdown: board cards dealt here, showdown players exist,
                // and no later street has actions
                const streetIdx    = STREET_SEQ.indexOf(street);
                const hasLaterActs = STREET_SEQ.slice(streetIdx + 1).some(s => data.actions[s]?.length > 0);
                const boardHere    = (boards[street] || []).length > 0;
                const isShowdown   = showdownPositions.length > 0 && boardHere && !hasLaterActs;

                if (isShowdown) {
                    hasAny = true;
                    const streetBoard = boards[street] || [];
                    const boardHtml   = `<div class="rec-log-col-board">${_actionLogCardHtml(streetBoard.join(''), false, 5)}</div>`;
                    let rows = '';
                    showdownPositions.forEach(pos => {
                        const pd      = data.players?.find(p => p.pos === pos);
                        const isHero  = pos === heroPos;
                        const heroRow = isHero ? ' rec-log-row-hero' : '';
                        const wBadge  = winners.has(pos) ? '<span class="w-badge" title="ผู้ชนะ">W</span>' : '';
                        const nameLbl = pd?.name ? `<span class="rec-log-name"> ${pd.name}</span>` : '';
                        const cards      = isHero ? (pd?.cards || heroCardsStr || '') : (pd?.cards || '');
                        const shouldHide = isHero ? !!window.state?.hideHand : _hideVillainCards;
                        const hcHtml     = `<span class="rec-log-hc">${cards ? _actionLogCardHtml(cards, shouldHide) : ''}${wBadge}</span>`;
                        rows += `
                            <div class="rec-log-row${heroRow}">
                                <span class="rec-log-pos">${pos}${nameLbl}</span>
                                ${hcHtml}
                                <span class="rec-log-act rec-log-allin">all-in ⚡</span>
                            </div>`;
                    });
                    colsHtml += `
                        <div class="rec-log-col rec-log-col-${street}">
                            <div class="rec-log-col-hd">
                                <span>${STREET_LBL[street]}</span>
                                ${boardHtml}
                            </div>
                            <div class="rec-log-col-body">${rows}</div>
                            <div class="rec-log-col-pot">Pot ${runningPot.toLocaleString()} ฿</div>
                        </div>`;
                } else {
                    colsHtml += `
                        <div class="rec-log-col rec-log-col-${street} rec-log-col-empty">
                            <div class="rec-log-col-hd">
                                <span>${STREET_LBL[street]}</span>
                                <div class="rec-log-col-board"></div>
                            </div>
                            <div class="rec-log-col-body"></div>
                        </div>`;
                }
            }
        });

        if (!hasAny) return '';

        const hero     = data.players?.find(p => p.isHero);
        const heroDisp = hero ? (hero.name ? `${hero.name} (${heroPos})` : heroPos) : '';
        const heroLine = heroDisp ? `<span class="rec-log-hero-tag">Hero: <b>${heroDisp}</b></span>` : '';

        const hasVillainCards = (data.players || []).some(p => !p.isHero && p.cards);
        const hideBtn = hasVillainCards
            ? `<button class="rec-hide-villains-btn${_hideVillainCards ? ' active' : ''}" onclick="window.recorderModule._toggleHideVillains()">${_hideVillainCards ? '🙈' : '👁'} ไพ่คู่แข่ง</button>`
            : '';

        return `
            <div class="rec-modal-log">
                <div class="rec-modal-log-title">ACTION LOG ${heroLine}${hideBtn}</div>
                <div class="rec-log-grid">${colsHtml}</div>
            </div>`;
    } catch (_) { return ''; }
}

function _toggleHideVillains() {
    _hideVillainCards = !_hideVillainCards;
    if (!_lastLogJson) return;
    const html = renderActionLog(_lastLogJson, _lastHeroCards);
    const old  = document.querySelector('.rec-modal-log');
    if (old && html) old.outerHTML = html;
}

// ── Setup toggle (from panel gear button) ────────────────────────────────────
function _toggleSetup() {
    const el = document.getElementById('recorder-setup');
    if (!el) return;
    el.style.display = el.style.display === 'none' ? '' : 'none';
}

// Called by app.js after HAND field changes — updates the hero's card slot in the setup table
function _updateHeroSlot() {
    if (!cfg?.players) return;
    const heroIdx = getHeroIdx();
    if (heroIdx < 0) return;
    const el = document.querySelector(`.rec-cards-slot[data-i="${heroIdx}"]`);
    if (el) el.innerHTML = renderCardSlotHTML(window.state?.sel?.hand?.join('') || '', true);
    _updateFeedCards(heroIdx);
}

// Called by app.js after FLOP/TURN/RIVER cards change — updates board cards in the recorder panel
function _updateBoardCards(field) {
    const el = document.getElementById(`rec-sc-board-${field}`);
    if (el) el.innerHTML = boardCardsHTML(field);
}

function _refreshBoardCards() {
    ['flop','turn','river'].forEach(s => _updateBoardCards(s));
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

    document.getElementById('rec-start-btn')?.addEventListener('click', () => {
        saveConfig(collectConfig());
        if (!cfg?.players || cfg.players.length < 2) { toast('กรุณาตั้งค่าผู้เล่นก่อน', 'error'); return; }
        if (!cfg.players.some(p => p.isHero)) { toast('กรุณากดเลือกตำแหน่ง Hero ก่อนเริ่มบันทึก', 'error'); return; }
        startRecording();
    });

    document.getElementById('pos-rotate-btn')?.addEventListener('click', () => {
        // Unlike the setup-panel button, this one is reachable before cfg exists at
        // all (user never opened detailed setup) — seed a default table first.
        if (!cfg) cfg = { players: buildDefaultPlayers(6), sb: 10, bb: 20, heroName: 'Hero', autoRotate: false };
        cfg.autoRotate = !cfg.autoRotate;
        saveConfig(cfg);
    });

    document.addEventListener('click', e => {
        if (!_blindsPopOpen) return;
        if (e.target.closest('.rec-blinds-wrap')) return;
        _blindsPopOpen = false;
        document.getElementById('rec-blinds-pop')?.classList.remove('open');
    });

    applyToggle();
}

function _moveHero(dir) {
    if (!cfg?.players?.length) return;
    const heroIdx = cfg.players.findIndex(p => p.isHero);
    if (heroIdx < 0) return;

    // Rotate every seat's name/stack/cards by one step (not just a 2-person
    // swap) so the whole lineup shifts consistently — same identity, new seat.
    const rotate = arr => {
        const out = arr.slice();
        if (dir < 0) out.push(out.shift());
        else         out.unshift(out.pop());
        return out;
    };
    const names  = rotate(cfg.players.map(p => p.name || ''));
    const stacks = rotate(cfg.players.map(p => p.stack));
    const cards  = rotate(cfg.players.map(p => p.cards || ''));

    const heroName = cfg.heroName || 'Hero';
    cfg.players.forEach((p, i) => {
        p.name   = names[i];
        p.stack  = stacks[i];
        p.cards  = cards[i];
        p.isHero = (p.name === heroName);
    });

    // Sync pos-chip selection to the new Hero's position
    const newHeroPos = cfg.players.find(p => p.isHero)?.pos;
    if (newHeroPos) {
        document.querySelectorAll('#position-chips .pos-chip').forEach(btn => {
            btn.classList.toggle('selected', btn.dataset.pos === newHeroPos);
        });
    }

    saveConfig(cfg);
    renderSetup();
}

function _getLogForHand(histIdx) {
    if (!rec?.editMode || rec.editHistIdx !== histIdx) return null;
    return buildJson();
}

function _heroFolded() {
    if (!rec || !cfg) return false;
    const hero = cfg.players.find(p => p.isHero);
    return hero ? !rec.playersInHand.includes(hero.pos) : false;
}

// Which field key (hand/flop/turn/river — app.js's vocabulary, not "preflop") Hero
// actually folded on, per the detailed action log. Null if Hero hasn't folded.
const REC_STREET_TO_FIELD = { preflop: 'hand', flop: 'flop', turn: 'turn', river: 'river' };
function _heroFoldStreet() {
    if (!rec || !cfg) return null;
    const hero = cfg.players.find(p => p.isHero);
    if (!hero) return null;
    for (const street of STREET_SEQ) {
        if (rec.streets[street]?.some(e => e.pos === hero.pos && e.a === 'fold')) {
            return REC_STREET_TO_FIELD[street] || null;
        }
    }
    return null;
}

function _isAutoRotateOn() { return !!cfg?.autoRotate; }

window.recorderModule = { init, renderActionLog, _act, _doRaise, _nextStreet, _saveLog, _undo, _cancelHand, _toggleSetup, _interceptCard, _deactivatePlayerPicker, _addRecorderUsedCards, _refreshAllCardSlots, _refreshAllFeedCards, _refreshBoardCards, _overrideCardGrid, _updateHeroSlot, _updateBoardCards, _getShowdownCards, _isRecording, _loadLogForEdit, _rerecordLog, _getLogForHand, _heroFolded, _heroFoldStreet, _moveHero, _toggleHideVillains, _rotatePositions, _isAutoRotateOn, _clearPlayerCards };
document.addEventListener('DOMContentLoaded', init);

})();
