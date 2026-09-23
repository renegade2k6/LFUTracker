/* Complete records are sorted together; exports use the same filtered order. */
const Directory = (() => {
  const columns = {
    alliances: [['name', 'Alliance name'], ['abbr', 'Abbreviation'], ['server', 'Server number'], ['power', 'Alliance power'], ['members', 'Member count']],
    players: [['name', 'Player name'], ['alliance', 'Alliance'], ['power', 'Player power'], ['server', 'Server number']]
  };
  function records(alliances, kind) {
    if (kind === 'alliances') return alliances.map(a => ({name: a.name || a.abbr || 'Unknown', abbr: a.abbr || null, server: a.originServerId ?? null, power: a.fightPower ?? null, members: a.curMember ?? null, id: a.allianceId}));
    const players = new Map();
    alliances.forEach(a => (a.members || []).forEach((m, i) => {
      const key = m.uid ? String(m.uid) : `${a.allianceId}/${i}`;
      const row = {name: m.name || 'Unknown', alliance: a.name || a.abbr || 'Unknown', power: m.power ?? null,
        server: m.originServerId ?? a.originServerId ?? null, id: a.allianceId, captured: Date.parse(m.capturedAtUtc || a.capturedAtUtc) || 0};
      if (!players.has(key) || row.captured > players.get(key).captured) players.set(key, row);
    }));
    return [...players.values()];
  }
  function sorted(rows, key, asc, query = '') {
    const q = query.trim().toLocaleLowerCase();
    return rows.filter(r => !q || ['name', 'alliance', 'server'].some(k => String(r[k] ?? '').toLocaleLowerCase().includes(q))).sort((a,b) => {
      if (a[key] == null) return b[key] == null ? 0 : 1;
      if (b[key] == null) return -1;
      const comparison = ['power','members','server'].includes(key) ? Number(a[key]) - Number(b[key]) : String(a[key]).localeCompare(String(b[key]));
      return asc ? comparison : -comparison;
    });
  }
  function csv(rows, kind) {
    const cell = value => {
      let s = String(value ?? '');
      if (/^[\s]*[=+@-]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    return '\uFEFF' + [columns[kind].map(c => c[1]), ...rows.map(r => columns[kind].map(c => r[c[0]]))].map(r => r.map(cell).join(',')).join('\r\n');
  }
  return {columns, records, sorted, csv};
})();
if (typeof module !== 'undefined') module.exports = Directory;
