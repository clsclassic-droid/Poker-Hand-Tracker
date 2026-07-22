// ─── Constants ──────────────────────────────────────────────────────────────
const RANKS = ['A','K','Q','J','T','9','8','7','6','5','4','3','2'];
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
const FIELD_COLORS = { hand:'#a78bfa', flop:'#67e8f9', turn:'#fbbf24', river:'#f87171', sd1:'#818cf8', sd2:'#60a5fa' };
const HIT_COLORS   = { hc:'#4a6580', pair:'#94a3b8', '2p':'#94a3b8', trips:'#60a5fa', st:'#34d399', fl:'#34d399', fh:'#fb923c', '4k':'#fbbf24', sf:'#f59e0b' };
const FOLD_LABEL    = { hand: 'PF', flop: 'FLOP', turn: 'TURN', river: 'RIVER' };
const FOLD_TO_FIELD = { PF: 'hand', FLOP: 'flop', TURN: 'turn', RIVER: 'river' };

// ─── Poker Hand Evaluator ─────────────────────────────────────────────────────
const _RV = {A:14,K:13,Q:12,J:11,T:10,'9':9,'8':8,'7':7,'6':6,'5':5,'4':4,'3':3,'2':2};
const _RN = {14:'A',13:'K',12:'Q',11:'J',10:'T',9:'9',8:'8',7:'7',6:'6',5:'5',4:'4',3:'3',2:'2'};

function _combos(arr, k) {
    if (k > arr.length) return [];
    if (k === arr.length) return [arr];
    if (k === 1) return arr.map(x => [x]);
    const res = [];
    for (let i = 0; i <= arr.length - k; i++)
        for (const rest of _combos(arr.slice(i+1), k-1)) res.push([arr[i], ...rest]);
    return res;
}

function _cmpScore(a, b) {
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) {
        const av = a[i] || 0, bv = b[i] || 0;
        if (av !== bv) return av - bv;
    }
    return 0;
}

function _analyzeHand(hand) {
    const vals  = hand.map(c => c.v).sort((a,b) => b-a);
    const suits = hand.map(c => c.s);
    const n     = hand.length;
    const isFlush = n >= 5 && new Set(suits).size === 1;
    let isStraight = false, strHigh = vals[0];
    if (n >= 5) {
        if (vals[0]-vals[4] === 4 && new Set(vals).size === 5) { isStraight = true; }
        else if (vals[0]===14&&vals[1]===5&&vals[2]===4&&vals[3]===3&&vals[4]===2) { isStraight=true; strHigh=5; }
    }
    const cnt = {};
    vals.forEach(v => cnt[v] = (cnt[v]||0)+1);
    const g = Object.entries(cnt).map(([v,c]) => ({v:+v,c})).sort((a,b) => b.c-a.c||b.v-a.v);
    const kickersExcl = usedValues => vals.filter(v => !usedValues.includes(v)).sort((a,b)=>b-a);

    if (isFlush&&isStraight) {
        const tier = strHigh===14&&vals[1]===13 ? 9 : 8;
        return { score:[tier,strHigh], keyValues: new Set(vals) };
    }
    if (g[0].c===4) {
        const k = kickersExcl([g[0].v]);
        return { score:[7,g[0].v,k[0]||0], keyValues: new Set([g[0].v]) };
    }
    if (g[0].c===3&&g[1]?.c===2) return { score:[6,g[0].v,g[1].v], keyValues: new Set([g[0].v,g[1].v]) };
    if (isFlush)    return { score:[5,...vals], keyValues: new Set(vals) };
    if (isStraight) return { score:[4,strHigh], keyValues: new Set(vals) };
    if (g[0].c===3) {
        const k = kickersExcl([g[0].v]);
        return { score:[3,g[0].v,k[0]||0,k[1]||0], keyValues: new Set([g[0].v]) };
    }
    if (g[0].c===2&&g[1]?.c===2) {
        const k = kickersExcl([g[0].v,g[1].v]);
        return { score:[2,g[0].v,g[1].v,k[0]||0], keyValues: new Set([g[0].v,g[1].v]) };
    }
    if (g[0].c===2) {
        const k = kickersExcl([g[0].v]);
        return { score:[1,g[0].v,k[0]||0,k[1]||0,k[2]||0], keyValues: new Set([g[0].v]) };
    }
    return { score:[0,...vals], keyValues: new Set() };
}

