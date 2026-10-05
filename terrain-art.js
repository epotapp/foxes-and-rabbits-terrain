// Shared pigment and small carved/painted marks for the live SVG and GIF canvas.
export const terrainColors = { ground: ['#d4d7b8', '#dce0c6', '#ccd1ad'], sand: ['#e9d097', '#eedaaa', '#e4c68c'], rock: ['#9faea7', '#b1bbb0', '#94a39b'] };
export function terrainFill(type, id) { return (terrainColors[type] || terrainColors.ground)[(id * 7 + Math.floor(id / 9)) % 3]; }
export function terrainMarks(type, id) {
  if (type === 'rock') return [
    { points: [[-.55,.48],[-.34,.1],[.03,.18],[.22,.52],[-.12,.65]], fill: '#788e85', stroke: '#61776e' },
    { points: [[-.34,.1],[-.22,.48],[.22,.52]], stroke: '#c7d0bc' },
    { points: [[.18,-.35],[.37,-.58],[.62,-.31],[.46,-.22]], fill: '#c4caba' }
  ];
  if (type === 'sand') return [
    { points: [[-.53,.35],[-.31,.42],[-.06,.35],[.14,.42],[.41,.35]], stroke: '#bf9b58' },
    { points: [[-.34,.58],[-.12,.63],[.09,.58]], stroke: '#cfaf73' },
    { points: [[.36,-.39],[.4,-.39]], stroke: '#ab8b4e' },
    { points: [[.56,-.2],[.59,-.2]], stroke: '#ab8b4e' }
  ];
  return id % 3 ? [] : [
    { points: [[-.47,.54],[-.54,.3],[-.4,.49],[-.31,.27]], stroke: '#89966d' },
    { points: [[.34,-.4],[.49,-.43]], stroke: '#a9b28a' }
  ];
}
export function terrainSVG(cell, type) {
  return `<g class="terrain-marks" transform="translate(${cell.x} ${cell.y})">${terrainMarks(type, cell.id).map(m => `<path d="M${m.points.map(p => p.join(' ')).join('L')}${m.fill ? 'Z' : ''}" fill="${m.fill || 'none'}" stroke="${m.stroke || 'none'}"/>`).join('')}</g>`;
}
export function paintTerrain(ctx, cell, type) {
  ctx.save(); ctx.translate(cell.x, cell.y); ctx.lineWidth = .055; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  for (const mark of terrainMarks(type, cell.id)) {
    ctx.beginPath(); mark.points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
    if (mark.fill) { ctx.closePath(); ctx.fillStyle = mark.fill; ctx.fill(); }
    if (mark.stroke) { ctx.strokeStyle = mark.stroke; ctx.stroke(); }
  }
  ctx.restore();
}
