import type { GameSystem } from '../types.js';

export interface Currency {
  /** Sheet field id the money is stored under. */
  id: string;
  label: string;
}

/** Currencies tracked on each system's character sheet (shop price columns). */
export const CURRENCIES: Record<GameSystem, Currency[]> = {
  dnd5e: [
    { id: 'cp', label: 'Copper (cp)' },
    { id: 'sp', label: 'Silver (sp)' },
    { id: 'ep', label: 'Electrum (ep)' },
    { id: 'gp', label: 'Gold (gp)' },
    { id: 'pp', label: 'Platinum (pp)' },
  ],
  swn: [{ id: 'credits', label: 'Credits' }],
  swade: [{ id: 'dollars', label: 'Currency ($)' }],
};

export function currenciesFor(system: GameSystem): Currency[] {
  return CURRENCIES[system];
}

/** Normalize a stored shop currency to a valid sheet field id for this system. */
export function normalizeCurrency(system: GameSystem, currency: string | undefined): string {
  const valid = new Set(CURRENCIES[system].map((c) => c.id));
  if (currency && valid.has(currency)) return currency;
  if (currency === 'cr') return 'credits'; // legacy default
  return system === 'swn' ? 'credits' : system === 'swade' ? 'dollars' : 'gp';
}
