import { useEffect, useState } from 'react';
import { ironMessage, ironRng, roll, type RollBreakdown } from 'shared';
import { intents, useGameStore } from '../store/game';
import { ConfirmButton } from '../util/ConfirmButton';

const shortHash = (h: string) => `${h.slice(0, 12)}…`;
const fmtDate = (t: number) => new Date(t).toLocaleString();

/**
 * Recompute a roll from a revealed seed entirely in the browser: rebuild the
 * HMAC-SHA256 keystream with WebCrypto and feed it to the same shared roller
 * the server used. Digest blocks are precomputed (WebCrypto is async, the
 * roller is not) — 64 blocks is far more than any roll can consume.
 */
async function recomputeRoll(seedHex: string, idx: number, expression: string): Promise<RollBreakdown> {
  const seed = Uint8Array.from(seedHex.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  const key = await crypto.subtle.importKey('raw', seed, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const blocks: Uint8Array[] = [];
  for (let b = 0; b < 64; b++) {
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ironMessage(idx, b)));
    blocks.push(new Uint8Array(sig));
  }
  return roll(expression, ironRng((b) => {
    if (b >= blocks.length) throw new Error('Roll consumed more keystream than expected.');
    return blocks[b];
  }));
}

function VerifyTool({ seeds }: { seeds: Array<{ commit: string; seedHex: string; firstIdx: number; lastIdx: number }> }) {
  const [idx, setIdx] = useState('');
  const [expr, setExpr] = useState('');
  const [result, setResult] = useState<string | null>(null);

  const run = async () => {
    const n = Number(idx);
    const seed = seeds.find((s) => n >= s.firstIdx && n <= s.lastIdx);
    if (!seed) {
      setResult('No revealed seed covers that roll # — its seed is still active (rotate to reveal it).');
      return;
    }
    try {
      const br = await recomputeRoll(seed.seedHex, n, expr.trim());
      setResult(`Recomputed ${br.expression}: [${br.dice.map((d) => d.value).join(', ')}] = ${br.total} — compare against the chat card.`);
    } catch (e) {
      setResult(`Could not verify: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="irondice-verify">
      <strong>Verify a roll</strong>
      <span className="dim" style={{ fontSize: 11 }}>
        Hover any roll card's 🛡 for its roll # and expression, then recompute it here from the revealed seed.
      </span>
      <div className="row">
        <input placeholder="roll #" value={idx} onChange={(e) => setIdx(e.target.value)} style={{ width: 80 }} />
        <input placeholder="expression, e.g. best(1d8!, 1d6!)" value={expr} onChange={(e) => setExpr(e.target.value)} />
        <button style={{ width: 'auto' }} disabled={!idx || !expr} onClick={() => void run()}>Recompute</button>
      </div>
      {result && <p style={{ fontSize: 12, margin: 0 }}>{result}</p>}
    </div>
  );
}

/** 🛡 IronDice: what it is, the live commitment, and the verification tools. */
export function IronDiceWindow() {
  const info = useGameStore((s) => s.ironDice);
  const isDm = useGameStore((s) => s.you?.role) === 'dm';
  useEffect(() => { intents.getIronDice(); }, []);

  return (
    <div className="irondice-window">
      <p style={{ marginTop: 0 }}>
        <strong>🛡 IronDice</strong> — every roll on Roll67 is thrown <b>on the server</b> from a
        cryptographic keystream (HMAC-SHA256), never in your browser, so no player or client mod can
        influence a result. Before any dice are thrown, the server publishes a <b>commitment</b>: the
        SHA-256 fingerprint of its secret seed. When the seed is later rotated it is revealed in full,
        and anyone can recompute every roll thrown under it — proving the house never fudged one.
      </p>
      {!info ? <p className="dim">Loading…</p> : (
        <>
          <div className="irondice-commit">
            <span className="dim">Active seed commitment</span>
            <code title={info.commit}>{info.commit}</code>
            <span className="dim" style={{ fontSize: 11 }}>
              committed {fmtDate(info.createdAt)} · rolls #{info.firstIdx}+ ({Math.max(0, info.rolls)} thrown so far)
            </span>
          </div>
          {isDm && (
            <ConfirmButton
              className=""
              style={{ width: 'auto' }}
              title="Reveal the current seed, making all its rolls verifiable, and mint a fresh one"
              confirmLabel="Reveal it and mint a fresh one?"
              onConfirm={() => intents.rotateIronDice()}
            >
              Rotate seed — reveal for verification
            </ConfirmButton>
          )}
          {info.revealed.length > 0 && (
            <>
              <h4 style={{ margin: '8px 0 4px' }}>Revealed seeds</h4>
              {info.revealed.map((r) => (
                <div key={r.commit} className="irondice-revealed">
                  <code title={`commitment ${r.commit}`}>{shortHash(r.commit)}</code>
                  <span className="dim">rolls #{r.firstIdx}–{r.lastIdx} · revealed {fmtDate(r.revealedAt)}</span>
                  <code className="irondice-seed" title="The revealed secret seed (hex)">{r.seedHex}</code>
                </div>
              ))}
              <VerifyTool seeds={info.revealed} />
            </>
          )}
          {info.revealed.length === 0 && (
            <p className="dim" style={{ fontSize: 12 }}>
              No seeds revealed yet — once the DM rotates the seed, its rolls become verifiable here.
            </p>
          )}
        </>
      )}
    </div>
  );
}
