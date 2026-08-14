import type { Server, Socket } from 'socket.io';
import {
  C2S, S2C, blocksMovement, canMoveToken, conditionsOf, firstFreeHex, getCondition, hexDistance, hexLine, inBounds, packHex,
  dieSides, playerColorFor, reachableAlong, roll, skillDie, str, swadePace, systemFor, traitExpr, vehicleSeats,
  type Character, type CreateTokenPayload, type DeleteTokenPayload, type DragTokenPayload,
  type GridConfig, type Hex, type JumpRollPayload, type MountTokenPayload, type MoveTokenPayload, type ProneMovePayload, type RunRollPayload, type TokenShape, type UpdateTokenPayload,
} from 'shared';
import { assets, campaigns, characters, chat, initiative, maps, tokens } from '../../db/repos.js';
import { db } from '../../db/db.js';
import { campaignRoom, dmRoom, emitError, safe, scrubNonFinite, sdata, userRoom } from '../hub.js';
import { breakAim, persistSheet, postStatusLine } from '../hp.js';
import { actionsTakenThisTurn } from './combat.js';

/** SWADE combat movement spent this turn, per campaign → token. */
/** A crawl is 2″ of Pace, whatever the character's legs would normally do. */
const CRAWL_PACE = 2;
/**
 * What a prone character chose to do about it this turn, by token id: stand
 * up, or stay down and crawl. Cleared when they stand, and with the rest of
 * the turn's movement when the turn ends.
 */
const proneIntent = new Map<string, 'stand' | 'crawl'>();

/**
 * A jump, in inches: 1″ flat, doubled off a run-up of at least 2″, and an
 * Athletics roll as an action adds 1″ more — 2″ on a raise.
 *
 * What a jump BUYS on a hex grid is not extra distance (it still counts
 * against Pace, per the book) but the right to ignore what is on the ground:
 * you clear the rough patch, the tar, the low wall of crates. So the distance
 * is banked as hexes the mover may cross this turn at the ordinary rate.
 */
const JUMP_BASE = 1;
const JUMP_WITH_RUN_UP = 2;

interface TurnMoveRec { moved: number; runBonus: number | null; jump?: number }
const swadeTurnMoves = new Map<string, Map<string, TurnMoveRec>>();

/** New turn (or combat over): everyone's movement budget refills. */
export function resetSwadeTurnMoves(campaignId: string): void {
  for (const tokenId of swadeTurnMoves.get(campaignId)?.keys() ?? []) proneIntent.delete(tokenId);
  swadeTurnMoves.delete(campaignId);
}

/** SWADE marks its heroes and named villains as Wild Cards on the sheet;
 *  other systems have no such concept. */
function isWildCard(character: { system: string; sheet: Record<string, unknown> }): boolean {
  return character.system === 'swade' && character.sheet.wildCard === true;
}

/**
 * How a character's token should look. Player-run characters and Wild Cards
 * are the table's protagonists, so they get the bigger hexagon by default;
 * rank-and-file Extras stay 1-hex circles. An explicit choice recorded on the
 * sheet (the creator wizard's Appearance step, or a DM resize on the map)
 * always wins — the default only fills the gap.
 */
export function tokenLookFor(
  character: { system: string; ownerUserId: string | null; sheet: Record<string, unknown> },
): { size: number; shape: TokenShape } {
  const featured = character.ownerUserId !== null || isWildCard(character);
  const sh = character.sheet;
  const size = Number(sh.tokenSize) > 0
    ? Math.max(0.5, Math.min(4, Number(sh.tokenSize)))
    : (featured ? 1.5 : 1);
  const shape = typeof sh.tokenShape === 'string'
    ? (sh.tokenShape as TokenShape)
    : (featured ? 'hexagon' : 'circle');
  return { size, shape };
}

/** Did this token spend its running die this turn? (−2 to other actions.) */
export function hasRunThisTurn(campaignId: string, tokenId: string): boolean {
  return swadeTurnMoves.get(campaignId)?.get(tokenId)?.runBonus != null;
}

/**
 * Tell whoever may move this token what is left of its Pace.
 *
 * The budget is the server's — it is the only thing that can be trusted with
 * it — but the map has to draw the reach, so the numbers behind it are
 * published to the token's owner and to the DM. Sent when a turn begins and
 * after every move, which is exactly when the answer changes.
 */
export function emitMoveBudget(io: Server, campaignId: string, tokenId: string, only?: Socket): void {
  const token = tokens.byId(tokenId);
  const ch = token?.characterId ? characters.byId(token.characterId) : undefined;
  if (!token || !ch || ch.system !== 'swade') return;
  if (!initiative.get(campaignId).active) return;
  const conds = conditionsOf(ch.sheet);
  const prone = conds.includes('prone');
  const crawling = prone && proneIntent.get(tokenId) === 'crawl';
  const rec = swadeTurnMoves.get(campaignId)?.get(tokenId);
  const payload = {
    tokenId,
    from: { q: token.q, r: token.r },
    pace: crawling ? CRAWL_PACE : Math.max(1, swadePace(ch.sheet) - (prone ? 2 : 0)),
    moved: rec?.moved ?? 0,
    runBonus: rec?.runBonus ?? null,
    // What a run could still buy: the running die's best face. Spent already,
    // or crawling on the floor, and there is nothing left to promise.
    runMax: rec?.runBonus != null || crawling ? 0 : dieSides(str(ch.sheet, 'runningDie', 'd6')),
    crawling,
    actions: actionsTakenThisTurn(campaignId, ch.id),
    shaken: conds.includes('shaken'),
  };
  // `only` is the socket that just joined: it needs catching up, and nobody
  // else needs telling again.
  if (only) { only.emit(S2C.MOVE_BUDGET, payload); return; }
  io.to(dmRoom(campaignId)).emit(S2C.MOVE_BUDGET, payload);
  if (ch.ownerUserId) io.to(userRoom(ch.ownerUserId)).emit(S2C.MOVE_BUDGET, payload);
}

