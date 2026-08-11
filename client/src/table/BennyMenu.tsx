import { useState } from 'react';
import type { BennyUseId } from 'shared';
import { intents, useGameStore } from '../store/game';

const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const conds = (sheet: Record<string, unknown>): string[] =>
  Array.isArray(sheet.conditions) ? (sheet.conditions as string[]) : [];

/**
 * The SWADE Benny menu: a floating 🪙 chip that opens the full "Benny Uses"
 * table. Every use the server can automate is a live button; anything not
 * currently legal (not Shaken, no recent roll, PP already full…) is greyed
 * out with the reason in its tooltip.
 */
export function BennyMenu() {
  const you = useGameStore((s) => s.you);
  const campaign = useGameStore((s) => s.campaign);
  const characters = useGameStore((s) => s.characters);
  const soakOffer = useGameStore((s) => s.soakOffer);
  const bennyState = useGameStore((s) => s.bennyState);
  const init = useGameStore((s) => s.initiativeState);
  // Shared with the keyring chip beside it: only one panel at a time.
  const open = useGameStore((s) => s.openChip === 'benny');
  const setOpen = (v: boolean | ((o: boolean) => boolean)) =>
    useGameStore.getState().setOpenChip((typeof v === 'function' ? v(open) : v) ? 'benny' : null);
  const [pickedId, setPickedId] = useState<string | null>(null);

  // Both of these are hooks, so they run on EVERY render — above the guards,
  // and above the `if (isDm)` branch that returns without reaching the
  // player-side code below. A hook that only runs on some renders is the
  // "rendered more hooks than during the previous render" crash, and toggling
  // the DM preview is exactly what flips that branch.
  const isDm = useGameStore((s) => s.isDm());
  const asUser = useGameStore((s) => s.asUserId());

  if (!you || campaign?.system !== 'swade') return null;

  // The DM's menu awards rather than spends: every player-controlled Wild
  // Card, one click each, announced in chat. (NPC bennies live on sheets.)
  if (isDm) {
    const wildCards = characters.filter((c) =>
      c.system === 'swade' && c.ownerUserId && (c.sheet as Record<string, unknown>).wildCard !== false);
    if (wildCards.length === 0) return null;
    return (
      <div className="benny-menu">
        <button className={`benny-chip ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} title="Award Bennies">
          🪙 DM
        </button>
        {open && (
          <div className="benny-panel">
            <div className="benny-head">
              <strong>Award Bennies</strong>
              <span className="dim">announced in chat</span>
            </div>
            {wildCards.map((c) => (
              <button
                key={c.id}
                title={`Give ${c.name} a Benny — posts "🪙 The DM awards ${c.name} a Benny!" to chat`}
                onClick={() => intents.awardBenny(c.id)}
              >
                🪙 {c.name} <span className="dim">({num((c.sheet as Record<string, unknown>).bennies)})</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  const mine = characters.filter((c) => c.system === 'swade' && c.ownerUserId === asUser);
  if (mine.length === 0) return null;
  const ch = mine.find((c) => c.id === pickedId) ?? mine[0];
  const sheet = ch.sheet as Record<string, unknown>;
  const bennies = num(sheet.bennies);
  const reroll = bennyState[ch.id];

  interface UseRow { id: BennyUseId | 'soak'; label: string; enabled: boolean; why: string }
  const rows: UseRow[] = [
    {
      id: 'reroll-trait', label: 'Reroll a trait test',
      enabled: !!reroll?.canRerollTrait,
      why: reroll?.canRerollTrait
        ? 'Reroll your last trait test from scratch — the entire roll, wild die included — and keep whichever whole set you prefer. You can keep spending Bennies to try again, but a Critical Failure on a reroll must be accepted. (Not allowed if the original was a Critical Failure.)'
        : 'No recent trait roll to reroll (rolls stay rerollable for 5 minutes).',
    },
    {
      id: 'recover-shaken', label: 'Recover from Shaken',
      enabled: conds(sheet).includes('shaken'),
      why: conds(sheet).includes('shaken')
        ? 'Instantly stop being Shaken — no roll needed. This is a free action and may be done at any time, even interrupting another’s action.'
        : `${ch.name} isn't Shaken.`,
    },
    {
      id: 'soak', label: 'Attempt to Soak damage',
      enabled: soakOffer?.characterId === ch.id,
      why: soakOffer?.characterId === ch.id
        ? 'Make a Vigor roll: the success and each raise remove one of the Wounds just dealt. Soak them all and the Shaken goes too.'
        : 'Available right after taking Wounds — watch for the Soak prompt.',
    },
    {
      id: 'redraw-card', label: 'Draw a new Action Card',
      enabled: !!init.active && !!init.cardMode && init.entries.some((e) => e.name === ch.name),
      why: init.active && init.cardMode
        ? 'Draw an additional Action Card and act on your choice of all your draws this round. You may keep spending Bennies for more cards.'
        : 'Only during action-card initiative.',
    },
    {
      id: 'reroll-damage', label: 'Reroll damage',
      enabled: !!reroll?.canRerollDamage,
      why: reroll?.canRerollDamage
        ? 'Reroll your attack’s damage — including any bonus raise die — and use whichever result you prefer.'
        : 'No recent damage roll to reroll (rolls stay rerollable for 5 minutes).',
    },
    {
      id: 'regain-pp', label: 'Regain 5 Power Points',
      enabled: num(sheet.pp) < num(sheet.maxPp, 10) && String(sheet.arcaneBackground ?? '').trim() !== '',
      why: String(sheet.arcaneBackground ?? '').trim() === ''
        ? 'Only characters with an Arcane Background can recover Power Points this way.'
        : num(sheet.pp) < num(sheet.maxPp, 10)
          ? `Recover 5 Power Points, up to your maximum (now ${num(sheet.pp)}/${num(sheet.maxPp, 10)}).`
          : 'Power Points are already full.',
    },
    {
      id: 'influence', label: 'Influence the story',
      enabled: true,
      why: 'Entirely up to the Game Master: an extra clue when the table is stuck, a mundane but needed item, or a nudge that makes an unimportant NPC more agreeable. Spending it announces the request to the table.',
    },
  ];

  const spend = (id: UseRow['id']) => {
    if (id === 'soak') intents.soakRoll(ch.id, true);
    else intents.bennyUse(ch.id, id);
  };

  return (
    <div className="benny-menu">
      <button className={`benny-chip ${open ? 'open' : ''}`} onClick={() => setOpen((o) => !o)} title="Benny menu">
        🪙 {bennies}
      </button>
      {open && (
        <div className="benny-panel">
          <div className="benny-head">
            <strong>Benny Uses</strong>
            <span className="dim">{bennies} left</span>
          </div>
          {mine.length > 1 && (
            <select value={ch.id} onChange={(e) => setPickedId(e.target.value)}>
              {mine.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
          {rows.map((r) => (
            <button
              key={r.id}
              disabled={bennies <= 0 || !r.enabled}
              title={bennies <= 0 ? 'No Bennies left.' : r.why}
              onClick={() => spend(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