function evaluatePokerHand(hole, board) {
    if (hole.length < 2) return null;
    const cards  = [...hole,...board].map((c,i) => ({
        r:c.slice(0,-1), s:c.slice(-1), v:_RV[c.slice(0,-1)],
        origin: i < hole.length ? 'hole' : 'board',
    }));
    const combos = cards.length <= 5 ? [cards] : _combos(cards, 5);
    let best = null, bestHand = null;
    for (const hand of combos) {
        const a = _analyzeHand(hand);
        if (!best || _cmpScore(a.score, best.score) > 0) { best = a; bestHand = hand; }
    }
    if (!best) return null;
    const rn = v => _RN[v]||v;
    const TIERS = [
        [9, ()=>'รอยัลฟลัส',                   'sf'],
        [8, v=>`STF ${rn(v)}`,                  'sf'],
        [7, v=>`โฟร์ ${rn(v)}`,                 '4k'],
        [6, (v,w)=>`ฟูล ${rn(v)}/${rn(w)}`,    'fh'],
        [5, v=>`ฟลัส ${rn(v)}`,                 'fl'],
        [4, v=>`เสตรท ${rn(v)}`,                 'st'],
        [3, v=>`ตอง ${rn(v)}`,                  'trips'],
        [2, (v,w)=>`สองคู่ ${rn(v)}&${rn(w)}`, '2p'],
        [1, v=>`คู่ ${rn(v)}`,                  'pair'],
        [0, v=>`HC ${rn(v)}`,                   'hc'],
    ];
    const t = TIERS.find(t => t[0]===best.score[0]);
    if (!t) return null;

    const fiveCards = bestHand.map(c => ({
        rank: c.r, suit: c.s, origin: c.origin, isKey: best.keyValues.has(c.v),
    }));

    return { name: t[1](best.score[1], best.score[2]), tier: t[2], fiveCards, score: best.score };
}

function fiveCardHtml(hole, board) {
    const result = evaluatePokerHand(hole, board);
    if (!result || !result.fiveCards.length) return '<span class="cv-empty">—</span>';
    const parts = [];
    let lastOrigin = null;
    result.fiveCards.forEach(c => {
        if (lastOrigin === 'hole' && c.origin === 'board') parts.push('<span class="fc-sep">|</span>');
        const cls  = RED_SUITS.has(c.suit) ? 'cv-red' : 'cv-black';
        const text = `${c.rank}${SUIT_SYM[c.suit] || c.suit}`;
        parts.push((c.origin === 'hole' && c.isKey)
            ? `<span class="fc-key ${cls}">${text}</span>`
            : `<span class="${cls}">${text}</span>`);
        lastOrigin = c.origin;
    });
    return parts.join(' ');
}

function getHitTier(text) {
    if (!text) return 'hc';
    if (text.startsWith('รอยัล')||text.startsWith('STF')) return 'sf';
    if (text.startsWith('โฟร์'))   return '4k';
    if (text.startsWith('ฟูล'))    return 'fh';
    if (text.startsWith('ฟลัส'))   return 'fl';
    if (text.startsWith('สตรีท') || text.startsWith('เสตรท')) return 'st';
    if (text.startsWith('ตอง'))    return 'trips';
    if (text.startsWith('สองคู่')) return '2p';
    if (text.startsWith('คู่'))    return 'pair';
    return 'hc';
}

// Sheet column layout (A-Q):
// A:No. B:Hand C:Flop D:Turn E:River F:SD1 G:SD2
// H:Position I:Hand Note J:Flop Note K:Turn Note L:River Note M:SD1 Note N:SD2 Note
// O:HIT P:Fold Q:Result
const SHEET_TAB    = 'Hands';
const HEADER_ROW   = ['No.','Hand','Flop','Turn','River','SD1','SD2','Position','Hand Note','Flop Note','Turn Note','River Note','SD1 Note','SD2 Note','HIT','Fold','Bet PF','Bet Flop','Bet Turn','Bet River','Pot','Result','Date'];
const NEW_HEADERS  = ['Position','Hand Note','Flop Note','Turn Note','River Note','SD1 Note','SD2 Note','HIT','Fold','Bet PF','Bet Flop','Bet Turn','Bet River','Pot','Result','Date'];

