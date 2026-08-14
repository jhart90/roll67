import { useState } from 'react';
import { authHeaders } from '../api';
import { useGameStore } from '../store/game';

/**
 * Take the whole campaign away in one file.
 *
 * Everything the table is made of goes: sheets, maps and their walls, tokens
 * where they stand, chests and shops, handouts, the chat log, the initiative
 * order, the clock, and every image and sound that has ever been uploaded to
 * it. Handed back to a server that has never seen this campaign, the file
 * rebuilds it — same ids, same everything — which is the only definition of
 * backup worth having.
 *
 * The download goes through fetch rather than a plain link because the
 * endpoint is bearer-authenticated: a bare href arrives without the token.
 */
export function CampaignBackup({ onClose }: { onClose: () => void }) {
  const campaign = useGameStore((s) => s.campaign);
  const [busy, setBusy] = useState(false);

  async function download() {
    if (!campaign) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/campaigns/${campaign.id}/backup`, { headers: authHeaders() });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Backup failed');
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      const slug = campaign.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'campaign';
      a.download = `${slug}-${new Date().toISOString().slice(0, 10)}.r67campaign`;
      a.click();
      URL.revokeObjectURL(url);
      useGameStore.getState().toast('Backup saved. Keep it somewhere that isn’t this server.', 'info');
    } catch (err) {
      useGameStore.getState().toast(err instanceof Error ? err.message : 'Backup failed');
    } finally {
      setBusy(false);
    }
  }

  if (!campaign) return null;
  return (
    <div className="dock-panel">
      <div className="dock-header">
        <h3>Back up campaign</h3>
        <button className="link" onClick={onClose}>close</button>
      </div>
      <p className="dim" style={{ fontSize: 12, lineHeight: 1.5 }}>
        One file holding all of <strong>{campaign.name}</strong> — every sheet, map, wall, token, chest,
        handout, the chat log, the initiative order and the clock, plus every image and sound uploaded to it.
        Restoring it on any Roll67 server rebuilds the campaign exactly, from the shelf screen.
      </p>
      <p className="dim" style={{ fontSize: 12, lineHeight: 1.5 }}>
        Player accounts aren’t in the file — no passwords leave this server. Players re-register with the same
        usernames and their characters find them again.
      </p>
      <button className="btn btn-accent" disabled={busy} onClick={download}>
        {busy ? 'Packing it up…' : '⬇ Download backup'}
      </button>
    </div>
  );
}
