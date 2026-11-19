/* Server tab. Loads data/server.enc.json (written by scripts/profiles.py, decrypted in the browser with the same
   site password as the tracker) and shows the server-only leaderboards for the home server. Ranks here only
   mean something inside that server, so they are kept apart from the global Profiles data.
   Pure helpers are exported for tests (tests/server.test.cjs); everything that touches the DOM is in `render`. */
const Server = (() => {
  const BUNDLE = 'data/server.enc.json';
  const state = {board: '', q: ''};
  let data = null, loading = null;

  // ---------------------------------------------------------------- pure helpers
  const esc = v => v == null ? '' : String(v).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const num = v => Number.isFinite(Number(v)) && v != null ? Number(v).toLocaleString('en-US') : '—';
  const dateStr = s => s ? new Date(s * 1000).toISOString().slice(0, 10) : '—';
  const nameOf = (names, kind, id) => (names && names[kind] && names[kind][id]) || null;

  // "#server" or "#server/<board key>"
  const owns = hash => /^#?server(\/|$)/.test(hash || '');
  const boardFromHash = hash => { const m = /^#?server\/(.+)$/.exec(hash || ''); return m ? decodeURIComponent(m[1]) : ''; };

  function filterRows(board, q) {
    const needle = (q || '').trim().toLowerCase();
    if (!needle) return board.rows;
    return board.rows.filter(r => `${r[2]} ${r[3]} ${r[1]}`.toLowerCase().includes(needle));
  }

  // Extra detail line(s) for a row: suit pieces / war machine build. Names come from the table dump when it was available.
  function extraText(kind, extra, names) {
    if (!extra) return '';
    if (kind === 'suit') {
      const suit = nameOf(names, 'suit', extra.s) || (extra.s != null ? `Suit ${extra.s}` : 'Suit');
      const pieces = (extra.e || []).map(e => `${nameOf(names, 'equip', e[0]) || e[0]} Lv${e[1] ?? '?'} (${num(e[2])})`);
      return `${suit} · ${extra.n ?? pieces.length}/4 pieces — ${pieces.join(', ')}`;
    }
    if (kind === 'wm') {
      const wm = nameOf(names, 'wm', extra.d) || (extra.d != null ? `Machine ${extra.d}` : 'Machine');
      const bits = [`Lv${extra.l ?? '?'}`, `${extra.st ?? '?'}★`];
      if (extra.sp && extra.sp.length) bits.push(`${extra.sp.length} surpass`);
      if (extra.m && extra.m.length) bits.push(`${extra.m.length} modules`);
      return `${wm} · ${bits.join(' · ')}`;
    }
    return '';
  }

  // ---------------------------------------------------------------- data
  async function fetchBundle() {
    const res = await fetch(BUNDLE, {cache: 'no-store'});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pw = SiteVault.saved();
    if (!pw) throw new Error('locked');
    return SiteVault.open(await res.json(), pw);
  }
  function load() {
    if (!loading) loading = fetchBundle().then(d => (data = d)).catch(e => { loading = null; throw e; });
    return loading;
  }

  // ---------------------------------------------------------------- views (DOM)
  const view = () => document.getElementById('view');
  const locked = () => typeof SAMPLE_MODE !== 'undefined' && SAMPLE_MODE;
  const card = (title, body) => `<div class="pf-card pf-lock"><h2>${esc(title)}</h2>${body}</div>`;

  function boardView(key) {
    const boards = data.boards, b = boards.find(x => x.k === key) || boards[0];
    state.board = b.k;
    const m = data.meta;
    const groups = [...new Set(boards.map(x => x.g))];
    const tabs = groups.map(g => `<optgroup label="${esc(g)}">${boards.filter(x => x.g === g).map(x =>
      `<option value="${esc(x.k)}"${x.k === b.k ? ' selected' : ''}>${esc(x.l)}</option>`).join('')}</optgroup>`).join('');
    view().innerHTML = `<div class="pf-hero"><p class="eyebrow">SERVER ${esc(m.server)}</p><h1>Server <span>${esc(m.server)}</span></h1>
      <p>Server-only leaderboards for the home server. Ranks are within this server only. Snapshot of what we have captured, so boards can be a few days apart.</p></div>
      <div class="pf-bar"><label>Board<select id="svb" onchange="Server.set('board',this.value)">${tabs}</select></label>
        <label class="grow">Search<input type="search" id="svq" placeholder="Name, tag or uid" value="${esc(state.q)}" oninput="Server.set('q',this.value)"></label></div>
      <div class="pf-count" id="svcount"></div><div class="pf-scroll" id="svtable"></div>`;
    drawRows();
  }

  function drawRows() {
    const b = data.boards.find(x => x.k === state.board);
    if (!b) return;
    const rows = filterRows(b, state.q);
    document.getElementById('svcount').textContent = `${rows.length.toLocaleString('en-US')} of ${b.rows.length.toLocaleString('en-US')} players · ${b.l} · captured ${dateStr(b.ts)}`;
    const detail = b.x ? '<th>Build</th>' : '';
    document.getElementById('svtable').innerHTML = `<table class="pf"><thead><tr><th class="n">#</th><th>Player</th><th>Alliance</th><th class="n">${esc(b.l)}</th>${detail}</tr></thead><tbody>${
      rows.map(r => `<tr><td class="n">${esc(r[0])}</td><td><a href="#p/${encodeURIComponent(r[1])}">${esc(r[2])}</a></td>
        <td>${r[3] ? `<span class="pf-badge">${esc(r[3])}</span>` : ''}</td><td class="n">${num(r[4])}</td>
        ${b.x ? `<td style="white-space:normal;min-width:18rem;color:var(--text-dim)">${esc(extraText(b.x, r[5], data.names))}</td>` : ''}</tr>`).join('')
    }</tbody></table>`;
  }

  function set(key, value) {
    state[key] = value;
    if (key === 'board') { location.hash = `#server/${encodeURIComponent(value)}`; return; }
    drawRows();
  }

  async function render() {
    if (typeof Profiles !== 'undefined' && Profiles.ensureStyle) Profiles.ensureStyle();
    document.querySelectorAll('[data-nav]').forEach(l => l.dataset.nav === 'server' ? l.setAttribute('aria-current', 'page') : l.removeAttribute('aria-current'));
    const label = document.getElementById('pageLabel');
    if (label) label.textContent = 'Server';
    if (locked()) { view().innerHTML = card('Server', '<p>Server leaderboards are part of the protected data. Log in to view them.</p><button type="button" class="primary-action" onclick="showLogin()">Log in</button>'); return; }
    const hash = location.hash;
    if (!data) view().innerHTML = '<div class="empty" role="status">Loading server boards…</div>';
    try { await load(); } catch (e) {
      if (location.hash === hash) view().innerHTML = card('Server unavailable', `<p>${esc(e.message === 'locked' ? 'Log in first.' : 'Could not load the server data (' + e.message + '). Run Deploy again, or refresh the page.')}</p>`);
      return;
    }
    if (location.hash !== hash) return;
    if (!data.boards.length) { view().innerHTML = card('Server', '<p>No server boards captured yet.</p>'); return; }
    boardView(boardFromHash(hash) || state.board);
    if (window.lucide) lucide.createIcons();
    window.scrollTo(0, 0);
  }

  return {owns, render, set, state, filterRows, extraText, boardFromHash, nameOf, helpers: {num, dateStr}};
})();
if (typeof module !== 'undefined') module.exports = Server;
