// Direction indices stay constant along straight lines on the hex grid.
// Shared by the referee, agents, and manual construction controls.
export function straightPaths(board, origin, length, masks = []) {
  const paths = [];
  if (board.terrain?.[origin] === 'rock') return paths;
  for (let direction = 0; direction < 6; direction++) {
    const path = [origin];
    while (path.length <= length) {
      const from = path.at(-1), next = board.neighbors[from]?.[direction];
      if (next === undefined || next < 0 || board.terrain?.[next] === 'rock') break;
      path.push(next);
    }
    if (path.length === length + 1 && path.slice(0, -1).some(from => !(masks[from] & (1 << direction)))) paths.push(path);
  }
  return paths;
}

export function constructionLength(board, origin, die) { return die + (board.terrain?.[origin] === 'ground' ? 1 : 0); }
export function sandConnection(board, from, to) { return board.terrain?.[from] === 'sand' || board.terrain?.[to] === 'sand'; }

export function straightContinuations(board, origin, length, draft, masks = []) {
  return straightPaths(board, origin, length, masks)
    .filter(path => draft.every((id, i) => path[i] === id) && draft.length < path.length)
    .map(path => path[draft.length]);
}
