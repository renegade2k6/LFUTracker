/* Browser-only ranking comparison. Reads existing captures; never writes data. */
const AllianceRankings = (() => {
  function power(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  function order(alliances) {
    return [...alliances].sort((a, b) =>
      (power(b.fightPower) ?? -1) - (power(a.fightPower) ?? -1) ||
      String(a.allianceId).localeCompare(String(b.allianceId)));
  }
  function ranks(alliances) {
    const result = new Map();
    let previous = null, rank = 0;
    order(alliances).forEach((a, i) => {
      const value = power(a.fightPower);
      if (value === null) return;
      if (value !== previous) rank = i + 1;
      result.set(a.allianceId, rank);
      previous = value;
    });
    return result;
  }
  // Compares each alliance's current rank against its OWN first-ever capture --
  // "since we started tracking this alliance," not a fixed time window. Needs no
  // external data and no fuzzy name/server matching: an alliance only "counts" once
  // it has at least two distinct history points (one to be a baseline, one to be
  // "now"). A freshly-captured alliance with only one point simply isn't ready yet --
  // shows up as "insufficient history" until the next capture, no wait period needed.
  function compare(alliances, history) {
    const sorted = order(alliances);
    const current = ranks(sorted);
    const captures = new Map(sorted.map(a => [a.allianceId,
      (Array.isArray(history?.[a.allianceId]) ? history[a.allianceId] : [])
        .filter(p => p && power(p.fightPower) !== null && Number.isFinite(Date.parse(p.capturedAtUtc)))
        .map(p => ({time: Date.parse(p.capturedAtUtc), fightPower: power(p.fightPower)}))
        .sort((a, b) => a.time - b.time)
    ]));
    const baseline = [];
    const baselineTimes = new Map();
    for (const a of sorted) {
      if (!current.has(a.allianceId)) continue;
      const points = captures.get(a.allianceId);
      if (points.length < 2) continue; // only one known capture -- nothing to compare against yet
      baseline.push({allianceId: a.allianceId, fightPower: points[0].fightPower});
      baselineTimes.set(a.allianceId, points[0].time);
    }
    // Comparing different sets would turn newly captured alliances into false drops.
    const ready = current.size >= 2 && baseline.length === current.size;
    const previous = ready ? ranks(baseline) : new Map();
    const changes = new Map(sorted.map(a => [a.allianceId,
      ready && current.has(a.allianceId) ? previous.get(a.allianceId) - current.get(a.allianceId) : null
    ]));
    const earliestOverall = baselineTimes.size ? Math.min(...baselineTimes.values()) : null;
    return {sorted, current, changes, baselineTimes, earliestOverall, ready, covered: baseline.length, total: current.size};
  }
  return {compare};
})();
