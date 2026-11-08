/**
 * Split the argument of the DM's `/as` command into who is speaking and what
 * they say.
 *
 *   "Sabu: Put down your weapons."          → Sabu
 *   "Sabu, Royal Priest: Walk back."         → Sabu, Royal Priest
 *   "Sabu, Royal Priest Walk back."          → Sabu, Royal Priest (a known name)
 *   "S.Y.S.T.E.M. Six signatures present."   → S.Y.S.T.E.M. (first word)
 *
 * A colon is the explicit form and always wins, so a voice that is no
 * character at all ("Voice on the tracker: ...") can be any length. Without
 * one, the longest known character name the text starts with is the speaker,
 * so the DM can type an NPC's full name naturally; failing that, the first
 * word is. Null when there is no message to say.
 */
export function parseSpeakAs(raw: string, knownNames: readonly string[] = []): { name: string; body: string } | null {
  const text = raw.trim();
  const colon = text.indexOf(':');
  // A colon past the first 60 characters is punctuation in a message, not
  // the end of a name.
  if (colon > 0 && colon <= 60) {
    const name = text.slice(0, colon).trim();
    const body = text.slice(colon + 1).trim();
    if (name && body) return { name, body };
    if (name && !body) return null;
  }
  const lower = text.toLowerCase();
  let best = '';
  for (const n of knownNames) {
    const name = n.trim();
    if (name && name.length > best.length && lower.startsWith(`${name.toLowerCase()} `)) best = name;
  }
  if (best) {
    const body = text.slice(best.length).trim();
    return body ? { name: best, body } : null;
  }
  const m = text.match(/^(\S+)\s+([\s\S]+)$/);
  if (!m) return null;
  return { name: m[1], body: m[2].trim() };
}
