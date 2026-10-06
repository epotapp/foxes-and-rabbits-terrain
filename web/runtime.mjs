import { TERRAIN_PROFILES } from '../core/terrain.js';
import { DEFAULTS, VERSION, RULES, configOf, makeBoard, newGame, actor, apply, wireObservation, publicBoard, exportGame, replay } from '../core/engine.js';
import { makeAgent, POLICIES, AGENT_VERSION, stepAgent } from '../core/agents.js';
import { play } from '../core/simulation.js';
import { replayFrames, replayObservation } from '../core/replay-frames.js';
import { normalizeRabbit, RABBIT_STRATEGIES, DEFAULT_MIX } from '../rabbit-strategies.js';

// Browser and local editions import the same referee, planners and replay code.
export function createRuntime(runBatch) {
  const matches = new Map(), batches = new Map(), replays = new Map();
  const profiles = { standard: DEFAULTS, small: { ...DEFAULTS, cols: 13, rows: 11 }, large: { ...DEFAULTS, cols: 23, rows: 21 } };
  const save = (filename, contents, mime) => ({ filename, contents, mime, savedTo: 'your browser downloads' });
  const keep = (map, id, value, limit) => { map.set(id, value); if (map.size > limit) map.delete(map.keys().next().value); };
  function session(input) {
    const seed = String(input.seed || `woodland-${Date.now()}`).slice(0, 120);
    const controllers = { fox: input.controllers?.fox ?? 'tracker', rabbit: input.controllers?.rabbit ?? 'human' };
    if (controllers.fox !== 'human' && !POLICIES.fox.some(p => p.id === controllers.fox)) throw new Error('Choose Human or an available Fox agent.');
    if (controllers.rabbit !== 'human') controllers.rabbit = normalizeRabbit(controllers.rabbit);
    const g = newGame(seed, input.config ?? DEFAULTS), humans = Object.keys(controllers).filter(role => controllers[role] === 'human');
    g.agentVersion = humans.length < 2 ? AGENT_VERSION : null;
    return { id: crypto.randomUUID(), token: crypto.randomUUID(), g, controllers, humans,
      agents: { fox: controllers.fox === 'human' ? null : makeAgent('fox', controllers.fox, seed), rabbit: controllers.rabbit === 'human' ? null : makeAgent('rabbit', controllers.rabbit, seed) },
      covered: humans.length === 2, viewing: humans.length === 1 ? humans[0] : humans.length === 2 ? 'rabbit' : 'observer' };
  }
  function snapshot(s) {
    const turn = actor(s.g), finished = !!s.g.winner;
    const hiddenTurn = s.viewing === 'fox' && turn === 'rabbit' && !finished;
    const obs = wireObservation(s.g, finished ? 'observer' : s.viewing, s.covered || hiddenTurn);
    return { ...obs, id: s.id, controllers: s.controllers, turn: finished ? null : turn,
      needsHandoff: s.covered, agentTurn: !finished && s.controllers[turn] !== 'human',
      mode: s.humans.length === 2 ? 'HvH' : s.humans.length === 1 ? 'HvA' : 'AvA',
      actionCount: s.viewing === 'fox' && !finished ? null : s.g.steps, canReplay: finished, rules: RULES, agentVersion: s.g.agentVersion,
      ...(s.viewing === 'observer' && s.agents.rabbit?.memory?.plan ? { rabbitPlan: { ...s.agents.rabbit.memory.plan } } : {}) };
  }
  function transition(s, oldRole) {
    if (!s.g.winner && actor(s.g) !== oldRole && s.humans.length === 2) { s.covered = true; s.viewing = actor(s.g); }
  }
  function reportCSV(data) {
    const fields = ['rules', 'agentVersion', 'fox', 'rabbit', 'seed', 'games', 'foxWins', 'rabbitWins', 'failed', 'elapsedMs', 'gamesPerSecond', 'averageRound', 'averageEdges', 'skippedTunnels', 'collapsedEdges', 'trappedGames', 'config'];
    const quote = v => `"${(typeof v === 'object' ? JSON.stringify(v) : String(v)).replaceAll('"', '""')}"`;
    return `${fields.join(',')}\r\n${fields.map(k => quote(data[k])).join(',')}\r\n\r\nround,fox_captures\r\n${data.captureRounds.slice(1).map((n, i) => `${i + 1},${n}`).join('\r\n')}`;
  }
  return async function request(path, { method = 'GET', headers = {}, body } = {}) {
    try {
      const url = new URL(path, 'https://game.invalid'), parts = url.pathname.split('/').filter(Boolean);
      if (parts[0] === 'api' && parts[1] === 'batches' && !runBatch) return { status: 404, data: { error: 'Playtests are available only in the local edition.' } };
      const input = typeof body === 'string' ? JSON.parse(body || '{}') : body ?? {};
      const ok = (data, status = 200) => ({ status, data });
      if (url.pathname === '/api/health') return ok({ app: 'foxes-and-rabbits-terrain', version: VERSION, rules: RULES });
      if (url.pathname === '/api/meta') return ok({ version: VERSION, rules: RULES, agentVersion: AGENT_VERSION, defaults: DEFAULTS, profiles, terrains: TERRAIN_PROFILES, policies: POLICIES, rabbitStrategies: RABBIT_STRATEGIES, defaultMix: DEFAULT_MIX, board: publicBoard(makeBoard(DEFAULTS)) });
      if (method === 'POST' && url.pathname === '/api/preview') { const config = configOf(input); return ok({ config, board: publicBoard(makeBoard(config)) }); }
      if (method === 'POST' && url.pathname === '/api/matches') { const s = session(input); keep(matches, s.id, s, 100); return ok({ token: s.token, game: snapshot(s) }, 201); }
      if (parts[0] === 'api' && parts[1] === 'matches' && parts[2]) {
        const s = matches.get(parts[2]);
        if (!s || headers['x-game-token'] !== s.token) return ok({ error: 'This game session is not available.' }, 403);
        if (method === 'GET' && !parts[3]) return ok(snapshot(s));
        if ((method === 'GET' && parts[3] === 'export') || (method === 'POST' && parts[3] === 'save')) {
          if (!s.g.winner) throw new Error('Finish the game before opening its full replay.');
          const data = exportGame(s.g, s.controllers);
          return ok(parts[3] === 'export' ? data : save(`replay-${s.id}.json`, JSON.stringify(data, null, 2), 'application/json'));
        }
        if (method === 'POST' && parts[3] === 'ready') { s.covered = false; return ok(snapshot(s)); }
        if (method === 'POST' && parts[3] === 'action') {
          if (s.covered || s.controllers[actor(s.g)] !== 'human') throw new Error('Wait for your turn and the private handoff.');
          const before = actor(s.g); apply(s.g, input); transition(s, before); return ok(snapshot(s));
        }
        if (method === 'POST' && parts[3] === 'advance') {
          const count = Math.min(500, Math.max(1, Math.floor(Number(input.steps) || 1)));
          for (let i = 0; i < count && !s.g.winner && !s.covered && s.controllers[actor(s.g)] !== 'human'; i++) {
            const role = actor(s.g); stepAgent(s.g, s.agents[role]); transition(s, role);
          }
          return ok(snapshot(s));
        }
      }
      if (method === 'POST' && url.pathname === '/api/batches') {
        if ([...batches.values()].some(b => b.result.status === 'running')) throw new Error('One batch is already running. Stop it or wait for it to finish.');
        const id = crypto.randomUUID(), job = { id, runner: null, result: null };
        job.runner = runBatch(input, result => { job.result = { ...result, id }; });
        job.result = { ...job.runner.snapshot(), id }; keep(batches, id, job, 20);
        job.runner.promise.then(result => { job.result = { ...result, id }; });
        return ok(job.result, 201);
      }
      if (parts[0] === 'api' && parts[1] === 'batches' && parts[2]) {
        const job = batches.get(parts[2]); if (!job) throw new Error('This batch is not available in the current session.');
        if (method === 'POST' && parts[3] === 'cancel') { await job.runner.cancel(); return ok(job.result); }
        if (method === 'POST' && parts[3] === 'sample') {
          const sample = job.result.samples[input.index ?? 0]; if (!sample) throw new Error('No sample game is available yet.');
          return ok(exportGame(play(sample.seed, job.result.config, sample.fox, sample.rabbit, true), { fox: sample.fox, rabbit: sample.rabbit }));
        }
        if (method === 'POST' && parts[3] === 'save') {
          const { format } = input; if (!['json', 'csv'].includes(format)) throw new Error('Choose JSON or CSV.');
          return ok(save(`results-${job.id}.${format}`, format === 'json' ? JSON.stringify(job.result, null, 2) : reportCSV(job.result), format === 'json' ? 'application/json' : 'text/csv'));
        }
        if (method === 'GET') return ok(job.result);
      }
      if (method === 'POST' && url.pathname === '/api/replays') {
        replay(input); const id = crypto.randomUUID(); keep(replays, id, input, 40); return ok({ id, length: input.actions.length, seed: input.seed }, 201);
      }
      if (parts[0] === 'api' && parts[1] === 'replays' && parts[2]) {
        const data = replays.get(parts[2]); if (!data) throw new Error('Replay unavailable.');
        if (method === 'GET' && parts[3] === 'frames') return ok(replayFrames(data, url.searchParams.get('view') || 'turn'));
        if (method === 'POST' && parts[3] === 'gif') {
          const bytes = new Uint8Array(body);
          if (bytes.length < 32 || bytes.length > 64 * 1024 * 1024 || new TextDecoder().decode(bytes.subarray(0, 6)) !== 'GIF89a' || bytes.at(-1) !== 59) throw new Error('A valid GIF export up to 64 MB is required.');
          return ok(save(`foxes-and-rabbits-${parts[2]}-${Date.now()}.gif`, bytes, 'image/gif'));
        }
        if (method === 'GET' && !parts[3]) {
          const frame = Math.max(0, Math.min(data.actions.length, Math.floor(Number(url.searchParams.get('frame')) || 0)));
          const perspective = url.searchParams.get('view') || 'turn', g = replay(data, frame);
          return ok({ ...replayObservation(g, frame ? data.actions[frame - 1] : null, perspective), replay: true, frame, length: data.actions.length });
        }
      }
      return ok({ error: 'Unknown action.' }, 404);
    } catch (error) { return { status: 400, data: { error: error.message } }; }
  };
}