const THAI_MONTHS  = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function formatDateThai(iso) {
    if (!iso) return 'ไม่ระบุวันที่';
    const parts = iso.split('-');
    if (parts.length !== 3) return iso;
    const [y, m, d] = parts;
    const label = `${parseInt(d,10)} ${THAI_MONTHS[parseInt(m,10)-1]} ${y}`;
    return iso === todayISO() ? `${label} (วันนี้)` : label;
}
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
    foldStreet:    null,
    sheetId:       0,
    editing:       null,
    expandedDays:  new Set(),
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
            try {
                const meta = await gapi.client.sheets.spreadsheets.get({ spreadsheetId: id });
                state.sheetId = meta.result.sheets?.find(s => s.properties.title === SHEET_TAB)?.properties?.sheetId ?? 0;
            } catch (_) { id = null; localStorage.removeItem(LS_SHEET_KEY); }
        }
        if (!id) {
            id = await findOrCreate();
            state.sheetId = 0;
        }
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
            range: `${SHEET_TAB}!H1:W1`,
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
        range: `${SHEET_TAB}!A1:W1`,
        valueInputOption: 'RAW',
        resource: { values: [HEADER_ROW] },
    });

    return newId;
}

// ─── History ──────────────────────────────────────────────────────────────────
async function loadHistory() {
    const res = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: state.spreadsheetId,
        range: `${SHEET_TAB}!A2:W`,
    });
    state.history = res.result.values || [];
    state.expandedDays = new Set([todayISO()]);
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
    const fb = '<span class="f-badge">F</span>';

    const groups = new Map();
    for (const r of state.history) {
        const key = r[22] || '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(r);
    }
    const orderedKeys = [...groups.keys()].sort((a, b) => {
        if (!a && !b) return 0;
        if (!a) return 1;
        if (!b) return -1;
        return b.localeCompare(a);
    });

    for (const key of orderedKeys) {
        const hands = groups.get(key).slice().sort((a, b) => (parseInt(b[0])||0) - (parseInt(a[0])||0));
        const totalResult = hands.reduce((s, r) => s + (parseFloat(r[21]) || 0), 0);
        const isExpanded = state.expandedDays.has(key);
        const totalCls = totalResult > 0 ? 'dt-win' : totalResult < 0 ? 'dt-loss' : 'dt-zero';
        const totalPfx = totalResult > 0 ? '+' : totalResult < 0 ? '−' : '';
        const totalStr = Math.abs(totalResult).toLocaleString();

        const hdr = document.createElement('tr');
        hdr.className = 'date-group-row' + (isExpanded ? ' expanded' : '');
        hdr.innerHTML = `
            <td colspan="12">
                <div class="dg-inner">
                    <div class="dg-left">
                        <span class="dg-caret">▶</span>
                        <span class="dg-title">${formatDateThai(key)}</span>
                        <span class="dg-count">${hands.length} hands</span>
                    </div>
                    <div class="dg-right">
                        <span class="dg-total-lbl">รวม</span>
                        <span class="dg-total ${totalCls}">${totalPfx}${totalStr} ฿</span>
                    </div>
                </div>
            </td>
        `;
        hdr.addEventListener('click', () => toggleDateGroup(key));
        tbody.appendChild(hdr);

        if (!isExpanded) continue;

        for (const r of hands) {
            const no    = r[0]  || '';
            const hand  = r[1]  || '';
            const flop  = r[2]  || '';
            const turn  = r[3]  || '';
            const river = r[4]  || '';
            const sd1   = r[5]  || '';
            const sd2   = r[6]  || '';
            const pos   = r[7]  || '';
            const hit   = r[14] || '';
            const fold  = r[15] || '';
            const result= r[21] || '';

            const noteItems = [
                { label: 'HAND',  text: r[8]  || '' },
                { label: 'FLOP',  text: r[9]  || '' },
                { label: 'TURN',  text: r[10] || '' },
                { label: 'RIVER', text: r[11] || '' },
                { label: 'SD1',   text: r[12] || '' },
                { label: 'SD2',   text: r[13] || '' },
            ].filter(n => n.text);
            const hasNotes = noteItems.length > 0;

            const foldField = FOLD_TO_FIELD[fold] || null;

            const handDisplay = (state.hideHand
                ? '<span style="filter:blur(4px);display:inline-block">●●</span>'
                : cardHtml(hand)) + (foldField === 'hand' ? ' ' + fb : '');
            const flopDisplay  = cardHtml(flop)  + (foldField === 'flop'  ? ' ' + fb : '');
            const turnDisplay  = cardHtml(turn)  + (foldField === 'turn'  ? ' ' + fb : '');
            const riverDisplay = cardHtml(river) + (foldField === 'river' ? ' ' + fb : '');

            const hitDisplay = state.hideHand
                ? '<span class="cv-empty">—</span>'
                : (hit ? `<span class="hit-badge hit-${getHitTier(hit)}">${hit}</span>` : '<span class="cv-empty">—</span>');

            let resultDisplay = '<span class="cv-empty">—</span>';
            if (result !== '' && result !== undefined && result !== null) {
                const rv = parseFloat(result);
                if (!isNaN(rv)) {
                    const cls = rv > 0 ? 'result-win' : rv < 0 ? 'result-loss' : 'result-tie';
                    const pfx = rv > 0 ? '+' : '';
                    resultDisplay = `<span class="${cls}">${pfx}${rv.toLocaleString()}</span>`;
                }
            }

            const holeArr  = hand ? hand.split(' ').filter(Boolean) : [];
            const boardArr = [flop, turn, river].filter(Boolean).join(' ').split(' ').filter(Boolean);
            const fcDisplay = state.hideHand
                ? '<span class="cv-empty">—</span>'
                : fiveCardHtml(holeArr, boardArr);

            const histIdx = state.history.indexOf(r);
            const tr = document.createElement('tr');
            tr.className = 'history-row clickable-row';
            tr.innerHTML = `
                <td>${no || '<span class="cv-empty">—</span>'}</td>
                <td>${pos ? `<span class="pos-badge">${pos}</span>` : '<span class="cv-empty">—</span>'}</td>
                <td>${handDisplay}</td>
                <td>${flopDisplay}</td>
                <td>${turnDisplay}</td>
                <td>${riverDisplay}</td>
                <td>${fcDisplay}</td>
                <td>${hitDisplay}</td>
                <td>${cardHtml(sd1)}</td>
                <td>${cardHtml(sd2)}${hasNotes ? '<span class="note-dot">💬</span>' : ''}</td>
                <td>${resultDisplay}</td>
                <td class="row-actions">
                    <button class="row-action-btn edit-btn" title="แก้ไข">✏️</button>
                    <button class="row-action-btn del-btn" title="ลบ">🗑️</button>
                </td>
            `;
            tr.addEventListener('click', () => openHandDetail(r));
            tr.querySelector('.edit-btn').addEventListener('click', e => { e.stopPropagation(); editHand(r, histIdx); });
            tr.querySelector('.del-btn').addEventListener('click',  e => { e.stopPropagation(); deleteHand(histIdx); });
            tbody.appendChild(tr);
        }
    }

    const cnt = document.getElementById('history-count');
    cnt.textContent = state.history.length ? `(${orderedKeys.length} วัน · ${state.history.length} hands)` : '';
}

