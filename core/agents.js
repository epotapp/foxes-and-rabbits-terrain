export { AGENT_VERSION, POLICIES, makeAgent, decide } from './planners.js';
import { decide } from './planners.js';
import { apply, actor, observe } from './engine.js';
import { rememberFox } from './fox-tracker.js';

export function stepAgent(game, agent) {
  const role = actor(game), round = game.round;
  const action = decide(agent, observe(game, role));
  apply(game, action);
  if (role === 'fox' && action.type === 'move') {
    // The aperture is visible on arrival, including the final movement point,
    // before the Rabbit covers the field. Pass only that filtered observation.
    rememberFox(agent, observe({ ...game, phase: 'fox_move', round }, 'fox'));
  }
  return action;
}
