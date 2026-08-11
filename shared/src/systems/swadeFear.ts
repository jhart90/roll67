/**
 * SWADE Fear checks and the Fear Table.
 *
 * A Fear check is a Spirit roll made as a free action the first time a
 * character spots something frightening. Success and they carry on. Failure
 * costs them, and how much depends on what they are looking at:
 *
 *   NAUSEA — a gruesome or horrific scene. Shaken and Fatigued, and a
 *            Critical Failure sends them to the Fear Table as well.
 *   TERROR — a terrifying creature or unknowable evil. Extras are simply
 *            Panicked; Wild Cards roll on the Fear Table, at +2 if the Fear
 *            check was a Critical Failure.
 *
 * The creature's own Fear penalty (a −2, say) applies twice over: once as a
 * penalty on the Spirit roll, and again as a *bonus* to the d20 pushing the
 * result down the table. Both directions are the book's.
 */

export type FearSource = 'nausea' | 'terror';

/** What a Fear Table result does to the character. */
export interface FearOutcome {
  id: string;
  /** The book's own name for the row. */
  label: string;
  /** The row's text, shown on the chat card. */
  effect: string;
  /** Conditions to apply. */
  conditions?: string[];
  /** A Hindrance the character picks up for good (or for the encounter). */
  hindrance?: string;
  /** Set when the row wants a follow-up roll the engine can't decide alone. */
  followUp?: 'vigor-heart-attack' | 'phobia-trauma' | 'joker';
}

/** The d20 bands, low roll to high — best outcome first, worst last. */
export const FEAR_TABLE: { min: number; max: number; outcome: FearOutcome }[] = [
  {
    min: 1,
    max: 3,
    outcome: {
      id: 'adrenaline',
      label: 'Adrenaline Surge',
      effect: 'The hero’s “fight” response takes over — he acts as if he had a Joker this action.',
      followUp: 'joker',
    },
  },
  {
    min: 4,
    max: 6,
    outcome: {
      id: 'distracted',
      label: 'Distracted',
      effect: 'The hero is Distracted until the end of his next turn.',
      conditions: ['distracted'],
    },
  },
  {
    min: 7,
    max: 9,
    outcome: {
      id: 'vulnerable',
      label: 'Vulnerable',
      effect: 'The target is Vulnerable until the end of his next turn.',
      conditions: ['vulnerable'],
    },
  },
  {
    min: 10,
    max: 12,
    outcome: { id: 'shaken', label: 'Shaken', effect: 'The hero is Shaken.', conditions: ['shaken'] },
  },
  {
    min: 13,
    max: 13,
    outcome: {
      id: 'markOfFear',
      label: 'The Mark of Fear',
      effect: 'The hero is Stunned and suffers some cosmetic physical alteration — a white streak in his hair, a permanent twitch, or some other minor physical change.',
      conditions: ['stunned'],
    },
  },
  {
    min: 14,
    max: 15,
    outcome: {
      id: 'frightened',
      label: 'Frightened',
      effect: 'The character gains the Hesitant Hindrance for the remainder of the encounter. If he already has it, he’s Panicked instead.',
      hindrance: 'Hesitant',
    },
  },
  {
    min: 16,
    max: 17,
    outcome: {
      id: 'panicked',
      label: 'Panicked',
      effect: 'The character immediately moves his full Pace away from the danger and is Shaken.',
      conditions: ['shaken', 'frightened'],
    },
  },
  {
    min: 18,
    max: 19,
    outcome: {
      id: 'minorPhobia',
      label: 'Minor Phobia',
      effect: 'The character gains a Minor Phobia Hindrance associated with the trauma.',
      hindrance: 'Phobia (Minor)',
      followUp: 'phobia-trauma',
    },
  },
  {
    min: 20,
    max: 21,
    outcome: {
      id: 'majorPhobia',
      label: 'Major Phobia',
      effect: 'The character gains the Major Phobia Hindrance.',
      hindrance: 'Phobia (Major)',
      followUp: 'phobia-trauma',
    },
  },
  {
    min: 22,
    max: Number.MAX_SAFE_INTEGER,
    outcome: {
      id: 'heartAttack',
      label: 'Heart Attack',
      effect: 'The hero is so overwhelmed with fear that his heart stutters. He must make an immediate Vigor roll at −2. If successful, he’s Stunned. If he fails, he’s Incapacitated and dies in 2d6 rounds — a Healing roll at −4 saves his life, but he remains Incapacitated.',
      followUp: 'vigor-heart-attack',
    },
  },
];