/** Has this token spent any Pace this turn? (Aiming demands standing still.) */
export function movedThisTurn(campaignId: string, tokenId: string): boolean {
  return (swadeTurnMoves.get(campaignId)?.get(tokenId)?.moved ?? 0) > 0;
}
import { hasSeenHex, socketsSeeingToken, syncMapVision } from '../visionService.js';
import { broadcastDirectory } from '../directory.js';
import { broadcastPresence, sendMapStateToUser } from './session.js';

/** Public URL of an uploaded asset, so the sheet's image field and the
 *  token's art can never drift to different pictures. */
function assetUrl(assetId: string): string | null {
  const a = assets.byId(assetId);
  return a ? `/uploads/${a.id}.${a.ext}` : null;
}

/** A color deliberately chosen on the character sheet, if it's a valid one. */
function sheetTokenColor(character?: { sheet: Record<string, unknown> }): string | undefined {
  const c = character?.sheet.tokenColor;
  return typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c : undefined;
}

/** The color a member is shown in everywhere else, so a new token matches. */
function colorForOwner(campaignId: string, userId: string): string {
  const m = campaigns.members(campaignId).find((x) => x.userId === userId);
  return m ? playerColorFor(m) : '#6c9bd2';
}

function requireCampaign(socket: Socket) {
  const d = sdata(socket);
  if (!d.campaignId || !d.role) throw new Error('Join a campaign first.');
  return d as typeof d & { campaignId: string; role: 'dm' | 'player' };
}

