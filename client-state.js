export const CURRENT_RULES = 'woodland-terrain-1';
export const CLIENT_VERSION = '2.0.0-terrain.1';

// Earlier servers do not send construction exceptions. Preserve their games
// without inventing skips or exposing any additional private information.
export function normalizeGame(snapshot) {
  return { ...snapshot,
    skipped: Array.isArray(snapshot.skipped) ? snapshot.skipped : [],
    constructionDice: Array.isArray(snapshot.constructionDice) ? snapshot.constructionDice : []
  };
}

export function constructionDieLabel(game, index) {
  const suffix = game.phase === 'rabbit_dig' && game.used[index]
    ? game.skipped?.[index] ? ', skipped: no legal placement' : ', used'
    : '';
  const bonus = game.phase === 'rabbit_dig' && game.board?.terrain?.[game.origin] === 'ground' ? ` plus 1 ground bonus, ${game.dice[index] + 1} steps` : '';
  return `Die ${index + 1}: ${game.dice[index]}${bonus}${suffix}`;
}

export function currentServerURL(pointer, version) {
  if (pointer?.version !== version || pointer?.rules !== CURRENT_RULES) return null;
  try {
    const url = new URL(pointer.url);
    const port = Number(url.port);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || ![7360,7363,7364,7365,7366,7367,7368,7369,7370].includes(port) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}
