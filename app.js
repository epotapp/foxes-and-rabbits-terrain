import { gameFetch as fetch } from './transport.js';
import { terrainFill, terrainSVG } from './terrain-art.js';
import { straightPaths, constructionLength, sandConnection } from './rules.js';
import { setupGifExport } from './gif-export.js';
import { strategyMixer } from './strategy-mixer.js';
import { DEFAULT_MIX, RABBIT_STRATEGIES } from './rabbit-strategies.js';
import { CURRENT_RULES, CLIENT_VERSION, normalizeGame, constructionDieLabel, currentServerURL } from './client-state.js';
const $ = id => document.getElementById(id);
const playtestsEnabled = document.documentElement.dataset.edition !== 'public';
let mapPreview = null, previewRequest = 0, previewTimer = null;
let meta, game = null, session = null, pending = false, draft = [], selectedDie = 0, zoom = 1, pan = null, autoplay = false, agentTimer = null, batch = null, batchTimer = null, replayInfo = null, replayGame = null;
const defaultPrefs = { field: 'standard', terrain: 'open', mapseed: 'woodland-mosaic-1', rounds: 25, sight: 2, fox: 'tracker', rabbit: 'human', mix: DEFAULT_MIX, speed: '120', highlights: true, motion: false };
let prefs = { ...defaultPrefs }, inMenu = true, settingsOpen = false;
try { prefs = { ...prefs, ...JSON.parse(localStorage.getItem('woodland-terrain-settings') || '{}') }; } catch {}
const gameMixer = strategyMixer($('game-mixer')), batchMixer = strategyMixer($('batch-mixer')), prefMixer = strategyMixer($('pref-mixer'));
function rabbitSelection(id, mixer) { return $(id).value === 'mixed' ? mixer.profile() : $(id).value; }
function shuffleSeed() { $('game-seed').value = `woodland-${crypto.randomUUID().slice(0, 8)}`; }
$('shuffle-seed').addEventListener('click', shuffleSeed);
$('batch-rabbit').addEventListener('change', () => batchMixer.show($('batch-rabbit').value === 'mixed'));
$('pref-rabbit').addEventListener('change', () => prefMixer.show($('pref-rabbit').value === 'mixed'));
const number = n => Math.round(n).toLocaleString();
const show = (id, visible) => { $(id).hidden = !visible; };
const text = (id, value) => { $(id).textContent = value; };
function toast(message) { text('toast', message); show('toast', true); clearTimeout(toast.timer); toast.timer = setTimeout(() => show('toast', false), 6000); }
function safe(fn) { return async event => { try { await fn(event); } catch (err) { toast(err.message); } }; }
async function api(url, data) {
  const headers = { ...(session ? { 'x-game-token': session.token } : {}) };
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { method: data === undefined ? 'GET' : 'POST', headers, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || 'The request could not be completed.'); return result;
}
function tab(name) {
  if (name === 'tests' && !playtestsEnabled) return;
  inMenu = false; document.body.dataset.view = name; show('main-menu', false);
  for (const id of ['game', 'tests', 'rules']) show(`${id}-tab`, id === name);
  document.querySelectorAll('.nav-tab').forEach(b => { b.classList.toggle('active', b.dataset.tab === name); b.setAttribute('aria-selected', String(b.dataset.tab === name)); });
  scheduleAgent();
}
document.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => tab(b.dataset.tab)));
// Setup navigation keeps the primary action outside the scrollable options.
const setupTabs = [...document.querySelectorAll('[data-setup]')];
function setupPage(name, focus = false) {
  setupTabs.forEach(button => {
    const active = button.dataset.setup === name;
    button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    show('setup-' + button.dataset.setup, active);
    if (active && focus) button.focus();
  });
  document.querySelector('.setup-scroll').scrollTop = 0;
}
setupTabs.forEach((button, index) => {
  button.addEventListener('click', () => setupPage(button.dataset.setup));
  button.addEventListener('keydown', event => {
    const target = event.key === 'ArrowRight' ? (index + 1) % setupTabs.length : event.key === 'ArrowLeft' ? (index + setupTabs.length - 1) % setupTabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? setupTabs.length - 1 : null;
    if (target !== null) { event.preventDefault(); setupPage(setupTabs[target].dataset.setup, true); }
  });
});
function controllerDescription() {
  const f = $('fox-controller').value, r = $('rabbit-controller').value;
  gameMixer.show(r === 'mixed');
  const mode = f === 'human' && r === 'human' ? 'HvH' : f !== 'human' && r !== 'human' ? 'AvA' : 'HvA';
  document.querySelectorAll('[data-mode]').forEach(b => { b.classList.toggle('selected', b.dataset.mode === mode); b.setAttribute('aria-pressed', String(b.dataset.mode === mode)); });
  show('human-role', mode === 'HvA');
  document.querySelectorAll('[data-human-role]').forEach(b => {
    const chosen = mode === 'HvA' && b.dataset.humanRole === (f === 'human' ? 'fox' : 'rabbit');
    b.classList.toggle('selected', chosen); b.setAttribute('aria-pressed', String(chosen));
  });
  text('mode-description', mode === 'HvH' ? 'Two humans. Pass the covered field between turns.' : mode === 'AvA' ? 'Two agents. Watch the game or advance one action at a time.' : `You are the ${f === 'human' ? 'Fox' : 'Rabbit'}. The agent plays the ${f === 'human' ? 'Rabbit' : 'Fox'}.`);
  text('agent-description', [['fox', f], ['rabbit', r]].filter(([, id]) => id !== 'human').map(([role, id]) => {
    const policy = meta?.policies[role].find(p => p.id === id); return policy ? `${policy.name}: ${policy.detail}` : '';
  }).join(' '));
}
document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
  const mode = b.dataset.mode;
  $('fox-controller').value = mode === 'HvH' ? 'human' : 'tracker';
  $('rabbit-controller').value = mode === 'AvA' ? prefs.rabbit === 'human' ? 'mixed' : prefs.rabbit : 'human'; controllerDescription();
}));
$('fox-controller').addEventListener('change', controllerDescription); $('rabbit-controller').addEventListener('change', controllerDescription);
document.querySelectorAll('[data-human-role]').forEach(b => b.addEventListener('click', () => {
  const foxHuman = b.dataset.humanRole === 'fox';
  $('fox-controller').value = foxHuman ? 'human' : prefs.fox === 'human' ? 'tracker' : prefs.fox;
  $('rabbit-controller').value = foxHuman ? prefs.rabbit === 'human' ? 'mixed' : prefs.rabbit : 'human';
  controllerDescription();
}));
function config(prefix = '') {
  return { ...meta.profiles[$(prefix ? 'batch-field' : 'field-profile').value], rounds: Number($(prefix + 'rounds').value), sight: Number($(prefix + 'sight').value), terrainProfile: $(prefix + 'terrain').value, mapSeed: $(prefix + 'mapseed').value };
}
async function refreshPreview() {
  clearTimeout(previewTimer);
  if (!meta) return;
  const ticket = ++previewRequest, result = await api('/api/preview', config());
  if (ticket !== previewRequest) return;
  mapPreview = result; if (!game && !replayInfo) render();
}
for (const id of ['field-profile', 'terrain', 'mapseed', 'rounds', 'sight']) $(id).addEventListener('change', safe(refreshPreview));
$('mapseed').addEventListener('input', () => {
  clearTimeout(previewTimer);
  if ($('mapseed').value.trim()) previewTimer = setTimeout(() => refreshPreview().catch(err => toast(err.message)), 180);
});
$('shuffle-map').addEventListener('click', safe(async () => { $('mapseed').value = `glade-${crypto.randomUUID().slice(0, 8)}`; await refreshPreview(); }));
function isManual(g = game) { return g && !g.replay && !g.covered && !g.winner && !g.agentTurn; }
function straightRules(g = game) { return (g?.rules || meta?.rules) === CURRENT_RULES; }
function currentVersion() { return meta?.version === CLIENT_VERSION && straightRules(null); }
function previewGame() {
  const board = mapPreview?.board || meta.board;
  return { board, config: mapPreview?.config || meta.defaults, fox: board.foxStart, rabbit: board.rabbitStart, masks: [], visible: null, phase: 'setup', round: 0, dice: [], used: [], role: 'observer' };
}
function tunnelChoices(g) {
  return straightPaths(g.board, g.origin, constructionLength(g.board, g.origin, g.dice[selectedDie]), g.masks);
}
function legalCells(g) {
  if (!isManual(g)) return [];
  if (g.phase === 'rabbit_dig') {
    if (!draft.length) draft = [g.origin];
    return straightRules(g) ? tunnelChoices(g).map(path => path[1])
      : draft.length <= constructionLength(g.board, g.origin, g.dice[selectedDie]) ? g.board.neighbors[draft.at(-1)].filter(n => n >= 0) : [];
  }
  const from = g.phase === 'rabbit_move' ? g.rabbit : g.phase === 'fox_move' ? g.fox : null;
  if (from === null) return [];
  return g.board.neighbors[from].filter((n, d) => n >= 0 && (g.phase === 'fox_move' || g.masks[from] & (1 << d)));
}
function polygon(c, radius = .97) {
  return Array.from({ length: 6 }, (_, i) => `${(c.x + Math.cos(i * Math.PI / 3) * radius).toFixed(3)},${(c.y + Math.sin(i * Math.PI / 3) * radius).toFixed(3)}`).join(' ');
}
function viewBox(g) {
  const cells = g.board.cells, maxX = Math.max(...cells.map(c => c.x)), maxY = Math.max(...cells.map(c => c.y));
  const width = maxX + 2.4, height = maxY + 2.4;
  const targetId = g.phase === 'rabbit_dig' && draft.length ? draft.at(-1) : g.role === 'fox' ? g.fox : g.rabbit ?? g.fox;
  const center = pan || (zoom === 1 ? { x: maxX / 2, y: maxY / 2 } : cells[targetId]);
  return [center.x - width / zoom / 2, center.y - height / zoom / 2, width / zoom, height / zoom];
}
function renderBoard(g) {
  const legal = new Set(legalCells(g)), visible = g.visible === null ? null : new Set(g.visible), board = g.board;
  let svg = '<defs>';
  if (visible) svg += `<clipPath id="sight-clip">${[...visible].map(id => `<polygon points="${polygon(board.cells[id], 1.015)}"/>`).join('')}</clipPath>`;
  svg += '</defs>';
  svg += board.cells.map(c => `<polygon data-cell="${c.id}" style="--terrain-fill:${terrainFill(board.terrain[c.id], c.id)}" class="hex terrain-${board.terrain[c.id]}${visible && !visible.has(c.id) ? ' fog' : ''}${legal.has(c.id) ? ' legal' : ''}${draft.includes(c.id) && g.phase === 'rabbit_dig' ? ' path' : ''}" points="${polygon(c)}" ${legal.has(c.id) ? `tabindex="0" role="button" aria-label="${g.phase === 'rabbit_dig' && straightRules(g) ? 'Build full tunnel toward' : 'Move to'} hex ${c.col + 1}, ${c.row + 1}"` : ''}><title>${board.terrain[c.id]} · column ${c.col + 1}, row ${c.row + 1}</title></polygon>`).join('');
  svg += board.cells.filter(c => !visible || visible.has(c.id)).map(c => terrainSVG(c, board.terrain[c.id])).join('');
  let segments = '', seen = new Set();
  for (let id = 0; id < board.cells.length; id++) {
    if (!g.masks[id]) continue;
    board.neighbors[id].forEach((n, d) => {
      if (n < 0 || !(g.masks[id] & (1 << d))) return;
      const key = `${Math.min(id, n)},${Math.max(id, n)}`; if (seen.has(key)) return; seen.add(key);
      const a = board.cells[id], b = board.cells[n];
      const temporary = sandConnection(board, id, n), life = g.expires?.[id * 6 + d] ? Math.max(0, g.expires[id * 6 + d] - g.round) : null;
      segments += `<g><title>${temporary ? 'Sand tunnel' + (life === null ? '' : ` · ${life} round${life === 1 ? '' : 's'} left including this round`) : 'Permanent ground tunnel'}</title><line class="tunnel-under" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/><line class="tunnel-line${temporary ? ' sand-tunnel' : ''}${life !== null && life <= 1 ? ' expiring-tunnel' : ''}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"/></g>`;
    });
  }
  svg += `<g ${visible ? 'clip-path="url(#sight-clip)"' : ''}>${segments}</g>`;
  if (g.phase === 'rabbit_dig' && draft.length > 1) svg += `<polyline class="draft-line" fill="none" points="${draft.map(id => `${board.cells[id].x},${board.cells[id].y}`).join(' ')}"/>`;
  for (const [id, mark] of [[board.foxStart, 'FI'], [board.rabbitStart, 'RI']]) if (!visible || visible.has(id)) {
    const c = board.cells[id]; svg += `<text class="start-mark" x="${c.x}" y="${c.y + .72}">${mark}</text>`;
  }
  for (const [id, label, color] of [[g.fox, 'F', '#a04b2e'], [g.rabbit, 'r', '#344d3b']]) if (id !== null && id !== undefined && !g.covered) {
    const c = board.cells[id]; svg += `<g class="token" transform="translate(${c.x} ${c.y})"><circle r=".55" fill="${color}"/><text class="token-letter" y="-.01">${label}</text></g>`;
  }
  $('board').innerHTML = svg; $('board').setAttribute('viewBox', viewBox(g).join(' '));
  text('zoom-label', `${Math.round(zoom * 100)}%`); show('board-cover', g.covered);
  if (g.covered) {
    text('cover-title', g.needsHandoff ? `Pass to the ${g.turn === 'fox' ? 'Fox' : 'Rabbit'}` : 'Rabbit turn');
    text('cover-text', g.needsHandoff ? 'The other player should look away before you uncover the field.' : 'Construction and movement stay hidden.');
    show('cover-ready', !!g.needsHandoff); text('cover-ready', `Ready as ${g.turn === 'fox' ? 'Fox' : 'Rabbit'}`);
  }
  text('setup-summary', `${g.config.cols} × ${g.config.rows} field · ${g.config.rounds} rounds · sight ${g.config.sight}`);
  text('round-number', g.round ? String(g.round).padStart(2, '0') : '—'); text('round-total', `/ ${g.config.rounds}`);
  text('match-label', g.replay ? `${g.role === 'observer' ? 'FULL BOARD' : g.role.toUpperCase() + ' VIEW'} · ${g.perspective === 'turn' ? 'FOLLOW TURNS' : 'REPLAY'}` : g.mode ? `${g.mode} · ${g.role === 'observer' ? 'OBSERVER' : g.role.toUpperCase() + ' VIEW'}` : 'FOXES AND RABBITS');
  text('board-heading', g.winner ? `${g.winner === 'fox' ? 'Fox' : 'Rabbit'} wins` : g.replay ? 'The recorded field' : 'The field');
  text('board-caption', `${g.config.cols} x ${g.config.rows} hexes / ${meta.terrains[g.config.terrainProfile]?.name || 'Custom terrain'} / ${g.config.mapSeed}`);
  const a = board.terrainAudit;
  text('terrain-audit', `${a.counts.ground} ground / ${a.counts.sand} sand / ${a.counts.rock} rock. ${a.connected ? 'Connected field' : 'Separate regions'}. ${a.openingDirections} maximum-length opening directions.`);
}
function renderTurn() {
  const g = game;
  document.body.dataset.tableState = replayInfo ? 'replay' : !g ? 'setup' : g.winner ? 'complete' : 'playing';
  const plan = !replayInfo && g?.role === 'observer' && !g.winner ? g.rabbitPlan : null;
  show('rabbit-plan', !!plan);
  if (plan) {
    const strategy = RABBIT_STRATEGIES.find(s => s.id === plan.lead), cell = g.board.cells[plan.target];
    text('rabbit-plan-title', strategy?.name || plan.lead);
    text('rabbit-plan-detail', `Working toward column ${cell.col + 1}, row ${cell.row + 1}. Plan begun in round ${plan.since}; reassesses by round ${plan.until}, or sooner if threatened. ${strategy?.detail || ''}`);
  }
  show('setup-panel', !g && !replayInfo); show('turn-panel', !!g && !replayInfo); show('replay-panel', !!replayInfo);
  show('speed-control', !!g && !replayInfo && g.agentTurn && !g.winner);
  if (!g || replayInfo) return;
  for (const id of ['roll-dice', 'commit-tunnel', 'undo-path', 'handoff-ready', 'agent-play', 'agent-step', 'move-budget', 'dig-progress', 'end-actions']) show(id, false);
  const role = g.turn || g.winner || 'rabbit', manual = isManual(g);
  $('turn-disc').className = `role-disc ${role}-disc`; text('turn-disc', role === 'fox' ? 'F' : 'r');
  text('turn-kicker', g.winner ? 'GAME COMPLETE' : `${role.toUpperCase()} TURN`);
  let title = '', instruction = '';
  if (g.winner) { title = `${g.winner === 'fox' ? 'Fox' : 'Rabbit'} wins`; instruction = g.reason; show('end-actions', true); }
  else if (g.needsHandoff) { title = 'Pass the field'; instruction = `Pass to the ${role === 'fox' ? 'Fox' : 'Rabbit'}. Keep the board covered until the other player looks away.`; show('handoff-ready', true); text('handoff-ready', `Ready as ${role === 'fox' ? 'Fox' : 'Rabbit'}`); }
  else if (g.covered) { title = 'Field covered'; instruction = 'The Rabbit is building tunnels and moving. Your view will return at the start of the Fox’s turn.'; }
  else if (g.phase === 'rabbit_roll_tunnels') { title = 'Build 3 straight tunnels'; instruction = 'Roll three d6. Starting on ground adds +1 to every tunnel; starting on sand uses the die as rolled. Use every die in full. Each tunnel must add at least one new connection; overlap is allowed.'; }
  else if (g.phase === 'rabbit_dig') { title = `Tunnels · ${g.used.filter(Boolean).length} / 3`; instruction = manual ? `Select a die, then click a highlighted hex next to r to choose a direction. The entire ${constructionLength(g.board, g.origin, g.dice[selectedDie])}-space tunnel is drawn in one click. Overlap is allowed, but each tunnel must add a new connection. Ground: d6 + 1. Sand: d6. Rock blocks digging. Only directions with a legal full-length tunnel are highlighted.` : 'The Rabbit draws three full-length straight tunnels. Each must add at least one new connection.'; }
  else if (g.phase === 'rabbit_roll_move') { title = 'Move the Rabbit'; instruction = 'Construction is complete. Roll one d6 for movement.'; }
  else if (g.phase === 'rabbit_move') { title = 'Move the Rabbit'; instruction = 'Follow the highlighted tunnel connections. Spend every movement point; backtracking is allowed.'; }
  else if (g.phase === 'fox_roll') { title = 'Move the Fox'; instruction = 'Roll two d4. Add the results and use the full movement total.'; }
  else if (g.phase === 'fox_move') { title = 'Move the Fox'; instruction = 'You must move every turn and spend the full dice total. Choose adjacent hexes until no steps remain. Enter r to catch the Rabbit.'; }
  if (!straightRules(g) && ['rabbit_roll_tunnels', 'rabbit_dig'].includes(g.phase)) {
    title = 'Build tunnels · earlier rules';
    instruction = g.phase === 'rabbit_roll_tunnels' ? 'Roll three d6. This existing game uses the earlier rules, which allow turns and retracing.'
      : manual ? `Select a die and click ${constructionLength(g.board, g.origin, g.dice[selectedDie])} adjacent hexes from r. This existing game allows turns and retracing.` : 'The Rabbit is constructing tunnels under this game’s earlier rules.';
  }
  text('phase-title', title); text('turn-instruction', instruction);
  const skipped = (g.skipped || []).flatMap((yes, i) => yes ? [`die ${i + 1} (${g.constructionDice[i]})`] : []);
  const explainSkips = !g.covered && g.phase.startsWith('rabbit_') && g.phase !== 'rabbit_roll_tunnels' && skipped.length > 0;
  show('construction-note', explainSkips);
  if (explainSkips) text('construction-note', `Skipped ${skipped.join(', ')}: no full-length straight tunnel can add a new connection. All six directions were checked.`);
  const tray = $('dice-tray'); tray.replaceChildren();
  if (g.dice.length) g.dice.forEach((value, i) => {
    const button = document.createElement('button'); button.className = `die${g.phase === 'rabbit_dig' && g.used[i] ? ' used' : ''}${manual && g.phase === 'rabbit_dig' && selectedDie === i ? ' selected' : ''}`;
    button.textContent = g.phase === 'rabbit_dig' && g.board.terrain[g.origin] === 'ground' ? `${value}+1` : value; button.setAttribute('aria-label', constructionDieLabel(g, i));
    button.disabled = pending || !manual || g.phase !== 'rabbit_dig' || g.used[i];
    button.addEventListener('click', () => { selectedDie = i; draft = [g.origin]; render(); }); tray.append(button);
  });
  else { const hint = document.createElement('span'); hint.className = 'die-placeholder'; hint.textContent = g.winner ? 'The game is finished.' : g.covered ? 'Private turn' : g.phase === 'fox_roll' ? '2 × d4' : g.phase === 'rabbit_roll_move' ? '1 × d6' : '3 × d6'; tray.append(hint); }
  if (manual && g.phase.includes('roll')) { show('roll-dice', true); text('roll-dice', g.phase === 'rabbit_roll_tunnels' ? 'Roll 3 d6' : g.phase === 'fox_roll' ? 'Roll 2 d4' : 'Roll 1 d6'); }
  if (manual && g.phase === 'rabbit_dig' && !straightRules(g)) {
    show('commit-tunnel', true); show('undo-path', true); show('dig-progress', true);
    text('commit-tunnel', `Draw tunnel · ${Math.max(0, draft.length - 1)} / ${constructionLength(g.board, g.origin, g.dice[selectedDie])}`);
    $('commit-tunnel').disabled = pending || draft.length !== constructionLength(g.board, g.origin, g.dice[selectedDie]) + 1; $('undo-path').disabled = pending || draft.length <= 1;
    $('dig-progress').innerHTML = Array.from({ length: constructionLength(g.board, g.origin, g.dice[selectedDie]) }, (_, i) => `<span class="${i < draft.length - 1 ? 'filled' : ''}"></span>`).join('');
  }
  if (g.phase === 'rabbit_move' || g.phase === 'fox_move') { show('move-budget', true); text('remaining-count', g.remaining); }
  if (g.mode === 'AvA' && !g.winner) { show('agent-play', true); show('agent-step', true); text('agent-play', autoplay ? 'Pause' : 'Play'); $('agent-step').disabled = pending || autoplay; }
  $('roll-dice').disabled = pending; $('handoff-ready').disabled = pending;
  text('game-status', g.winner ? g.reason : pending ? 'Playing…' : g.needsHandoff ? 'A private handoff is required.' : g.agentTurn ? g.mode === 'AvA' && !autoplay ? 'Agent game paused. Choose Play or One action.' : 'Agent turn' : manual ? 'Your turn' : '');
}
function render() { renderTurn(); renderBoard(replayGame || game || previewGame()); }
function receive(g) {
  g = normalizeGame(g);
  const changed = !game || game.phase !== g.phase || game.round !== g.round || JSON.stringify(game.used) !== JSON.stringify(g.used);
  game = g;
  if (changed) { selectedDie = Math.max(0, g.used.findIndex(x => !x)); draft = g.origin === null ? [] : [g.origin]; pan = null; }
  if (g.winner) autoplay = false;
  render(); scheduleAgent();
}
async function act(action) {
  if (pending || !game || replayInfo) return;
  pending = true; renderTurn();
  try { const g = await api(`/api/matches/${game.id}/action`, action); receive(g); }
  finally { pending = false; renderTurn(); scheduleAgent(); }
}
$('start-game').addEventListener('click', safe(async () => {
  if (!currentVersion()) { toast('Use Open updated game above to play with the current agents and rules.'); return; }
  if (pending) return; pending = true; $('start-game').disabled = true;
  try {
    const result = await api('/api/matches', { config: config(), seed: $('game-seed').value, controllers: { fox: $('fox-controller').value, rabbit: rabbitSelection('rabbit-controller', gameMixer) } });
    session = { id: result.game.id, token: result.token }; sessionStorage.setItem('woodland-terrain-game', JSON.stringify(session));
    autoplay = false; zoom = 1; pan = null; receive(result.game);
  } finally { pending = false; $('start-game').disabled = false; renderTurn(); scheduleAgent(); }
}));
$('roll-dice').addEventListener('click', safe(() => act({ type: 'roll' })));
$('commit-tunnel').addEventListener('click', safe(() => act({ type: 'dig', die: selectedDie, path: draft })));
$('undo-path').addEventListener('click', () => { if (draft.length > 1) draft.pop(); render(); });
async function ready() { if (pending) return; pending = true; try { receive(await api(`/api/matches/${game.id}/ready`, {})); } finally { pending = false; renderTurn(); } }
$('handoff-ready').addEventListener('click', safe(ready)); $('cover-ready').addEventListener('click', safe(ready));
async function cellClick(id) {
  if (pending || replayInfo || !game || !legalCells(game).includes(id)) return;
  if (game.phase === 'rabbit_dig') {
    if (straightRules(game)) {
      const path = tunnelChoices(game).find(path => path[1] === id);
      if (path) await act({ type: 'dig', die: selectedDie, path });
    } else { draft.push(id); render(); }
  }
  else await act({ type: 'move', to: id });
}
$('board').addEventListener('click', safe(e => { if (dragged) { dragged = false; return; } const cell = e.target.closest('[data-cell]'); if (cell) return cellClick(Number(cell.dataset.cell)); }));
$('board').addEventListener('keydown', safe(e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); const cell = e.target.closest('[data-cell]'); if (cell) return cellClick(Number(cell.dataset.cell)); } }));
function scheduleAgent() {
  clearTimeout(agentTimer);
  if (!game || game.winner || !game.agentTurn || pending || replayInfo || inMenu || settingsOpen || (game.mode === 'AvA' && !autoplay)) return;
  agentTimer = setTimeout(() => advance().catch(err => { autoplay = false; toast(err.message); renderTurn(); }), Number($('speed').value));
}
async function advance(one = false) {
  if (pending || !game || !game.agentTurn || game.winner || replayInfo) return;
  pending = true;
  try { receive(await api(`/api/matches/${game.id}/advance`, { steps: one ? 1 : Number($('speed').value) === 0 || game.covered ? 500 : 1 })); }
  finally { pending = false; renderTurn(); scheduleAgent(); }
}
$('agent-play').addEventListener('click', () => { autoplay = !autoplay; renderTurn(); scheduleAgent(); });
$('agent-step').addEventListener('click', safe(() => advance(true))); $('speed').addEventListener('change', scheduleAgent);
$('new-game').addEventListener('click', () => { if (!game || game.winner) resetGame(); else $('new-game-dialog').showModal(); });
$('keep-game').addEventListener('click', () => $('new-game-dialog').close()); $('confirm-new').addEventListener('click', () => { $('new-game-dialog').close(); resetGame(); });
function resetGame() { clearTimeout(agentTimer); autoplay = false; game = null; session = null; replayInfo = null; replayGame = null; replayRequest++; draft = []; zoom = 1; pan = null; shuffleSeed(); sessionStorage.removeItem('woodland-terrain-game'); text('game-status', 'Choose the players, then start a game.'); render(); }
for (const [id, change] of [['zoom-in', .5], ['zoom-out', -.5]]) $(id).addEventListener('click', () => { zoom = Math.max(1, Math.min(3, zoom + change)); pan = null; renderBoard(replayGame || game || previewGame()); });
$('zoom-reset').addEventListener('click', () => { zoom = 1; pan = null; renderBoard(replayGame || game || previewGame()); });
let drag = null, dragged = false;
$('board').addEventListener('pointerdown', e => { if (zoom <= 1) return; drag = { x: e.clientX, y: e.clientY, box: viewBox(replayGame || game || previewGame()) }; dragged = false; });
window.addEventListener('pointermove', e => { if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) < 6) return; dragged = true; const rect = $('board').getBoundingClientRect(); pan = { x: drag.box[0] + drag.box[2] / 2 - dx * drag.box[2] / rect.width, y: drag.box[1] + drag.box[3] / 2 - dy * drag.box[3] / rect.height }; $('board').setAttribute('viewBox', viewBox(replayGame || game || previewGame()).join(' ')); });
window.addEventListener('pointerup', () => { drag = null; });
function downloadSaved(saved) { const a = document.createElement('a'); a.href = saved.downloadUrl; a.download = saved.filename; a.hidden = true; document.body.append(a); a.click(); a.remove(); toast(`Saved to ${saved.savedTo}`); }
$('export-game').addEventListener('click', safe(async () => downloadSaved(await api(`/api/matches/${game.id}/save`, {}))));
$('watch-replay').addEventListener('click', safe(async () => openReplay(await api(`/api/matches/${game.id}/export`))));
setupGifExport({ api, currentVersion, downloadSaved,
  gameReplay: () => api(`/api/matches/${game.id}/export`),
  currentReplay: () => ({ ...replayInfo, view: $('replay-view').value }),
  onOpen: () => { settingsOpen = true; clearTimeout(agentTimer); },
  onClose: () => { settingsOpen = false; scheduleAgent(); }
});
async function openReplay(data) {
  clearTimeout(agentTimer); autoplay = false;
  replayInfo = await api('/api/replays', data); $('replay-scrub').max = replayInfo.length; $('replay-scrub').value = 0; zoom = 1; pan = null;
  $('replay-view').value = currentVersion() ? 'turn' : 'observer';
  tab('game'); await replayFrame(0); renderTurn();
}
let replayRequest = 0;
async function replayFrame(frame) {
  if (!replayInfo) return; const request = ++replayRequest;
  const g = await api(`/api/replays/${replayInfo.id}?frame=${frame}&view=${$('replay-view').value}`);
  if (request !== replayRequest || !replayInfo) return;
  replayGame = g; draft = []; render(); text('replay-count', `${g.frame} / ${g.length}`); $('replay-scrub').value = g.frame;
  let message = g.covered ? 'The Rabbit acted in private.' : 'Starting positions.';
  if (g.event) {
    const event = g.event, who = event.actor === 'fox' ? 'Fox' : 'Rabbit';
    if (g.role === 'fox' && event.actor === 'rabbit') message = 'The Rabbit acted in private.';
    else if (event.action.type === 'roll') message = `${who} rolled ${event.dice.join(' + ')}.`;
    else if (event.action.type === 'dig') message = `Rabbit drew a tunnel of ${event.action.path.length - 1} steps.`;
    else message = `${who} moved one hex.`;
  }
  text('replay-event', message); text('game-status', 'Recorded game · use the slider to inspect each action.'); $('replay-next').disabled = g.frame === g.length;
}
$('replay-scrub').addEventListener('input', safe(e => replayFrame(Number(e.target.value))));
$('replay-view').addEventListener('change', safe(() => replayFrame(Number($('replay-scrub').value))));
$('replay-next').addEventListener('click', safe(() => replayFrame(Math.min(replayInfo.length, Number($('replay-scrub').value) + 1))));
$('close-replay').addEventListener('click', () => { replayInfo = null; replayGame = null; zoom = 1; pan = null; render(); scheduleAgent(); });
$('open-replay').addEventListener('change', safe(async e => { const file = e.target.files[0]; if (!file) return; if (file.size > 4000000) throw new Error('Choose a replay smaller than 4 MB.'); await openReplay(JSON.parse(await file.text())); e.target.value = ''; }));
function renderBatch() {
  const s = batch; if (!s) return;
  const running = s.status === 'running'; $('run-batch').disabled = running; show('cancel-batch', running);
  text('batch-status', running ? 'Games in progress' : s.status === 'cancelled' ? 'Batch stopped' : s.failed ? 'Batch finished with failures' : 'Playtests complete');
  text('batch-progress-count', `${number(s.games)} / ${number(s.requestedGames)}`); $('batch-progress').value = (s.games + s.failed) / s.requestedGames * 100;
  text('metric-games', number(s.games)); text('metric-speed', number(s.gamesPerSecond)); text('metric-time', s.elapsedMs < 60000 ? `${(s.elapsedMs / 1000).toFixed(1)}s` : `${(s.elapsedMs / 60000).toFixed(1)}m`); text('metric-round', s.averageRound.toFixed(1));
  text('fox-rate', s.games ? `${(s.foxWinRate * 100).toFixed(1)}%` : '—'); text('rabbit-rate', s.games ? `${((1 - s.foxWinRate) * 100).toFixed(1)}%` : '—');
  $('fox-bar').style.width = `${s.foxWinRate * 100}%`; $('rabbit-bar').style.width = s.games ? `${(1 - s.foxWinRate) * 100}%` : '0';
  text('batch-profile', `${s.config.cols} × ${s.config.rows} · ${s.config.rounds} rounds · sight ${s.config.sight}`);
  const rabbitProfile = typeof s.rabbit === 'string' ? s.rabbit : 'mixed';
  const rabbitName = meta.policies.rabbit.find(p => p.id === rabbitProfile)?.name || rabbitProfile;
  const mixDescription = typeof s.rabbit === 'object' ? ' · ' + RABBIT_STRATEGIES.filter(p => s.rabbit.weights[p.id] > 0).map(p => `${p.name} ${s.rabbit.weights[p.id]}`).join(' / ') : '';
  text('batch-strategy-summary', `${s.fox} Fox vs ${rabbitName}${mixDescription}`);
  text('confidence', s.foxInterval95 ? `Fox win rate: 95% interval ${(s.foxInterval95[0] * 100).toFixed(1)}–${(s.foxInterval95[1] * 100).toFixed(1)}%. This measures this pairing, not every possible strategy.` : 'Results describe this strategy pairing and rules profile.');
  text('failures', `Failed games: ${s.failed}`);
  text('construction-exceptions', `Unplaceable tunnels skipped: ${number(s.skippedTunnels || 0)}. Sand connections collapsed: ${number(s.collapsedEdges || 0)}. Trapped Rabbits: ${number(s.trappedGames || 0)}.`);
  const max = Math.max(1, ...s.captureRounds);
  $('histogram').innerHTML = s.captureRounds.slice(1).map((n, i) => `<div class="hist-column" title="Round ${i + 1}: ${n} captures"><div class="bar" style="height:${n / max * 100}%"></div><span>${s.config.rounds <= 30 || i % 5 === 0 ? i + 1 : ''}</span></div>`).join('');
  $('histogram').setAttribute('aria-label', `Capture counts: ${s.captureRounds.slice(1).map((n, i) => `round ${i + 1}: ${n}`).join(', ')}`);
  $('download-results').disabled = !s.games; $('download-csv').disabled = !s.games;
  show('sample-games', s.samples.length > 0); $('sample-list').replaceChildren();
  s.samples.slice(0, 4).forEach((sample, i) => {
    const button = document.createElement('button'); button.className = 'sample-button';
    const label = document.createElement('span'); label.textContent = `${sample.winner === 'fox' ? 'Fox' : 'Rabbit'} wins · round ${sample.round}`;
    const action = document.createElement('span'); action.textContent = 'Replay'; button.append(label, action);
    button.addEventListener('click', safe(async () => openReplay(await api(`/api/batches/${s.id}/sample`, { index: i })))); $('sample-list').append(button);
  });
}
async function pollBatch() {
  if (!batch) return;
  try { batch = await api(`/api/batches/${batch.id}`); renderBatch(); if (batch.status === 'running') batchTimer = setTimeout(pollBatch, 600); }
  catch (err) { toast(err.message); $('run-batch').disabled = false; }
}
$('run-batch').addEventListener('click', safe(async () => {
  if (!currentVersion()) { toast('Open the updated game to run playtests with the current agents and rules.'); return; }
  $('run-batch').disabled = true;
  try { batch = await api('/api/batches', { games: Number($('batch-games').value), fox: $('batch-fox').value, rabbit: rabbitSelection('batch-rabbit', batchMixer), seed: $('batch-seed').value, config: config('batch-') }); sessionStorage.setItem('woodland-terrain-batch', batch.id); renderBatch(); clearTimeout(batchTimer); await pollBatch(); }
  catch (err) { $('run-batch').disabled = false; throw err; }
}));
$('cancel-batch').addEventListener('click', safe(async () => { batch = await api(`/api/batches/${batch.id}/cancel`, {}); clearTimeout(batchTimer); renderBatch(); }));
$('download-results').addEventListener('click', safe(async () => downloadSaved(await api(`/api/batches/${batch.id}/save`, { format: 'json' }))));
$('download-csv').addEventListener('click', safe(async () => downloadSaved(await api(`/api/batches/${batch.id}/save`, { format: 'csv' }))));

