import type { Server, Socket } from 'socket.io';
import fs from 'node:fs';
import path from 'node:path';
import {
  C2S, S2C, PLAYLIST_COUNT, PLAYLIST_SIZE,
  type AddAudioPayload, type AudioControlPayload, type AudioState,
  type CreateFolderPayload, type DeleteAssetPayload, type DeleteFolderPayload,
  type MoveAssetPayload, type MoveHandoutPayload, type RemoveAudioPayload,
  type SetSoundboardSlotPayload, type ClearSoundboardSlotPayload, type PlaySfxPayload,
  type RenameAssetPayload, type RenameFolderPayload,
} from 'shared';
import { UPLOADS_DIR } from '../../config.js';
import { assetFolders, assets, audioTracks, campaigns, handouts, soundboard, SOUNDBOARD_SLOTS } from '../../db/repos.js';
import { campaignRoom, campaignSockets, dmRoom, emitError, safe, sdata } from '../hub.js';
import { broadcastHandouts } from './table.js';

// ---------- asset library (DM tool) ----------

export function broadcastAssets(io: Server, campaignId: string): void {
  const payload = { folders: assetFolders.forCampaign(campaignId), assets: assets.forCampaign(campaignId) };
  io.to(dmRoom(campaignId)).emit(S2C.ASSETS, payload);
}

// ---------- audio jukebox (in-memory playback state per campaign) ----------

const audioStates = new Map<string, AudioState>();

export function getAudioState(campaignId: string): AudioState {
  return audioStates.get(campaignId) ?? { trackId: null, playing: false, loop: false, shuffle: false, playlist: 0, volume: 0.6, startedAt: 0 };
}

export function broadcastAudio(io: Server, campaignId: string): void {
  io.to(campaignRoom(campaignId)).emit(S2C.AUDIO_TRACKS, { tracks: audioTracks.forCampaign(campaignId) });
  io.to(campaignRoom(campaignId)).emit(S2C.AUDIO_STATE, { state: getAudioState(campaignId) });
}

/** The grid is DM-only, so it goes to the DM room rather than the campaign. */
export function broadcastSoundboard(io: Server, campaignId: string): void {
  io.to(dmRoom(campaignId)).emit(S2C.SOUNDBOARD, { slots: soundboard.forCampaign(campaignId) });
}

const validSlot = (i: unknown): i is number =>
  Number.isInteger(i) && (i as number) >= 0 && (i as number) < SOUNDBOARD_SLOTS;

function requireDm(socket: Socket) {
  const d = sdata(socket);
  if (!d.campaignId || d.role !== 'dm') throw new Error('DM only.');
  return d as typeof d & { campaignId: string };
}