function toggleDateGroup(key) {
    if (state.expandedDays.has(key)) state.expandedDays.delete(key);
    else state.expandedDays.add(key);
    renderHistory();
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

    const board     = [...flop, ...turn, ...river];
    const hitResult = evaluatePokerHand(hand, board);
    const hitText   = hitResult ? hitResult.name : '';
    const foldText  = state.foldStreet ? FOLD_LABEL[state.foldStreet] : '';

    const betPF    = parseFloat(document.getElementById('bet-pf')?.value)   || 0;
    const betFLOP  = parseFloat(document.getElementById('bet-flop')?.value)  || 0;
    const betTURN  = parseFloat(document.getElementById('bet-turn')?.value)  || 0;
    const betRIVER = parseFloat(document.getElementById('bet-river')?.value) || 0;
    const potAmt   = parseFloat(document.getElementById('pot-input')?.value) || 0;
    const totalBet = betPF + betFLOP + betTURN + betRIVER;

    let resultVal = '';
    if (state.foldStreet) {
        if (totalBet > 0) resultVal = String(-totalBet);
    } else if (totalBet > 0) {
        const opponents = [sd1, sd2].filter(h => h.length >= 2);
        let weWin = opponents.length === 0 ? (potAmt > 0 ? true : null) : null;
        let tied = false;
        if (opponents.length > 0) {
            let weLose = false;
            for (const oppHole of opponents) {
                const oppResult = evaluatePokerHand(oppHole, board);
                if (oppResult && hitResult) {
                    const cmp = _cmpScore(oppResult.score, hitResult.score);
                    if (cmp > 0) { weLose = true; break; }
                    if (cmp === 0) tied = true;
                }
            }
            weWin = weLose ? false : (tied ? null : true);
        }
        if (weWin === true) {
            const potProfit = potAmt - totalBet;
            resultVal = String(potProfit > 0 ? potProfit : totalBet);
        } else if (weWin === false) {
            resultVal = String(-totalBet);
        } else if (tied) {
            resultVal = '0';
        }
    }

    const handNum = state.editing ? state.editing.handNum : state.handNumber;
    const dateVal = document.getElementById('date-input')?.value || todayISO();
    const row = [
        handNum,
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
        hitText,
        foldText,
        betPF    || '',
        betFLOP  || '',
        betTURN  || '',
        betRIVER || '',
        potAmt   || '',
        resultVal,
        dateVal,
    ];

    const btn = document.getElementById('save-btn');
    btn.disabled = true;
    try {
        if (state.editing) {
            const { histIdx, handNum } = state.editing;
            const sheetRow = histIdx + 2;
            await gapi.client.sheets.spreadsheets.values.update({
                spreadsheetId: state.spreadsheetId,
                range: `${SHEET_TAB}!A${sheetRow}:W${sheetRow}`,
                valueInputOption: 'RAW',
                resource: { values: [row] },
            });
            state.history[histIdx] = row;
            state.editing = null;
            btn.textContent = '💾 บันทึก Hand';
            state.expandedDays.add(dateVal);
            showToast(`✓ อัปเดต Hand #${handNum} สำเร็จ!`, 'success');
            renderHistory();
            clearAll();
        } else {
            await gapi.client.sheets.spreadsheets.values.append({
                spreadsheetId: state.spreadsheetId,
                range: `${SHEET_TAB}!A:W`,
                valueInputOption: 'RAW',
                insertDataOption: 'INSERT_ROWS',
                resource: { values: [row] },
            });
            showToast(`✓ บันทึก Hand #${state.handNumber} สำเร็จ!`, 'success');
            state.history.push(row);
            state.expandedDays.add(dateVal);
            renderHistory();
            state.handNumber++;
            document.getElementById('hand-num-display').textContent = state.handNumber;
            clearAll();
        }
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
    state.foldStreet = null;
    ['bet-pf','bet-flop','bet-turn','bet-river','pot-input'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = ''; el.disabled = false; }
    });
    const dateEl = document.getElementById('date-input');
    if (dateEl) dateEl.value = todayISO();
    if (state.editing) {
        state.editing = null;
        document.getElementById('save-btn').textContent = '💾 บันทึก Hand';
        document.getElementById('hand-num-display').textContent = state.handNumber;
    }
    refreshFoldBtn(); // also calls refreshResultDisplay
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
    if (label) {
        label.textContent = '💬 ' + FIELD_CFG[f].label;
        label.style.color = FIELD_COLORS[f] || 'var(--text-dim)';
    }
    if (ta) ta.value = state.comments[f];
}

