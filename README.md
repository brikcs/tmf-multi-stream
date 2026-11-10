# TMF Multi Stream

Watch several Twitch, Kick and YouTube streams side by side, styled after [tmfrz.com](https://tmfrz.com).

- Add channels by name or link (several at once, comma-separated), up to 12
- Grid layout (auto-sized to fill the screen) or Focus layout (one large stream, the rest alongside)
- Chat panel with a tab per stream, theater mode, drag a tile's title bar to reorder
- The lineup lives in the URL, so **Share** copies a link that opens the same streams and layout
- Shortcuts: `G` grid, `F` focus, `1`–`9` focus a stream, `←`/`→` cycle focus, `C` chat, `T` theater, `/` add

## Live now (stream discovery)

The **Live now** section lists Twitch and Kick streams with `tmfrz` in the title. A browser cannot ask Twitch or Kick for this directly, so a scheduled GitHub Action (`.github/workflows/discover.yml`) runs `scripts/discover.mjs` every 10 minutes and publishes the result as `live.json` on the `live-data` branch, which the page reads.

It needs API credentials, added under **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Where it comes from |
| --- | --- |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Register an application at <https://dev.twitch.tv/console/apps> |
| `KICK_CLIENT_ID`, `KICK_CLIENT_SECRET` | Create an app in your Kick account settings under **Developer** |

Either platform can be left out; the section then says it is not connected. Notes:

- The repository must be public for the page to read `live.json`.
- Twitch: every live stream in the Grand Theft Auto V category is checked, plus a channel search for other categories.
- Kick: its API has no title search and returns at most 100 streams per request, so small Kick streams can be missed.
- Expect results to lag by 10–20 minutes. GitHub pauses scheduled workflows after 60 days without repository activity.
- If the repository is renamed or forked, update `LIVE_URL` at the top of `app.js`.

## Running it

It is a static site with no build step. Serve the folder from any web host (GitHub Pages works), or locally:

```sh
python3 -m http.server 8000
```

Twitch only allows its player on pages served over HTTPS or from `localhost`, so opening `index.html` directly as a file will not play Twitch streams.

## Font

tmfrz.com sets its text in Tactic Round, a licensed font that is not included here. The page uses it when it is installed and otherwise falls back to Orbitron. To ship it, add `@font-face` rules for your licensed files at the top of `styles.css`.
