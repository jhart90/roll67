# Roll67

A hex-grid virtual tabletop (Roll20-style) for playing **D&D 5e** and **Stars Without Number** online with your group — built for 1 DM + up to ~8 players.

## Features

- **Persistent accounts** — username/password login; characters, maps, tokens, fog of war and chat history all live in a SQLite database and survive restarts.
- **Campaigns** — a DM creates a campaign (choosing 5e or SWN) and shares a 6-letter invite code; players join with it.
- **Hex maps** — upload any battle-map image, then align the pointy-top hex grid over it with size/origin controls. Multiple maps per campaign with a **party map** players follow by default; the DM can privately view/edit any other map, and can split the party by assigning individual players to different maps.
- **Presence pills** — everyone sees who's connected at the bottom of the screen; the DM also sees which map each player is on and can click a pill to move them.
- **Tokens** — drag-and-drop with hex snap, token art uploads, HP bars, name plates. Players can only move their own characters; NPCs are DM-only.
- **True line-of-sight vision** — the server computes each player's field of view from their token(s): walls block sight, closed doors block until opened, lights create visible pockets in darkness, and darkvision works in the dark. Players are **never sent** what they can't see — hidden tokens and DM geometry never leave the server.
- **Walls block movement too** — player tokens can't be moved through walls or closed doors (keyboard or drag); pathing allows going around corners but never through. The DM can reposition tokens freely.
- **Wall types** — solid (blocks movement + sight), window (blocks movement, see-through), and one-way (see out, not in) walls, with a type picker in the wall tool.
- **Asset library** — the DM uploads and organizes images into folders and reuses them as map backgrounds or tokens without re-uploading.
- **Audio jukebox** — the DM uploads mp3/ogg/wav tracks and plays background music that syncs to every player (play/stop/loop/master volume); each player has a local mute.
- **World tab** — a DM worldbuilding hub:
  - **Locations** — nested places (region → settlement → building → point of interest) with notes, each linking NPCs, shops, and handouts; toggle visibility to reveal a location to players.
  - **Shops** — merchant inventories with a currency dropdown and structured stock (each item has Name / Price / Qty / Description, edited or deleted in place, added one at a time or pulled straight from the **compendium**). Buying transfers the item's full logic to the buyer: a compendium weapon becomes their attack (with the right modifiers), a healing potion becomes a usable item — currency auto-deducted, stock decremented. The DM can **present a shop as a live pop-up storefront** to all players or a chosen subset — targeted players buy from a modal in real time (prices, stock, and their own currency enforced), and the DM can stop showing it at any time.
  - **Random NPC generator** — one click spins up a townsfolk NPC with a name, occupation, rolled stats, and personality/appearance tags.
- **Fog of war** — unexplored areas are black; explored-but-not-visible areas are dimmed. Explored fog persists per player per map.
- **Layers** — GM token layer for hidden monsters/notes; GM drawing layer for private sketches.
- **DM tools** — wall polylines (trace your map art; Shift snaps to hex corners), doors (players can open/close when adjacent), light sources with bright/dim radii, **View as player** to see exactly what any player sees, and God mode.
- **Character sheets** — full 5e and SWN templates with auto-calculated modifiers, saves, skills, spell slots / psionics, inventory and XP. Every stat is click-to-roll straight into chat, with advantage/disadvantage.
- **Targeted combat** — weapons and usable items are **Actions** on the sheet. Attacking enters a targeting mode: only tokens within the weapon's range highlight, and clicking one rolls to hit against the target's AC, then auto-applies the damage. Healing potions are usable straight from a character's inventory — a pop-up asks who to use it on, rolls the heal, adds it to the target, and consumes the item. Any HP change syncs to the character sheet and token bar and shows a floating green/red **+/-HP** number over the token to everyone who can see it. NPC sheets stay private throughout — only the token's HP bar is shared.
- **Character art** — set a character's **token image** and a **detail/portrait** image (shown on the Bio & Info tab) from the sheet. Choosing an image opens an in-game **asset picker** — pick from the campaign's uploaded art or upload a new image from your computer. Setting the token image repaints that character's tokens on every map, and new tokens use it by default.
- **Compendium** — an SRD-based content library (weapons, armor, gear, magic items, ~95 spells, SWN cyberware & psychic powers). Add any item to a character from the sheet and its rolls apply automatically: a weapon becomes a click-to-roll attack with the right ability + proficiency baked in, a damaging spell becomes a clickable damage roll.
- **NPC library** — ~280 pre-built SRD monsters/NPCs (5e) and SWN NPCs, searchable and one-click to add as a DM-controlled NPC with full stats.
- **Directory** — a shared campaign reference: rollable tables, handouts, and a collapsible tree of every map, character, token, weapon, spell, and item introduced so far, visible to the whole party (directory characters are clickable to open their sheet). NPC-only secrets stay hidden from players.
- **Rollable tables** — the DM builds named random tables (one item per line, optional "players can roll"); a click posts a random result to chat.
- **Player Toolbar** — each player keeps a bottom row of saved roll "pills": pin any roll from a character sheet, or add a custom `/r` pill. Pills are colored, renamable, reorderable, and pinned sheet-rolls stay live with the character's current stats.
- **Group initiative** — the DM rolls initiative for every token on the map at once (optionally including hidden NPCs), auto-sorted.
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
