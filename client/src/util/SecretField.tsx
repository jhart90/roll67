import type { ReactNode } from 'react';

/**
 * The house style for text nobody else will ever read.
 *
 * A DM types secrets into several different windows — a character's true
 * motives, what a handout is really about — and before this they each looked
 * like ordinary fields with a warning sentence beside them. A sentence is
 * something you read once and stop seeing; a colour is something you cannot
 * stop seeing. So every field whose contents never leave this screen wears
 * the same violet tint, the same bar down its left edge, and the same 🕶 on
 * its label, and the rule for reading the app becomes simple: tinted means
 * private, plain means somebody else can see it.
 *
 * It is deliberately a shared component rather than a shared class. A new
 * secret field should be impossible to add without inheriting the whole
 * treatment, wording included — and `hint` is required for the same reason,
 * because "private from whom" is exactly the part a reader needs.
 */
export function SecretField({ label, hint, children }: {
  label: string;
  /** Who cannot see this, in as many words. */
  hint: string;
  children: ReactNode;
}) {
  return (
    <div className="secret-field">
      <label className="secret-field-label">
        🕶 {label} <span className="dim">({hint})</span>
      </label>
      {children}
    </div>
  );
}
