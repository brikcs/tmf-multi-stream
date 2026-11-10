# TMF Multi Stream

Watch several Twitch, Kick and YouTube streams side by side, styled after [tmfrz.com](https://tmfrz.com).

- Add channels by name or link (several at once, comma-separated), up to 12
- Grid layout (auto-sized to fill the screen) or Focus layout (one large stream, the rest alongside)
- Chat panel with a tab per stream, theater mode, drag a tile's title bar to reorder
- The lineup lives in the URL, so **Share** copies a link that opens the same streams and layout
- Shortcuts: `G` grid, `F` focus, `1`–`9` focus a stream, `←`/`→` cycle focus, `C` chat, `T` theater, `/` add

## Running it

It is a static site with no build step. Serve the folder from any web host (GitHub Pages works), or locally:

```sh
python3 -m http.server 8000
```

Twitch only allows its player on pages served over HTTPS or from `localhost`, so opening `index.html` directly as a file will not play Twitch streams.

## Font

tmfrz.com sets its text in Tactic Round, a licensed font that is not included here. The page uses it when it is installed and otherwise falls back to Orbitron. To ship it, add `@font-face` rules for your licensed files at the top of `styles.css`.
