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
  const [open, setOpen] = useState(false);
  const [pickedId, setPickedId] = useState<string | null>(null);

  if (!you || campaign?.system !== 'swade') return null;
  const isDm = you.role === 'dm';
  const mine = characters.filter((c) => c.system === 'swade' && (isDm || c.ownerUserId === you.userId));
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
      why: reroll?.canRerollTrait ? 'Reroll your last trait roll — the better result counts.' : 'No recent trait roll to reroll.',
    },
    {
      id: 'recover-shaken', label: 'Recover from Shaken',
      enabled: conds(sheet).includes('shaken'),
      why: conds(sheet).includes('shaken') ? 'Instantly stop being Shaken — no roll needed.' : `${ch.name} isn't Shaken.`,
    },
    {
      id: 'soak', label: 'Attempt to Soak damage',
      enabled: soakOffer?.characterId === ch.id,
      why: soakOffer?.characterId === ch.id
        ? 'Vigor roll — the success and each raise remove a wound just taken.'
        : 'Only right after taking Wounds (the Soak prompt).',
    },
    {
      id: 'redraw-card', label: 'Draw a new Action Card',
      enabled: !!init.active && !!init.cardMode && init.entries.some((e) => e.name === ch.name),
      why: init.active && init.cardMode
        ? 'Discard your Action Card and draw a new one.'
        : 'Only during action-card initiative.',
    },
    {
      id: 'reroll-damage', label: 'Reroll damage',
      enabled: !!reroll?.canRerollDamage,
      why: reroll?.canRerollDamage ? 'Reroll your last damage roll — the better result counts.' : 'No recent damage roll to reroll.',
    },
    {
      id: 'regain-pp', label: 'Regain 5 Power Points',
      enabled: num(sheet.pp) < num(sheet.maxPp, 10) && String(sheet.arcaneBackground ?? '').trim() !== '',
      why: String(sheet.arcaneBackground ?? '').trim() === ''
        ? `${ch.name} has no Arcane Background.`
        : num(sheet.pp) < num(sheet.maxPp, 10)
          ? `Recover 5 PP (now ${num(sheet.pp)}/${num(sheet.maxPp, 10)}).`
          : 'Power Points are already full.',
    },
    {
      id: 'influence', label: 'Influence the story',
      enabled: true,
      why: 'Spend a Benny on a narrative edit — the table adjudicates.',
    },
  ];

  const spend = (id: UseRow['id']) => {
    if (id === 'soak') intents.soakRoll(ch.id, true);
    else intents.bennyUse(ch.id, id);
  };

  return (
    <div className="benny-menu">
      <button className="benny-chip" onClick={() => setOpen((o) => !o)} title="Benny menu">
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
