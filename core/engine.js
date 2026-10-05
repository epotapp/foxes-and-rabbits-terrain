import { straightPaths, constructionLength, sandConnection } from '../rules.js';
import { generateTerrain, terrainAudit, TERRAIN_PROFILES } from './terrain.js';
import { CURRENT_RULES, CLIENT_VERSION } from '../client-state.js';
export { straightPaths, constructionLength, sandConnection } from '../rules.js';
export const VERSION = CLIENT_VERSION;
export const RULES = CURRENT_RULES;
                                    
                                                                                                                                                                                                
export const DEFAULTS         = { cols: 19, rows: 17, rounds: 25, sight: 2, terrainProfile: 'open', mapSeed: 'woodland-mosaic-1' };
const directions = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
const cache = new Map();

export function configOf(input                  = {})         {
  const out = { ...DEFAULTS, ...input };
  for (const [key, lo, hi] of [['cols', 7, 25], ['rows', 7, 25], ['rounds', 1, 100], ['sight', 1, 4]]         ) {
    if (!Number.isInteger(out[key]) || out[key] < lo || out[key] > hi) throw new Error(`Invalid ${key}: use ${lo}–${hi}.`);
  }
  const starts = startingHexes(out);
  if (!Object.hasOwn(TERRAIN_PROFILES, out.terrainProfile)) throw new Error('Choose a terrain profile.');
  if (typeof out.mapSeed !== 'string' || !out.mapSeed.trim() || out.mapSeed.length > 100) throw new Error('Use a terrain seed of 1–100 characters.');
  if (out.terrainCells && (!Array.isArray(out.terrainCells) || out.terrainCells.length !== out.cols * out.rows || out.terrainCells.some(t => !['ground', 'sand', 'rock'].includes(t)))) throw new Error('Each field hex needs ground, sand or rock terrain.');
  const config = { cols: out.cols, rows: out.rows, rounds: out.rounds, sight: out.sight, ...starts, terrainProfile: out.terrainProfile, mapSeed: out.mapSeed, ...(out.terrainCells ? { terrainCells: [...out.terrainCells] } : {}) };
  for (const id of Object.values(starts)) if (!Number.isInteger(id) || id < 0 || id >= out.cols * out.rows) throw new Error('Starting hexes must be on the field.');
  if (starts.foxStart === starts.rabbitStart) throw new Error('The players must start on different hexes.');
  const board = makeBoard(config);
  if (board.terrain[config.rabbitStart] === 'rock' || board.terrain[config.foxStart] === 'rock') throw new Error('Starting hexes must be ground or sand.');
  if (!board.openingTunnelFits) throw new Error('The Rabbit opening must allow a full maximum-roll tunnel: 7 on ground or 6 on sand.');
  if (!config.terrainCells && (board.terrainAudit.trappedCells || !board.terrainAudit.connected)) throw new Error('This field is too small for safe straight-tunnel terrain. Choose a larger field.');
  return config;
}

function startingHexes(config) {
  return { foxStart: config.foxStart ?? (config.rows - 2) * config.cols + 1,
    rabbitStart: config.rabbitStart ?? Math.round((config.rows - 1) * 5 / 16) * config.cols + Math.round((config.cols - 1) * 11 / 18) };
}
export function replayConfig(data) {
  // Terrain seeds and explicit layouts are part of the deterministic replay.
  return { ...DEFAULTS, ...data.config };
}
export function makeBoard(config        ) {
  const { foxStart, rabbitStart } = startingHexes(config);
  const key = JSON.stringify([config.cols, config.rows, config.sight, foxStart, rabbitStart, config.terrainProfile ?? DEFAULTS.terrainProfile, config.mapSeed ?? DEFAULTS.mapSeed, config.terrainCells]);
  if (cache.has(key)) return cache.get(key);
  const cells = [], lookup = new Map();
  for (let row = 0; row < config.rows; row++) for (let col = 0; col < config.cols; col++) {
    const id = cells.length, q = col, r = row - Math.floor(col / 2);
    cells.push({ id, col, row, q, r, x: col * 1.5, y: Math.sqrt(3) * (row + (col % 2) / 2) });
    lookup.set(`${q},${r}`, id);
  }
  const neighbors = cells.map(c => directions.map(([dq, dr]) => lookup.get(`${c.q + dq},${c.r + dr}`) ?? -1));
  const distances = cells.map(a => Uint8Array.from(cells, b => Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r))));
  const visibility = cells.map(c => cells.filter(other => distances[c.id][other.id] <= config.sight).map(other => other.id));
  const board = { cells, neighbors, distances, visibility, size: cells.length, foxStart, rabbitStart, cols: config.cols, rows: config.rows, terrain: [], terrainAudit: null, openingTunnelFits: false };
  board.terrain = generateTerrain(board, { ...DEFAULTS, ...config });
  board.terrainAudit = terrainAudit(board, board.terrain);
  board.openingTunnelFits = straightPaths(board, rabbitStart, constructionLength(board, rabbitStart, 6)).length > 0;
  if (cache.size >= 40) cache.delete(cache.keys().next().value);
  cache.set(key, board);
  return board;
}

