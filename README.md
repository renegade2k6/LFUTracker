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
| `directory.js`, `rankings.js`, `player-power.js` | Directory tables, rank changes, player power changes |
| `data/site.enc.json` | Encrypted site data |

Deployed to GitHub Pages by `.github/workflows/pages.yml` on every push to `master`.
