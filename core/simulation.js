import { newGame, actor, RULES, VERSION } from './engine.js';
import { makeAgent, AGENT_VERSION, stepAgent } from './agents.js';
export function play(seed        , config = {}, fox = 'tracker', rabbit = 'mixed', record = false) {
  const game = newGame(seed, config, record);
  game.agentVersion = AGENT_VERSION;
  const agents = { fox: makeAgent('fox', fox, seed), rabbit: makeAgent('rabbit', rabbit, seed) };
  while (!game.winner) {
    if (game.steps > game.config.rounds * 30) throw new Error('The match exceeded its legal action bound.');
    const role = actor(game);
    stepAgent(game, agents[role]);
  }
  return game;
}
export function emptyStats(rounds        ) {
  return { games: 0, foxWins: 0, rabbitWins: 0, failed: 0, totalRounds: 0, totalActions: 0, totalEdges: 0, skippedTunnels: 0, collapsedEdges: 0, trappedGames: 0, sightings: 0, sightingRounds: 0, captureRounds: Array(rounds + 1).fill(0), errors: [], samples: [] };
}
export function accumulate(stats, game, seed        , fox        , rabbit        ) {
  stats.games++; stats[game.winner === 'fox' ? 'foxWins' : 'rabbitWins']++;
  stats.totalRounds += game.round; stats.totalActions += game.steps; stats.totalEdges += game.stats.newEdges;
  stats.skippedTunnels += game.stats.skippedTunnels; stats.collapsedEdges += game.stats.collapsedEdges; stats.trappedGames += Number(game.stats.trapped);
  if (game.stats.firstSighting !== null) { stats.sightings++; stats.sightingRounds += game.stats.firstSighting; }
  if (game.winner === 'fox') stats.captureRounds[game.round]++;
  if (stats.samples.length < 4) stats.samples.push({ seed, winner: game.winner, round: game.round, fox, rabbit });
}
export function summarize(stats, elapsedMs        , config, fox        , rabbit        , seed        , workers        ) {
  const n = stats.games, p = n ? stats.foxWins / n : 0, z = 1.96, z2 = z * z;
  const den = 1 + z2 / Math.max(n, 1), mid = (p + z2 / (2 * Math.max(n, 1))) / den;
  const half = z * Math.sqrt(p * (1 - p) / Math.max(n, 1) + z2 / (4 * Math.max(n, 1) ** 2)) / den;
  return { ...stats, version: VERSION, rules: RULES, agentVersion: AGENT_VERSION, config, fox, rabbit, seed, workers, elapsedMs,
    gamesPerSecond: elapsedMs ? n * 1000 / elapsedMs : 0, foxWinRate: p,
    foxInterval95: n ? [Math.max(0, mid - half), Math.min(1, mid + half)] : null,
    averageRound: n ? stats.totalRounds / n : 0, averageEdges: n ? stats.totalEdges / n : 0,
    averageFirstSighting: stats.sightings ? stats.sightingRounds / stats.sightings : null };
}
