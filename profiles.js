/* Profiles (Beta) tab. Self-contained: loads data/profiles.enc.json (every player) and, on demand,
   data/profiles-detail.enc.json (advanced "star" players), both written by scripts/profiles.py and
   decrypted in the browser with the same site password as the tracker (vault.js).
   Pure helpers are exported for tests (tests/profiles.test.cjs); everything below `render` needs a DOM. */
const Profiles = (() => {
  const MAIN = 'data/profiles.enc.json', DETAIL = 'data/profiles-detail.enc.json';
  const PAGE = 50;
  const state = {q: '', server: '', star: false, tab: '', sort: 'pw', dir: -1, page: 0, alliance: -1};
  let main = null, detail = null, byUid = new Map(), loading = null, detailLoading = null, shown = [];

  // ---------------------------------------------------------------- pure helpers
  const esc = v => v == null ? '' : String(v).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const num = v => Number.isFinite(Number(v)) && v != null ? Number(v).toLocaleString('en-US') : '—';
  const compact = v => {
    const n = Number(v);
    if (!Number.isFinite(n) || v == null) return '—';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e4) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString('en-US');
  };
  const dateStr = s => s ? new Date(s * 1000).toISOString().slice(0, 10) : '—';
  const ago = (s, now = Date.now()) => {
    if (!s) return '—';
    const m = Math.round((now / 1000 - s) / 60);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    if (m < 1440) return `${Math.round(m / 60)}h ago`;
    return `${Math.round(m / 1440)}d ago`;
  };
  const stars = t => t ? '★' : '';
  // "Explore" stores a stage id: 100500 is shown in game as 50-10 (chapter = id / 2000, stage = remainder / 50).
  function formatValue(tab, v) {
    if (v == null) return '—';
    if (tab && tab.f === 'cur_id') return `${Math.floor(v / 2000)}-${(v % 2000) / 50}`;
    return num(v);
  }
  const humanize = k => k.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()).replace(/\bId\b/g, 'ID');
  const LABELS = {armyKill: 'Kills (units defeated)', armyDead: 'Units lost', armyCure: 'Units treated', battleWin: 'Battles won',
    allBattleCount: 'Battles fought', zombieKill: 'Zombies defeated', likeNum: 'Likes', manorValue: 'Manor value',
    buildingPower: 'Building power', sciencePower: 'Tech power', armyPower: 'Army power', serverName: 'Home server',
    sharecode: 'Share code', totalCP: 'Total CP', facilityCP: 'Facility CP', technologyCP: 'Technology CP',
    infirmaryCapacity: 'Infirmary capacity'};
  function describe(v, key = '') {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(x => describe(x, key)).filter(Boolean).join(' · ');
    if (typeof v === 'object') return Object.entries(v).map(([k, x]) => {
      const d = describe(x, k);
      return d === '' ? '' : `${humanize(k)} ${d}`;
    }).filter(Boolean).join(', ');
    // ids, indexes, levels and stars are shown raw; only genuine quantities get thousands separators
    return typeof v === 'number' && !/id$|index|level|star|quality|position/i.test(key) ? num(v) : String(v);
  }
  function normalize(payload) {
    const players = payload.players;
    for (const p of players) {
      p.tabCount = p.tb ? p.tb.length : 0;
      p.search = `${p.n} ${p.b} ${p.an} ${p.u}`.toLowerCase();
    }
    return payload;
  }
  function applyFilters(players, s, alliances) {
    const q = s.q.trim().toLowerCase();
    const out = players.filter(p =>
      (!q || p.search.includes(q)) &&
      (!s.server || String(p.sv) === s.server) &&
      (!s.star || p.st) &&
      (s.alliance < 0 || p.ai === s.alliance) &&
      (!s.tab || (p.tb && p.tb.some(t => String(t[0]) === s.tab))));
    const key = {pw: p => p.pw, kl: p => p.kl, lv: p => p.lv, ls: p => p.ls, tabs: p => p.tabCount * 10 + (p.st || 0),
      name: p => p.n.toLowerCase(), alliance: p => (p.b || '').toLowerCase()}[s.sort] || (p => p.pw);
    return out.sort((a, b) => {
      const x = key(a), y = key(b);
      if (x == null && y == null) return 0;
      if (x == null) return 1;                       // missing values always sort last
      if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : 0) * s.dir || (a.n < b.n ? -1 : 1);
    });
  }
  function spark(points, {w = 120, h = 32, big = false} = {}) {
    if (!points || points.length < 2) return '';
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const pad = big ? 14 : 3, X = t => pad + (x1 === x0 ? 0 : (t - x0) / (x1 - x0)) * (w - 2 * pad),
      Y = v => h - pad - (y1 === y0 ? 0.5 : (v - y0) / (y1 - y0)) * (h - 2 * pad);
    const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)} ${Y(p[1]).toFixed(1)}`).join('');
    const last = points[points.length - 1];
    const dots = big ? points.map(p => `<circle cx="${X(p[0]).toFixed(1)}" cy="${Y(p[1]).toFixed(1)}" r="3"><title>${esc(dateStr(p[0]))}: ${esc(num(p[1]))}</title></circle>`).join('') : '';
    return `<svg class="pf-spark${big ? ' big' : ''}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="trend"><path class="area" d="${d}L${X(x1).toFixed(1)} ${h}L${X(x0).toFixed(1)} ${h}Z"/><path class="line" d="${d}"/>${dots || `<circle cx="${X(last[0]).toFixed(1)}" cy="${Y(last[1]).toFixed(1)}" r="2.5"/>`}</svg>`;
  }
  const delta = pts => pts && pts.length > 1 ? pts[pts.length - 1][1] - pts[0][1] : null;

  // ---------------------------------------------------------------- loading
  async function fetchBundle(path) {
    const res = await fetch(path, {cache: 'no-store'});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pw = SiteVault.saved();
    if (!pw) throw new Error('locked');
    return SiteVault.open(await res.json(), pw);
  }
  function load() {
    if (!loading) loading = fetchBundle(MAIN).then(p => {
      main = normalize(p);
      byUid = new Map(main.players.map(x => [x.u, x]));
      return main;
    }).catch(e => { loading = null; throw e; });
    return loading;
  }
  function loadDetail() {
    if (!detailLoading) detailLoading = fetchBundle(DETAIL).then(d => (detail = d)).catch(e => { detailLoading = null; throw e; });
    return detailLoading;
  }

  // ---------------------------------------------------------------- styles (injected: no theme.css change needed)
  const CSS = `
  .pf-hero h1{font-family:var(--display);font-size:clamp(2.2rem,5vw,3.6rem);margin:.2rem 0;letter-spacing:.02em;text-transform:uppercase}
  .pf-hero h1 span{color:var(--hazard)} .pf-beta{display:inline-block;font:600 .7rem var(--mono);padding:.15rem .5rem;border:1px solid var(--border-glow);border-radius:99px;color:var(--hazard-text);vertical-align:middle;margin-left:.5rem}
  .pf-hero p{color:var(--text-dim);max-width:70ch}
  .pf-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:.75rem;margin:1.2rem 0}
  .pf-tile{background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--radius);padding:.8rem 1rem}
  .pf-tile b{display:block;font:700 1.5rem var(--display);letter-spacing:.02em}.pf-tile small{color:var(--text-faint);font-size:.72rem;text-transform:uppercase;letter-spacing:.08em}
  .pf-tile .sub{display:block;color:var(--text-dim);font-size:.72rem;margin-top:.15rem}
  .pf-bar{display:flex;flex-wrap:wrap;gap:.6rem;align-items:end;margin:1rem 0}
  .pf-bar label{display:flex;flex-direction:column;gap:.25rem;font-size:.72rem;color:var(--text-faint);text-transform:uppercase;letter-spacing:.08em}
  .pf-bar input[type=search],.pf-bar select{background:var(--bg-card);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.5rem .7rem;font:inherit;min-width:9rem}
  .pf-bar .grow{flex:1;min-width:14rem}.pf-check{flex-direction:row!important;align-items:center;gap:.4rem!important;padding-bottom:.5rem}
  .pf-count{color:var(--text-dim);font-size:.85rem;margin:.4rem 0}
  .pf-scroll{overflow-x:auto;border:1px solid var(--border-subtle);border-radius:var(--radius)}
  table.pf{width:100%;border-collapse:collapse;font-size:.88rem}
  table.pf th{position:sticky;top:0;background:var(--bg-card-elev);text-align:left;font:600 .72rem var(--mono);text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim);padding:.6rem .7rem;white-space:nowrap;cursor:pointer}
  table.pf th.sorted{color:var(--hazard-text)} table.pf td{padding:.5rem .7rem;border-top:1px solid var(--border-subtle);white-space:nowrap}
  table.pf tr:hover td{background:var(--bg-card-hover)} .pf .n{text-align:right;font-variant-numeric:tabular-nums}
  .pf a{color:var(--text)} .pf a:hover{color:var(--hazard-text)}
  .pf-star{color:var(--hazard);font-weight:700;letter-spacing:-.1em;cursor:help}
  .pf-badge{display:inline-block;font:600 .68rem var(--mono);padding:.1rem .45rem;border-radius:99px;background:var(--hazard-dim);color:var(--hazard-text);border:1px solid var(--border-glow)}
  .pf-badge.mute{background:var(--bg-card-elev);color:var(--text-dim);border-color:var(--border)} .pf-badge.good{background:var(--good-dim);color:var(--good);border-color:transparent}
  .pf-pager{display:flex;justify-content:space-between;align-items:center;margin:.8rem 0}.pf-pager button{background:var(--bg-card);color:var(--text);border:1px solid var(--border);border-radius:var(--radius-sm);padding:.45rem .9rem;cursor:pointer}
  .pf-pager button:disabled{opacity:.4;cursor:default}
  .pf-spark{width:100%;height:32px;display:block}.pf-spark.big{height:130px}.pf-spark .line{fill:none;stroke:var(--hazard);stroke-width:1.6;vector-effect:non-scaling-stroke}
  .pf-spark .area{fill:var(--hazard-dim);stroke:none}.pf-spark circle{fill:var(--hazard)}
  .pf-card{background:var(--bg-card);border:1px solid var(--border-subtle);border-radius:var(--radius-lg);padding:1.1rem 1.25rem;margin:1rem 0}
  .pf-card h2{font:600 .8rem var(--mono);text-transform:uppercase;letter-spacing:.1em;color:var(--text-dim);margin:0 0 .8rem}
  .pf-head{display:flex;flex-wrap:wrap;gap:.6rem 1.2rem;align-items:center;justify-content:space-between}.pf-head h1{margin:0;font:700 clamp(1.8rem,4vw,2.8rem) var(--display)}
  .pf-meta{color:var(--text-dim);display:flex;flex-wrap:wrap;gap:.4rem .9rem;align-items:center;margin-top:.4rem}
  .pf-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:.75rem}
  .pf-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:1rem}
  .pf-tab{background:var(--bg-card-elev);border:1px solid var(--border-subtle);border-radius:var(--radius);padding:.7rem .9rem}
  .pf-tab h3{margin:0;font:600 .75rem var(--mono);text-transform:uppercase;color:var(--text-dim);display:flex;justify-content:space-between}
  .pf-tab .rank{font:700 1.7rem var(--display);color:var(--hazard-text)}.pf-tab .val{color:var(--text-dim);font-variant-numeric:tabular-nums}
  .pf-tab .x{color:var(--text-faint);font-size:.72rem;margin-top:.35rem;line-height:1.4;word-break:break-word}.pf-tab time{color:var(--text-faint);font-size:.7rem}
  .pf-chart small{display:flex;justify-content:space-between;color:var(--text-faint);font-size:.72rem}
  .pf-up{color:var(--good)}.pf-down{color:var(--danger)}
  .pf-timeline{list-style:none;margin:0;padding:0}.pf-timeline li{padding:.45rem 0;border-top:1px solid var(--border-subtle);display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap}
  .pf-note{color:var(--text-faint);font-size:.8rem;margin-top:1rem;line-height:1.5}
  .pf-lock{text-align:center;padding:3rem 1rem}.pf-lock button{margin-top:1rem}
  @media(max-width:640px){.pf-bar label{flex:1 1 45%}.pf-bar .grow{flex-basis:100%}}`;
  function ensureStyle() {
    if (document.getElementById('pf-style')) return;
    const el = document.createElement('style');
    el.id = 'pf-style';
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  // ---------------------------------------------------------------- views
  const view = () => document.getElementById('view');
  const owns = hash => /^#?(profiles|p\/)/.test(hash || '');
  const locked = () => typeof SAMPLE_MODE !== 'undefined' && SAMPLE_MODE;
  const stat = (label, value, sub) => `<div class="pf-tile"><small ${label === 'Alliance power' ? 'title="Power as shown in the in-game alliance member list. Can differ from Total CP on Commander Info."' : label === 'Power' ? 'title="In-game Total CP (Commander Info)"' : ''}>${esc(label)}</small><b>${value}</b>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
  const allianceOf = p => p.ai != null ? main.alliances[p.ai] : null;
  const tabName = i => main.tabs[i].l;

  function lockedView() {
    view().innerHTML = `<div class="pf-card pf-lock"><h2>Profiles (Beta)</h2><p>Player profiles are part of the protected data. Log in to view them.</p>
      <button type="button" class="primary-action" onclick="showLogin()">Log in</button></div>`;
  }
  function errorView(e) {
    view().innerHTML = `<div class="pf-card pf-lock"><h2>Profiles unavailable</h2><p>${esc(e.message === 'locked' ? 'Log in first.' : 'Could not load the profile data (' + e.message + '). Run Deploy again, or refresh the page.')}</p></div>`;
  }

  function listView() {
    const players = main.players, m = main.meta;
    const servers = [...new Set(players.map(p => p.sv).filter(v => v != null))].sort((a, b) => a - b);
    const al = state.alliance >= 0 ? main.alliances[state.alliance] : null;
    const withTabs = players.filter(p => p.tb).length;
    view().innerHTML = `<section class="pf-hero"><p class="eyebrow">INTELLIGENCE / PROFILES</p>
      <h1>Player <span>Profiles</span><span class="pf-beta">BETA</span></h1>
      <p>Every survivor we have seen, built from alliance rosters and the in-game leaderboards. Roster stats exist for nearly everyone; players marked <span class="pf-star">★</span> appear on the global leaderboards or have had their commander popup captured, and get an advanced profile.</p></section>
      <div class="pf-tiles">${stat('Profiles', num(m.players))}${stat('Advanced ★', num(m.stars), `both global boards or popup`)}${stat('On a leaderboard', num(withTabs), `${(100 * withTabs / m.players).toFixed(1)}% of profiles`)}${stat('Alliances', num(m.alliances))}${stat('Data refreshed', esc(ago(Date.parse(m.generatedAtUtc) / 1000)))}</div>
      <div class="pf-bar" role="search">
        <label class="grow">Search<input type="search" id="pfq" placeholder="Name, alliance tag, alliance name or uid…" value="${esc(state.q)}" oninput="Profiles.set('q',this.value)"></label>
        <label>Server<select onchange="Profiles.set('server',this.value)"><option value="">All</option>${servers.map(s => `<option value="${s}"${String(s) === state.server ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Leaderboard<select onchange="Profiles.set('tab',this.value)"><option value="">Any</option>${main.tabs.map((t, i) => `<option value="${i}"${String(i) === state.tab ? ' selected' : ''}>${esc(t.l)}</option>`).join('')}</select></label>
        <label>Sort<select onchange="Profiles.set('sort',this.value)">${[['pw', 'Power'], ['kl', 'Kills'], ['lv', 'HQ level'], ['ls', 'Last seen'], ['name', 'Name'], ['alliance', 'Alliance']].map(([k, l]) => `<option value="${k}"${state.sort === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="pf-check"><input type="checkbox" ${state.star ? 'checked' : ''} onchange="Profiles.set('star',this.checked)"> ★ advanced only</label>
        ${al ? `<label class="pf-check"><span class="pf-badge">${esc(al.b || al.n)} ✕</span><button type="button" class="pf-badge mute" onclick="Profiles.set('alliance',-1)">clear alliance</button></label>` : ''}
      </div>
      <div class="pf-count" id="pfcount" role="status"></div>
      <div class="pf-scroll"><table class="pf" aria-label="Player profiles"><thead><tr>
        <th></th>${[['name', 'Player'], ['alliance', 'Alliance'], ['', 'Server'], ['pw', 'Power'], ['lv', 'HQ'], ['kl', 'Kills'], ['ls', 'Last seen']].map(([k, l]) => `<th${k ? ` onclick="Profiles.set('sort','${k}')"` : ''} class="${k === state.sort ? 'sorted' : ''}${['pw', 'lv', 'kl'].includes(k) ? ' n' : ''}">${l}${k === state.sort ? (state.dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}
      </tr></thead><tbody id="pfrows"></tbody></table></div>
      <div class="pf-pager"><button type="button" id="pfprev" onclick="Profiles.page(-1)">← Previous</button><span id="pfpage"></span><button type="button" id="pfnext" onclick="Profiles.page(1)">Next →</button></div>
      <p class="pf-note">Beta. Each value carries its own capture date: rosters are refreshed whenever an alliance screen is opened, global leaderboard ranks only for players who were on a list when somebody looked. A blank means "never captured", not zero. Only global (cross-server) leaderboards are shown; server-only lists are left out because they only cover one server.</p>`;
    drawRows();
  }

  function drawRows() {
    shown = applyFilters(main.players, state, main.alliances);
    const pages = Math.max(1, Math.ceil(shown.length / PAGE));
    state.page = Math.min(state.page, pages - 1);
    const slice = shown.slice(state.page * PAGE, state.page * PAGE + PAGE);
    document.getElementById('pfcount').textContent = `${num(shown.length)} of ${num(main.players.length)} profiles`;
    document.getElementById('pfrows').innerHTML = slice.length ? slice.map(p => {
      const a = allianceOf(p);
      return `<tr><td>${p.st ? `<span class="pf-star" title="Advanced profile">${stars(p.st)}</span>` : ''}</td>
        <td><a href="#p/${esc(p.u)}">${esc(p.n)}</a></td>
        <td>${p.b ? esc(p.b) : '<span class="pf-badge mute">none</span>'}${a ? '' : p.b ? ' <span class="pf-badge mute" title="Not in the newest roster we captured for this alliance">left?</span>' : ''}</td>
        <td>${p.sv != null ? esc(p.sv) : '—'}</td><td class="n">${p.pw != null ? num(p.pw) : '—'}</td><td class="n">${p.lv != null ? p.lv : '—'}</td>
        <td class="n">${p.kl != null ? num(p.kl) : '—'}</td><td title="${esc(dateStr(p.ls))}">${esc(ago(p.ls))}</td></tr>`;
    }).join('') : `<tr><td colspan="8" class="empty">No matches. Try another name, tag or server.</td></tr>`;
    document.getElementById('pfpage').textContent = `Page ${state.page + 1} / ${pages}`;
    document.getElementById('pfprev').disabled = state.page === 0;
    document.getElementById('pfnext').disabled = state.page >= pages - 1;
  }

  function chartCard(title, pts, fmt = num) {
    if (!pts || pts.length < 2) return '';
    const d = delta(pts);
    return `<div class="pf-card pf-chart"><h2>${esc(title)}</h2>${spark(pts, {w: 600, h: 130, big: true})}
      <small><span>${esc(dateStr(pts[0][0]))} · ${esc(fmt(pts[0][1]))}</span><span class="${d >= 0 ? 'pf-up' : 'pf-down'}">${d >= 0 ? '+' : ''}${esc(fmt(d))}</span><span>${esc(dateStr(pts[pts.length - 1][0]))} · ${esc(fmt(pts[pts.length - 1][1]))}</span></small></div>`;
  }

  function tabCard(t, extra) {
    const tab = main.tabs[t.i];
    const hist = t.h && t.h.length > 1 ? spark(t.h.map(h => [h[0], -h[1]]), {w: 200, h: 36}) : '';
    const text = extra ? describe(extra.snap ? extra.snap : null) : '';
    const x = extra && extra.x ? describe(extra.x) : '';
    return `<div class="pf-tab"><h3><span>${esc(tab.l)}</span><span>${esc(tab.g)}</span></h3>
      <div class="rank">#${esc(t.r)}</div><div class="val">${esc(formatValue(tab, t.v))} <time>· ${esc(dateStr(t.ts))}</time></div>${hist}
      ${text ? `<div class="x">${esc(text)}</div>` : ''}${x ? `<div class="x">${esc(x)}</div>` : ''}</div>`;
  }

  function profileView(uid) {
    const p = byUid.get(uid);
    if (!p) { view().innerHTML = `<a class="back-btn" href="#profiles">&larr; Back</a><div class="pf-card empty">Profile not found in the current export.</div>`; return; }
    const a = allianceOf(p);
    const trackerLink = a && typeof STATE !== 'undefined' && STATE.alliances.some(x => x.allianceId === a.id) ? `<a href="#a/${encodeURIComponent(a.id)}">tracker page →</a>` : '';
    const tabs = (p.tb || []).map(t => ({i: t[0], r: t[1], v: t[2], ts: t[3]}));
    const hd = !p.pc || p.pcs ? delta(p.ph) : null;     // a CP tile never gets a delta computed from roster history
    view().innerHTML = `<a class="back-btn" href="#profiles">&larr; All profiles</a>
      <div class="pf-card"><div class="pf-head"><div><p class="eyebrow">PLAYER PROFILE</p><h1>${esc(p.n)} ${p.st ? `<span class="pf-star" title="Advanced profile">${stars(p.st)}</span>` : ''}</h1>
        <div class="pf-meta">${p.b ? `<span class="pf-badge">${esc(p.b)}</span>` : '<span class="pf-badge mute">no alliance</span>'}<span>${esc(p.an)}</span>
        ${a ? `<a href="#profiles" onclick="Profiles.set('alliance',${p.ai});return true">${num(a.m)} members →</a> ${trackerLink}` : p.b ? '<span class="pf-badge mute" title="Missing from the newest roster we captured for this alliance (left, kicked or just not captured yet)">not in latest roster</span>' : ''}
        ${p.sv != null ? `<span>Server ${esc(p.sv)}</span>` : ''}${p.on != null ? `<span class="pf-badge ${p.on ? 'good' : 'mute'}">${p.on ? 'online at capture' : 'offline at capture'}</span>` : ''}</div></div>
        <div class="pf-meta"><span>uid ${esc(p.u)}</span><span title="${esc(dateStr(p.ls))}">last seen ${esc(ago(p.ls))}</span></div></div></div>
      <div class="pf-tiles">${stat(p.pc ? 'Power' : 'Alliance power', p.pw != null ? num(p.pw) : '—', hd != null ? `<span class="${hd >= 0 ? 'pf-up' : 'pf-down'}">${hd >= 0 ? '+' : ''}${compact(hd)} since ${esc(dateStr(p.ph[0][0]))}</span>` : '')}
        ${p.aw != null ? stat('Alliance power', num(p.aw), '<span>as in the alliance member list</span>') : ''}${stat('HQ level', p.lv != null ? p.lv : '—')}${stat('Kills', p.kl != null ? num(p.kl) : '—')}${stat('Joined alliance', p.jt ? esc(dateStr(p.jt)) : '—')}
</div>
      <div class="pf-grid2">${chartCard(p.pcs ? 'Power over time' : 'Alliance power over time', p.ph, compact)}${chartCard('Kills over time', p.kh, compact)}${chartCard('HQ level over time', p.lh)}</div>
      ${p.cr ? `<div class="pf-card"><h2>Cultural relics</h2><div class="pf-grid"><div class="pf-tab"><h3><span>Relic power</span><span>${p.cr[2] != null ? 'Server ' + esc(p.cr[2]) : 'Server list'}</span></h3>
        <div class="rank">#${esc(p.cr[1])}</div><div class="val">${esc(num(p.cr[0]))} <time>· ${esc(dateStr(p.cr[3]))}</time></div>
        ${p.ch && p.ch.length > 1 ? spark(p.ch, {w: 200, h: 36}) : ''}<div class="x">Rank within that server's list only, shown where we captured it.</div></div></div></div>` : ''}
      ${tabs.length ? `<div class="pf-card"><h2>Global leaderboards (${tabs.length})</h2><div class="pf-grid" id="pftabs">${tabs.map(t => tabCard(t)).join('')}</div>
        ${p.st ? '<p class="pf-note" id="pfdetailnote">Loading the advanced profile…</p>' : ''}</div>` : ''}
      ${p.al ? `<div class="pf-card"><h2>Name &amp; alliance history</h2><ul class="pf-timeline">${[...p.al].reverse().map(x => `<li><span><b>${esc(x[0])}</b> ${x[1] ? `<span class="pf-badge mute">${esc(x[1])}</span>` : ''}</span><span>${esc(dateStr(x[2]))}${x[3] !== x[2] ? ' → ' + esc(dateStr(x[3])) : ''}</span></li>`).join('')}</ul></div>` : ''}
      <div id="pfextra"></div>
      <p class="pf-note">Values come from passive captures of what the game already shows. Each carries its own capture date; leaderboard ranks are positions in the captured list, not a live standing.</p>`;
    if (p.st) loadDetail().then(() => {
      const d = detail && detail.players[uid];
      if (!d || location.hash !== `#p/${uid}`) return;
      document.getElementById('pfdetailnote')?.remove();
      document.getElementById('pftabs').innerHTML = d.tabs.map(t => tabCard(t, t)).join('');
      document.getElementById('pfextra').innerHTML = extraCards(d);
    }).catch(() => { const n = document.getElementById('pfdetailnote'); if (n) n.textContent = 'Advanced details are unavailable right now.'; });
  }

  function extraCards(d) {
    let h = '';
    if (d.popup) {
      const rows = Object.entries({...d.popup.player, ...d.popup.moreInfo});
      h += `<div class="pf-card"><h2>Commander info · ${esc(dateStr(d.popup.ts))}</h2><div class="pf-grid">${rows.map(([k, v]) => `<div class="pf-tab"><h3><span>${esc(LABELS[k] || humanize(k))}</span></h3><div class="val">${esc(typeof v === 'number' ? num(v) : v)}</div></div>`).join('')}</div></div>`;
    }
    return h + `<p class="pf-note">Hero, beast and weapon entries show game ids; names are not mapped yet.</p>`;
  }

  // ---------------------------------------------------------------- public
  let timer;
  function set(key, value) {
    state[key] = value;
    if (key === 'sort') {
      const same = state._last === value;
      state._last = value;
      state.dir = same ? -state.dir : (value === 'name' || value === 'alliance' ? 1 : -1);
    }
    state.page = 0;
    if (key === 'alliance') { location.hash = '#profiles'; if (document.getElementById('pfrows')) listView(); return; }
    if (key === 'q') { clearTimeout(timer); timer = setTimeout(drawRows, 120); return; }
    if (key === 'sort' || key === 'tab' || key === 'server' || key === 'star') { listView(); const q = document.getElementById('pfq'); if (q && key === 'sort') q.blur(); }
  }
  function page(step) { state.page += step; drawRows(); document.getElementById('pfrows').scrollIntoView({block: 'start'}); }

  async function render() {
    ensureStyle();
    document.querySelectorAll('[data-nav]').forEach(l => l.dataset.nav === 'profiles' ? l.setAttribute('aria-current', 'page') : l.removeAttribute('aria-current'));
    const label = document.getElementById('pageLabel');
    if (label) label.textContent = 'Profiles (Beta)';
    if (locked()) { lockedView(); return; }
    const hash = location.hash;
    if (!main) view().innerHTML = '<div class="empty" role="status">Loading profiles…</div>';
    try { await load(); } catch (e) { if (location.hash === hash) errorView(e); return; }
    if (location.hash !== hash) return;
    if (hash.startsWith('#p/')) profileView(decodeURIComponent(hash.slice(3))); else listView();
    if (window.lucide) lucide.createIcons();
    window.scrollTo(0, 0);
  }

  const api = {owns, render, set, page, state, ensureStyle, formatValue, applyFilters, normalize, spark, describe, delta, stars,
    helpers: {num, compact, dateStr, ago, humanize}};
  return api;
})();
if (typeof module !== 'undefined') module.exports = Profiles;
