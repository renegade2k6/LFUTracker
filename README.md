# Alliance Tracker

## Website and GitHub Pages

The site uses the LFU Leaks visual style: OLED black, copper-orange accents,
Inter typography, centered navigation, and dark panels. **All alliances** and
**All players** open searchable tables. Every column sorts complete rows;
headers stay visible when scrolling. **Export CSV** downloads all matching
rows in their displayed order, with full power values and Excel-friendly UTF-8.
Players are deduplicated by UID using their newest roster record. Player server
uses `curServerId`, falling back to `serverId`; alliance member counts use
`curMember`. Missing numeric values display as a dash and export blank.

To publish, use this Website directory as the root of a dedicated GitHub repo,
with a `main` branch. The included `.gitignore` allows only website assets,
the three required JSON files, this README, and the GitHub workflow. It excludes
local tools, scripts, CSV files, tests, browser profiles, and working files.
In **Settings → Pages → Build and deployment**, select **GitHub Actions**.
Push to `main` or run **Publish website** manually. The workflow stages only
`index.html`, `theme.css`, `directory.js`, `rankings.js`, `player-power.js`,
and `data/{alliances,history,meta}.json`, plus `.nojekyll`.
No Python server is needed on Pages. Relative URLs and hash navigation support
a repository URL such as `https://renegade2k6.github.io/REPOSITORY/`.
The included JSON files become publicly downloadable as part of the website.
Commit updated JSON to refresh the public data. A repository has not been
created or deployed by this change.

## Local preview

Verification on 17 September 2026: 8 directory/player-history tests passed.
Chrome checked navigation, search, sorting, filters, alliance details, and table
layouts at 390, 768, 1440, and 1920px without page overflow or runtime errors.
The staged Pages files also loaded from a nested URL. The downloaded player CSV
matched all 12,060 displayed player records and their sort order. The rank-history
panel and unavailable-comparison labels were removed from the interface.

Double-click **Run-Website.bat** to start the Python server and open the site at
http://localhost:8765/. Keep the server window open while using the site; close
it or press Ctrl+C to stop. Python 3 is required, with either `py` or `python`
available. No Python packages need installing.

Running the launcher again opens the existing tracker. If another application
occupies port 8765, the launcher reports the conflict instead of changing the
address. The consistent address preserves this browser's player-power history.
Use the same browser/profile to retain comparisons between visits.

Use the navigation to jump to the overview, alliance directory, or leaderboards.
The directory supports server filtering, power/member/name sorting, and card or
list layouts. Search finds alliances and alliances containing matching survivors.
Select an alliance for its roster, power history, and sortable/filterable members.
Rank changes appear alongside each alliance when comparison history is available.

`Update-Website.bat` remains the separate data-export command. Launching the site
does not collect new game data. Reload the webpage after exporting new captures.
Fonts and decorative icons use external CDNs; data and the server are local.

## Verification — 14 September 2026

- Chrome checks passed against the actual export: 23 alliances, server filtering,
  navigation, alliance/player search, directory views, roster filtering/sorting,
  and no JavaScript runtime exceptions.
- Checked overflow at 390, 768, 1440, and 1920 pixel widths; inspected desktop and
  mobile screenshots under `.work/`.
- Python server startup, data serving, and duplicate-launch detection passed.
- Existing Node suite: 6 passed, 6 failed. The unchanged ranking tests still
  expect weekly/external baseline APIs; the current unchanged `rankings.js`
  implements first-capture comparisons and has no `compareExternal` function.
  All 5 player-power tests passed. This pre-existing test mismatch remains open.
- Data files, capture/export scripts, and ranking calculations were not edited.
