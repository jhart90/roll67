import type { Server, Socket } from 'socket.io';
import fs from 'node:fs';
import path from 'node:path';
import {
  C2S, S2C,
  type AddAudioPayload, type AudioControlPayload, type AudioState,
  type CreateFolderPayload, type DeleteAssetPayload, type DeleteFolderPayload,
  type MoveAssetPayload, type MoveHandoutPayload, type RemoveAudioPayload,
  type RenameAssetPayload, type RenameFolderPayload,
} from 'shared';
import { UPLOADS_DIR } from '../../config.js';
import { assetFolders, assets, audioTracks, campaigns, handouts } from '../../db/repos.js';
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
  return audioStates.get(campaignId) ?? { trackId: null, playing: false, loop: false, volume: 0.6, startedAt: 0 };
}

export function broadcastAudio(io: Server, campaignId: string): void {
  io.to(campaignRoom(campaignId)).emit(S2C.AUDIO_TRACKS, { tracks: audioTracks.forCampaign(campaignId) });
  io.to(campaignRoom(campaignId)).emit(S2C.AUDIO_STATE, { state: getAudioState(campaignId) });
}

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
  }));

  socket.on(C2S.CREATE_FOLDER, safe(socket, ({ name, kind }: CreateFolderPayload) => {
    const d = requireDm(socket);
    assetFolders.create(d.campaignId, name?.trim() || 'New folder', kind === 'handout' ? 'handout' : 'art');
    broadcastAssets(io, d.campaignId);
    broadcastHandouts(io, d.campaignId);
  }));

  socket.on(C2S.RENAME_FOLDER, safe(socket, ({ folderId, name }: RenameFolderPayload) => {
    const d = requireDm(socket);
    const f = assetFolders.byId(folderId);
    if (!f || f.campaignId !== d.campaignId) return;
    assetFolders.rename(folderId, name?.trim() || f.name);
    broadcastAssets(io, d.campaignId);
    broadcastHandouts(io, d.campaignId);
  }));

  socket.on(C2S.DELETE_FOLDER, safe(socket, ({ folderId }: DeleteFolderPayload) => {
    const d = requireDm(socket);
    const f = assetFolders.byId(folderId);
    if (!f || f.campaignId !== d.campaignId) return;
    assetFolders.delete(folderId);
    broadcastAssets(io, d.campaignId);
    broadcastHandouts(io, d.campaignId);
  }));

  socket.on(C2S.MOVE_ASSET, safe(socket, ({ assetId, folderId }: MoveAssetPayload) => {
    const d = requireDm(socket);
    const a = assets.byId(assetId);
    if (!a || a.campaign_id !== d.campaignId) return;
    assets.move(assetId, folderId);
    broadcastAssets(io, d.campaignId);
  }));

  socket.on(C2S.RENAME_ASSET, safe(socket, ({ assetId, title }: RenameAssetPayload) => {
    const d = requireDm(socket);
    const a = assets.byId(assetId);
    if (!a || a.campaign_id !== d.campaignId) return;
    assets.rename(assetId, title?.trim() || a.filename);
    broadcastAssets(io, d.campaignId);
  }));

  socket.on(C2S.DELETE_ASSET, safe(socket, ({ assetId }: DeleteAssetPayload) => {
    const d = requireDm(socket);
    const a = assets.byId(assetId);
    if (!a || a.campaign_id !== d.campaignId) return;
    try { fs.unlinkSync(path.join(UPLOADS_DIR, `${a.id}.${a.ext}`)); } catch { /* already gone */ }
    assets.delete(assetId);
    broadcastAssets(io, d.campaignId);
  }));

  socket.on(C2S.MOVE_HANDOUT, safe(socket, ({ handoutId, folderId }: MoveHandoutPayload) => {
    const d = requireDm(socket);
    const h = handouts.byId(handoutId);
    if (!h) return;
    handouts.move(handoutId, folderId);
    broadcastHandouts(io, d.campaignId);
  }));

  // ----- audio -----

  socket.on(C2S.ADD_AUDIO, safe(socket, ({ assetId, title }: AddAudioPayload) => {
    const d = requireDm(socket);
    const a = assets.byId(assetId);
    if (!a || a.campaign_id !== d.campaignId || a.kind !== 'audio') throw new Error('Not an audio asset.');
    audioTracks.add(d.campaignId, assetId, title?.trim() || a.filename);
    broadcastAudio(io, d.campaignId);
  }));

  socket.on(C2S.REMOVE_AUDIO, safe(socket, ({ trackId }: RemoveAudioPayload) => {
    const d = requireDm(socket);
    const t = audioTracks.byId(trackId);
    if (!t || t.campaignId !== d.campaignId) return;
    audioTracks.remove(trackId);
    const st = getAudioState(d.campaignId);
    if (st.trackId === trackId) audioStates.set(d.campaignId, { ...st, trackId: null, playing: false });
    broadcastAudio(io, d.campaignId);
  }));

  socket.on(C2S.AUDIO_CONTROL, safe(socket, ({ trackId, action, loop, volume }: AudioControlPayload) => {
    const d = requireDm(socket);
    const cur = getAudioState(d.campaignId);
    const next: AudioState = { ...cur };
    if (loop !== undefined) next.loop = loop;
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
  }));
}
