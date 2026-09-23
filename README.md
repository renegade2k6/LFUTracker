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

Deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `master`.
The workflow publishes an explicit file list: a new file the page loads must be added to
its `cp` step and to the `.gitignore` whitelist, or it 404s on the live site.

## CSV exports

**All Alliances** and **All Players** export the filtered rows in the displayed order. Both
add a `Last updated (UTC)` column. Player power is written as `current (max seen)`, e.g.
`461719324 (480112905)`, matching the table; max seen is the highest power in any verified
roster capture or season-leaderboard capture.