export function registerTokenHandlers(io: Server, socket: Socket): void {
  socket.on(C2S.CREATE_TOKEN, safe(socket, (payload: CreateTokenPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') {
      emitError(socket, 'Only the DM can place tokens.');
      return;
    }
    const map = maps.byId(payload.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown map.');
    if (!inBounds({ q: payload.q, r: payload.r }, map.grid)) throw new Error('Off the map.');
    if ((map.blocked ?? []).includes(packHex({ q: payload.q, r: payload.r }))) {
      emitError(socket, 'Nothing can stand there — that ground is impassable.');
      return;
    }
    const character = payload.characterId ? characters.byId(payload.characterId) : undefined;
    tokens.create({
      mapId: payload.mapId,
      characterId: character?.id ?? null,
      name: payload.name?.trim() || character?.name || 'Token',
      artAssetId: payload.artAssetId ?? null,
      q: payload.q,
      r: payload.r,
      layer: payload.layer ?? 'token',
      ...(() => {
        const look = character ? tokenLookFor(character) : { size: 1, shape: 'circle' as TokenShape };
        return { size: payload.size ?? look.size, shape: payload.shape ?? look.shape };
      })(),
      // A token starts in the color its SHEET asks for; failing that, the
      // color of whoever will control it — the linked character's owner, or
      // the DM placing it. One less thing to set by hand, and the map reads as
      // "whose is whose" straight away.
      color: payload.color
        ?? sheetTokenColor(character)
        ?? colorForOwner(d.campaignId, character?.ownerUserId ?? d.userId),
      vision: payload.vision ?? null,
      bar: payload.bar ?? null,
    });
    // DM sees the new token immediately; players learn via vision sync.
    const created = tokens.forMap(payload.mapId).at(-1)!;
    io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: created });
    syncMapVision(io, d.campaignId, payload.mapId);
    broadcastDirectory(io, d.campaignId);
  }, 'CREATE_TOKEN'));

  socket.on(C2S.DELETE_TOKEN, safe(socket, ({ tokenId }: DeleteTokenPayload) => {
    const d = requireCampaign(socket);
    if (d.role !== 'dm') {
      emitError(socket, 'Only the DM can remove tokens.');
      return;
    }
    const token = tokens.byId(tokenId);
    if (!token) return;
    const map = maps.byId(token.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown token.');
    tokens.delete(tokenId);
    io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_REMOVED, { tokenId });
    syncMapVision(io, d.campaignId, token.mapId);
    broadcastDirectory(io, d.campaignId);
  }, 'DELETE_TOKEN'));

  socket.on(C2S.UPDATE_TOKEN, safe(socket, ({ tokenId, patch: rawPatch }: UpdateTokenPayload) => {
    const d = requireCampaign(socket);
    const patch = scrubNonFinite(rawPatch);
    const token = tokens.byId(tokenId);
    if (!token) return;
    const map = maps.byId(token.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown token.');
    if (d.role !== 'dm') {
      // A player may recolor a token they control, and nothing else — color
      // is theirs to pick, but size, vision and HP stay the DM's.
      const ch = token.characterId ? characters.byId(token.characterId) : undefined;
      const mine = !!ch && ch.ownerUserId === d.userId;
      const onlyColor = Object.keys(patch).length === 1 && typeof patch.color === 'string';
      if (!mine || !onlyColor) {
        emitError(socket, mine ? 'You can only change that token’s color.' : 'Only the DM can edit tokens.');
        return;
      }
    }
    // For a character-linked token the SHEET is authoritative for HP: a bar
    // edit writes through to the sheet (persistSheet then mirrors the new HP
    // back onto every one of that character's token bars), so the sheet and
    // the token can never drift apart. Only unlinked tokens keep a bar of
    // their own.
    let tokenPatch = patch;
    if (patch.bar && token.characterId) {
      const ch = characters.byId(token.characterId);
      if (ch) {
        persistSheet(io, d.campaignId, ch, { hp: patch.bar.hp, maxHp: patch.bar.maxHp });
        const { bar: _bar, ...rest } = patch;
        tokenPatch = rest;
        if (Object.keys(tokenPatch).length === 0) {
          broadcastDirectory(io, d.campaignId);
          return;
        }
      }
    }
    // Art and color are ONE setting per character, wherever they're edited.
    // Changing either on a token writes it back to the sheet (both the asset
    // id and the URL the sheet's image field renders) and repaints that
    // character's tokens on every other map, so no two copies can disagree.
    const artChanged = typeof tokenPatch.artAssetId === 'string';
    const colorChanged = typeof tokenPatch.color === 'string';
    if ((artChanged || colorChanged) && token.characterId) {
      const ch = characters.byId(token.characterId);
      if (ch) {
        const sheetPatch: Record<string, unknown> = { ...ch.sheet };
        if (artChanged) {
          const assetId = tokenPatch.artAssetId as string;
          sheetPatch.tokenImageAssetId = assetId;
          const url = assetUrl(assetId);
          if (url) sheetPatch.tokenImage = url;
        }
        if (colorChanged) sheetPatch.tokenColor = tokenPatch.color;
        characters.update(ch.id, undefined, sheetPatch);
        const updatedCh = characters.byId(ch.id)!;
        io.to(dmRoom(d.campaignId)).emit(S2C.CHARACTER_UPSERTED, { character: updatedCh });
        if (updatedCh.ownerUserId) io.to(userRoom(updatedCh.ownerUserId)).emit(S2C.CHARACTER_UPSERTED, { character: updatedCh });
        // Every other token of this character follows suit.
        for (const other of tokens.forCharacter(ch.id)) {
          if (other.id === tokenId) continue;
          const p: Record<string, unknown> = {};
          if (artChanged) p.artAssetId = tokenPatch.artAssetId;
          if (colorChanged) p.color = tokenPatch.color;
          tokens.update(other.id, p);
          io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: tokens.byId(other.id)! });
          if (other.mapId !== token.mapId) syncMapVision(io, d.campaignId, other.mapId);
        }
      }
    }
    // Appearance sync: resizing/reshaping a character-linked token records the
    // choice on the sheet, so the look follows the character onto every other
    // map (placement reads the sheet when there's no token to copy from).
    if ((tokenPatch.size !== undefined || tokenPatch.shape !== undefined) && token.characterId) {
      const ch = characters.byId(token.characterId);
      if (ch) {
        const sheet = { ...ch.sheet };
        if (tokenPatch.size !== undefined) sheet.tokenSize = tokenPatch.size;
        if (tokenPatch.shape !== undefined) sheet.tokenShape = tokenPatch.shape;
        characters.update(ch.id, undefined, sheet);
        const updatedCh = characters.byId(ch.id)!;
        io.to(dmRoom(d.campaignId)).emit(S2C.CHARACTER_UPSERTED, { character: updatedCh });
        if (updatedCh.ownerUserId) io.to(userRoom(updatedCh.ownerUserId)).emit(S2C.CHARACTER_UPSERTED, { character: updatedCh });
      }
    }
    // Name sync: renaming a character-linked token also renames the character.
    if (typeof tokenPatch.name === 'string' && token.characterId) {
      const ch = characters.byId(token.characterId);
      if (ch && ch.name !== tokenPatch.name) {
        characters.update(ch.id, tokenPatch.name, ch.sheet);
        const updatedCh = characters.byId(ch.id)!;
        io.to(dmRoom(d.campaignId)).emit(S2C.CHARACTER_UPSERTED, { character: updatedCh });
        if (updatedCh.ownerUserId) io.to(userRoom(updatedCh.ownerUserId)).emit(S2C.CHARACTER_UPSERTED, { character: updatedCh });
      }
    }
    tokens.update(tokenId, tokenPatch);
    const updated = tokens.byId(tokenId)!;
    io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: updated });
    syncMapVision(io, d.campaignId, token.mapId);
    broadcastDirectory(io, d.campaignId);
  }, 'UPDATE_TOKEN'));

  socket.on(C2S.MOVE_TOKEN, safe(socket, ({ tokenId, q: rawQ, r: rawR, drag }: MoveTokenPayload) => {
    const d = requireCampaign(socket);
    // Hex coordinates are integers by definition; a fractional/garbage value
    // (inBounds already rejects NaN) would otherwise persist verbatim.
    const q = Math.round(rawQ);
    const r = Math.round(rawR);
    const token = tokens.byId(tokenId);
    if (!token) return;
    const map = maps.byId(token.mapId);
    if (!map || map.campaignId !== d.campaignId) throw new Error('Unknown token.');
    const character = token.characterId ? characters.byId(token.characterId) : undefined;
    if (!canMoveToken(d.role, d.userId, token, character)) {
      emitError(socket, 'You can only move your own character.');
      return;
    }
    if (!inBounds({ q, r }, map.grid)) {
      emitError(socket, 'That is off the map.');
      return;
    }
    // Inaccessible ground is scenery, not cover: a chasm or a lava flow has
    // nowhere to stand, so nobody occupies it — the DM included, since a
    // token parked there could never be reached or left by anyone else.
    if ((map.blocked ?? []).includes(packHex({ q, r }))) {
      emitError(socket, 'Nothing can stand there — that ground is impassable.');
      return;
    }
    // Bound, Entangled, Stunned, Bleeding Out… pinned characters stay put
    // until the condition clears. The DM can always reposition tokens.
    if (d.role !== 'dm' && character && blocksMovement(conditionsOf(character.sheet))) {
      const held = conditionsOf(character.sheet)
        .map((id) => getCondition(id))
        .find((c) => c?.blocksMove);
      emitError(socket, `${character.name} cannot move while ${held?.label ?? 'held'}.`);
      return;
    }
    // Players can't cross walls or closed doors: the token stops on the last
    // free hex in that direction (held up against the blocker). The DM moves
    // freely. Movement is straight-line collision, not auto-pathing.
    //
    // Exception — DRAGGING between rooms out of combat: with no initiative
    // running there is no tactical position to protect, and making the party
    // trace a path around every wall to reach a room they have already
    // explored is busywork. So a player may drag straight onto any hex they
    // personally remember, walls included. Ground they have never seen still
    // has to be walked to, so this can never scout the unknown.
    //
    // WALKING is different: a WASD/arrow step is the character physically
    // moving through the world, so it always collides with walls, explored
    // ground or not.
    let dest = { q, r };
    if (d.role !== 'dm') {
      const outOfCombat = !initiative.get(d.campaignId).active;
      const knownGround = drag === true && outOfCombat && hasSeenHex(d.userId, token.mapId, { q, r });
      if (!knownGround) {
        const stop = reachableAlong(
          { q: token.q, r: token.r },
          { q, r },
          { grid: map.grid, walls: map.walls, doors: map.doors },
        );
        if (stop.q === token.q && stop.r === token.r) {
          // Held up against a wall. This used to return in silence, which was
          // fine while the client waited for permission before moving — it
          // now moves first and waits to be corrected, so silence left the
          // token standing inside the wall until its guard expired. Echo the
          // token back unchanged: no toast for a bump anyone can see, but the
          // client learns at once that nothing happened.
          socket.emit(S2C.TOKEN_UPSERTED, { token });
          return;
        }
        dest = stop;
      }
    }
    // A rider goes where the horse goes. Their own legs are not in play until
    // they get off, so this is refused rather than silently dragging them out
    // of the saddle — dismounting is a decision, not a side effect of a drag.
    if (token.mountedOn) {
      const mount = tokens.byId(token.mountedOn);
      socket.emit(S2C.TOKEN_UPSERTED, { token });
      emitError(socket, `${token.name} is riding${mount ? ` ${mount.name}` : ''} — dismount first, or move the mount.`);
      return;
    }

    // SWADE combat movement: Pace is a real per-turn budget (1 hex = 1").
    // Standing from Prone costs 2" first; pushing past Pace automatically
    // rolls the d6 running die, once per turn.
    // Pace is the character's, not the mover's: a DM moving the NPC whose turn
    // it is spends that NPC's legs the same way a player spends their own, or
    // the reach drawn on the map is a promise nobody is keeping. The DM keeps
    // their free hand for everything else — repositioning a token that is not
    // up, or one that is not in the fight at all, is refereeing rather than
    // moving, and it is the one way to undo a mistake mid-round.
    const init = initiative.get(d.campaignId);
    const upNow = init.entries[init.turnIdx]?.tokenId;
    // A fight is turns. A token in the order waits for its own — the client
    // refuses this before it sends anything, and this is the rule behind it.
    // The DM is exempt: moving a token that is not up is refereeing, and the
    // only way to undo a mistake mid-round.
    if (d.role !== 'dm' && init.active && upNow !== tokenId
      && init.entries.some((e) => e.tokenId === tokenId)) {
      socket.emit(S2C.TOKEN_UPSERTED, { token });
      emitError(socket, `It is not ${token.name}'s turn.`);
      return;
    }
    const spendsPace = d.role !== 'dm' || upNow === tokenId;
    if (spendsPace && character?.system === 'swade') {
      const prone = conditionsOf(character.sheet).includes('prone');
      const combat = initiative.get(d.campaignId).active;
      // Prone is a choice, not a state to be dragged out of. A character on
      // the ground can get up — a free action that costs 2″ of Pace — or stay
      // down and crawl, which caps them at 2″ but is unaffected by Difficult
      // Ground and keeps the −2 that ranged attackers suffer against them.
      // Moving used to stand them up unasked, which silently threw away the
      // reason they went prone in the first place.
      if (prone && combat && !proneIntent.get(tokenId)) {
        socket.emit(S2C.TOKEN_UPSERTED, { token });
        socket.emit(S2C.CRAWL_PROMPT, { tokenId, name: character.name, crawlPace: CRAWL_PACE });
        return;
      }
      const crawling = prone && proneIntent.get(tokenId) === 'crawl';
      if (combat) {
        const per = swadeTurnMoves.get(d.campaignId) ?? new Map<string, TurnMoveRec>();
        swadeTurnMoves.set(d.campaignId, per);
        const rec = per.get(tokenId) ?? { moved: 0, runBonus: null };
        // Crawling is its own tiny budget; standing spends 2″ of a normal one.
        const pace = crawling ? CRAWL_PACE : Math.max(1, swadePace(character.sheet) - (prone ? 2 : 0));
        // Difficult Ground: each hex of rough terrain entered costs 2" of
        // Pace instead of 1 — walk the hexes the move crosses, not just the
        // straight-line distance. A crawler is already down in it and pays
        // the ordinary rate.
        const rough = crawling ? new Set<number>() : new Set(map.terrain);
        const path = hexLine({ q: token.q, r: token.r }, dest).slice(1);
        // A jump in hand clears the rough hexes it covers — that is what the
        // leap was for. It is spent as it is used, hex by hex.
        let airborne = rec.jump ?? 0;
        const stepDist = path.reduce((a, h) => {
          const isRough = rough.has(packHex(h));
          if (isRough && airborne > 0) { airborne -= 1; return a + 1; }
          return a + (isRough ? 2 : 1);
        }, 0);
        rec.jump = airborne;
        if (rec.moved + stepDist > pace + (rec.runBonus ?? 0)) {
          if (rec.runBonus === null) {
            // Past Pace with no running die spent: ask, never auto-roll —
            // running costs −2 on everything else this turn.
            // Nothing has happened yet — the move waits on the answer. Put
            // the token back where it really is while the player decides,
            // rather than leaving it standing at a hex it may not reach.
            socket.emit(S2C.TOKEN_UPSERTED, { token });
            socket.emit(S2C.RUN_PROMPT, { tokenId, name: character.name, pace, moved: rec.moved });
            return;
          }
          emitError(socket, `Not enough movement: Pace ${pace} +${rec.runBonus} run, already moved ${rec.moved}.`);
          return;
        }
        rec.moved += stepDist;
        per.set(tokenId, rec);
      }
      if (prone && !crawling) {
        persistSheet(io, d.campaignId, character, { conditions: conditionsOf(character.sheet).filter((c) => c !== 'prone') });
        postStatusLine(io, d.campaignId, combat ? `${character.name} stands up (2″ of Pace).` : `${character.name} stands up.`);
        proneIntent.delete(tokenId);
      }
    }
    // Moving under your own power breaks a held Aim — regardless of who
    // dragged the token (a DM repositioning the aimer counts as them moving).
    if (character?.system === 'swade' && conditionsOf(character.sheet).includes('aiming')) {
      breakAim(io, d.campaignId, characters.byId(character.id) ?? character, 'moves — the aim is lost.');
    }
    const fromHex = { q: token.q, r: token.r };
    tokens.move(tokenId, dest.q, dest.r);
    // Anyone in the saddle travels with it, to the same hex.
    for (const rider of tokens.forMap(token.mapId).filter((t) => t.mountedOn === tokenId)) {
      tokens.move(rider.id, dest.q, dest.r);
      for (const s2 of socketsSeeingToken(io, d.campaignId, tokens.byId(rider.id)!)) {
        s2.emit(S2C.TOKEN_MOVED, { tokenId: rider.id, q: dest.q, r: dest.r });
      }
    }
    const moved = tokens.byId(tokenId)!;
    // Tell everyone who could already see it where it went; vision sync
    // handles reveals/hides for everyone else (and fog for the mover).
    for (const s of socketsSeeingToken(io, d.campaignId, moved)) {
      s.emit(S2C.TOKEN_MOVED, { tokenId, q: dest.q, r: dest.r });
    }
    // A single move can only possibly change what's visible near its old or
    // new hex (plus, if it carries a light, that light's own glow radius) --
    // viewers nowhere near either spot can skip the recompute entirely. This
    // is the hot path (fired on every step of every token's movement), so
    // it's the one call site worth hinting; other, far less frequent vision
    // triggers (wall/door/light edits, etc.) keep the always-safe full sync.
    syncMapVision(io, d.campaignId, token.mapId, {
      hexes: [fromHex, dest],
      extraRadius: token.light ? Math.max(token.light.bright, token.light.dim) : 0,
    });
    // What is left of the turn, so the reach shading on the map keeps up with
    // the ground actually covered.
    emitMoveBudget(io, d.campaignId, tokenId);
  }, 'MOVE_TOKEN'));

  // The player accepted the run: roll the d6 running die (logged to chat)
  // and extend this turn's budget. Their next move attempt then goes through.
  /**
   * The answer to the crawl prompt. Recording the choice is all this does —
   * the move that prompted it was refused, so the player makes it again and
   * it is honoured. Standing up happens on that move, not here, because
   * standing is free but the 2″ it costs belongs to a move that actually
   * happens.
   */
  /**
   * Get on, or get off.
   *
   * Only a token the DM has marked rideable can be mounted — nothing is a
   * mount by default, or every crate on the map would be a horse. The rider
   * moves to the mount's hex and stays there: from here their movement is the
   * mount's, and MOVE_TOKEN refuses to let them walk off on their own.
   */
  socket.on(C2S.MOUNT_TOKEN, safe(socket, ({ tokenId, mountId }: MountTokenPayload) => {
    const d = requireCampaign(socket);
    const token = tokens.byId(tokenId);
    if (!token) return;
    const character = token.characterId ? characters.byId(token.characterId) : undefined;
    if (!canMoveToken(d.role, d.userId, token, character)) {
      emitError(socket, 'That is not yours to move.');
      return;
    }
    const map = maps.byId(token.mapId);
    if (!map || map.campaignId !== d.campaignId) return;

    if (!mountId) {
      if (!token.mountedOn) return;
      const mount = tokens.byId(token.mountedOn);
      tokens.update(tokenId, { mountedOn: null });
      // Stepping off hands the wheel back: the next one aboard drives until
      // the DM says otherwise.
      if (mount && mount.driverTokenId === tokenId) {
        tokens.update(mount.id, { driverTokenId: null });
        io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: tokens.byId(mount.id)! });
      }
      // Step off onto the nearest free hex rather than standing inside the
      // horse. Failing that, stay put — a rider with nowhere to go is a
      // problem for the table, not a reason to refuse the dismount.
      if (mount) {
        const taken = new Set(tokens.forMap(token.mapId)
          .filter((t) => t.id !== tokenId)
          .map((t) => packHex({ q: t.q, r: t.r })));
        const spot = firstFreeHex({ q: mount.q, r: mount.r }, taken, map.grid);
        tokens.move(tokenId, spot.q, spot.r);
      }
      const off = tokens.byId(tokenId)!;
      io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: off });
      for (const s2 of socketsSeeingToken(io, d.campaignId, off)) {
        s2.emit(S2C.TOKEN_MOVED, { tokenId, q: off.q, r: off.r });
      }
      postStatusLine(io, d.campaignId, `${token.name} dismounts${mount ? ` from ${mount.name}` : ''}.`);
      syncMapVision(io, d.campaignId, token.mapId);
      return;
    }

    const mount = tokens.byId(mountId);
    if (!mount || mount.mapId !== token.mapId) return;
    if (!mount.mountable) {
      emitError(socket, `${mount.name} is not something anyone can ride. The DM marks a token rideable in its inspector.`);
      return;
    }
    if (mount.id === token.id) return;
    // Seats are finite: one on a horse, a whole crew on a boat. And a mount
    // cannot itself be riding something else, or the two would drag each
    // other around.
    const riders = tokens.forMap(token.mapId).filter((t) => t.mountedOn === mount.id && t.id !== token.id);
    const seats = Math.max(1, mount.maxRiders ?? 1);
    if (riders.length >= seats) {
      emitError(socket, `${mount.name} is full — ${seats} rider${seats === 1 ? '' : 's'} (${riders.map((r) => r.name).join(', ')}).`);
      return;
    }
    if (mount.mountedOn) { emitError(socket, `${mount.name} is riding something else.`); return; }

    tokens.update(tokenId, { mountedOn: mount.id });
    tokens.move(tokenId, mount.q, mount.r);
    const up = tokens.byId(tokenId)!;
    io.to(dmRoom(d.campaignId)).emit(S2C.TOKEN_UPSERTED, { token: up });
    for (const s2 of socketsSeeingToken(io, d.campaignId, up)) {
      s2.emit(S2C.TOKEN_MOVED, { tokenId, q: up.q, r: up.r });
    }
    postStatusLine(io, d.campaignId, `${token.name} mounts ${mount.name}.`);
    syncMapVision(io, d.campaignId, token.mapId);
  }, 'MOUNT_TOKEN'));

  socket.on(C2S.PRONE_MOVE, safe(socket, ({ tokenId, mode }: ProneMovePayload) => {
    const d = requireCampaign(socket);
    const token = tokens.byId(tokenId);
    if (!token) return;
    const character = token.characterId ? characters.byId(token.characterId) : undefined;
    if (!character || character.system !== 'swade') return;
    if (!canMoveToken(d.role, d.userId, token, character)) return;
    proneIntent.set(tokenId, mode === 'crawl' ? 'crawl' : 'stand');
    postStatusLine(io, d.campaignId, mode === 'crawl'
      ? `${character.name} stays down and crawls (${CRAWL_PACE}″, still Prone).`
      : `${character.name} gets up — the next move stands them up for 2″ of Pace.`);
    // Crawling is a smaller budget than standing, so the reach changes with
    // the answer.
    emitMoveBudget(io, d.campaignId, tokenId);
  }, 'PRONE_MOVE'));

  /**
   * Leap. Free at 1″, or 2″ off a run-up; an Athletics roll spends the turn's
   * action to add 1″ more, 2″ on a raise. The distance still comes out of
   * Pace — the book is explicit that jumping never lets you exceed it — so
   * what the jump actually buys is the ground it clears: banked hexes this
   * turn that cost the ordinary rate however rough they are.
   */
  socket.on(C2S.JUMP_ROLL, safe(socket, ({ tokenId, withRunUp, athletics }: JumpRollPayload) => {
    const d = requireCampaign(socket);
    const token = tokens.byId(tokenId);
    if (!token) return;
    const character = token.characterId ? characters.byId(token.characterId) : undefined;
    if (!character || character.system !== 'swade') return;
    if (!canMoveToken(d.role, d.userId, token, character)) return;
    const per = swadeTurnMoves.get(d.campaignId) ?? new Map<string, TurnMoveRec>();
    swadeTurnMoves.set(d.campaignId, per);
    const rec = per.get(tokenId) ?? { moved: 0, runBonus: null };
    let distance = withRunUp ? JUMP_WITH_RUN_UP : JUMP_BASE;
    let br: ReturnType<typeof roll> | null = null;
    if (athletics) {
      br = roll(traitExpr(character.sheet, skillDie(character.sheet, 'Athletics')));
      // A success adds an inch; a raise adds two.
      if (br.total >= 8) distance += 2;
      else if (br.total >= 4) distance += 1;
    }
    rec.jump = (rec.jump ?? 0) + distance;
    per.set(tokenId, rec);
    const how = withRunUp ? 'with a run-up' : 'from standing';
    const text = `🤸 ${character.name} jumps ${how} — ${distance}″ cleared`
      + (athletics ? ` (Athletics ${br!.total})` : '')
      + '. It still costs Pace, but rough ground under the leap does not.';
    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, fromCharacter: character.name, characterId: character.id,
      kind: br ? 'roll' : 'system', text,
      roll: br ? { ...br, outcome: br.total >= 4 ? 'success' as const : 'failure' as const } : null,
      recipients: null,
      ...(br ? { callout: { what: 'Jumping — Athletics', tone: 'trait' as const } } : {}),
    });
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
  }, 'JUMP_ROLL'));

  socket.on(C2S.RUN_ROLL, safe(socket, ({ tokenId }: RunRollPayload) => {
    const d = requireCampaign(socket);
    const token = tokens.byId(tokenId);
    if (!token) return;
    const character = token.characterId ? characters.byId(token.characterId) : undefined;
    if (!character || character.system !== 'swade') return;
    if (!canMoveToken(d.role, d.userId, token, character)) return;
    if (!initiative.get(d.campaignId).active) return;
    const per = swadeTurnMoves.get(d.campaignId) ?? new Map<string, TurnMoveRec>();
    swadeTurnMoves.set(d.campaignId, per);
    const rec = per.get(tokenId) ?? { moved: 0, runBonus: null };
    if (rec.runBonus !== null) return; // already spent the running die
    // The character's OWN running die, and it Aces like any other die in this
    // game. A d6 for most people, but Fleet-Footed and several ancestries step
    // it up — and hardcoding a d6 here quietly threw that away, along with the
    // wild sprint an Ace is supposed to allow.
    const die = str(character.sheet, 'runningDie', 'd6') || 'd6';
    const br = roll(`1${die}!`);
    rec.runBonus = br.total;
    per.set(tokenId, rec);
    const msg = chat.add(d.campaignId, {
      userId: d.userId, fromName: d.username, fromCharacter: character.name, characterId: character.id, kind: 'roll',
      text: `🏃 ${character.name} runs (${die}) — +${br.total} Pace this turn (−2 to their other actions).`,
      roll: br, recipients: null,
    });
    io.to(campaignRoom(d.campaignId)).emit(S2C.CHAT, { msg });
    emitMoveBudget(io, d.campaignId, tokenId);
  }, 'RUN_ROLL'));

  socket.on(C2S.DRAG_TOKEN, safe(socket, ({ tokenId, x, y, done }: DragTokenPayload) => {
    const d = requireCampaign(socket);
    const token = tokens.byId(tokenId);
    if (!token) return;
    const character = token.characterId ? characters.byId(token.characterId) : undefined;
    if (!canMoveToken(d.role, d.userId, token, character)) return;
    // Ghost positions are ephemeral: relayed only to viewers who already see
    // the token, never persisted, no vision recompute.
    for (const s of socketsSeeingToken(io, d.campaignId, token)) {
      if (s.id !== socket.id) s.emit(S2C.TOKEN_DRAG_GHOST, { tokenId, x, y, done: !!done });
    }
  }, 'DRAG_TOKEN'));
}

