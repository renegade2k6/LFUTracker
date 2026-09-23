/* Local browser history only. Capture/export files are never written. */
const PlayerPower = (() => {
  const KEY = 'alliance-tracker.player-power.v1';
  function validPower(p) { return typeof p === 'number' && Number.isFinite(p) && p >= 0; }
  function validPoint(p) { return p && validPower(p.power) && Number.isFinite(p.time); }
  function update(alliances, storage) {
    let records = {}, saved = true;
    try {
      const raw = storage.getItem(KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      if (parsed?.version === 1 && parsed.records && typeof parsed.records === 'object') {
        for (const [uid, entry] of Object.entries(parsed.records)) {
          if (validPoint(entry?.current)) records[uid] = {current: entry.current,
            previous: validPoint(entry.previous) ? entry.previous : null};
        }
      }
    } catch { saved = false; }
    const latest = new Map(), conflicts = new Set();
    for (const a of alliances) {
      for (const m of a.members || []) {
        // A member can carry a newer per-player observation (season leaderboard merge).
        const time = Date.parse(m.capturedAtUtc || a.capturedAtUtc);
        if (!Number.isFinite(time)) continue;
        const uid = String(m.uid ?? '');
        if (!/^\d+$/.test(uid) || m.power == null || String(m.power).trim() === '') continue;
        const power = Number(m.power);
        if (!validPower(power)) continue;
        const prior = latest.get(uid);
        if (!prior || time > prior.time) { latest.set(uid, {power, time}); conflicts.delete(uid); }
        else if (time === prior.time && power !== prior.power) conflicts.add(uid);
      }
    }
    let changed = false;
    for (const [uid, point] of latest) {
      if (conflicts.has(uid)) continue;
      const entry = records[uid];
      if (!entry || point.time > entry.current.time) {
        records[uid] = {current: point, previous: entry?.current ?? null};
        changed = true;
      }
    }
    if (changed) {
      // Bound storage; retain the 10,000 most recently captured players.
      records = Object.fromEntries(Object.entries(records).sort((a, b) => b[1].current.time - a[1].current.time).slice(0, 10000));
      try { storage.setItem(KEY, JSON.stringify({version: 1, records})); }
      catch { saved = false; }
    }
    return {records, saved, conflicts};
  }
  function movement(tracking, member, capturedAtUtc) {
    const uid = String(member.uid ?? '');
    const entry = tracking.records[uid];
    const time = Date.parse(capturedAtUtc);
    if (tracking.conflicts.has(uid) || !entry || entry.current.time !== time ||
        member.power == null || String(member.power).trim() === '' || entry.current.power !== Number(member.power)) return null;
    if (!entry.previous) return null;
    const delta = entry.current.power - entry.previous.power;
    return {delta, percent: entry.previous.power === 0 ? null : delta / entry.previous.power * 100,
      previousTime: entry.previous.time, currentTime: entry.current.time, previousPower: entry.previous.power};
  }
  return {update, movement};
})();
