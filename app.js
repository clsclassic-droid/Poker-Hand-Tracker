// ─── Constants ──────────────────────────────────────────────────────────────
const RANKS = ['A','2','3','4','5','6','7','8','9','T','J','Q','K'];
const SUITS = [
    { symbol: '♠', code: 's', red: false },
    { symbol: '♥', code: 'h', red: true  },
    { symbol: '♦', code: 'd', red: true  },
    { symbol: '♣', code: 'c', red: false },
];
const SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED_SUITS = new Set(['h', 'd']);

const FIELD_CFG = {
    hand:  { label: 'HAND',  max: 2 },
    flop:  { label: 'FLOP',  max: 3 },
    turn:  { label: 'TURN',  max: 1 },
    river: { label: 'RIVER', max: 1 },
    sd1:   { label: 'SD1',   max: 2 },
    sd2:   { label: 'SD2',   max: 2 },
};
const FIELDS = ['hand', 'flop', 'turn', 'river', 'sd1', 'sd2'];

// Sheet column layout (A-N):
// A:No. B:Hand C:Flop D:Turn E:River F:SD1 G:SD2
// H:Position I:Hand Note J:Flop Note K:Turn Note L:River Note M:SD1 Note N:SD2 Note
const SHEET_TAB    = 'Hands';
const HEADER_ROW   = ['No.','Hand','Flop','Turn','River','SD1','SD2','Position','Hand Note','Flop Note','Turn Note','River Note','SD1 Note','SD2 Note'];
const NEW_HEADERS  = ['Position','Hand Note','Flop Note','Turn Note','River Note','SD1 Note','SD2 Note'];
const FOLDER_NAME  = 'Poker Hand Tracker';
const SHEET_NAME   = 'Poker Hand Tracker';
const LS_SHEET_KEY = 'pht_sheet_id';

const DISCOVERY_DOCS = [
    'https://sheets.googleapis.com/$discovery/rest?version=v4',
    'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
];
const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive';

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
    gapiReady:     false,
    gisReady:      false,
    tokenClient:   null,
    authorized:    false,
    spreadsheetId: null,
    handNumber:    1,
    activeField:   'hand',
    sel:           { hand:[], flop:[], turn:[], river:[], sd1:[], sd2:[] },
    comments:      { hand:'',  flop:'',  turn:'',  river:'',  sd1:'',  sd2:'' },
    usedCards:     new Set(),
    history:       [],
    hideHand:      false,
    showComment:   false,
};

// ─── GAPI / GIS init ─────────────────────────────────────────────────────────
function gapiLoaded() {
    gapi.load('client', async () => {
        try {
            await gapi.client.init({ apiKey: CONFIG.API_KEY, discoveryDocs: DISCOVERY_DOCS });
        } catch (e) { console.error('gapi init error', e); }
        state.gapiReady = true;
        checkBothReady();
    });
}

function gisLoaded() {
    state.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CONFIG.CLIENT_ID,
        scope:     SCOPES,
        callback:  onTokenResponse,
    });
    state.gisReady = true;
    checkBothReady();
}

