# Hotspot Radar MVP

Lightweight local web app for monitoring AI/programming trend keywords.

## Run

```powershell
cd C:\Users\Administrator\Documents\Codex\2026-07-10\new-chat-4\outputs\hotspot-radar-mvp
node server.js
```

Open http://localhost:4873.

## What Works In MVP

- Add/remove monitored keywords and scopes.
- Manual scan and scheduled scan.
- Browser notification permission flow.
- Server-Sent Events live discovery feed.
- Broader sources: Google News, official/vendor RSS feeds, Hacker News, GitHub, arXiv, and DEV Community.
- Selectable sources in the right-side settings panel.
- Click "AI 总结" on a discovery to generate a local Chinese extractive summary.
- Auto-delete old discoveries. Default retention is 24 hours and can be changed in the right-side settings panel.
- Lightweight authenticity heuristics for suspicious domains, clickbait terms, and unofficial brand claims.
- Built-in local demo signal for offline verification.

If your local network blocks external sources, the local demo signal still verifies the full UI, notification, retention, and AI summary paths.

## Public Readonly Mode

Use this mode when deploying publicly without a visitor password:

```bash
PUBLIC_READONLY=1 ADMIN_TOKEN=replace-with-a-long-random-token PORT=4873 STATE_FILE=/var/lib/hotspot-radar/state.json npm start
```

Public visitors can open `/hotspots.html`, expand hotspot items, open original links, and request a Chinese AI summary for the current page view.

Management operations require the admin token:

- Add or delete keywords.
- Change sources or retention time.
- Trigger manual scans.
- Generate local demo signals.

Admin entry:

```text
/index.html#adminToken=replace-with-a-long-random-token
```

The token is stored in the admin browser's local storage and removed from the address bar after loading.

## Publish To GitHub

After logging in with GitHub CLI in a normal PowerShell window:

```powershell
.\publish-github.ps1
```

Optional private repository:

```powershell
.\publish-github.ps1 -Visibility private
```

If `git push` cannot connect to GitHub, the script automatically falls back to `publish-github-api.ps1`, which publishes the tracked files through GitHub's API.
