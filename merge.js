/* Source-agnostic data merge. Every in-game source (alliance rosters, season leaderboard,
   future captures) is reduced to the same observations of alliances and players, each
   stamped with its own time and source. The newest observation wins, field by field,
   no matter which source it came from. Inputs are never mutated; every merged value keeps
   its provenance (…Source / …AtUtc) so the page can say where a number came from.

   Alliance observation: {allianceId, name, abbr, serverId, level, leaderName, power, rank, at, source}
   Player observation:   {uid, name, power, originServerId, rank, at, source,
                          allianceId? | allianceAbbr + allianceName (resolved by exact name)} */
const DataMerge = (() => {
  const time = v => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
  const iso = t => new Date(t).toISOString();
  const nameKey = (abbr, name) => `${String(abbr ?? '').trim()}|${String(name ?? '').trim()}`;
  const allianceTime = a => time(a.updatedAtUtc) ?? time(a.capturedAtUtc) ?? -Infinity;
  const memberTime = (a, m) => time(m.capturedAtUtc) ?? time(a.capturedAtUtc) ?? -Infinity;

  /* ---------- adapters: one per source ---------- */
  function fromSeasonLeaderboard(lb) {
    const obs = {alliances: [], players: [], history: []};
    if (!lb || lb.__failed) return obs;
    const source = 'season-leaderboard';
    const a = lb.alliances, p = lb.players;
    const at = b => b && Array.isArray(b.rows) ? time(b.capturedAtUtc) : null;
    if (at(a) !== null) {
      for (const r of a.rows) if (r && r.allianceId) obs.alliances.push({allianceId: r.allianceId, name: r.name, abbr: r.abbr,
        serverId: r.serverId, level: r.level, leaderName: r.leaderName, power: r.power, rank: r.rank, at: at(a), source});
      for (const [id, points] of Object.entries(a.history || {}))
        for (const [when, power] of points || []) if (time(when) !== null) obs.history.push({allianceId: id, at: time(when), power, source});
    }
    if (at(p) !== null) {
      for (const r of p.rows) if (r && r.uid) obs.players.push({uid: String(r.uid), name: r.name, power: r.power, originServerId: r.serverId,
        rank: r.rank, allianceAbbr: r.abbr, allianceName: r.allianceName, at: at(p), source});
    }
    return obs;
  }

  /* ---------- merge ---------- */
  function apply(alliances, history, observations) {
    const report = {updatedAlliances: 0, addedAlliances: 0, updatedPlayers: 0, addedPlayers: 0, movedPlayers: 0, skipped: 0, removedEmpty: 0};
    const out = (alliances || []).map(a => ({...a, members: (a.members || []).map(m => ({...m}))}));
    const hist = Object.fromEntries(Object.entries(history || {}).map(([id, points]) => [id, [...(points || [])]]));
    const obs = observations || {};
    const byId = new Map(out.map(a => [a.allianceId, a]));
    const byName = new Map();
    const index = a => { const k = nameKey(a.abbr, a.name); byName.set(k, byName.has(k) && byName.get(k) !== a ? null : a); };
    out.forEach(index);
    const newAlliance = (fields, at, source) => {
      const a = {level: null, leaderName: null, fightPower: null, curMember: null, maxMember: null, alliancePoint: null,
        ...fields, capturedAtUtc: iso(at), updatedAtUtc: iso(at), members: [], source};
      out.push(a); byId.set(a.allianceId, a); index(a); report.addedAlliances++;
      return a;
    };

    // Alliances: oldest first so the newest observation is applied last and wins.
    for (const o of [...(obs.alliances || [])].sort((x, y) => x.at - y.at)) {
      let a = byId.get(o.allianceId);
      if (!a) {
        newAlliance({allianceId: o.allianceId, name: o.name, abbr: o.abbr, originServerId: o.serverId, level: o.level ?? null,
          leaderName: o.leaderName ?? null, fightPower: o.power == null ? null : String(o.power),
          fightPowerSource: o.source, fightPowerAtUtc: iso(o.at)}, o.at, o.source);
      } else if (o.at > allianceTime(a)) {
        Object.assign(a, {name: o.name ?? a.name, abbr: o.abbr ?? a.abbr, level: o.level ?? a.level,
          leaderName: o.leaderName ?? a.leaderName, updatedAtUtc: iso(o.at)});
        if (o.power != null) Object.assign(a, {fightPower: String(o.power), fightPowerSource: o.source, fightPowerAtUtc: iso(o.at)});
        index(a); report.updatedAlliances++;
      }
      if (o.rank != null) byId.get(o.allianceId).ranks = {...(byId.get(o.allianceId).ranks || {}), [o.source]: o.rank};
    }

    // Power history points from any source, deduplicated by time.
    for (const o of obs.history || []) {
      const list = hist[o.allianceId] || (hist[o.allianceId] = []);
      if (list.some(p => time(p.capturedAtUtc) === o.at)) continue;
      list.push({capturedAtUtc: iso(o.at), fightPower: String(o.power), source: o.source});
    }
    Object.values(hist).forEach(list => list.sort((x, y) => time(x.capturedAtUtc) - time(y.capturedAtUtc)));

    // Players: newest observation owns power, name and alliance membership.
    const members = new Map();
    out.forEach(a => a.members.forEach(m => m.uid != null && members.set(String(m.uid), {a, m})));
    for (const o of [...(obs.players || [])].sort((x, y) => x.at - y.at)) {
      let target = o.allianceId ? byId.get(o.allianceId) || null : null;
      if (!target && String(o.allianceAbbr ?? '').trim()) {
        const k = nameKey(o.allianceAbbr, o.allianceName);
        target = byName.get(k) || null;
        // Alliance known only through a player row: keep it; power stays unknown until observed.
        if (!target && !byName.has(k)) target = newAlliance({allianceId: `name:${k}`, name: o.allianceName, abbr: o.allianceAbbr,
          originServerId: o.originServerId}, o.at, o.source);
      }
      const found = members.get(o.uid);
      const fields = {name: o.name, power: Number(o.power), capturedAtUtc: iso(o.at), powerSource: o.source};
      if (found && (!target || found.a === target)) {
        if (o.rank != null) found.m.ranks = {...(found.m.ranks || {}), [o.source]: o.rank};
        if (o.at > memberTime(found.a, found.m)) {
          Object.assign(found.m, {...fields, name: o.name ?? found.m.name, originServerId: o.originServerId ?? found.m.originServerId});
          report.updatedPlayers++;
        }
      } else if (target && (!found || o.at > memberTime(found.a, found.m))) {
        // New to the site, or seen in a different alliance more recently than their last roster.
        const m = {uid: o.uid, originServerId: o.originServerId, ...fields, source: o.source,
          ranks: o.rank != null ? {[o.source]: o.rank} : undefined};
        target.members.push(m);
        if (found) { found.m.movedToAllianceId = target.allianceId; report.movedPlayers++; } else report.addedPlayers++;
        members.set(o.uid, {a: target, m});
      } else report.skipped++;
    }
    // Alliances with no known members (e.g. seen only on the alliance leaderboard) are not listed.
    const listed = out.filter(a => a.members.some(m => !m.movedToAllianceId));
    report.removedEmpty = out.length - listed.length;
    return {alliances: listed, history: hist, report};
  }

  return {apply, fromSeasonLeaderboard};
})();
if (typeof module !== 'undefined') module.exports = DataMerge;