function mainMenu() {
  inMenu = true; document.body.dataset.view = 'menu'; clearTimeout(agentTimer); autoplay = false;
  show('main-menu', true); for (const name of ['game', 'tests', 'rules']) show(name + '-tab', false);
  document.querySelectorAll('.nav-tab').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
  show('menu-continue', !!game); text('menu-play', game ? 'New game' : 'Play');
}
function applyPrefs(defaults = true) {
  $('speed').value = prefs.speed;
  document.body.classList.toggle('reduce-motion', prefs.motion); document.body.classList.toggle('hide-highlights', !prefs.highlights);
  if (defaults) { $('terrain').value = prefs.terrain; $('mapseed').value = prefs.mapseed; $('field-profile').value = prefs.field; $('rounds').value = prefs.rounds; $('sight').value = prefs.sight; $('fox-controller').value = prefs.fox; $('rabbit-controller').value = prefs.rabbit; gameMixer.set(prefs.mix); controllerDescription(); refreshPreview().catch(err => toast(err.message)); }
}
function settingsMenu() {
  settingsOpen = true; clearTimeout(agentTimer);
  for (const key of ['field', 'terrain', 'mapseed', 'rounds', 'sight', 'fox', 'rabbit', 'speed']) $('pref-' + key).value = prefs[key];
  prefMixer.set(prefs.mix); prefMixer.show(prefs.rabbit === 'mixed');
  $('pref-highlights').checked = prefs.highlights; $('pref-motion').checked = prefs.motion; $('settings-dialog').showModal();
}
$('open-menu').addEventListener('click', mainMenu);
$('menu-continue').addEventListener('click', () => { replayInfo = null; replayGame = null; replayRequest++; tab('game'); render(); });
$('menu-play').addEventListener('click', () => { if (game && !game.winner) $('new-game-dialog').showModal(); else { resetGame(); tab('game'); } });
$('confirm-new').addEventListener('click', () => tab('game'));
$('menu-tests').addEventListener('click', () => tab('tests')); $('menu-rules').addEventListener('click', () => tab('rules'));
$('menu-settings').addEventListener('click', settingsMenu); $('open-settings').addEventListener('click', settingsMenu);
$('close-settings').addEventListener('click', () => $('settings-dialog').close());
$('settings-dialog').addEventListener('close', () => { settingsOpen = false; scheduleAgent(); });
$('settings-form').addEventListener('submit', e => {
  e.preventDefault();
  try { if ($('pref-rabbit').value === 'mixed') prefMixer.profile(); } catch (err) { toast(err.message); return; }
  prefs = { field: $('pref-field').value, terrain: $('pref-terrain').value, mapseed: $('pref-mapseed').value, rounds: Number($('pref-rounds').value), sight: Number($('pref-sight').value), fox: $('pref-fox').value, rabbit: $('pref-rabbit').value, mix: prefMixer.weights(), speed: $('pref-speed').value, highlights: $('pref-highlights').checked, motion: $('pref-motion').checked };
  localStorage.setItem('woodland-terrain-settings', JSON.stringify(prefs)); applyPrefs(); $('settings-dialog').close(); toast('Settings saved. Game defaults apply to new games.');
});
$('reset-settings').addEventListener('click', () => { for (const key of ['field', 'terrain', 'mapseed', 'rounds', 'sight', 'fox', 'rabbit', 'speed']) $('pref-' + key).value = defaultPrefs[key]; prefMixer.set(DEFAULT_MIX); prefMixer.show(false); $('pref-highlights').checked = true; $('pref-motion').checked = false; });