function checkBothReady() {
    if (state.gapiReady && state.gisReady) {
        document.getElementById('auth-btn').disabled = false;
    }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
document.getElementById('auth-btn').addEventListener('click', () => {
    const hasToken = gapi.client.getToken() !== null;
    state.tokenClient.requestAccessToken({ prompt: hasToken ? '' : 'consent' });
});

document.getElementById('signout-btn').addEventListener('click', () => {
    const token = gapi.client.getToken();
    if (token) google.accounts.oauth2.revoke(token.access_token, () => {});
    gapi.client.setToken(null);
    state.authorized = false;
    document.getElementById('auth-btn').style.display = '';
    document.getElementById('user-display').classList.remove('visible');
    document.getElementById('main-content').classList.remove('visible');
    localStorage.removeItem(LS_SHEET_KEY);
});

async function onTokenResponse(resp) {
    if (resp.error) { showToast('เข้าสู่ระบบล้มเหลว: ' + resp.error, 'error'); return; }

    state.authorized = true;
    document.getElementById('auth-btn').style.display = 'none';
    document.getElementById('user-display').classList.add('visible');

    try {
        const token = gapi.client.getToken().access_token;
        const info  = await fetch('https://www.googleapis.com/oauth2/v3/userinfo',
            { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json());
        document.getElementById('user-name').textContent = info.name || info.email || '';
    } catch (_) {}

    await initSpreadsheet();
}

// ─── Spreadsheet Setup ────────────────────────────────────────────────────────
async function initSpreadsheet() {
    showOverlay('กำลังค้นหา Google Sheet ...');
    try {
        let id = localStorage.getItem(LS_SHEET_KEY);
        if (id) {
            try { await gapi.client.sheets.spreadsheets.get({ spreadsheetId: id }); }
            catch (_) { id = null; localStorage.removeItem(LS_SHEET_KEY); }
        }
        if (!id) id = await findOrCreate();
        state.spreadsheetId = id;
        localStorage.setItem(LS_SHEET_KEY, id);

        // Ensure new columns H-N have headers (safe to call on existing sheets)
        await ensureNewHeaders(id);

        const link = document.getElementById('sheet-link');
        link.href = `https://docs.google.com/spreadsheets/d/${id}`;
        link.classList.add('visible');

        await loadHistory();
        calcHandNumber();
        hideOverlay();
        document.getElementById('main-content').classList.add('visible');
    } catch (e) {
        hideOverlay();
        showToast('เกิดข้อผิดพลาด: ' + (e.result?.error?.message || e.message || e), 'error');
        console.error(e);
    }
}

async function ensureNewHeaders(id) {
    try {
        await gapi.client.sheets.spreadsheets.values.update({
            spreadsheetId: id,
            range: `${SHEET_TAB}!H1:N1`,
            valueInputOption: 'RAW',
            resource: { values: [NEW_HEADERS] },
        });
    } catch (_) {}
}

async function findOrCreate() {
    setOverlayMsg('ค้นหาโฟลเดอร์ "' + FOLDER_NAME + '" ...');
    let folderId = null;
    try {
        const res = await gapi.client.drive.files.list({
            q: `name='${FOLDER_NAME}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
            fields: 'files(id)', spaces: 'drive',
        });
        if (res.result.files?.length) folderId = res.result.files[0].id;
    } catch (_) {}

    if (folderId) {
        setOverlayMsg('ค้นหา spreadsheet ในโฟลเดอร์ ...');
        try {
            const res = await gapi.client.drive.files.list({
                q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
                fields: 'files(id,name)', orderBy: 'modifiedTime desc',
            });
            if (res.result.files?.length) return res.result.files[0].id;
        } catch (_) {}
    }

    setOverlayMsg('สร้าง spreadsheet ใหม่ ...');
    const created = await gapi.client.sheets.spreadsheets.create({
        properties: { title: SHEET_NAME },
        sheets: [{ properties: { title: SHEET_TAB } }],
    });
    const newId = created.result.spreadsheetId;

    if (folderId) {
        try {
            await gapi.client.drive.files.update({
                fileId: newId, addParents: folderId, removeParents: 'root', fields: 'id,parents',
            });
        } catch (_) {}
    }

    await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: newId,
        range: `${SHEET_TAB}!A1:N1`,
        valueInputOption: 'RAW',
        resource: { values: [HEADER_ROW] },
    });

    return newId;
}

// ─── History ──────────────────────────────────────────────────────────────────
async function loadHistory() {
    const res = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: state.spreadsheetId,
        range: `${SHEET_TAB}!A2:N`,
    });
    state.history = res.result.values || [];
    renderHistory();
}

function calcHandNumber() {
    let max = 0;
    for (const row of state.history) {
        const n = parseInt(row[0], 10);
        if (!isNaN(n) && n > max) max = n;
    }
    state.handNumber = max + 1;
    document.getElementById('hand-num-display').textContent = state.handNumber;
}

function renderHistory() {
    const tbody = document.getElementById('history-body');
    tbody.innerHTML = '';
    const rows = [...state.history].reverse().slice(0, 25);

    for (const r of rows) {
        const no    = r[0] || '';
        const hand  = r[1] || '';
        const flop  = r[2] || '';
        const turn  = r[3] || '';
        const river = r[4] || '';
        const sd1   = r[5] || '';
        const sd2   = r[6] || '';
        const pos   = r[7] || '';

        const noteItems = [
            { label: 'HAND',  text: r[8]  || '' },
            { label: 'FLOP',  text: r[9]  || '' },
            { label: 'TURN',  text: r[10] || '' },
            { label: 'RIVER', text: r[11] || '' },
            { label: 'SD1',   text: r[12] || '' },
            { label: 'SD2',   text: r[13] || '' },
        ].filter(n => n.text);
        const hasNotes = noteItems.length > 0;

        const handDisplay = state.hideHand
            ? '<span class="hand-hidden" style="filter:blur(4px)">●●</span>'
            : cardHtml(hand);

        const tr = document.createElement('tr');
        tr.className = 'history-row clickable-row';
        tr.innerHTML = `
            <td>${no || '<span class="cv-empty">—</span>'}</td>
            <td>${pos ? `<span class="pos-badge">${pos}</span>` : '<span class="cv-empty">—</span>'}</td>
            <td>${handDisplay}</td>
            <td>${cardHtml(flop)}</td>
            <td>${cardHtml(turn)}</td>
            <td>${cardHtml(river)}</td>
            <td>${cardHtml(sd1)}</td>
            <td>${cardHtml(sd2)}${hasNotes ? '<span class="note-dot">💬</span>' : ''}</td>
        `;
        tr.addEventListener('click', () => openHandDetail(r));
        tbody.appendChild(tr);
    }

    const cnt = document.getElementById('history-count');
    cnt.textContent = state.history.length ? `(${state.history.length} hands)` : '';
}

function cardHtml(str) {
    if (!str) return '<span class="cv-empty">—</span>';
    return str.split(' ').filter(Boolean).map(card => {
        const suit = card.slice(-1);
        const rank = card.slice(0, -1);
        const cls  = RED_SUITS.has(suit) ? 'cv-red' : 'cv-black';
        return `<span class="${cls}">${rank}${SUIT_SYM[suit] || suit}</span>`;
    }).join(' ');
}

// ─── Save ─────────────────────────────────────────────────────────────────────
async function saveHand() {
    const { hand, flop, turn, river, sd1, sd2 } = state.sel;
    if (hand.length < 2) {
        showToast('กรุณาเลือกไพ่ HAND ให้ครบ 2 ใบก่อน', 'error');
        setActive('hand');
        return;
    }

    // Flush current comment textarea to state before saving
    syncCommentInput();

    const position = document.getElementById('position-select').value;
    const { comments } = state;

    const row = [
        state.handNumber,
        hand.join(' '),
        flop.join(' '),
        turn.join(' '),
        river.join(' '),
        sd1.join(' '),
        sd2.join(' '),
        position,
        comments.hand,
        comments.flop,
        comments.turn,
        comments.river,
        comments.sd1,
        comments.sd2,
    ];

    const btn = document.getElementById('save-btn');
    btn.disabled = true;
    try {
        await gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId: state.spreadsheetId,
            range: `${SHEET_TAB}!A:N`,
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            resource: { values: [row] },
        });

        showToast(`✓ บันทึก Hand #${state.handNumber} สำเร็จ!`, 'success');
        state.history.push(row);
        renderHistory();
        state.handNumber++;
        document.getElementById('hand-num-display').textContent = state.handNumber;
        clearAll();
    } catch (e) {
        showToast('บันทึกล้มเหลว: ' + (e.result?.error?.message || e.message || e), 'error');
        console.error(e);
    } finally {
        btn.disabled = false;
    }
}

// ─── Card Selection ────────────────────────────────────────────────────────────
function onCardClick(cardId) {
    const f   = state.activeField;
    const cfg = FIELD_CFG[f];
    const sel = state.sel[f];
    const idx = sel.indexOf(cardId);

    if (idx >= 0) {
        sel.splice(idx, 1);
    } else {
        if (state.usedCards.has(cardId)) return;
        if (sel.length >= cfg.max) return;
        sel.push(cardId);
    }

    rebuildUsed();
    refreshFieldDisplay(f);
    refreshPickerHeader();
    refreshCardGrid();

    if (sel.length === cfg.max) {
        const next = FIELDS[FIELDS.indexOf(f) + 1];
        if (next) setTimeout(() => setActive(next), 160);
    }
}

function rebuildUsed() {
    state.usedCards.clear();
    FIELDS.forEach(f => state.sel[f].forEach(c => state.usedCards.add(c)));
}

function setActive(field) {
    syncCommentInput();  // save current field's comment before switching
    state.activeField = field;
    document.querySelectorAll('.field-item').forEach(el => {
        el.classList.toggle('active', el.dataset.field === field);
    });
    refreshPickerHeader();
    refreshCardGrid();
    refreshCommentInput();
}

function undoLast() {
    const f   = state.activeField;
    const sel = state.sel[f];
    if (!sel.length) return;
    sel.pop();
    rebuildUsed();
    refreshFieldDisplay(f);
    refreshPickerHeader();
    refreshCardGrid();
}

function clearField() {
    const f = state.activeField;
    if (!state.sel[f].length) return;
    state.sel[f] = [];
    rebuildUsed();
    refreshFieldDisplay(f);
    refreshPickerHeader();
    refreshCardGrid();
}

function clearAll() {
    FIELDS.forEach(f => { state.sel[f] = []; state.comments[f] = ''; refreshFieldDisplay(f); });
    rebuildUsed();
    document.getElementById('position-select').value = '';
    setActive('hand');
}

// ─── Comment helpers ──────────────────────────────────────────────────────────
function syncCommentInput() {
    const ta = document.getElementById('comment-input');
    if (ta) state.comments[state.activeField] = ta.value;
}

function refreshCommentInput() {
    const f     = state.activeField;
    const label = document.getElementById('comment-label');
    const ta    = document.getElementById('comment-input');
    if (label) label.textContent = '💬 ' + FIELD_CFG[f].label;
    if (ta)    ta.value = state.comments[f];
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function refreshPickerHeader() {
    const f   = state.activeField;
    const cfg = FIELD_CFG[f];
    const cnt = state.sel[f].length;
    document.getElementById('picker-field-name').textContent = cfg.label;
    const badge = document.getElementById('picker-count');
    badge.textContent = `${cnt} / ${cfg.max}`;
    badge.classList.toggle('full', cnt === cfg.max);
}

function refreshFieldDisplay(field) {
    const el   = document.getElementById('fd-' + field);
    const item = document.getElementById('fi-' + field);
    if (!el || !item) return;
    const cfg = FIELD_CFG[field];
    const sel = state.sel[field];

    let html = '';
    for (let i = 0; i < cfg.max; i++) {
        if (i < sel.length) {
            const card = sel[i];
            const suit = card.slice(-1);
            const rank = card.slice(0, -1);
            // Blur hand cards when hideHand is on
            if (field === 'hand' && state.hideHand) {
                html += `<span style="filter:blur(4px);display:inline-block">●</span>`;
            } else {
                const col = RED_SUITS.has(suit) ? '#f87171' : '#e2e8f0';
                html += `<span style="color:${col}">${rank}${SUIT_SYM[suit]}</span>`;
            }
            if (i < cfg.max - 1) html += ' ';
        } else {
            html += '<span style="color:#2d4a6a">—</span>';
            if (i < cfg.max - 1) html += ' ';
        }
    }
    // Show comment indicator dot
    if (state.comments[field]) html += ' <span class="has-note">●</span>';
    el.innerHTML = html;

    item.classList.toggle('complete', sel.length === cfg.max);
    item.classList.toggle('active', field === state.activeField);
}

function refreshCardGrid() {
    const f    = state.activeField;
    const sel  = state.sel[f];
    const full = sel.length >= FIELD_CFG[f].max;

    SUITS.forEach(suit => {
        RANKS.forEach(rank => {
            const id  = rank + suit.code;
            const btn = document.getElementById('cb-' + id);
            if (!btn) return;

            const isSelected      = sel.includes(id);
            const isUsedElsewhere = state.usedCards.has(id) && !isSelected;

            btn.classList.remove('selected', 'used', 'field-full');
            btn.disabled = false;

            if (isSelected) {
                btn.classList.add('selected');
            } else if (isUsedElsewhere) {
                btn.classList.add('used');
                btn.disabled = true;
            } else if (full) {
                btn.classList.add('field-full');
                btn.disabled = true;
            }
        });
    });
}

// ─── Build DOM ────────────────────────────────────────────────────────────────
function buildFieldsBar() {
    const bar = document.getElementById('fields-bar');
    FIELDS.forEach((f, i) => {
        const cfg = FIELD_CFG[f];
        const div = document.createElement('div');
        div.className = 'field-item' + (i === 0 ? ' active' : '');
        div.dataset.field = f;
        div.id = 'fi-' + f;
        div.addEventListener('click', () => setActive(f));

        const slots = Array(cfg.max).fill('<span style="color:#2d4a6a">—</span>').join(' ');
        div.innerHTML = `<div class="field-label">${cfg.label}</div><div class="field-cards" id="fd-${f}">${slots}</div>`;
        bar.appendChild(div);
    });
}

function buildCardGrid() {
    const grid = document.getElementById('card-grid');
    SUITS.forEach(suit => {
        const lbl = document.createElement('div');
        lbl.className = 'suit-label ' + (suit.red ? 'suit-red' : 'suit-black');
        lbl.textContent = suit.symbol;
        grid.appendChild(lbl);

        RANKS.forEach(rank => {
            const id  = rank + suit.code;
            const btn = document.createElement('button');
            btn.id        = 'cb-' + id;
            btn.className = 'card-btn ' + (suit.red ? 'red-card' : 'black-card');
            btn.innerHTML = `<span class="card-rank">${rank}</span><span class="card-suit">${suit.symbol}</span>`;
            btn.addEventListener('click', () => onCardClick(id));
            grid.appendChild(btn);
        });
    });
}

// ─── Overlay helpers ──────────────────────────────────────────────────────────
function showOverlay(msg) {
    document.getElementById('setup-msg').textContent = msg;
    document.getElementById('setup-overlay').classList.add('visible');
}
function setOverlayMsg(msg) { document.getElementById('setup-msg').textContent = msg; }
function hideOverlay()      { document.getElementById('setup-overlay').classList.remove('visible'); }

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className   = 'show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.className = '', 3200);
}

// ─── Hand Detail Modal ────────────────────────────────────────────────────────
function openHandDetail(r) {
    const no  = r[0] || '?';
    const pos = r[7] || '';

    const titleEl = document.getElementById('hand-modal-title');
    titleEl.innerHTML = `Hand #${no}${pos ? ` <span class="hm-pos-badge">${pos}</span>` : ''}`;

    const fields = [
        { label: 'HAND',  cards: r[1] || '', note: r[8]  || '', hideCards: state.hideHand },
        { label: 'FLOP',  cards: r[2] || '', note: r[9]  || '' },
        { label: 'TURN',  cards: r[3] || '', note: r[10] || '' },
        { label: 'RIVER', cards: r[4] || '', note: r[11] || '' },
        { label: 'SD1',   cards: r[5] || '', note: r[12] || '' },
        { label: 'SD2',   cards: r[6] || '', note: r[13] || '' },
    ];

    const body = document.getElementById('hand-modal-body');
    body.innerHTML = fields.map(f => {
        let cardsHtml;
        if (f.hideCards) {
            cardsHtml = '<span style="filter:blur(4px);display:inline-block">●●</span>';
        } else {
            cardsHtml = f.cards ? cardHtml(f.cards) : '<span class="cv-empty">—</span>';
        }
        const noteHtml = f.note ? `<div class="hm-note">${f.note}</div>` : '';
        return `
            <div class="hm-field-row">
                <span class="hm-field-label">${f.label}</span>
                <div class="hm-field-content">
                    <div class="hm-cards">${cardsHtml}</div>
                    ${noteHtml}
                </div>
            </div>`;
    }).join('');

    document.getElementById('hand-modal-overlay').classList.remove('hand-modal-hidden');
}

function closeHandDetail() {
    document.getElementById('hand-modal-overlay').classList.add('hand-modal-hidden');
}

// ─── Hide Hand toggle ─────────────────────────────────────────────────────────
function toggleHideHand() {
    state.hideHand = !state.hideHand;
    const btn = document.getElementById('hide-hand-btn');
    btn.textContent  = state.hideHand ? '🙈 Hand' : '👁 Hand';
    btn.classList.toggle('active', state.hideHand);
    refreshFieldDisplay('hand');
    renderHistory();
}

// ─── Comment area toggle ──────────────────────────────────────────────────────
function toggleCommentArea() {
    state.showComment = !state.showComment;
    const row = document.getElementById('comment-row');
    const btn = document.getElementById('comment-toggle-btn');
    row.classList.toggle('comment-hidden', !state.showComment);
    btn.classList.toggle('active', state.showComment);
    if (state.showComment) {
        document.getElementById('comment-input').focus();
    }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    buildFieldsBar();
    buildCardGrid();
    refreshPickerHeader();
    refreshCommentInput();

    document.getElementById('undo-btn').addEventListener('click', undoLast);
    document.getElementById('clear-field-btn').addEventListener('click', clearField);
    document.getElementById('clear-btn').addEventListener('click', clearAll);
    document.getElementById('save-btn').addEventListener('click', saveHand);
    document.getElementById('hide-hand-btn').addEventListener('click', toggleHideHand);
    document.getElementById('comment-toggle-btn').addEventListener('click', toggleCommentArea);

    document.getElementById('comment-input').addEventListener('input', () => {
        state.comments[state.activeField] = document.getElementById('comment-input').value;
        refreshFieldDisplay(state.activeField);
    });

    document.getElementById('hand-modal-close').addEventListener('click', closeHandDetail);
    document.getElementById('hand-modal-overlay').addEventListener('click', (e) => {
        if (e.target === document.getElementById('hand-modal-overlay')) closeHandDetail();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeHandDetail();
    });
});
