import { intents, useGameStore } from '../store/game';

/**
 * You are on the ground and you asked to move. There are two ways to do that
 * and they are not the same choice: getting up is free but spends 2″ of this
 * turn's Pace and gives back the −2 that ranged attackers were suffering
 * against you, while crawling keeps all of that and costs you everything
 * except two inches.
 *
 * Moving used to stand a prone token up without asking, which silently threw
 * away whatever reason they had for lying down.
 */
export function CrawlPrompt() {
  const prompt = useGameStore((s) => s.crawlPrompt);
  if (!prompt) return null;
  return (
    <div className="soak-prompt">
      <strong>⬇️ {prompt.name} is Prone</strong>
      <span className="dim" style={{ fontSize: 12 }}>
        Standing up is a free action but costs <b>2″ of Pace</b>, and drops the −2 that
        ranged attacks against you are taking. Crawling stays down and keeps that cover,
        but you may only move <b>{prompt.crawlPace}″</b> — though rough ground costs a
        crawler nothing extra. Choose, then make the move again.
      </span>
      <div className="row">
        <button className="primary" style={{ width: 'auto' }} onClick={() => intents.proneMove(prompt.tokenId, 'stand')}>
          🧍 Stand up (2″)
        </button>
        <button onClick={() => intents.proneMove(prompt.tokenId, 'crawl')}>
          🐛 Stay down and crawl ({prompt.crawlPace}″)
        </button>
        <button onClick={() => useGameStore.setState({ crawlPrompt: null })}>Stay put</button>
      </div>
    </div>
  );
}