try {
  meta = await api('/api/meta');
  for (const id of ['rabbit-controller', 'batch-rabbit', 'pref-rabbit']) {
    const options = (id === 'batch-rabbit' ? [] : [new Option('Human', 'human')]).concat(meta.policies.rabbit.map(p => new Option(p.name, p.id)));
    $(id).replaceChildren(...options);
  }
  $('batch-rabbit').value = meta.policies.rabbit.some(p => p.id === 'mixed') ? 'mixed' : 'evasive'; batchMixer.show($('batch-rabbit').value === 'mixed');
  applyPrefs(); shuffleSeed();
  if (!currentVersion()) {
    show('version-notice', true); $('start-game').disabled = true; $('run-batch').disabled = true;
    try {
      const pointer = await api('/active-server.json'), url = currentServerURL(pointer, CLIENT_VERSION);
      if (url) { $('updated-game-link').href = url; show('updated-game-link', true); }
    } catch {}
  }
  const saved = sessionStorage.getItem('woodland-terrain-game');
  if (saved) { try { session = JSON.parse(saved); game = await api(`/api/matches/${session.id}`); } catch { session = null; sessionStorage.removeItem('woodland-terrain-game'); } }
  if (game) { const restored = game; game = null; receive(restored); } else render();
  mainMenu();
  const savedBatch = sessionStorage.getItem('woodland-terrain-batch'); if (playtestsEnabled && savedBatch) { try { batch = await api(`/api/batches/${savedBatch}`); renderBatch(); if (batch.status === 'running') pollBatch(); } catch { sessionStorage.removeItem('woodland-terrain-batch'); } }
} catch (err) { toast(`The game could not start: ${err.message}`); }

