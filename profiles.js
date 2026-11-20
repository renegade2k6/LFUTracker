/* Profiles (Beta) tab. Self-contained: loads data/profiles.enc.json (every player) and, on demand,
   data/profiles-detail.enc.json (advanced "star" players), both written by scripts/profiles.py and
   decrypted in the browser with the same site password as the tracker (vault.js).
   Pure helpers are exported for tests (tests/profiles.test.cjs); everything below `render` needs a DOM. */
const Profiles = (() => {
  const MAIN = 'data/profiles.enc.json', DETAIL = 'data/profiles-detail.enc.json';
  const PAGE = 50;
  const state = {q: '', name: '', an: '', tag: '', server: '', exact: false, star: false, tab: '', sort: 'pw', dir: -1, page: 0, alliance: -1};
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
    if (typeof v === 'object') return Object.entries(v).filter(([k]) => !/^(cur)?server(id)?$/i.test(k)).map(([k, x]) => {   // server ids on leaderboard rows are merged host servers, not the player's
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
      p.nl = String(p.n).toLowerCase(); p.anl = String(p.an || '').toLowerCase(); p.bl = String(p.b || '').toLowerCase();
    }
    return payload;
  }
  function applyFilters(players, s, alliances) {
    const q = s.q.trim().toLowerCase();
    const out = players.filter(p =>
      (!q || p.search.includes(q)) &&
      (!s.name || p.nl.includes(s.name.trim().toLowerCase())) &&
      (!s.an || p.anl.includes(s.an.trim().toLowerCase())) &&
      (!s.tag || p.bl.includes(s.tag.trim().toLowerCase())) &&
      (!s.server || String(p.sv) === s.server) &&
      (!s.exact || (p.sv != null && !p.sx)) &&                    // exact servers only: from a leaderboard row or popup, not inferred
      (!s.star || p.st) &&
      (s.alliance < 0 || p.ai === s.alliance) &&
      (!s.tab || (p.tb && p.tb.some(t => String(t[0]) === s.tab))));
    const key = {pw: p => p.pw, kl: p => p.kl, ls: p => p.ls, tabs: p => p.tabCount * 10 + (p.st || 0),
      name: p => p.n.toLowerCase(), an: p => (p.an || '').toLowerCase(), alliance: p => (p.b || '').toLowerCase(), sv: p => p.sv}[s.sort] || (p => p.pw);
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
  // Highest power seen: this pipeline's peak, the current value, and the tracker's peaks (roster history plus the season leaderboard).
  const trackerPeaks = () => (typeof STATE !== 'undefined' && STATE.peaks instanceof Map) ? STATE.peaks : null;
  const peakOf = (p, ext = trackerPeaks()) => {
    const v = [p.pk, p.pw, ext && ext.get(String(p.u))].filter(x => Number.isFinite(x));
    return v.length ? Math.max(...v) : null;
  };
  // CSV identical in layout to the All Players export (same columns, order, "power (highest seen)" format, UTC timestamps and
  // formula-safe cells). Power is the same single number the table and profile show.
  function csv(rows, alliances, ext = trackerPeaks()) {
    const cell = v => { let t = String(v ?? ''); if (/^[\s]*[=+@-]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const head = ['Player Name', 'Alliance Name', 'Alliance Tag', 'Server Number', 'Power', 'Last Updated (UTC)'];
    const body = rows.map(p => {
      const al = p.ai != null && alliances ? alliances[p.ai] : null;
      const power = p.pw;
      const peak = peakOf(p, ext);
      const shownPower = peak != null ? `${power ?? ''} (${peak})`.trim() : power;
      return [p.n, (al && al.n) || p.an, (al && al.b) || p.b, p.sv, shownPower,
              p.ls ? new Date(p.ls * 1000).toISOString().slice(0, 19).replace('T', ' ') : ''];
    });
    return '﻿' + [head, ...body].map(r => r.map(cell).join(',')).join('\r\n');
  }
  function exportCsv() {
    if (!main) return;
    const url = URL.createObjectURL(new Blob([csv(shown, main.alliances)], {type: 'text/csv;charset=utf-8;'}));
    const a = document.createElement('a');
    a.href = url; a.download = `players-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
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
  .pf-actions{margin:.2rem 0 .5rem}.pf-actions button{cursor:pointer;font:inherit}
  .pf-an{color:var(--text-dim)}.power-peak{color:var(--text-faint);font-weight:400}
  .pf-scroll{overflow-x:auto;border:1px solid var(--border-subtle);border-radius:var(--radius)}
  table.pf{width:100%;border-collapse:collapse;font-size:.88rem;table-layout:auto}
  @media (max-width:720px){table.pf:not(.sv-t){min-width:700px}}
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
  .pf-gl{margin:0 0 .9rem}.pf-gl h3{margin:0;padding:.45rem .85rem;background:linear-gradient(#8b8b90,#66666b);color:#fff;font:600 1rem var(--body,inherit);border-radius:4px 4px 0 0}
  .pf-gl .row{display:flex;justify-content:space-between;gap:1rem;padding:.55rem .85rem;background:#2a2a2e;border-bottom:2px solid #18181b}
  .pf-gl .row span{color:#a9a597}.pf-gl .row b{color:#fff;font-weight:600;font-variant-numeric:tabular-nums;text-align:right}
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
  const stat = (label, value, sub) => `<div class="pf-tile"><small ${label === 'Power' ? 'title="The newest player power we captured (commander CP, the season-map Player Power list or an alliance member list)"' : ''}>${esc(label)}</small><b>${value}</b>${sub ? `<span class="sub">${sub}</span>` : ''}</div>`;
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
    const cols = [['name', 'Player Name'], ['an', 'Alliance Name'], ['alliance', 'Alliance Tag'], ['sv', 'Server Number'], ['pw', 'Power'], ['kl', 'Kills']];
    const filt = [['name', 'Player Name', 'Any part of a name'], ['an', 'Alliance Name', 'Any part of a name'], ['tag', 'Alliance Tag', 'e.g. PX1']];
    view().innerHTML = `<section class="database-heading"><p class="eyebrow">INTELLIGENCE / PROFILES</p><h1>PLAYER <span>PROFILES</span><span class="pf-beta">BETA</span></h1>
      <p>Every survivor we have seen, built from alliance rosters and the in-game leaderboards. Players marked <span class="pf-star">★</span> get an advanced profile. ${num(m.players)} profiles · ${num(m.stars)} advanced · ${num(withTabs)} on a leaderboard · refreshed ${esc(ago(Date.parse(m.generatedAtUtc) / 1000))}.</p></section>
      <div class="database-filters" role="search" aria-label="Filter profiles">${filt.map(([k, l, hint]) => `<label class="database-filter"><span>${l}</span><input class="filter" type="search" placeholder="${hint}" value="${esc(state[k])}" oninput="Profiles.set('${k}',this.value)"></label>`).join('')}</div>
      <div class="pf-bar" role="search">
        <label>Server<select onchange="Profiles.set('server',this.value)"><option value="">All</option>${servers.map(s => `<option value="${s}"${String(s) === state.server ? ' selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Leaderboard<select onchange="Profiles.set('tab',this.value)"><option value="">Any</option>${main.tabs.map((t, i) => `<option value="${i}"${String(i) === state.tab ? ' selected' : ''}>${esc(t.l)}</option>`).join('')}</select></label>
        <label class="pf-check" title="Hide players whose server is only inferred from their alliance (~)"><input type="checkbox" ${state.exact ? 'checked' : ''} onchange="Profiles.set('exact',this.checked)"> exact server only</label>
        <label class="pf-check"><input type="checkbox" ${state.star ? 'checked' : ''} onchange="Profiles.set('star',this.checked)"> ★ advanced only</label>
        ${al ? `<label class="pf-check"><span class="pf-badge">${esc(al.b || al.n)} ✕</span><button type="button" class="pf-badge mute" onclick="Profiles.set('alliance',-1)">clear alliance</button></label>` : ''}
      </div>
      <div class="database-toolbar"><span id="pfcount" role="status"></span><span class="database-hint">Click a column header to sort · Filled boxes must all match</span><button type="button" class="export-button" onclick="Profiles.exportCsv()" title="Every matching profile, in the current sort order, with full numbers"><svg class="icon-sm" data-lucide="download"></svg> <span id="pfexport">Export CSV</span></button></div>
      <p class="database-mobile-hint">Swipe the table sideways to see all columns.</p>
      <div class="database-scroll" tabindex="0" aria-label="Sortable player profiles"><table class="database-table" aria-label="Player profiles"><thead><tr>
        ${cols.map(([k, l]) => `<th scope="col" aria-sort="${k === state.sort ? (state.dir < 0 ? 'descending' : 'ascending') : 'none'}"><button onclick="Profiles.set('sort','${k}')">${l}<span aria-hidden="true">${k === state.sort ? (state.dir < 0 ? '↓' : '↑') : '↕'}</span></button></th>`).join('')}
      </tr></thead><tbody id="pfrows"></tbody></table></div>
      <div class="database-pagination"><span id="pfpage" role="status"></span><div><button type="button" id="pfprev" onclick="Profiles.page(-1)">Previous</button><button type="button" id="pfnext" onclick="Profiles.page(1)">Next</button></div></div>
      <p class="database-footnote">Export includes all matching rows in the current sort order, including other pages, with full numeric power values. Brackets show the highest power seen. A <b>~</b> after a server number means it is the server of the player's alliance, because the player's own server was not captured. Each value carries its own capture date; a blank means "never captured", not zero. Only global (cross-server) leaderboards are shown.</p>`;
    drawRows();
  }

  function drawRows() {
    shown = applyFilters(main.players, state, main.alliances);
    const pages = Math.max(1, Math.ceil(shown.length / PAGE));
    state.page = Math.min(state.page, pages - 1);
    const slice = shown.slice(state.page * PAGE, state.page * PAGE + PAGE);
    document.getElementById('pfcount').textContent = `${num(shown.length)} / ${num(main.players.length)} players`;
    document.getElementById('pfexport').textContent = `Export ${num(shown.length)} players (CSV)`;
    document.getElementById('pfrows').innerHTML = slice.length ? slice.map(p => {
      const a = allianceOf(p);
      return `<tr><td><a href="#p/${esc(p.u)}">${esc(p.n)}</a>${p.st ? ` <span class="pf-star" title="Advanced profile">${stars(p.st)}</span>` : ''}</td>
        <td>${esc((a && a.n) || p.an)}</td><td>${p.b ? esc(p.b) : '<span class="pf-badge mute">none</span>'}${a ? '' : p.b ? ' <span class="pf-badge mute" title="Not in the newest roster we captured for this alliance">left?</span>' : ''}</td>
        <td class="numeric"${p.sx ? ' title="Server of this player\'s alliance (their own server was not captured)"' : ''}>${p.sv != null ? esc(p.sv) : '—'}${p.sx ? '<small style="color:var(--text-faint)" aria-label="alliance server, inferred"> ~</small>' : ''}</td><td class="numeric">${p.pw != null ? num(p.pw) : '—'}${peakOf(p) != null && peakOf(p) !== p.pw ? ` <span class="power-peak" title="Highest power seen">(${num(peakOf(p))})</span>` : ''}</td>
        <td class="numeric">${p.kl != null ? num(p.kl) : '—'}</td></tr>`;
    }).join('') : `<tr><td colspan="6" class="empty">No matches. Try another name, tag or server.</td></tr>`;
    document.getElementById('pfpage').textContent = `Page ${num(state.page + 1)} of ${num(pages)}`;
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
    const hd = delta(p.ph);
    view().innerHTML = `<a class="back-btn" href="#profiles">&larr; All profiles</a>
      <div class="pf-card"><div class="pf-head"><div><p class="eyebrow">PLAYER PROFILE</p><h1>${esc(p.n)} ${p.st ? `<span class="pf-star" title="Advanced profile">${stars(p.st)}</span>` : ''}</h1>
        <div class="pf-meta">${p.b ? `<span class="pf-badge">${esc(p.b)}</span>` : '<span class="pf-badge mute">no alliance</span>'}<span>${esc(p.an)}</span>
        ${a ? `<a href="#profiles" onclick="Profiles.set('alliance',${p.ai});return true">${num(a.m)} members →</a> ${trackerLink}` : p.b ? '<span class="pf-badge mute" title="Missing from the newest roster we captured for this alliance (left, kicked or just not captured yet)">not in latest roster</span>' : ''}
        ${p.sv != null ? `<span${p.sx ? ' title="Server of this player\'s alliance (their own server was not captured)"' : ''}>Server ${esc(p.sv)}${p.sx ? ' ~ <small>(alliance server)</small>' : ''}</span>` : ''}${p.on != null ? `<span class="pf-badge ${p.on ? 'good' : 'mute'}">${p.on ? 'online at capture' : 'offline at capture'}</span>` : ''}</div></div>
        <div class="pf-meta"><span>uid ${esc(p.u)}</span><span title="${esc(dateStr(p.ls))}">last seen ${esc(ago(p.ls))}</span></div></div></div>
      <div class="pf-tiles">${stat('Power', p.pw != null ? num(p.pw) : '—', hd != null ? `<span class="${hd >= 0 ? 'pf-up' : 'pf-down'}">${hd >= 0 ? '+' : ''}${compact(hd)} since ${esc(dateStr(p.ph[0][0]))}</span>` : '')}
        ${peakOf(p) != null && peakOf(p) !== p.pw ? stat('Peak power', num(peakOf(p)), '<span>highest seen</span>') : ''}${stat('Kills', p.kl != null ? num(p.kl) : '—')}${stat('Joined alliance', p.jt ? esc(dateStr(p.jt)) : '—')}
</div>
      <div class="pf-grid2">${chartCard('Power over time', p.ph, compact)}${chartCard('Kills over time', p.kh, compact)}</div>
      ${p.cr ? `<div class="pf-card"><h2>Cultural relics</h2><div class="pf-grid"><div class="pf-tab"><h3><span>Relic power</span><span>${p.cr[2] != null ? 'Server ' + esc(p.cr[2]) : 'Server list'}</span></h3>
        <div class="rank">#${esc(p.cr[1])}</div><div class="val">${esc(num(p.cr[0]))} <time>· ${esc(dateStr(p.cr[3]))}</time></div>
        ${p.ch && p.ch.length > 1 ? spark(p.ch, {w: 200, h: 36}) : ''}<div class="x">Rank within that server's list only, shown where we captured it.</div></div></div></div>` : ''}
      ${tabs.length ? `<div class="pf-card"><h2>Global leaderboards (${tabs.length})</h2><div class="pf-grid" id="pftabs">${tabs.map(t => tabCard(t)).join('')}</div>
        ${p.st ? '<p class="pf-note" id="pfdetailnote">Loading the advanced profile…</p>' : ''}</div>` : ''}
      ${p.mv ? `<div class="pf-card"><h2>Alliance moves</h2><ul class="pf-timeline">${[...p.mv].reverse().map(x => `<li><span>${x[1] ? `<span class="pf-badge mute">${esc(x[1])}</span> ` : ''}<b>${esc(x[0])}</b></span><span>${esc(dateStr(x[2]))}${x[3] !== x[2] ? ' → ' + esc(dateStr(x[3])) : ''}</span></li>`).join('')}</ul><p class="pf-note">Alliances this player was seen in on a complete roster; dates are first and last sighting.</p></div>` : ''}
      ${p.al ? `<div class="pf-card"><h2>Name &amp; alliance history</h2><ul class="pf-timeline">${[...p.al].reverse().map(x => `<li><span><b>${esc(x[0])}</b> ${x[1] ? `<span class="pf-badge mute">${esc(x[1])}</span>` : ''}</span><span>${esc(dateStr(x[2]))}${x[3] !== x[2] ? ' → ' + esc(dateStr(x[3])) : ''}</span></li>`).join('')}</ul></div>` : ''}
      <div id="pfextra"></div>
      <p class="pf-note">Values come from passive captures of what the game already shows. Each carries its own capture date; leaderboard ranks are positions in the captured list, not a live standing.</p>`;
    if (p.st) loadDetail().then(() => {
      const d = detail && detail.players[uid];
      if (!d || location.hash !== `#p/${uid}`) return;
      document.getElementById('pfdetailnote')?.remove();
      const tabsEl = document.getElementById('pftabs');       // absent when the player has no global ranks (popup-only profiles)
      if (tabsEl) tabsEl.innerHTML = d.tabs.map(t => tabCard(t, t)).join('');
      document.getElementById('pfextra').innerHTML = extraCards(d);
    }).catch(() => { const n = document.getElementById('pfdetailnote'); if (n) n.textContent = 'Advanced details are unavailable right now.'; });
  }

  // Commander Info "More Info" as the game groups it. Other players only expose Battles; your own account also shows CP.
  // Labels and row order are the game's (the capture lists zombies before units defeated (yours); the game does not).
  const GAME_SECTIONS = [
    ['CP', [['totalCP', 'Total CP'], ['facilityCP', 'Facility Combat Power'], ['technologyCP', 'Technology Combat Power'], ['armyPower', 'Army Power']]],
    ['Battles', [['battlesTotal', 'Total Battles'], ['battleVictories', 'Battle Victories'], ['unitsDefeatedEnemies', 'Units Defeated (Enemies)'],
      ['unitsDefeatedYours', 'Units Defeated (Yours)'], ['unitsTreatedYours', 'Units Treated (Yours)'], ['zombiesDefeated', 'Zombies Defeated']]],
  ];
  // Popup fields that only repeat a row of the sections above (same number, older name). Hidden by KEY, and only when the
  // sections are shown, so a profile without More Info still lists them and an unrelated field is never hidden by value.
  const SECTION_REPEATS = new Set(['armyKill', 'buildingPower', 'sciencePower', 'battleWin', 'allBattleCount', 'zombieKill', 'armyDead', 'armyCure']);
  // -> [{title, rows: [[label, value]]}]: the game's sections first, then anything else we captured that is not a repeat of them.
  function commanderSections(popup) {
    const all = {...(popup.player || {}), ...(popup.moreInfo || {})};
    const used = new Set(), out = [];
    for (const [title, keys] of GAME_SECTIONS) {
      const rows = keys.filter(([k]) => all[k] != null && all[k] !== '').map(([k, label]) => { used.add(k); return [label, num(all[k])]; });
      if (rows.length) out.push({title, rows});
    }
    const rest = Object.entries(all).filter(([k, v]) => !used.has(k) && v != null && v !== '' && !(out.length && SECTION_REPEATS.has(k)))
      .map(([k, v]) => [LABELS[k] || humanize(k), describe(v, k)]);
    if (rest.length) out.push({title: 'More', rows: rest});
    return out;
  }
  const sectionHtml = s => `<div class="pf-gl"><h3>${esc(s.title)}</h3>${s.rows.map(([l, v]) => `<div class="row"><span>${esc(l)}</span><b>${esc(v)}</b></div>`).join('')}</div>`;

  function extraCards(d) {
    let h = '';
    if (d.popup) h += `<div class="pf-card"><h2>Commander info · ${esc(dateStr(d.popup.ts))}</h2>${commanderSections(d.popup).map(sectionHtml).join('')}</div>`;
    return h + `<p class="pf-note">Hero, beast and weapon entries show game ids; names are not mapped yet.</p>`;
  }

  // ---------------------------------------------------------------- public
  let timer;
  function set(key, value) {
    state[key] = value;
    if (key === 'sort') {
      const same = state._last === value;
      state._last = value;
      state.dir = same ? -state.dir : (['name', 'an', 'alliance', 'sv'].includes(value) ? 1 : -1);
    }
    state.page = 0;
    if (key === 'alliance') { location.hash = '#profiles'; if (document.getElementById('pfrows')) listView(); return; }
    if (key === 'q' || key === 'name' || key === 'an' || key === 'tag') { clearTimeout(timer); timer = setTimeout(drawRows, 120); return; }
    if (key === 'sort' || key === 'tab' || key === 'server' || key === 'star' || key === 'exact') listView();
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

  const api = {owns, render, set, exportCsv, csv, peakOf, page, state, ensureStyle, formatValue, applyFilters, normalize, spark, describe, delta, stars,
    helpers: {num, compact, dateStr, ago, humanize}, commanderSections};
  return api;
})();
if (typeof module !== 'undefined') module.exports = Profiles;