/**
 * The Panicked row when Frightened lands on someone already Hesitant: the
 * book routes them there rather than handing out a second copy.
 */
export const PANICKED_OUTCOME = FEAR_TABLE.find((r) => r.outcome.id === 'panicked')!.outcome;

/** Turn a creature's Fear penalty into the bonus it adds to the table roll. */
export function fearTableBonus(fearPenalty: number): number {
  // The book writes the penalty as a negative ("Fear −2") and then says to add
  // it as a positive. Accept it either way round so a DM typing 2 or −2 gets
  // the same, correct, answer.
  return Math.abs(Math.round(fearPenalty)) || 0;
}

/** The row a d20 total lands on. Totals below 1 clamp to the first row. */
export function fearTableRow(total: number): FearOutcome {
  const hit = FEAR_TABLE.find((r) => total >= r.min && total <= r.max);
  return (hit ?? FEAR_TABLE[0]!).outcome;
}

/**
 * The Fear Table roll: d20, plus the creature's Fear penalty as a positive,
 * plus 2 more when a Terror check was a Critical Failure. Nausea only reaches
 * the table on a Critical Failure at all, so the book's +2 — written beside
 * the Terror entry — is not applied there.
 */
export function fearTableTotal(
  d20: number, fearPenalty: number, source: FearSource, criticalFailure: boolean,
): number {
  const crit = source === 'terror' && criticalFailure ? 2 : 0;
  return d20 + fearTableBonus(fearPenalty) + crit;
}

/** What a failed Fear check costs, before any Fear Table roll. */
export interface FearCheckResult {
  /** Conditions the failure applies on its own. */
  conditions: string[];
  /** Fatigue levels gained (Nausea's own cost). */
  fatigue: number;
  /** True when this character must also roll on the Fear Table. */
  rollsTable: boolean;
  /** A one-line summary for the chat card. */
  summary: string;
}

/**
 * Resolve a failed Fear check. `wildCard` matters only under Terror, where
 * Extras skip the table and are simply Panicked.
 */
export function fearCheckFailure(
  source: FearSource, criticalFailure: boolean, wildCard: boolean,
): FearCheckResult {
  if (source === 'nausea') {
    return {
      conditions: ['shaken'],
      fatigue: 1,
      rollsTable: criticalFailure,
      summary: criticalFailure
        ? 'Shaken and Fatigued — and a Critical Failure sends them to the Fear Table.'
        : 'Shaken and Fatigued.',
    };
  }
  if (!wildCard) {
    return {
      conditions: [...(PANICKED_OUTCOME.conditions ?? [])],
      fatigue: 0,
      rollsTable: false,
      summary: 'Panicked — flees a full Pace from the danger and is Shaken.',
    };
  }
  return {
    conditions: [],
    fatigue: 0,
    rollsTable: true,
    summary: criticalFailure
      ? 'Rolls on the Fear Table at +2 for the Critical Failure.'
      : 'Rolls on the Fear Table.',
  };
}

/** The Spirit roll's own modifier: the creature's Fear penalty, as a penalty. */
export function fearCheckMod(fearPenalty: number): number {
  return -fearTableBonus(fearPenalty);
}

export const FEAR_SOURCE_LABEL: Record<FearSource, string> = {
  nausea: 'Nausea (gruesome or horrific)',
  terror: 'Terror (a terrifying creature or evil)',
};