// Optional browser-agent controls use the current player's filtered view and the same referee.
if (document.modelContext?.registerTool && meta) {
  const lifecycle = new AbortController();
  const register = tool => Promise.resolve(document.modelContext.registerTool(tool, { signal: lifecycle.signal })).catch(() => {});
  const observation = () => {
    if (!game) return { status: 'no_game' };
    return { ...game, legalCells: legalCells(game), draftPath: game.role === 'fox' ? [] : [...draft] };
  };
  await register({ name: 'get_game_observation', title: 'Read the current player’s game view', description: 'Returns the current player view, phase, board and legal actions. Hidden Rabbit information is omitted for a Fox player. Does not start or change a game.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: observation });
  await register({ name: 'play_game_action', title: 'Play an action for the current human slot', description: 'Commits a roll, a complete tunnel path, or one adjacent movement step through the game referee. A game must already be running with the current human slot ready. Does not accept actions during private handoffs or built-in agent turns.', inputSchema: { type: 'object', properties: { type: { type: 'string', enum: ['roll', 'dig', 'move'] }, die: { type: 'integer', minimum: 0, maximum: 2 }, path: { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 2, maxItems: 8 }, to: { type: 'integer', minimum: 0 } }, required: ['type'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: async input => {
    if (!game || pending || replayInfo || game.covered || game.agentTurn || game.winner) throw new Error('The current player cannot act now.');
    if (!['roll', 'dig', 'move'].includes(input.type)) throw new Error('Choose roll, dig, or move.');
    tab('game'); await act(input); return observation();
  } });
  if (playtestsEnabled) await register({ name: 'run_playtest_batch', title: 'Run a batch of agent games', description: 'Starts complete AvA simulations using the selected playtest field, rounds and sight. Displays live statistics. Returns the batch id; use get_playtest_results to read progress.', inputSchema: { type: 'object', properties: { games: { type: 'integer', minimum: 1, maximum: 100000 }, fox: { type: 'string', enum: ['tracker', 'scout', 'random'] }, rabbit: { type: 'string', enum: meta.policies.rabbit.map(p => p.id) }, seed: { type: 'string', maxLength: 100 } }, required: ['games', 'fox', 'rabbit', 'seed'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: async input => {
    if (!currentVersion()) throw new Error('Open the updated game to run playtests with the current agents and rules.');
    if (batch?.status === 'running') throw new Error('A batch is already running.');
    batch = await api('/api/batches', { ...input, rabbit: input.rabbit === 'mixed' ? batchMixer.profile() : input.rabbit, config: config('batch-') });
    if (![...$('batch-games').options].some(o => o.value === String(input.games))) $('batch-games').add(new Option(`${number(input.games)} games`, String(input.games)));
    $('batch-games').value = String(input.games); $('batch-fox').value = input.fox; $('batch-rabbit').value = input.rabbit; batchMixer.show(input.rabbit === 'mixed'); $('batch-seed').value = input.seed;
    sessionStorage.setItem('woodland-terrain-batch', batch.id); tab('tests'); renderBatch(); clearTimeout(batchTimer); batchTimer = setTimeout(pollBatch, 300); return { id: batch.id, status: batch.status, requestedGames: batch.requestedGames };
  } });
  if (playtestsEnabled) await register({ name: 'get_playtest_results', title: 'Read the current batch results', description: 'Returns progress and results for the batch visible in Playtests.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: async () => { if (!batch) return { status: 'no_batch' }; batch = await api(`/api/batches/${batch.id}`); renderBatch(); return batch; } });
  window.addEventListener('pagehide', () => lifecycle.abort(), { once: true });
}