export function registerLibraryHandlers(io: Server, socket: Socket): void {
  socket.on(C2S.REQUEST_ASSETS, safe(socket, () => {
    const d = sdata(socket);
    if (d.campaignId && d.role === 'dm') {
      socket.emit(S2C.ASSETS, { folders: assetFolders.forCampaign(d.campaignId), assets: assets.forCampaign(d.campaignId) });
    }
  }, 'REQUEST_ASSETS'));

  socket.on(C2S.CREATE_FOLDER, safe(socket, ({ name, kind }: CreateFolderPayload) => {
    const d = requireDm(socket);
    assetFolders.create(d.campaignId, name?.trim() || 'New folder', kind === 'handout' ? 'handout' : 'art');
    broadcastAssets(io, d.campaignId);
    broadcastHandouts(io, d.campaignId);
  }, 'CREATE_FOLDER'));

  socket.on(C2S.RENAME_FOLDER, safe(socket, ({ folderId, name }: RenameFolderPayload) => {
    const d = requireDm(socket);
    const f = assetFolders.byId(folderId);
    if (!f || f.campaignId !== d.campaignId) return;
    assetFolders.rename(folderId, name?.trim() || f.name);
    broadcastAssets(io, d.campaignId);
    broadcastHandouts(io, d.campaignId);
  }, 'RENAME_FOLDER'));

  socket.on(C2S.DELETE_FOLDER, safe(socket, ({ folderId }: DeleteFolderPayload) => {
    const d = requireDm(socket);
    const f = assetFolders.byId(folderId);
    if (!f || f.campaignId !== d.campaignId) return;
    assetFolders.delete(folderId);
    broadcastAssets(io, d.campaignId);
    broadcastHandouts(io, d.campaignId);
  }, 'DELETE_FOLDER'));

  socket.on(C2S.MOVE_ASSET, safe(socket, ({ assetId, folderId }: MoveAssetPayload) => {
    const d = requireDm(socket);
    const a = assets.byId(assetId);
    if (!a || a.campaign_id !== d.campaignId) return;
    assets.move(assetId, folderId);
    broadcastAssets(io, d.campaignId);
  }, 'MOVE_ASSET'));

  socket.on(C2S.RENAME_ASSET, safe(socket, ({ assetId, title }: RenameAssetPayload) => {
    const d = requireDm(socket);
    const a = assets.byId(assetId);
    if (!a || a.campaign_id !== d.campaignId) return;
    assets.rename(assetId, title?.trim() || a.filename);
    broadcastAssets(io, d.campaignId);
  }, 'RENAME_ASSET'));

  socket.on(C2S.DELETE_ASSET, safe(socket, ({ assetId }: DeleteAssetPayload) => {
    const d = requireDm(socket);
    const a = assets.byId(assetId);
    if (!a || a.campaign_id !== d.campaignId) return;
    // DB row first, file second: if the row is still referenced (a map
    // background or token art holds an FK to it), the delete THROWS -- and
    // deleting the file beforehand would leave that map/token pointing at a
    // dead URL with a row that can never be deleted. A file-unlink failure
    // after a successful row delete just strands a harmless orphan file.
    try {
      assets.delete(assetId);
    } catch {
      emitError(socket, 'That asset is still in use (as a map background or token art).');
      return;
    }
    try { fs.unlinkSync(path.join(UPLOADS_DIR, `${a.id}.${a.ext}`)); } catch { /* already gone */ }
    broadcastAssets(io, d.campaignId);
  }, 'DELETE_ASSET'));

  socket.on(C2S.MOVE_HANDOUT, safe(socket, ({ handoutId, folderId }: MoveHandoutPayload) => {
    const d = requireDm(socket);
    const h = handouts.byId(handoutId);
    if (!h) return;
    handouts.move(handoutId, folderId);
    broadcastHandouts(io, d.campaignId);
  }, 'MOVE_HANDOUT'));

  // ----- audio -----

  socket.on(C2S.ADD_AUDIO, safe(socket, ({ assetId, title, playlist }: AddAudioPayload) => {
    const d = requireDm(socket);
    const a = assets.byId(assetId);
    if (!a || a.campaign_id !== d.campaignId || a.kind !== 'audio') throw new Error('Not an audio asset.');
    const list = Math.max(0, Math.min(PLAYLIST_COUNT - 1, Math.floor(playlist ?? 0)));
    // Enforced here, not just greyed out in the UI: the cap is what keeps a
    // playlist a playlist rather than a library.
    if (audioTracks.countIn(d.campaignId, list) >= PLAYLIST_SIZE) {
      throw new Error(`Playlist ${list + 1} is full (${PLAYLIST_SIZE} tracks).`);
    }
    audioTracks.add(d.campaignId, assetId, title?.trim() || a.filename, list);
    broadcastAudio(io, d.campaignId);
  }, 'ADD_AUDIO'));

  socket.on(C2S.REMOVE_AUDIO, safe(socket, ({ trackId }: RemoveAudioPayload) => {
    const d = requireDm(socket);
    const t = audioTracks.byId(trackId);
    if (!t || t.campaignId !== d.campaignId) return;
    audioTracks.remove(trackId);
    const st = getAudioState(d.campaignId);
    if (st.trackId === trackId) audioStates.set(d.campaignId, { ...st, trackId: null, playing: false });
    broadcastAudio(io, d.campaignId);
  }, 'REMOVE_AUDIO'));

  socket.on(C2S.AUDIO_CONTROL, safe(socket, ({ trackId, action, loop, loopOne, shuffle, playlist, volume }: AudioControlPayload) => {
    const d = requireDm(socket);
    const cur = getAudioState(d.campaignId);
    const next: AudioState = { ...cur };
    if (loop !== undefined) next.loop = loop;
    if (loopOne !== undefined) next.loopOne = loopOne;
    if (shuffle !== undefined) next.shuffle = shuffle;
    if (playlist !== undefined) next.playlist = Math.max(0, Math.min(PLAYLIST_COUNT - 1, Math.floor(playlist)));
    if (volume !== undefined) next.volume = Math.max(0, Math.min(1, volume));
    if (action === 'play') {
      if (trackId && trackId !== cur.trackId) {
        next.trackId = trackId;
        next.startedAt = Date.now();
      } else if (!cur.startedAt) {
        next.startedAt = Date.now();
      }
      next.playing = true;
    } else if (action === 'pause') {
      next.playing = false;
    } else if (action === 'stop') {
      next.playing = false;
      next.trackId = null;
    }
    audioStates.set(d.campaignId, next);
    io.to(campaignRoom(d.campaignId)).emit(S2C.AUDIO_STATE, { state: next });
  }, 'AUDIO_CONTROL'));

  // ---- soundboard (DM-only grid; the sounds themselves reach everyone) ----

  socket.on(C2S.SET_SOUNDBOARD_SLOT, safe(socket, ({ slotIndex, assetId, label }: SetSoundboardSlotPayload) => {
    const d = requireDm(socket);
    if (!validSlot(slotIndex)) throw new Error('Bad soundboard slot.');
    const a = assets.byId(assetId);
    if (!a || a.campaign_id !== d.campaignId || a.kind !== 'audio') throw new Error('Not an audio asset.');
    soundboard.set(d.campaignId, slotIndex, assetId, label?.trim() || a.filename);
    broadcastSoundboard(io, d.campaignId);
  }, 'SET_SOUNDBOARD_SLOT'));

  socket.on(C2S.CLEAR_SOUNDBOARD_SLOT, safe(socket, ({ slotIndex }: ClearSoundboardSlotPayload) => {
    const d = requireDm(socket);
    if (!validSlot(slotIndex)) return;
    soundboard.clear(d.campaignId, slotIndex);
    broadcastSoundboard(io, d.campaignId);
  }, 'CLEAR_SOUNDBOARD_SLOT'));

  // Fire-and-forget: the URL is resolved server-side from the slot so a client
  // can't ask everyone to play an arbitrary file. Sent as its own event rather
  // than through AudioState, so an effect never interrupts the music.
  socket.on(C2S.PLAY_SFX, safe(socket, ({ slotIndex }: PlaySfxPayload) => {
    const d = requireDm(socket);
    if (!validSlot(slotIndex)) return;
    const url = soundboard.urlAt(d.campaignId, slotIndex);
    if (!url) return; // empty square
    const label = soundboard.forCampaign(d.campaignId).find((s) => s.slotIndex === slotIndex)?.label ?? '';
    io.to(campaignRoom(d.campaignId)).emit(S2C.SFX_PLAY, { url, label });
  }, 'PLAY_SFX'));
}
