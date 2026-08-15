import type { CardBackSpec, Character } from 'shared';
import { CARD_BACK_PATTERNS, CARD_BORDERS, normalizeCardBack, patternDefaults } from 'shared';
import { intents } from '../store/game';
import { CardBackView, cardBackCss } from '../util/cardBacks';

/**
 * The card-back studio: its own window, because sixteen patterns × sixteen
 * borders × free paint is a browse, and a browse does not belong crammed into
 * a sheet row. The Bio tab shows only the finished card and the door here.
 *
 * Everything applies as it is clicked — the sheet is the single copy, and the
 * live preview IS the sheet's value rendered by the same function that will
 * render it face down on every screen at the table.
 */
export function CardBackEditor({ character, onClose }: { character: Character; onClose: () => void }) {
  const spec = normalizeCardBack(character.sheet.cardBack);
  const save = (next: CardBackSpec) => intents.updateCharacter(character.id, { cardBack: next });

  /**
   * Picking a design adopts the whole look — geometry and colors, border
   * kept. The sixteen are pre-built starting points, not stencils over
   * whatever paint happens to be loaded; the repainting comes after, below.
   * Several share a geometry on purpose: fewer patterns, more designs.
   */
  const pickPattern = (id: string) => save(patternDefaults(id, spec.border));
  const paint = (patch: Partial<CardBackSpec>) => save({ ...spec, ...patch });

  const borderFollows = spec.borderColor === '';
  const resolvedBorder = spec.borderColor || spec.primary;

  return (
    <div className="cardback-editor">
      {/* The card as the table will see it, at full size, always current. */}
      <div className="cbe-preview">
        <CardBackView back={character.sheet.cardBack} />
        <span className="dim">{character.name}’s action cards</span>
      </div>

      <h4 className="settings-head">Design</h4>
      <div className="cardback-grid cbe-grid">
        {CARD_BACK_PATTERNS.map((p) => {
          // Three designs can share a weave, so "which tile is mine" is the
          // whole starting spec, not the geometry — otherwise picking one
          // plaid lights up all three.
          const d = patternDefaults(p.id, spec.border);
          const on = spec.pattern === d.pattern && spec.primary === d.primary
            && spec.secondary === d.secondary && spec.accent === d.accent;
          return (
            <button
              key={p.id}
              className={`cardback-pick${on ? ' on' : ''}`}
              title={p.label}
              onClick={() => pickPattern(p.id)}
            >
              <CardBackView back={d} className="cardback-mini" />
            </button>
          );
        })}
      </div>

      <h4 className="settings-head">Colors</h4>
      <div className="cbe-colors">
        <label>Primary
          <input type="color" value={spec.primary} onChange={(e) => paint({ primary: e.target.value })} />
        </label>
        <label>Secondary
          <input type="color" value={spec.secondary} onChange={(e) => paint({ secondary: e.target.value })} />
        </label>
        <label>Secondary 2
          <input type="color" value={spec.accent} onChange={(e) => paint({ accent: e.target.value })} />
        </label>
      </div>

      <h4 className="settings-head">Border</h4>
      {/* Each border worn by the CURRENT card, not by a neutral blank — the
          question being answered is "what would mine look like in this". */}
      <div className="cardback-grid cbe-grid">
        {CARD_BORDERS.map((b) => (
          <button
            key={b.id}
            className={`cardback-pick${spec.border === b.id ? ' on' : ''}`}
            title={b.label}
            onClick={() => paint({ border: b.id })}
          >
            <CardBackView back={{ ...spec, border: b.id }} className="cardback-mini" />
          </button>
        ))}
      </div>

      <div className="cbe-colors">
        <label className="cbe-border-color">Border color
          <span className="cbe-swatch-row">
            <button
              className={`cbe-swatch${borderFollows ? ' on' : ''}`}
              style={{ background: spec.primary }}
              title="Follow the primary color — repaints with it"
              onClick={() => paint({ borderColor: '' })}
            >P</button>
            <button
              className={`cbe-swatch${spec.borderColor === spec.secondary ? ' on' : ''}`}
              style={{ background: spec.secondary }}
              title="Use the secondary color"
              onClick={() => paint({ borderColor: spec.secondary })}
            >S</button>
            <button
              className={`cbe-swatch${spec.borderColor === spec.accent ? ' on' : ''}`}
              style={{ background: spec.accent }}
              title="Use the second secondary color"
              onClick={() => paint({ borderColor: spec.accent })}
            >S2</button>
            {/* The tertiary: any color at all, nothing to do with the three. */}
            <input
              type="color"
              value={resolvedBorder}
              title="A color of its own"
              onChange={(e) => paint({ borderColor: e.target.value })}
            />
          </span>
        </label>
      </div>

      <div className="row" style={{ marginTop: 10 }}>
        <button className="link" onClick={() => intents.updateCharacter(character.id, { cardBack: '' })}>
          reset to classic
        </button>
        <span className="spacer" />
        <button className="btn btn-accent" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

/** The Bio tab's face: the current card and the door to the studio. */
export function CardBackFieldPreview({ value, readOnly, onOpen }: {
  value: unknown; readOnly: boolean; onOpen: () => void;
}) {
  return (
    <div className="cbe-field-preview">
      <div className="cardback-mini" style={cardBackCss(value)} />
      {!readOnly && <button className="link" onClick={onOpen}>Customize…</button>}
    </div>
  );
}
