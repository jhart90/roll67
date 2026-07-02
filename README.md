# Roll67

A hex-grid virtual tabletop (Roll20-style) for playing **D&D 5e** and **Stars Without Number** online with your group — built for 1 DM + up to ~8 players.

## Features

- **Persistent accounts** — username/password login; characters, maps, tokens, fog of war and chat history all live in a SQLite database and survive restarts.
- **Campaigns** — a DM creates a campaign (choosing 5e or SWN) and shares a 6-letter invite code; players join with it.
- **Hex maps** — upload any battle-map image, then align the pointy-top hex grid over it with size/origin controls. Multiple maps per campaign; the DM switches which one is live.
- **Tokens** — drag-and-drop with hex snap, token art uploads, HP bars, name plates. Players can only move their own characters; NPCs are DM-only.
- **True line-of-sight vision** — the server computes each player's field of view from their token(s): walls block sight, closed doors block until opened, lights create visible pockets in darkness, and darkvision works in the dark. Players are **never sent** what they can't see — hidden tokens and DM geometry never leave the server.
- **Fog of war** — unexplored areas are black; explored-but-not-visible areas are dimmed. Explored fog persists per player per map.
- **Layers** — GM token layer for hidden monsters/notes; GM drawing layer for private sketches.
- **DM tools** — wall polylines (trace your map art; Shift snaps to hex corners), doors (players can open/close when adjacent), light sources with bright/dim radii, **View as player** to see exactly what any player sees, and God mode.
- **Character sheets** — full 5e and SWN templates with auto-calculated modifiers, saves, skills, spell slots / psionics, inventory and XP. Every stat is click-to-roll straight into chat, with advantage/disadvantage.
- **Chat & dice** — `/r 2d6+3` rolls (with `kh`/`kl`, `adv`, `dis`, parentheses), `/gr` GM-only rolls, `/w name` whispers, saved macros (`#stab`), roll cards with die breakdowns and crit highlighting.
- **Initiative tracker** — roll from sheets, hidden entries for surprise monsters, turn/round advancement.
- **Table tools** — freehand drawing, hex ruler (broadcasts a live measurement to everyone), pings, and handouts/journal shareable to all or specific players.

## Running locally

```bash
npm install
npm run dev
```

- Client: http://localhost:5173 (Vite, proxies to the server)
- Server: http://localhost:3001 (Express + Socket.IO)
- Data: `./data/roll67.db` + `./data/uploads/`

Tests:

```bash
npm test        # unit tests (hex math, FOV, dice, sheets)
npm run itest   # integration smoke test (needs the dev server running)
npm run typecheck
```

## Deploying to Railway (~$5/mo)

1. Push this repo to GitHub.
2. In [Railway](https://railway.app): **New Project → Deploy from GitHub repo** — it reads `railway.json` and builds automatically.
3. Add a **Volume** to the service, mounted at `/data`.
4. Add an environment variable: `DATA_DIR=/data`.
5. **Settings → Networking → Generate Domain** to get your public URL.

The database and all uploads live on the volume, so they survive redeploys.

### Playing together

1. Everyone visits the public URL and creates an account (username + password).
2. The DM creates a campaign and reads out the invite code.
3. Players join with the code, the DM makes (or assigns) their characters, places tokens, and you're playing.

## Architecture (for the curious)

npm-workspaces monorepo:

- `shared/` — pure TypeScript: hex math, raycast FOV + lighting, dice parser, sheet schemas (5e/SWN), the socket protocol, permissions. Fully unit-tested, no I/O.
- `server/` — Express 4 + Socket.IO 4, better-sqlite3. Authoritative: clients send intents, the server validates permissions, persists, and broadcasts. `live/visionService.ts` is the secrecy boundary — every payload to a player is filtered through their computed field of view.
- `client/` — React 18 + Vite + Zustand. Hybrid renderer: canvas for the map image/grid and fog (fast full-surface redraws), SVG/DOM for tokens, drawings, walls and overlays (free hit-testing and drag).