export function hash(value        )         {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) h = Math.imul(h ^ value.charCodeAt(i), 16777619);
  return h >>> 0;
}
export function random(seed        ) {
  let a = seed >>> 0;
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function dice(g, purpose        , count        , sides        )           {
  const rng = random(hash(`${g.seed}|dice|${g.round}|${purpose}`));
  return Array.from({ length: count }, () => 1 + Math.floor(rng() * sides));
}
export function newGame(seed = 'woodland-1', input                  = {}, record = true) {
  const config = configOf(input), board = makeBoard(config);
  return { version: VERSION, rules: RULES, agentVersion: null                 , seed: String(seed).slice(0, 120), config, board,
    tunnels: new Uint8Array(board.size), expires: new Uint16Array(board.size * 6), fox: board.foxStart, rabbit: board.rabbitStart,
    phase: 'rabbit_roll_tunnels', round: 1, completedRounds: 0, remaining: 0,
    dice: []            , lastRoll: []            , constructionDice: []            , used: []             , skipped: []             , origin: board.rabbitStart,
    winner: null               , reason: '', actions: [], record, steps: 0,
    stats: { foxSteps: 0, rabbitSteps: 0, dugSteps: 0, newEdges: 0, skippedTunnels: 0, collapsedEdges: 0, trapped: false, firstSighting: null                  }
  };
}
export function actor(g)       { return g.phase.startsWith('fox') ? 'fox' : 'rabbit'; }
export function linked(g, from        , to        )          {
  const d = g.board.neighbors[from]?.indexOf(to) ?? -1;
  return d >= 0 && !!(g.tunnels[from] & (1 << d));
}
function join(g, from        , to        ) {
  const d = g.board.neighbors[from].indexOf(to);
  if (!(g.tunnels[from] & (1 << d))) g.stats.newEdges++;
  g.tunnels[from] |= 1 << d;
  g.tunnels[to] |= 1 << ((d + 3) % 6);
  if (sandConnection(g.board, from, to)) {
    g.expires[from * 6 + d] = g.round + 3;
    g.expires[to * 6 + ((d + 3) % 6)] = g.round + 3;
  }
}
function collapseSand(g) {
  for (let from = 0; from < g.board.size; from++) for (let d = 0; d < 6; d++) {
    const expiry = g.expires[from * 6 + d], to = g.board.neighbors[from][d];
    if (expiry && expiry <= g.round && to > from) {
      g.tunnels[from] &= ~(1 << d); g.tunnels[to] &= ~(1 << ((d + 3) % 6));
      g.expires[from * 6 + d] = 0; g.expires[to * 6 + ((d + 3) % 6)] = 0; g.stats.collapsedEdges++;
    }
  }
}
function sighting(g) {
  if (!g.winner && actor(g) === 'fox' && g.board.distances[g.fox][g.rabbit] <= g.config.sight && g.stats.firstSighting === null) g.stats.firstSighting = g.round;
}
function capture(g, reason        ) { g.winner = 'fox'; g.reason = reason; g.phase = 'over'; }

function resolveConstruction(g) {
  for (let die = 0; die < 3; die++) {
    if (!g.used[die] && !straightPaths(g.board, g.origin, constructionLength(g.board, g.origin, g.dice[die]), g.tunnels).length) {
      g.used[die] = true; g.skipped[die] = true; g.stats.skippedTunnels++;
    }
  }
  if (g.used.every(Boolean)) { g.phase = 'rabbit_roll_move'; g.dice = []; }
}

export function apply(g, action     ) {
  if (g.winner) throw new Error('This game is finished.');
  if (!action || typeof action !== 'object') throw new Error('An action is required.');
  const oldPhase = g.phase, who = actor(g);
  let clean;
  if (action.type === 'roll') {
    if (g.phase === 'rabbit_roll_tunnels') {
      collapseSand(g);
      g.dice = dice(g, 'dig', 3, 6); g.constructionDice = [...g.dice]; g.used = [false, false, false]; g.skipped = [false, false, false]; g.origin = g.rabbit; g.phase = 'rabbit_dig';
    } else if (g.phase === 'rabbit_roll_move') {
      g.dice = dice(g, 'rabbit', 1, 6); g.remaining = g.dice[0]; g.phase = 'rabbit_move';
      if (!g.tunnels[g.rabbit]) { g.stats.trapped = true; capture(g, 'The Rabbit has no tunnel connection left and is trapped.'); }
    } else if (g.phase === 'fox_roll') {
      g.dice = dice(g, 'fox', 2, 4); g.remaining = g.dice[0] + g.dice[1]; g.phase = 'fox_move';
    } else throw new Error('Finish the current action before rolling again.');
    g.lastRoll = [...g.dice];
    if (g.phase === 'rabbit_dig') resolveConstruction(g);
    clean = { type: 'roll' };
  } else if (action.type === 'dig') {
    if (g.phase !== 'rabbit_dig') throw new Error('Tunnels can only be drawn in the construction step.');
    const die = action.die, path = action.path;
    if (!Number.isInteger(die) || die < 0 || die > 2 || g.used[die]) throw new Error('Select an unused construction die.');
    if (!Array.isArray(path) || path.length !== constructionLength(g.board, g.origin, g.dice[die]) + 1 || path[0] !== g.origin) throw new Error('Use the full tunnel length, including +1 when starting on ground.');
    if (path.some(id => g.board.terrain[id] === 'rock')) throw new Error('Rock cannot be dug through.');
    const direction = g.board.neighbors[path[0]].indexOf(path[1]);
    for (let i = 1; i < path.length; i++) {
      if (!Number.isInteger(path[i]) || path[i] < 0 || path[i] >= g.board.size || !g.board.neighbors[path[i - 1]]?.includes(path[i])) throw new Error('A tunnel must connect adjacent hexes.');
      if (g.board.neighbors[path[i - 1]][direction] !== path[i]) throw new Error('Each tunnel must be one straight line. Turns and reversals are not allowed.');
    }
    if (!path.some((to, i) => i > 0 && !linked(g, path[i - 1], to))) throw new Error('Each tunnel must add at least one new connection. Overlap is allowed.');
    for (let i = 1; i < path.length; i++) join(g, path[i - 1], path[i]);
    g.stats.dugSteps += path.length - 1; g.used[die] = true;
    resolveConstruction(g);
    clean = { type: 'dig', die, path: [...path] };
  } else if (action.type === 'move') {
    if (g.phase !== 'rabbit_move' && g.phase !== 'fox_move') throw new Error('Roll movement dice before moving.');
    const from = g[who], to = action.to;
    if (!Number.isInteger(to) || to < 0 || to >= g.board.size || !g.board.neighbors[from].includes(to)) throw new Error('Move to an adjacent hex.');
    if (who === 'rabbit' && !linked(g, from, to)) throw new Error('The Rabbit must follow an existing tunnel connection.');
    g[who] = to; g.remaining--; g.stats[who + 'Steps']++;
    if (g.fox === g.rabbit) capture(g, who === 'fox' ? 'The Fox reached the Rabbit.' : 'The Rabbit entered the Fox’s hex.');
    else if (g.remaining === 0) {
      g.dice = [];
      if (who === 'rabbit') g.phase = 'fox_roll';
      else {
        g.completedRounds = g.round;
        if (g.round >= g.config.rounds) { g.winner = 'rabbit'; g.reason = `The Rabbit survived ${g.config.rounds} complete rounds.`; g.phase = 'over'; }
        else { g.round++; g.phase = 'rabbit_roll_tunnels'; }
      }
    }
    clean = { type: 'move', to };
  } else throw new Error('Unknown action.');
  g.steps++;
  sighting(g);
  if (g.record) g.actions.push({ round: oldPhase === 'fox_move' && g.phase === 'rabbit_roll_tunnels' ? g.round - 1 : g.round, actor: who, phase: oldPhase, action: clean, ...(clean.type === 'roll' ? { dice: [...g.lastRoll] } : {}) });
  return g;
}

export function observe(g, role                   ) {
  const full = role !== 'fox';
  const active = actor(g), ownPhase = full || active === 'fox';
  const visible = full ? null : ownPhase ? g.board.visibility[g.fox] : [];
  const masks = full ? g.tunnels.slice() : new Uint8Array(g.board.size);
  if (!full) for (const id of visible) masks[id] = g.tunnels[id];
  const rabbit = full || (ownPhase && g.board.distances[g.fox][g.rabbit] <= g.config.sight) ? g.rabbit : null;
  return { board: g.board, config: g.config, role, fox: g.fox, rabbit,
    masks, expires: full ? g.expires.slice() : [], visible, phase: ownPhase ? g.phase : 'waiting', round: g.round,
    completedRounds: g.completedRounds, remaining: ownPhase ? g.remaining : 0,
    dice: ownPhase ? [...g.dice] : [], used: full ? [...g.used] : [],
    skipped: full ? [...g.skipped] : [], constructionDice: full ? [...g.constructionDice] : [],
    origin: full ? g.origin : null, winner: g.winner, reason: g.winner ? g.reason : '' };
}

export function publicBoard(board) {
  return { cells: board.cells, neighbors: board.neighbors, cols: board.cols, rows: board.rows, foxStart: board.foxStart, rabbitStart: board.rabbitStart, terrain: board.terrain, terrainAudit: board.terrainAudit };
}
export function wireObservation(g, role                   , covered = false) {
  const obs = observe(g, role);
  if (covered) {
    return { board: publicBoard(g.board), config: g.config, role, fox: g.fox, rabbit: null, masks: [], visible: [], phase: 'covered', round: g.round, completedRounds: g.completedRounds, remaining: 0, dice: [], used: [], origin: null, winner: null, reason: '', covered: true };
  }
  return { ...obs, board: publicBoard(g.board), masks: Array.from(obs.masks), expires: Array.from(obs.expires), covered: false };
}

export function exportGame(g, controllers = null) {
  return { format: 'foxes-and-rabbits-replay', version: VERSION, rules: RULES, agentVersion: g.agentVersion ?? null, seed: g.seed, config: g.config, controllers, actions: g.actions, result: { winner: g.winner, round: g.round, completedRounds: g.completedRounds, reason: g.reason, stats: g.stats } };
}
export function replay(data, limit = Infinity) {
  if (data?.format !== 'foxes-and-rabbits-replay' || data.rules !== RULES || !Array.isArray(data.actions) || data.actions.length > 30000) throw new Error('This is not a supported Foxes and Rabbits replay.');
  const g = newGame(data.seed, replayConfig(data), false);
  g.agentVersion = typeof data.agentVersion === 'string' ? data.agentVersion : null;
  for (const event of data.actions.slice(0, limit)) {
    if (event.actor !== actor(g) || event.phase !== g.phase) throw new Error('The replay has an invalid turn sequence.');
    apply(g, event.action);
    if (event.action.type === 'roll' && JSON.stringify(event.dice) !== JSON.stringify(g.lastRoll)) throw new Error('The recorded dice do not match this replay.');
  }
  return g;
}
