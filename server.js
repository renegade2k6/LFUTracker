/* Server tab. Loads data/server.enc.json (written by scripts/profiles.py, decrypted in the browser with the same
   site password as the tracker) and shows the server-only leaderboards for the home server, laid out like the
   in-game leaderboard. Ranks here only mean something inside that server, so they are kept apart from the global
   Profiles data. Pure helpers are exported for tests (tests/server.test.cjs); everything that touches the DOM is in `render`. */
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

  // Detail text for a row: suit pieces / war machine build. Names come from the table dump when it was available.
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

  // The label the game prints above the value on the right of a row: "[Resolute]", "Isaac | Last Show", ...
  function setText(kind, extra, names) {
    if (!extra) return '';
    if (kind === 'suit') return `[${nameOf(names, 'suit', extra.s) || (extra.s != null ? `Suit ${extra.s}` : 'Suit')}]`;
    if (kind === 'ex') return nameOf(names, 'ex', extra.i) || (extra.i != null ? `Ultimate weapon ${extra.i}` : 'Ultimate weapon');
    if (kind === 'wm') return nameOf(names, 'wm', extra.d) || (extra.d != null ? `Machine ${extra.d}` : 'Machine');
    if (kind === 'hero') return nameOf(names, 'hero', extra.h) || (extra.h != null ? `Hero ${extra.h}` : 'Hero');
    return '';
  }

  // Short text that sits next to the picture for machines / heroes (the name goes on the right, like the game).
  function detailText(kind, extra) {
    if (!extra) return '';
    if (kind === 'wm') {
      const bits = [`Lv${extra.l ?? '?'}`, `${extra.st ?? '?'}★`];
      if (extra.sp && extra.sp.length) bits.push(`${extra.sp.length} surpass`);
      return bits.join(' · ');
    }
    if (kind === 'hero') return '';
    return '';
  }

  // Icons: img/e/<equipId>, img/w/<machineId>, img/x/<weaponId>, img/h/<heroId>, img/m/<iconName> (.webp, exported by profiles.py).
  // A missing icon just hides itself; the text is always there.
  const icon = (dir, id, label) => id == null ? '' :
    `<img class="sv-ico" src="img/${dir}/${encodeURIComponent(id)}.webp" width="32" height="32" loading="lazy" alt="" title="${esc(label)}" onerror="this.style.display='none'">`;
  // An item icon on a coloured tile with its level on top, like the game's leaderboard. `cls` picks the colours.
  const tile = (dir, id, label, cls, badge, top) => `<span class="sv-tile ${cls}">${icon(dir, id, label)}${top ? `<i>${esc(top)}</i>` : ''}${badge ? `<b>${esc(badge)}</b>` : ''}</span>`;
  // Gear tile colour follows the piece level, as in the game: Lv30 red, Lv20 orange (both sampled from the game);
  // 10-19 purple and below blue follow the same ladder as war machine modules but are not confirmed.
  const gearTier = lv => !Number.isFinite(Number(lv)) || lv == null ? 'x' : lv >= 30 ? 'r' : lv >= 20 ? 'o' : lv >= 10 ? 'p' : 'b';

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

  // The picture part of a row: [main tiles, module chips]. Text is separate (setText / extraText).
  function tiles(kind, extra, names) {
    if (!extra) return ['', ''];
    if (kind === 'suit') {
      return [(extra.e || []).map(e => {
        const label = `${nameOf(names, 'equip', e[0]) || e[0]} Lv${e[1] ?? '?'} (${num(e[2])})`;
        return tile('e', e[0], label, `gear gl${gearTier(e[1])}`, `Lv.${e[1] ?? '?'}`);
      }).join(''), ''];
    }
    if (kind === 'hero') {
      const hero = nameOf(names, 'hero', extra.h) || `Hero ${extra.h}`;
      const skills = (extra.k || []).map(k => tile('k', k[0], `Skill Lv${k[1] ?? '?'}`, 'skill', k[1] != null ? String(k[1]) : ''));
      // the game prints its own tier label ("X4") top-left of the portrait; we do not have that value, so none is shown
      return [tile('h', extra.h, `${hero} · Lv${extra.l ?? '?'} · ${extra.s ?? '?'}★`, 'portrait', `Lv.${extra.l ?? '?'}`) + skills.join(''), ''];
    }
    if (kind === 'ex') return [tile('x', extra.i, exName(names, extra.i).filter(Boolean).join(' · '), 'ult', `Lv.${extra.l ?? '?'}`) + exHero(extra.i, names), ''];
    if (kind === 'wm') return [icon('w', extra.d, nameOf(names, 'wm', extra.d) || (extra.d != null ? `Machine ${extra.d}` : 'Machine')), moduleChips(extra.m, names)];
    return ['', ''];
  }

  // Pictures + descriptive text in one block (kept for tests and non-leaderboard uses).
  function buildHtml(kind, extra, names) {
    if (!extra) return '';
    const [main, mods] = tiles(kind, extra, names);
    const text = kind === 'suit' ? `${nameOf(names, 'suit', extra.s) || (extra.s != null ? `Suit ${extra.s}` : 'Suit')} · ${extra.n ?? (extra.e || []).length}/4` : extraText(kind, extra, names);
    return `<div class="sv-build">${main}<span class="sv-txt">${esc(text)}</span></div>${mods}`;
  }

  // One leaderboard row, in the game's order: rank medal, [Tag]Name #server, pictures, label over value.
  function rowHtml(board, r, names, server) {
    const rank = r[0], [main, mods] = tiles(board.x, r[5], names), label = setText(board.x, r[5], names);
    const medal = rank >= 1 && rank <= 3 ? ` r${rank}` : '';
    return `<div class="sv-r${rank <= 3 ? ' top' + rank : ''}">
      <span class="sv-rk${medal}">${esc(rank)}</span>
      <a class="sv-nm" href="#p/${encodeURIComponent(r[1])}">${r[3] ? `<span class="sv-tag">[${esc(r[3])}]</span>` : ''}${esc(r[2])}${server != null ? ` <small>#${esc(server)}</small>` : ''}</a>
      <div class="sv-bd">${main ? `<div class="sv-pics">${main}${detailText(board.x, r[5]) ? `<span class="sv-txt">${esc(detailText(board.x, r[5]))}</span>` : ''}</div>` : ''}${mods}</div>
      <div class="sv-rt">${label ? `<span class="sv-set">${esc(label)}</span>` : ''}<b>${esc(fmtValue(board, r[4]))}</b></div></div>`;
  }

  const CSS = `
  .sv{max-width:1100px}
  .sv-note{display:flex;gap:.7rem;align-items:flex-start;background:var(--hazard-dim);border:1px solid var(--border-glow);border-radius:var(--radius);
    padding:.75rem 1rem;margin:1rem 0;color:var(--text);font-size:.88rem;line-height:1.5}
  .sv-note b{color:var(--hazard-text)} .sv-note span{color:var(--text-dim)}
  .sv-wrap{display:grid;grid-template-columns:13rem minmax(0,1fr);gap:1rem;align-items:start;margin-top:1rem}
  .sv-menu{display:flex;flex-direction:column;gap:.35rem;position:sticky;top:1rem}
  .sv-mi{text-align:left;background:linear-gradient(90deg,#1d1d21,#26262b);color:#b9b2a2;border:1px solid #34343b;border-left:3px solid #6b5a33;border-radius:6px;padding:.7rem .85rem;font:600 .9rem var(--display);letter-spacing:.02em;cursor:pointer;transition:.12s}
  .sv-mi:hover{color:#fff;border-color:#55555f;border-left-color:#c9a84f}
  .sv-mi[aria-pressed=true]{background:linear-gradient(90deg,#5b5b60,#3d3d44);color:#fff;border-color:#d8d8de;border-left-color:#f0dc9a}
  .sv-tools{display:flex;flex-wrap:wrap;gap:.6rem 1.2rem;align-items:center;justify-content:space-between;margin:0 0 .6rem}
  .sv-tools input[type=search]{background:var(--bg-card);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.5rem .8rem;font:inherit;width:min(100%,22rem)}
  .sv-tools .pf-count{margin:0}
  .sv-selwrap{display:none;margin:1rem 0 .4rem}
  .sv-selwrap select{width:100%;background:var(--bg-card);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.65rem .8rem;font:inherit}

  /* leaderboard list, after the in-game one: header strip, purple-tinted top three, grey rows, medal ranks */
  .sv-lb{border:1px solid var(--border-subtle);border-radius:var(--radius-lg);overflow:hidden;background:#17181d}
  .sv-lh,.sv-r{display:grid;grid-template-columns:3.4rem minmax(11rem,1fr) auto minmax(9rem,max-content);column-gap:1rem;align-items:center}
  .sv-lh{padding:.55rem 1rem;background:#232329;color:#b8aa88;font:600 .78rem var(--mono);letter-spacing:.06em;text-transform:uppercase;border-bottom:1px solid #000}
  .sv-lh .rt{grid-column:4;text-align:right}
  .sv-r{padding:.55rem 1rem;background:#2a2a30;border-bottom:2px solid #15151a;min-height:3.4rem}
  .sv-r.top1,.sv-r.top2,.sv-r.top3{background:linear-gradient(90deg,#4e475e,#64587a 55%,#51486a)}
  .sv-rk{width:2.1rem;height:2.1rem;border-radius:50%;display:grid;place-items:center;font:700 .95rem var(--display);background:#1c1c20;color:#cfcfd6;border:2px solid #3b3b42}
  .sv-rk.r1{background:radial-gradient(circle at 35% 30%,#fff0b0,#d6a93a 70%);color:#3a2800;border-color:#ffe7a0}
  .sv-rk.r2{background:radial-gradient(circle at 35% 30%,#fafbff,#a9b2c6 70%);color:#2a2f3a;border-color:#e4e9f5}
  .sv-rk.r3{background:radial-gradient(circle at 35% 30%,#ffd9b8,#b97a4a 70%);color:#3a1f08;border-color:#f0b98c}
  .sv-nm{color:#f1f1f4;font-weight:600;overflow-wrap:anywhere;text-decoration:none}.sv-nm:hover{color:var(--hazard-text)}
  .sv-nm small{color:#9c9cab;font-weight:500;margin-left:.2rem}.sv-tag{color:#e5e5ea;margin-right:.05rem}
  .sv-bd{display:flex;flex-direction:column;gap:.35rem;align-items:flex-start}
  .sv-pics{display:flex;align-items:center;gap:.35rem}
  .sv-rt{display:flex;flex-direction:column;align-items:flex-end;text-align:right;line-height:1.25}
  .sv-rt b{font:700 1.02rem var(--display);color:#fff;letter-spacing:.02em}.sv-rt .sv-set{color:#f1f1f6;font-size:.98rem;font-weight:600}
  .sv-r:has(.sv-set) .sv-rt b{font-size:.92rem;color:#d4d4df;font-weight:600}

  .sv-mods{display:flex;gap:.25rem}
  .sv-mod{position:relative;display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:6px;background:var(--bg-card-elev);border:1px solid var(--border)}
  .sv-mod img{object-fit:contain}.sv-mod b{position:absolute;right:-3px;bottom:-4px;font:700 .62rem var(--mono);line-height:1;padding:1px 3px;border-radius:4px;background:#000c;color:var(--text)}
  /* tier colours as shown in the game's War Beast Factory: Lv 7-9 purple, 10-12 orange, 13-15 red, 16+ gold */
  .sv-mod.q1{border-color:#9aa3b2}.sv-mod.q2{border-color:#4a9cff}.sv-mod.q3{border-color:#9a6cd0}.sv-mod.q4{border-color:#e8845a}.sv-mod.q5{border-color:#e0485a}.sv-mod.q6{border-color:#ffc83d}
  .sv-tile{position:relative;display:inline-flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:6px}
  .sv-tile .sv-ico{width:100%;height:100%;border:0;background:none;border-radius:6px}
  .sv-tile b{position:absolute;right:3px;bottom:2px;font:700 .58rem var(--mono);line-height:1;color:#fff;text-shadow:0 1px 2px #000,0 0 3px #000}
  /* gear tile colour by piece level (sampled from the game's hero screen): Lv30 crimson, Lv20 orange */
  .sv-tile.gear{background:linear-gradient(160deg,#8a929f,#636b78);border:1px solid #aab1bd}
  .sv-tile.glr{background:linear-gradient(160deg,#a74855,#813642);border-color:#c7677a}
  .sv-tile.glo{background:linear-gradient(160deg,#bf7657,#865443);border-color:#e8a07c}
  .sv-tile.glp{background:linear-gradient(160deg,#7f6496,#624f77);border-color:#a48bd0}
  .sv-tile.glb{background:linear-gradient(160deg,#4a78b8,#34568a);border-color:#7ea4d8}
  .sv-tile i{position:absolute;left:3px;top:2px;font:700 .56rem var(--mono);font-style:normal;line-height:1;color:#ffd978;text-shadow:0 1px 2px #000,0 0 3px #000}
  .sv-tile.portrait{width:50px;height:50px;background:#1d2736;border:2px solid #5f93b5;border-radius:5px}.sv-tile.portrait .sv-ico{border-radius:3px}
  .sv-tile.skill{width:42px;height:42px;background:linear-gradient(160deg,#3b4a72,#26304f);border:2px solid #d8b86a;border-radius:5px}
  .sv-tile.skill b{right:3px;bottom:1px;font-size:.7rem}
  .sv-tile.skill::after{content:'';position:absolute;left:3px;bottom:3px;border-left:4px solid transparent;border-right:4px solid transparent;border-bottom:7px solid #e6c15a}
  .sv-tile.ult{width:84px;background:#2b2a30;border:2px solid #f0dc9a;border-radius:5px}.sv-tile.ult .sv-ico{border-radius:3px}
  .sv-ico{object-fit:contain;border-radius:5px;background:var(--bg-card-elev);border:1px solid var(--border-subtle)}
  .sv-txt{color:var(--text-dim);font-size:.8rem;margin-left:.45rem;line-height:1.3}
  @media (max-width:720px){
    .sv-wrap{grid-template-columns:1fr}.sv-menu{display:none}.sv-selwrap{display:block}
    .sv-tools input[type=search]{width:100%}
    .sv-lh{display:none}
    .sv-r{grid-template-columns:2.4rem 1fr auto;column-gap:.6rem;padding:.6rem .75rem}
    .sv-rk{grid-column:1;grid-row:1 / span 2}
    .sv-nm{grid-column:2;grid-row:1}
    .sv-rt{grid-column:3;grid-row:1 / span 2}
    .sv-bd{grid-column:1 / -1;grid-row:3;padding-top:.35rem}
    .sv-bd:empty{display:none}
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
    const tabs = boards.map(x => `<option value="${esc(x.k)}"${x.k === b.k ? ' selected' : ''}>${esc(x.l)}</option>`).join('');
    const menu = boards.map(x => `<button type="button" class="sv-mi" data-board="${esc(x.k)}" aria-pressed="${x.k === b.k}">${esc(x.l)}</button>`).join('');
    view().innerHTML = `<div class="sv">
      <div class="pf-hero"><p class="eyebrow">SERVER ${esc(m.server)}</p><h1>Server <span>${esc(m.server)}</span></h1>
        <p>How the players on our home server compare, board by board.</p></div>
      <div class="sv-note" role="note"><svg class="icon-sm" data-lucide="info" aria-hidden="true"></svg><div><b>Server ${esc(m.server)} data is from the in-game leaderboards.</b>
        <span> It only covers players who appeared on a board when we captured it, so it is not a full roster. Ranks are within this server only, and each board was captured at its own time (shown above the list).</span></div></div>
      <div class="sv-selwrap"><select id="svsel" aria-label="Board">${tabs}</select></div>
      <div class="sv-wrap"><nav class="sv-menu" id="svpills" aria-label="Leaderboards">${menu}</nav>
        <div class="sv-main"><div class="sv-tools"><div class="pf-count" id="svcount"></div>
          <input type="search" id="svq" placeholder="Search name, tag or uid" aria-label="Search this board" value="${esc(state.q)}"></div>
        <div class="sv-lb" id="svtable"></div></div></div></div>`;
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
    document.getElementById('svtable').innerHTML = `<div class="sv-lh"><span>Ranking</span><span>Name</span><span></span><span class="rt">${esc(b.c || b.l)}</span></div>${
      rows.map(r => rowHtml(b, r, data.names, data.meta.server)).join('')}`;
  }

  // Switching boards must not scroll the page: update the URL without a hashchange (which re-renders and jumps to
  // the top) and refresh just the menu, the picker and the list.
  function switchBoard(key) {
    state.board = key;
    try { history.pushState(null, '', `#server/${encodeURIComponent(key)}`); } catch { location.hash = `#server/${encodeURIComponent(key)}`; return; }
    document.querySelectorAll('#svpills [data-board]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.board === key)));
    const sel = document.getElementById('svsel');
    if (sel) sel.value = key;
    drawRows();                                   // the page keeps its scroll position; the menu is sticky, so it stays in reach
  }

  function set(key, value) {
    state[key] = value;
    if (key === 'board') { if (data) switchBoard(value); else location.hash = `#server/${encodeURIComponent(value)}`; return; }
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

  return {owns, render, set, state, filterRows, extraText, setText, detailText, buildHtml, rowHtml, fmtValue, exName, gearTier, boardFromHash, nameOf, helpers: {num, dateStr}};
})();
if (typeof module !== 'undefined') module.exports = Server;
