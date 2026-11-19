# Alliance Tracker

Static site for tracking Last Fortress alliances and players: alliance directory,
rosters, power history, rankings and an all-players database.

## Access

The site's data is published only as `data/site.enc.json`, encrypted with
AES-256-GCM (key derived from a master password with PBKDF2-SHA256). The page asks
for the password and decrypts it in the browser; without the password the data
cannot be read. Ask the site owner for access.

## How data gets here

Data comes from in-game captures processed locally (collect, verify, merge, then
encrypt). Every source describes the same alliances and players, and the newest
observation wins, whatever source it came from (`merge.js`). Unencrypted data is
never committed to this repository.

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `theme.css` | The site |
| `vault.js` | Password prompt support: decrypts the data bundle (WebCrypto) |
| `merge.js` | Newest-wins merge of alliance/player observations from each source |
| `directory.js`, `rankings.js`, `player-power.js` | Directory tables and CSV export, rank changes, player power changes |
| `logo.png`, `favicon-32.png`, `apple-touch-icon.png` | Header logo, browser tab icon, phone home-screen icon |
| `hero-radar.png` | Overview hero radar (the sweep is CSS on top) |
| `data/site.enc.json` | Encrypted site data |
| `profiles.js`, `data/profiles.enc.json`, `data/profiles-detail.enc.json` | Profiles (Beta): one page per player. Headline power is the in-game Commander CP when captured; the alliance member-list power is shown separately. A `~` after a server means it is the player's alliance server (the player's own was not captured) |
| `server.js`, `data/server.enc.json`, `data/dimension.enc.json` | **Homeworld 21** and **Dimension** pages (see below) |
| `img/` | Small WebP icons (gear, war beasts, ultimate weapons, heroes, skills, modules) used by those pages; only icons the boards use are exported |

Deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `master`.
The workflow publishes an explicit file list: a new file the page loads must be added to
its `cp` step and to the `.gitignore` whitelist, or it 404s on the live site.

## Homeworld 21 and Dimension pages

Both pages are laid out like the in-game leaderboard (menu of boards, rank medals, `[Tag]Name #server`, item tiles with
levels, the game's own column headers) and are decrypted in the browser like the rest of the site.

- **Homeworld 21** lists the in-game leaderboards for the homeworld, which is made up of several servers
  (260, 263, 280, 310, 316, 328, 395, 399, 400). Every row keeps the player's own `#server`. Only players in the homeworld
  at the time of the snapshot are listed, so players currently away in their dimension maps do not appear, and only players
  who appeared on a board when it was captured (it is not a full roster). Ranks are positions on that board.
- **Dimension** shows the game's season-map rankings: Player Power (top 150 players) and Alliance Power, from every server in
  the dimension. A dimension lasts about 4 weeks, so the page shows when the snapshot was taken and warns after 28 days
  that the dimension has probably changed.
- Both are snapshots from passive in-game captures, not live data. Arena boards are never published, and the global
  Decor / Prosperity boards live on the Profiles pages.

## All Alliances and All Players

Both tables use the same headers, in the same order:

| Page | Columns |
| --- | --- |
| All Alliances | Alliance Name, Alliance Tag, Server Number, Members, Power |
| All Players | Player Name, Alliance Name, Alliance Tag, Server Number, Power |

Labelled search boxes sit above each table (All Players: player name, alliance name,
alliance tag; All Alliances: alliance name, alliance tag). Every filled box must match;
**Clear filters** empties them. The header search matches any of these fields.

## CSV exports

The tables show 100 rows per page to keep large directories responsive. The export
button shows how many rows it will write (e.g. `Export 12 players (CSV)`) and exports
all filtered rows in the current sort order, including rows on other pages. Columns
are the table columns plus `Last Updated (UTC)`. Player power is written as
`current (max seen)`, e.g.
`461719324 (480112905)`, matching the table; max seen is the highest power in any verified
roster capture or season-leaderboard capture.