export const TOKEN_COLORS = ['#6c9bd2', '#d26c6c', '#7ed28a', '#d2a56c', '#b06cd2', '#6cd2c8', '#c9c96c'];

export function hashStr(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

/** The map's rough center hex (odd-r offset → axial). */
export function centerHex(grid: GridConfig): Hex {
  const r = Math.floor(grid.rows / 2);
  const col = Math.floor(grid.cols / 2);
  return { q: col - (r - (r & 1)) / 2, r };
}

/**
 * Relocate a character's token to a map (used when a character is dragged onto a
 * map in the world tree, or dropped directly on the map canvas): remove its
 * tokens from other maps and place it on the target map. If `dropHex` is given
 * (an explicit drop location on the canvas) an existing token on the target map
 * is moved there and a new one is created there rather than at the spawn point;
 * otherwise a fresh token lands at the map's spawn point (or center), nudged to
 * the nearest free hex, and an existing token on the target map is left alone.
 */
export function placeCharacterToken(
  io: Server, campaignId: string, character: Character, mapId: string, dropHex?: Hex | null,
): void {
  const map = maps.byId(mapId);
  if (!map || map.campaignId !== campaignId) return;
  if (dropHex && !inBounds(dropHex, map.grid)) dropHex = null;

  // All DB mutations in ONE transaction (a crash between the old tokens'
  // deletes and the new token's create would strand the character with no
  // token anywhere); the socket broadcasts happen after the commit, so
  // clients never hear about a change that then rolled back.
  const touchedMaps = new Set<string>();
  const { removedIds, upserted } = db.transaction(() => {
    const removed: string[] = [];
    let existingOnTarget: string | null = null;
    // Moving between maps must not reset the token's look: remember how it
    // appeared on the map it is leaving and carry that across.
    let priorLook: { size: number; shape: TokenShape; color: string } | null = null;
    for (const t of tokens.forCharacter(character.id)) {
      if (t.mapId === mapId) { existingOnTarget = t.id; continue; }
      priorLook ??= { size: t.size, shape: t.shape, color: t.color };
      tokens.delete(t.id);
      removed.push(t.id);
      touchedMaps.add(t.mapId);
    }

    if (existingOnTarget && dropHex) {
      tokens.move(existingOnTarget, dropHex.q, dropHex.r);
      touchedMaps.add(mapId);
      return { removedIds: removed, upserted: tokens.byId(existingOnTarget)! };
    }
    if (!existingOnTarget) {
      let hex = dropHex;
      if (!hex) {
        const spawn = map.spawn ?? centerHex(map.grid);
        const occupied = new Set(tokens.forMap(mapId).map((t) => packHex({ q: t.q, r: t.r })));
        hex = firstFreeHex(spawn, occupied, map.grid);
      }
      // Appearance choices live on the SHEET (tokenColor/Shape/Size, alongside
      // the existing tokenImageAssetId), so the creator wizard's Customize
      // Appearance step survives re-placement onto other maps.
      const sh = character.sheet as Record<string, unknown>;
      const artAssetId = typeof sh.tokenImageAssetId === 'string' ? sh.tokenImageAssetId : null;
      const hp = systemFor(character.system).hp(character.sheet);
      const fallbackColor = character.ownerUserId
        ? colorForOwner(campaignId, character.ownerUserId)
        : TOKEN_COLORS[Math.abs(hashStr(character.id)) % TOKEN_COLORS.length];
      const look = priorLook ?? tokenLookFor(character);
      const created = tokens.create({
        mapId, characterId: character.id, name: character.name, artAssetId,
        q: hex.q, r: hex.r, layer: character.ownerUserId ? 'token' : 'gm',
        size: look.size,
        shape: look.shape,
        color: priorLook?.color
          ?? (typeof sh.tokenColor === 'string' && /^#[0-9a-fA-F]{6}$/.test(sh.tokenColor) ? sh.tokenColor : fallbackColor),
        vision: null, bar: hp.maxHp > 0 ? hp : null, light: null,
      });
      // A vehicle arrives already rideable, with its seats set from the
      // sheet's crew + passengers — that IS the designation, made by whoever
      // put a boat in the compendium rather than re-ticked on every spawn.
      if (character.system === 'swade' && character.sheet.vehicle === true) {
        tokens.update(created.id, { mountable: true, maxRiders: vehicleSeats(character.sheet) });
      }
      touchedMaps.add(mapId);
      return { removedIds: removed, upserted: created };
    }
    return { removedIds: removed, upserted: null };
  })();

  for (const id of removedIds) io.to(dmRoom(campaignId)).emit(S2C.TOKEN_REMOVED, { tokenId: id });
  if (upserted) io.to(dmRoom(campaignId)).emit(S2C.TOKEN_UPSERTED, { token: upserted });

  // A player's own token landing on a map they're not currently viewing
  // (e.g. the DM dragged their character onto a new map) pulls that player
  // onto it — the same mechanism as the DM manually assigning them a map.
  if (character.ownerUserId && campaigns.viewMapIdFor(campaignId, character.ownerUserId) !== mapId) {
    campaigns.setMemberMap(campaignId, character.ownerUserId, mapId);
    sendMapStateToUser(io, campaignId, character.ownerUserId);
    broadcastPresence(io, campaignId);
  }

  for (const m of touchedMaps) syncMapVision(io, campaignId, m);
  broadcastDirectory(io, campaignId);
}
