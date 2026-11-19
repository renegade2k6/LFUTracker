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

  // Explore stores a stage id: 100500 is shown in game as 50-10 (chapter = id / 2000, stage = remainder / 50).
  const fmtValue = (board, v) => !Number.isFinite(Number(v)) || v == null ? '—' : board && board.f === 'stage' ? `${Math.floor(v / 2000)}-${(v % 2000) / 50}` : num(v);

  // The table names ultimate weapons "Hero | Weapon". -> [weapon, hero]
  function exName(names, id) {
    const n = nameOf(names, 'ex', id);
    if (!n) return [id != null ? `Ultimate weapon ${id}` : 'Ultimate weapon', ''];
    const i = n.indexOf('|');
    return i < 0 ? [n.trim(), ''] : [n.slice(i + 1).trim(), n.slice(0, i).trim()];
  }

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
    if (kind === 'hero') {
      const hero = nameOf(names, 'hero', extra.h) || (extra.h != null ? `Hero ${extra.h}` : 'Hero');
      return `${hero} · Lv${extra.l ?? '?'} · ${extra.s ?? '?'}★`;
    }
    if (kind === 'ex') {
      const [weapon, hero] = exName(names, extra.i);
      return `${weapon}${hero ? ` (${hero})` : ''} · Lv${extra.l ?? '?'} · ${extra.s ?? '?'}★`;
    }
    if (kind === 'wm') {
      const wm = nameOf(names, 'wm', extra.d) || (extra.d != null ? `Machine ${extra.d}` : 'Machine');
      const bits = [`Lv${extra.l ?? '?'}`, `${extra.st ?? '?'}★`];
      if (extra.sp && extra.sp.length) bits.push(`${extra.sp.length} surpass`);
      if (extra.m && extra.m.length && !(names && names.mod)) bits.push(`${extra.m.length} modules`);
      return `${wm} · ${bits.join(' · ')}`;
    }
    return '';
  }

  // Same build as extraText but with icons (img/e/<equipId>.webp, img/w/<machineId>.webp, exported by profiles.py).
  // A missing icon just hides itself; the text is always there.
  const icon = (dir, id, label) => id == null ? '' :
    `<img class="sv-ico" src="img/${dir}/${encodeURIComponent(id)}.webp" width="32" height="32" loading="lazy" alt="" title="${esc(label)}" onerror="this.style.display='none'">`;
  // Hero portrait for an ultimate weapon (names.exh maps weapon id -> hero id).
  const exHero = (id, names) => {
    const h = names && names.exh && names.exh[id];
    return h ? icon('h', h, nameOf(names, 'hero', h) || `Hero ${h}`) : '';
  };

  // Module chips: icon with its level on top. [level, quality, icon, type] comes from the table dump (names.mod).
  function moduleChips(ids, names) {
    if (!ids || !ids.length) return '';
    return `<div class="sv-mods">${ids.map(id => {
      const m = names && names.mod && names.mod[id];
      if (!m) return `<span class="sv-mod" title="Module ${esc(id)}"><b>?</b></span>`;
      const label = `${m[3] || 'Module'} Lv${m[0]}`;
      const q = Number.isInteger(m[1]) ? m[1] : 0;           // the game's own quality tier for that module level
      return `<span class="sv-mod q${q}" title="${esc(label)}">${m[2] ? `<img src="img/m/${encodeURIComponent(m[2])}.webp" width="26" height="26" loading="lazy" alt="" onerror="this.style.display='none'">` : ''}<b>${esc(m[0])}</b></span>`;
    }).join('')}</div>`;
  }

  function buildHtml(kind, extra, names) {
    if (!extra) return '';
    if (kind === 'suit') {
      const suit = nameOf(names, 'suit', extra.s) || (extra.s != null ? `Suit ${extra.s}` : 'Suit');
      const pieces = (extra.e || []).map(e => {
        const label = `${nameOf(names, 'equip', e[0]) || e[0]} Lv${e[1] ?? '?'} (${num(e[2])})`;
        return `<span class="sv-piece">${icon('e', e[0], label)}<small>${esc(`Lv${e[1] ?? '?'}`)}</small></span>`;
      }).join('');
      return `<div class="sv-build">${pieces}<span class="sv-txt">${esc(suit)} · ${esc(extra.n ?? (extra.e || []).length)}/4</span></div>`;
    }
    if (kind === 'hero') return `<div class="sv-build">${icon('h', extra.h, nameOf(names, 'hero', extra.h) || `Hero ${extra.h}`)}<span class="sv-txt">${esc(extraText(kind, extra, names))}</span></div>`;
    if (kind === 'ex') return `<div class="sv-build">${icon('x', extra.i, exName(names, extra.i).filter(Boolean).join(' · '))}${exHero(extra.i, names)}<span class="sv-txt">${esc(extraText(kind, extra, names))}</span></div>`;
    if (kind === 'wm') {
      const wm = nameOf(names, 'wm', extra.d) || (extra.d != null ? `Machine ${extra.d}` : 'Machine');
      return `<div class="sv-build">${icon('w', extra.d, wm)}<span class="sv-txt">${esc(extraText(kind, extra, names))}</span></div>${moduleChips(extra.m, names)}`;
    }
    return '';
  }

  const CSS = `
  .sv{max-width:1100px}
  .sv-note{display:flex;gap:.7rem;align-items:flex-start;background:var(--hazard-dim);border:1px solid var(--border-glow);border-radius:var(--radius);
    padding:.75rem 1rem;margin:1rem 0;color:var(--text);font-size:.88rem;line-height:1.5}
  .sv-note b{color:var(--hazard-text)} .sv-note span{color:var(--text-dim)}
  .sv-pills{display:flex;flex-wrap:wrap;gap:1.2rem 1.6rem;margin:1rem 0 .4rem}
  .sv-grp{display:flex;flex-direction:column;gap:.35rem}
  .sv-grp>small{font:600 .68rem var(--mono);letter-spacing:.1em;text-transform:uppercase;color:var(--text-faint)}
  .sv-grp>div{display:flex;flex-wrap:wrap;gap:.4rem}
  .sv-pill{background:var(--bg-card);color:var(--text-dim);border:1px solid var(--border);border-radius:99px;padding:.4rem .95rem;font:inherit;font-size:.85rem;cursor:pointer;transition:.15s}
  .sv-pill:hover{color:var(--text);border-color:var(--border-hi)}
  .sv-pill[aria-pressed=true]{background:var(--hazard-dim);color:var(--hazard-text);border-color:var(--border-glow)}
  .sv-tools{display:flex;flex-wrap:wrap;gap:.6rem 1.2rem;align-items:center;justify-content:space-between;margin:.8rem 0 .5rem}
  .sv-tools input[type=search]{background:var(--bg-card);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.5rem .8rem;font:inherit;width:min(100%,22rem)}
  .sv-tools .pf-count{margin:0}
  table.sv-t{table-layout:auto}
  table.sv-t th.r,table.sv-t td.r{width:3.5rem;text-align:right;padding-right:1rem;color:var(--text-faint);font-variant-numeric:tabular-nums}
  table.sv-t tr.top1 td.r{color:#ffd36b;font-weight:700} table.sv-t tr.top2 td.r{color:#cfd6e4;font-weight:700} table.sv-t tr.top3 td.r{color:#d99a6c;font-weight:700}
  table.sv-t td.v{font-weight:600;color:var(--text)} table.sv-t td.al{width:5.5rem}
  table.sv-t td.b{white-space:normal;padding-top:.35rem;padding-bottom:.35rem}
  .sv-build{display:flex;flex-wrap:wrap;align-items:center;gap:.3rem}
  .sv-piece{display:inline-flex;flex-direction:column;align-items:center;gap:1px}.sv-piece small{font-size:.62rem;color:var(--text-faint);line-height:1}
  .sv-mods{display:flex;gap:.25rem;margin-top:.3rem}
  .sv-mod{position:relative;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:6px;background:var(--bg-card-elev);border:1px solid var(--border)}
  .sv-mod img{object-fit:contain}.sv-mod b{position:absolute;right:-3px;bottom:-4px;font:700 .62rem var(--mono);line-height:1;padding:1px 3px;border-radius:4px;background:#000c;color:var(--text)}
  /* tier colours as shown in the game's War Beast Factory: Lv 7-9 purple, 10-12 orange, 13-15 red, 16+ gold */
  .sv-mod.q1{border-color:#9aa3b2}.sv-mod.q2{border-color:#4a9cff}.sv-mod.q3{border-color:#9a6cd0}.sv-mod.q4{border-color:#e8845a}.sv-mod.q5{border-color:#e0485a}.sv-mod.q6{border-color:#ffc83d}
  .sv-ico{object-fit:contain;border-radius:5px;background:var(--bg-card-elev);border:1px solid var(--border-subtle)}
  .sv-txt{color:var(--text-dim);font-size:.8rem;margin-left:.45rem;line-height:1.3}
  .sv-selwrap{display:none;margin:1rem 0 .4rem}
  .sv-selwrap select{width:100%;background:var(--bg-card);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.65rem .8rem;font:inherit}
  @media (max-width:720px){
    .sv-pills{display:none}.sv-selwrap{display:block}
    .sv-tools input[type=search]{width:100%}
    table.sv-t,table.sv-t tbody{display:block}
    table.sv-t thead{display:none}
    table.sv-t tr{display:grid;grid-template-columns:2.2rem 1fr auto;column-gap:.6rem;align-items:center;padding:.6rem .75rem;border-top:1px solid var(--border-subtle)}
    table.sv-t td{border:0;padding:.1rem 0;white-space:normal;min-width:0}
    table.sv-t td.r{grid-column:1;grid-row:1 / span 2;width:auto;padding-right:0;text-align:left}
    table.sv-t td.p{grid-column:2;grid-row:1;overflow-wrap:anywhere}
    table.sv-t td.al{display:block;grid-column:2;grid-row:2;width:auto}
    table.sv-t td.v{grid-column:3;grid-row:1 / span 2;text-align:right}
    table.sv-t td.b{grid-column:1 / -1;grid-row:3;padding:.4rem 0 0 0}
    .sv-txt{margin-left:.3rem}
  }`;
  function ensureStyle() {
    if (document.getElementById('sv-style')) return;
    const el = document.createElement('style');
    el.id = 'sv-style';
    el.textContent = CSS;
    document.head.appendChild(el);
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
    const pills = groups.map(g => `<div class="sv-grp"><small>${esc(g)}</small><div>${boards.filter(x => x.g === g).map(x =>
      `<button type="button" class="sv-pill" data-board="${esc(x.k)}" aria-pressed="${x.k === b.k}">${esc(x.l)}</button>`).join('')}</div></div>`).join('');
    view().innerHTML = `<div class="sv">
      <div class="pf-hero"><p class="eyebrow">SERVER ${esc(m.server)}</p><h1>Server <span>${esc(m.server)}</span></h1>
        <p>How the players on our home server compare, board by board.</p></div>
      <div class="sv-note" role="note"><svg class="icon-sm" data-lucide="info" aria-hidden="true"></svg><div><b>Server ${esc(m.server)} data is from the in-game leaderboards.</b>
        <span> It only covers players who appeared on a board when we captured it, so it is not a full roster. Ranks are within this server only, and each board was captured at its own time (shown above the table).</span></div></div>
      <div class="sv-selwrap"><select id="svsel" aria-label="Board">${tabs}</select></div>
      <div class="sv-pills" id="svpills">${pills}</div>
      <div class="sv-tools"><div class="pf-count" id="svcount"></div>
        <input type="search" id="svq" placeholder="Search name, tag or uid" aria-label="Search this board" value="${esc(state.q)}"></div>
      <div class="pf-scroll" id="svtable"></div></div>`;
    document.getElementById('svpills').addEventListener('click', e => {
      const btn = e.target.closest('[data-board]');
      if (btn) set('board', btn.dataset.board);
    });
    document.getElementById('svsel').addEventListener('change', e => set('board', e.target.value));
    document.getElementById('svq').addEventListener('input', e => set('q', e.target.value));
    drawRows();
  }

  function drawRows() {
    const b = data.boards.find(x => x.k === state.board);
    if (!b) return;
    const rows = filterRows(b, state.q);
    document.getElementById('svcount').textContent = `${rows.length.toLocaleString('en-US')} of ${b.rows.length.toLocaleString('en-US')} players · ${b.l} · captured ${dateStr(b.ts)}`;
    document.getElementById('svtable').innerHTML = `<table class="pf sv-t"><thead><tr><th class="r">#</th><th>Player</th><th class="al">Alliance</th><th class="n">${esc(b.l)}</th>${b.x ? '<th>Build</th>' : ''}</tr></thead><tbody>${
      rows.map(r => `<tr class="${r[0] <= 3 ? 'top' + r[0] : ''}"><td class="r">${esc(r[0])}</td><td class="p"><a href="#p/${encodeURIComponent(r[1])}">${esc(r[2])}</a></td>
        <td class="al">${r[3] ? `<span class="pf-badge">${esc(r[3])}</span>` : ''}</td><td class="n v">${esc(fmtValue(b, r[4]))}</td>
        ${b.x ? `<td class="b">${buildHtml(b.x, r[5], data.names)}</td>` : ''}</tr>`).join('')
    }</tbody></table>`;
  }

  function set(key, value) {
    state[key] = value;
    if (key === 'board') { location.hash = `#server/${encodeURIComponent(value)}`; return; }
    drawRows();
  }

  async function render() {
    if (typeof Profiles !== 'undefined' && Profiles.ensureStyle) Profiles.ensureStyle();
    ensureStyle();
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

  return {owns, render, set, state, filterRows, extraText, buildHtml, fmtValue, exName, boardFromHash, nameOf, helpers: {num, dateStr}};
})();
if (typeof module !== 'undefined') module.exports = Server;
