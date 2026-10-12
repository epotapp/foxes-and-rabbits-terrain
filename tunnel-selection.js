import { constructionLength, straightPaths } from './rules.js';

// Keep dice in their rolled order; only change the default selection.
export function mostOpenDie(game) {
  let selected = Math.max(0, game.used.findIndex(used => !used)), most = -1;
  for (let die = 0; die < game.dice.length; die++) {
    if (game.used[die]) continue;
    const count = straightPaths(game.board, game.origin,
      constructionLength(game.board, game.origin, game.dice[die]), game.masks).length;
    if (count > most) { most = count; selected = die; }
  }
  return selected;
}
