import { newGame, apply, actor, wireObservation, publicBoard, replayConfig } from './engine.js';

export function replayObservation(game, event = null, perspective = 'turn') {
  if (!['turn', 'observer', 'fox', 'rabbit'].includes(perspective)) throw new Error('Choose a valid replay perspective.');
  // Each frame shows the action just performed. In particular, a final Fox
  // step must keep its aperture even though the referee has begun Rabbit's turn.
  const frameActor = event?.actor ?? actor(game);
  const role = perspective === 'turn' ? frameActor : perspective;
  const covered = role === 'fox' && frameActor === 'rabbit' && !game.winner;
  const arrival = { ...game, round: event?.round ?? game.round,
    ...(role === 'fox' && !covered ? { phase: 'fox_move' } : {}) };
  return { ...wireObservation(arrival, role, covered), perspective,
    event: covered || (role === 'fox' && event?.actor === 'rabbit') ? null : event };
}

// Called only for replay records already validated by replay() at registration.
export function replayFrames(data, role = 'turn') {
  if (!['turn', 'observer', 'fox', 'rabbit'].includes(role)) throw new Error('Choose a valid replay perspective.');
  const game = newGame(data.seed, replayConfig(data), false), frames = [];
  const capture = event => {
    const { board, ...view } = replayObservation(game, event, role);
    frames.push(view);
  };
  capture(null);
  for (const event of data.actions) { apply(game, event.action); capture(event); }
  return { board: publicBoard(game.board), config: game.config, role, frames };
}
