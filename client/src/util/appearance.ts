/**
 * Per-viewer appearance: the UI theme, and the colors the map's geometry is
 * drawn in.
 *
 * All of it is LOCAL. Two people at the same table can run different themes
 * and different wall colors without arguing, and none of it touches the
 * campaign — this is how you like to look at the game, not part of the game.
 * Stored in localStorage so it survives a reload, applied as CSS variables so
 * every existing rule picks it up without being rewritten.
 */

export type UiTheme = 'standard' | 'dark' | 'light';

export const UI_THEMES: { id: UiTheme; label: string; hint: string }[] = [
  { id: 'standard', label: 'Standard', hint: 'the original slate blue' },
  { id: 'dark', label: 'Dark', hint: 'matte black, for a dim room' },
  { id: 'light', label: 'Light', hint: 'dark text on cool grey' },
];

/** The variables a theme overrides. Everything else is shared. */
type ThemeVars = Record<string, string>;

const THEME_VARS: Record<UiTheme, ThemeVars> = {
  // The scheme the app has always used — an empty override, so "Standard"
  // means the stylesheet's own values rather than a copy of them that could
  // drift out of step with it.
  standard: {},
  dark: {
    '--bg': '#000000',
    '--panel': '#0c0c0e',
    '--panel-2': '#15151a',
    '--border': '#2a2a33',
    '--text': '#e8e8ee',
    '--text-dim': '#8f8f9d',
    '--accent': '#6c9bd2',
    '--accent-2': '#d2a56c',
  },
  // Grey, not white. A pure-white panel beside a dark map is a torch in the
  // face — every surface here is a cool grey, and the lightest of them still
  // sits well below white so nothing glares.
  light: {
    '--bg': '#c9cfd8',
    '--panel': '#dde2e9',
    '--panel-2': '#ccd3dc',
    '--border': '#a9b3c1',
    '--text': '#191d24',
    '--text-dim': '#525b69',
    '--accent': '#33608f',
    '--accent-2': '#8a5a1c',
    '--danger': '#a83636',
    '--ok': '#2e6f40',
  },
};

/** How the map's geometry is drawn for this viewer. */
export interface MapColors {
  wall: string;
  wallOpacity: number;
  doorClosed: string;
  doorClosedOpacity: number;
  doorOpen: string;
  doorOpenOpacity: number;
}

/** The colors the app shipped with, so "reset" has something to mean. */
export const MAP_COLORS_DEFAULT: MapColors = {
  wall: '#d8574f',
  wallOpacity: 0.85,
  doorClosed: '#c98d4b',
  doorClosedOpacity: 0.95,
  doorOpen: '#7ed28a',
  doorOpenOpacity: 0.7,
};

/**
 * Where a roll's modifier explains itself: on hover, or in the card.
 *
 * The tooltip keeps the log terse but costs a hover per roll, which is a poor
 * trade for anyone reading on a touchscreen, sharing a screen, or still
 * learning why a number came out the way it did. Same words either way.
 */
export type RollDetail = 'tooltip' | 'chat';

export const ROLL_DETAILS: { id: RollDetail; label: string; hint: string }[] = [
  { id: 'tooltip', label: 'In tooltip', hint: 'Hover a modifier to read what went into it. Keeps the log compact.' },
  { id: 'chat', label: 'In chat', hint: 'Every modifier is itemized in the roll card itself, with no hovering.' },
];

const THEME_KEY = 'roll67.uiTheme';
const COLORS_KEY = 'roll67.mapColors';
const ROLL_DETAIL_KEY = 'roll67.rollDetail';

export function readRollDetail(): RollDetail {
  return safeRead(ROLL_DETAIL_KEY) === 'chat' ? 'chat' : 'tooltip';
}

export function saveRollDetail(v: RollDetail): void {
  safeWrite(ROLL_DETAIL_KEY, v);
}

/**
 * Which settings sections this viewer has folded away.
 *
 * Stored by section title, and stored as the CLOSED set rather than the open
 * one: a section added later is then open by default for everyone, instead of
 * arriving silently collapsed for anybody who had saved a list without it.
 */
const SECTIONS_KEY = 'roll67.settingsClosed';

export function readClosedSections(): string[] {
  const raw = safeRead(SECTIONS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function saveClosedSections(titles: string[]): void {
  safeWrite(SECTIONS_KEY, JSON.stringify(titles));
}

export function readTheme(): UiTheme {
  const v = safeRead(THEME_KEY);
  return v === 'dark' || v === 'light' || v === 'standard' ? v : 'standard';
}

export function readMapColors(): MapColors {
  const raw = safeRead(COLORS_KEY);
  if (!raw) return { ...MAP_COLORS_DEFAULT };
  try {
    const parsed = JSON.parse(raw) as Partial<MapColors>;
    // Merged over the defaults rather than trusted wholesale: a key added to
    // MapColors later must not come back undefined for anyone who saved
    // before it existed.
    return { ...MAP_COLORS_DEFAULT, ...parsed };
  } catch {
    return { ...MAP_COLORS_DEFAULT };
  }
}

export function saveTheme(theme: UiTheme): void {
  safeWrite(THEME_KEY, theme);
  applyTheme(theme);
}

export function saveMapColors(colors: MapColors): void {
  safeWrite(COLORS_KEY, JSON.stringify(colors));
}

/**
 * Push a theme onto the document. Standard clears the overrides instead of
 * writing its own values, so the stylesheet stays the single definition of
 * what "standard" is.
 */
export function applyTheme(theme: UiTheme): void {
  const root = document.documentElement;
  const all = new Set(Object.keys(THEME_VARS.dark).concat(Object.keys(THEME_VARS.light)));
  for (const name of all) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(THEME_VARS[theme])) {
    root.style.setProperty(name, value);
  }
  root.dataset.theme = theme;
}

function safeRead(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function safeWrite(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* private mode — in-memory only */ }
}