// ─── UI Helpers ───────────────────────────────────────────────────────────────
function refreshPickerHeader() {
    const f   = state.activeField;
    const cfg = FIELD_CFG[f];
    const cnt = state.sel[f].length;
    const nameEl = document.getElementById('picker-field-name');
    nameEl.textContent = cfg.label;
    nameEl.style.color = FIELD_COLORS[f] || 'var(--accent)';
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

    refreshFiveCardDisplay();
    refreshHitDisplay();
}

function refreshFiveCardDisplay() {
    const el = document.getElementById('fi-fivecard');
    if (!el) return;

    if (state.hideHand) { el.style.display = 'none'; return; }
    el.style.display = '';

    const hole  = state.sel.hand;
    const board = [...state.sel.flop, ...state.sel.turn, ...state.sel.river];
    const fd    = document.getElementById('fd-fivecard');
    if (fd) fd.innerHTML = fiveCardHtml(hole, board);
}

function refreshHitDisplay() {
    const el = document.getElementById('fi-hit');
    if (!el) return;

    if (state.hideHand) { el.style.display = 'none'; return; }
    el.style.display = '';

    const hole   = state.sel.hand;
    const board  = [...state.sel.flop, ...state.sel.turn, ...state.sel.river];
    const result = evaluatePokerHand(hole, board);
    const fd     = document.getElementById('fd-hit');

    el.className = 'field-item';
    if (!result || hole.length < 2) {
        el.classList.add('fi-hit-empty');
        if (fd) fd.innerHTML = '—';
        return;
    }
    el.classList.add('fi-hit-' + result.tier);
    if (fd) fd.innerHTML = `<span class="hit-badge hit-${result.tier}">${result.name}</span>`;
}

function refreshCardGrid() {
    const f    = state.activeField;
    const sel  = state.sel[f];
    const full = sel.length >= FIELD_CFG[f].max;
    // When hiding hand and not on HAND field, don't expose hand cards via the grid
    const concealHand = state.hideHand && f !== 'hand';

    SUITS.forEach(suit => {
        RANKS.forEach(rank => {
            const id  = rank + suit.code;
            const btn = document.getElementById('cb-' + id);
            if (!btn) return;

            const isSelected      = sel.includes(id);
            const isUsedElsewhere = state.usedCards.has(id) && !isSelected
                                    && !(concealHand && state.sel.hand.includes(id));

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

        if (f === 'river') {
            const fcDiv = document.createElement('div');
            fcDiv.className = 'field-item fi-fivecard-empty';
            fcDiv.id = 'fi-fivecard';
            fcDiv.innerHTML = `<div class="field-label">5-CARD</div><div class="field-cards" id="fd-fivecard">—</div>`;
            bar.appendChild(fcDiv);

            const hitDiv = document.createElement('div');
            hitDiv.className = 'field-item fi-hit-empty';
            hitDiv.id = 'fi-hit';
            hitDiv.innerHTML = `<div class="field-label">HIT</div><div class="field-cards" id="fd-hit">—</div>`;
            bar.appendChild(hitDiv);
        }
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

    const foldField = FOLD_TO_FIELD[r[15]] || null;
    const fb = '<span class="f-badge">F</span>';

    const fields = [
        { key:'hand',    label:'HAND',  cards: r[1]||'', note: r[8] ||'', hideCards: state.hideHand, hasFold: foldField === 'hand' },
        { key:'flop',    label:'FLOP',  cards: r[2]||'', note: r[9] ||'', hasFold: foldField === 'flop' },
        { key:'turn',    label:'TURN',  cards: r[3]||'', note: r[10]||'', hasFold: foldField === 'turn' },
        { key:'river',   label:'RIVER', cards: r[4]||'', note: r[11]||'', hasFold: foldField === 'river' },
        { key:'fivecard', label:'5-CARD', isFiveCard: true },
        { key:'hit',     label:'HIT',   isHit: true, hitText: r[14]||'' },
        { key:'result',  label:'RESULT', isResult: true, resultText: r[21]||'' },
        { key:'sd1',     label:'SD1',   cards: r[5]||'', note: r[12]||'' },
        { key:'sd2',     label:'SD2',   cards: r[6]||'', note: r[13]||'' },
    ];

    const body = document.getElementById('hand-modal-body');
    body.innerHTML = fields.map(f => {
        if (f.isFiveCard) {
            if (state.hideHand) return '';
            const holeArr  = r[1] ? r[1].split(' ').filter(Boolean) : [];
            const boardArr = [r[2], r[3], r[4]].filter(Boolean).join(' ').split(' ').filter(Boolean);
            const cardsHtml = fiveCardHtml(holeArr, boardArr);
            return `
            <div class="hm-field-row">
                <span class="hm-field-label" style="color:#2dd4bf">${f.label}</span>
                <div class="hm-field-content"><div class="hm-cards">${cardsHtml}</div></div>
            </div>`;
        }
        if (f.isHit) {
            if (state.hideHand) return '';
            const ht = f.hitText;
            const cardsHtml = ht
                ? `<span class="hit-badge hit-${getHitTier(ht)}">${ht}</span>`
                : '<span class="cv-empty">—</span>';
            return `
            <div class="hm-field-row">
                <span class="hm-field-label" style="color:#f59e0b">${f.label}</span>
                <div class="hm-field-content"><div class="hm-cards">${cardsHtml}</div></div>
            </div>`;
        }
        if (f.isResult) {
            const rt = f.resultText;
            let resultHtml = '<span class="cv-empty">—</span>';
            if (rt) {
                const rv = parseFloat(rt);
                if (!isNaN(rv)) {
                    const cls = rv > 0 ? 'result-win' : 'result-loss';
                    const pfx = rv > 0 ? '+' : '';
                    resultHtml = `<span class="${cls}">${pfx}${rv.toLocaleString()}</span>`;
                }
            }
            return `
            <div class="hm-field-row">
                <span class="hm-field-label" style="color:#22c55e">${f.label}</span>
                <div class="hm-field-content"><div class="hm-cards">${resultHtml}</div></div>
            </div>`;
        }
        let cardsHtml;
        if (f.hideCards) {
            cardsHtml = '<span style="filter:blur(4px);display:inline-block">●●</span>';
        } else {
            cardsHtml = f.cards ? cardHtml(f.cards) : '<span class="cv-empty">—</span>';
        }
        if (f.hasFold) cardsHtml += ' ' + fb;
        const noteHtml = f.note ? `<div class="hm-note">${f.note}</div>` : '';
        const color = FIELD_COLORS[f.key] || 'var(--text-muted)';
        return `
            <div class="hm-field-row">
                <span class="hm-field-label" style="color:${color}">${f.label}</span>
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

// ─── Delete / Edit hand ───────────────────────────────────────────────────────
async function deleteHand(histIdx) {
    const handNo = state.history[histIdx]?.[0] || '?';
    if (!confirm(`ลบ Hand #${handNo} ใช่ไหม?`)) return;
    try {
        await gapi.client.sheets.spreadsheets.batchUpdate({
            spreadsheetId: state.spreadsheetId,
            resource: {
                requests: [{
                    deleteDimension: {
                        range: {
                            sheetId:    state.sheetId,
                            dimension:  'ROWS',
                            startIndex: histIdx + 1,
                            endIndex:   histIdx + 2,
                        },
                    },
                }],
            },
        });
        state.history.splice(histIdx, 1);
        if (state.editing?.histIdx === histIdx) {
            state.editing = null;
            document.getElementById('save-btn').textContent = '💾 บันทึก Hand';
        }
        calcHandNumber();
        renderHistory();
        showToast(`ลบ Hand #${handNo} สำเร็จ`, 'success');
    } catch (e) {
        showToast('ลบล้มเหลว: ' + (e.result?.error?.message || e.message || e), 'error');
    }
}

function editHand(r, histIdx) {
    closeHandDetail();
    const fieldMap = { hand: r[1]||'', flop: r[2]||'', turn: r[3]||'', river: r[4]||'', sd1: r[5]||'', sd2: r[6]||'' };
    FIELDS.forEach(f => {
        state.sel[f] = fieldMap[f] ? fieldMap[f].split(' ').filter(Boolean) : [];
        refreshFieldDisplay(f);
    });
    state.comments = {
        hand: r[8]||'', flop: r[9]||'', turn: r[10]||'',
        river: r[11]||'', sd1: r[12]||'', sd2: r[13]||'',
    };
    FIELDS.forEach(f => refreshFieldDisplay(f));

    document.getElementById('position-select').value = r[7] || '';
    state.foldStreet = FOLD_TO_FIELD[r[15]] || null;
    refreshFoldBtn();

    document.getElementById('bet-pf').value    = r[16] || '';
    document.getElementById('bet-flop').value  = r[17] || '';
    document.getElementById('bet-turn').value  = r[18] || '';
    document.getElementById('bet-river').value = r[19] || '';
    const potEl = document.getElementById('pot-input');
    potEl.value    = r[20] || '';
    potEl.disabled = !!state.foldStreet;
    const dateEl = document.getElementById('date-input');
    if (dateEl) dateEl.value = r[22] || todayISO();
    refreshResultDisplay();

    rebuildUsed();
    setActive('hand');

    state.editing = { histIdx, handNum: r[0] || state.handNumber };
    document.getElementById('save-btn').textContent = '💾 อัปเดต Hand';
    document.getElementById('hand-num-display').textContent = r[0] || state.handNumber;

    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ─── Hide Hand toggle ─────────────────────────────────────────────────────────
function toggleHideHand() {
    state.hideHand = !state.hideHand;
    const btn = document.getElementById('hide-hand-btn');
    btn.textContent  = state.hideHand ? '🙈 Hand' : '👁 Hand';
    btn.classList.toggle('active', state.hideHand);
    refreshFieldDisplay('hand');
    refreshFiveCardDisplay();
    refreshHitDisplay();
    refreshCardGrid();
    renderHistory();
}

// ─── Fold toggle ──────────────────────────────────────────────────────────────
function toggleFold() {
    if (state.foldStreet) {
        state.foldStreet = null;
    } else {
        const f = state.activeField;
        if (['hand', 'flop', 'turn', 'river'].includes(f)) state.foldStreet = f;
    }
    refreshFoldBtn();
}

function refreshFoldBtn() {
    const btn = document.getElementById('fold-btn');
    if (!btn) return;
    if (state.foldStreet) {
        btn.textContent = `🏳 ${FOLD_LABEL[state.foldStreet]}`;
        btn.classList.add('fold-active');
    } else {
        btn.textContent = '🏳 Fold';
        btn.classList.remove('fold-active');
    }
    refreshResultDisplay();
}

function refreshResultDisplay() {
    const BET_IDS    = ['bet-pf', 'bet-flop', 'bet-turn', 'bet-river'];
    const BET_LABELS = ['PF', 'FLOP', 'TURN', 'RIVER'];
    const betVals = BET_IDS.map(id => {
        const el = document.getElementById(id);
        return (el && el.value !== '') ? (parseFloat(el.value) || 0) : null;
    });
    const potAmt = parseFloat(document.getElementById('pot-input')?.value) || 0;
    const total  = betVals.reduce((a, b) => a + (b ?? 0), 0);

    const totalEl = document.getElementById('bet-total');
    if (totalEl) totalEl.textContent = total > 0 ? total.toLocaleString() + ' ฿' : '0 ฿';

    const potEl = document.getElementById('pot-input');
    if (potEl) potEl.disabled = !!state.foldStreet;

    // Pot Odds badge — uses last filled street
    const badge = document.getElementById('pot-odds-badge');
    if (badge) {
        let lastIdx = -1;
        for (let i = 0; i < betVals.length; i++) if (betVals[i] !== null) lastIdx = i;

        if (potAmt > 0 && lastIdx >= 0 && betVals[lastIdx] > 0) {
            const b   = betVals[lastIdx];
            const pct = b / (potAmt + b) * 100;
            const cls = pct <= 25 ? 'pot-odds-good' : pct <= 33 ? 'pot-odds-mid' : 'pot-odds-bad';
            badge.textContent = BET_LABELS[lastIdx] + ' ' + pct.toFixed(1) + '%';
            badge.className   = 'pot-odds-badge ' + cls;
        } else {
            badge.textContent = '—';
            badge.className   = 'pot-odds-badge pot-odds-empty';
        }
    }

    const rp = document.getElementById('result-preview');
    if (!rp) return;

    if (state.foldStreet) {
        if (total > 0) {
            rp.textContent = '−' + total.toLocaleString() + ' ฿';
            rp.className = 'result-preview rp-loss';
        } else {
            rp.textContent = '—';
            rp.className = 'result-preview';
        }
    } else if (potAmt > 0) {
        const potProfit = potAmt - total;
        const display = potProfit > 0 ? potProfit : total;
        rp.textContent = '+' + display.toLocaleString() + ' ฿';
        rp.className = 'result-preview rp-win';
    } else {
        rp.textContent = '—';
        rp.className = 'result-preview';
    }
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

    document.getElementById('fold-btn').addEventListener('click', toggleFold);
    document.getElementById('undo-btn').addEventListener('click', undoLast);
    document.getElementById('clear-field-btn').addEventListener('click', clearField);
    document.getElementById('clear-btn').addEventListener('click', clearAll);
    document.getElementById('save-btn').addEventListener('click', saveHand);
    document.getElementById('hide-hand-btn').addEventListener('click', toggleHideHand);
    document.getElementById('comment-toggle-btn').addEventListener('click', toggleCommentArea);

    ['bet-pf','bet-flop','bet-turn','bet-river','pot-input'].forEach(id => {
        document.getElementById(id).addEventListener('input', refreshResultDisplay);
    });
    refreshResultDisplay();

    const dateEl = document.getElementById('date-input');
    if (dateEl && !dateEl.value) dateEl.value = todayISO();

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
