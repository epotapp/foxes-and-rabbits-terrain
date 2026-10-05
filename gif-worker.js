import { terrainFill, paintTerrain } from './terrain-art.js';
import { sandConnection } from './rules.js';
import { GifEncoder, makePalette, indexPixels } from './gif-encoder.js';

self.onmessage = async ({ data }) => {
  try {
    const { replay, width, delay } = data;
    if (![640, 960, 1280].includes(width) || ![20, 120, 500].includes(delay)) throw new Error('Invalid GIF options.');
    const scale = width / 960, height = Math.round(744 * scale), canvas = new OffscreenCanvas(width, height), ctx = canvas.getContext('2d', { willReadFrequently: true });
    const response = await fetch(new URL('./assets/woodland-board.png', import.meta.url));
    if (!response.ok) throw new Error('The board artwork could not load.');
    const art = await createImageBitmap(await response.blob()), backdrop = new OffscreenCanvas(width, height), background = backdrop.getContext('2d');
    background.fillStyle = '#f3eddf'; background.fillRect(0, 0, width, height); background.drawImage(art, 12 * scale, 74 * scale, 936 * scale, 624 * scale); art.close();
    const { palette, lookup } = makePalette(background.getImageData(0, 0, width, height).data), gif = new GifEncoder(width, height, palette);
    const board = replay.board, maxX = Math.max(...board.cells.map(c => c.x)), maxY = Math.max(...board.cells.map(c => c.y));
    const unit = Math.min(936 * .84 / (maxX + 2.4), 624 * .78 / (maxY + 2.4));
    const originX = 480 - maxX * unit / 2, originY = 74 + 624 * .49 - maxY * unit / 2;
    const hex = (cell, radius = .97) => {
      ctx.moveTo(cell.x + radius, cell.y);
      for (let n = 1; n < 6; n++) ctx.lineTo(cell.x + Math.cos(n * Math.PI / 3) * radius, cell.y + Math.sin(n * Math.PI / 3) * radius);
      ctx.closePath();
    };
    const caption = g => {
      if (g.winner) return g.reason;
      if (g.covered) return 'Rabbit turn · the field is covered';
      const event = g.event;
      if (!event) return g.phase === 'fox_roll' ? 'Fox turn · roll for movement' : 'Starting positions';
      const who = event.actor === 'fox' ? 'Fox' : 'Rabbit';
      if (event.action.type === 'roll') return `${who} rolled ${event.dice.join(' + ')}`;
      if (event.action.type === 'dig') return `Rabbit drew a ${event.action.path.length - 1}-step tunnel`;
      return `${who} moved one hex${g.remaining ? ` · ${g.remaining} steps remaining` : ''}`;
    };
    for (let frame = 0; frame < replay.frames.length; frame++) {
      const g = replay.frames[frame], visible = g.visible === null ? null : new Set(g.visible);
      ctx.resetTransform(); ctx.drawImage(backdrop, 0, 0); ctx.scale(scale, scale);
      ctx.fillStyle = '#352b21'; ctx.font = 'bold 29px Georgia'; ctx.fillText('Foxes and Rabbits', 24, 38);
      ctx.fillStyle = '#746b5c'; ctx.font = '13px Arial'; ctx.fillText(`Terrain edition · ${g.role === 'observer' ? 'Full board' : g.role === 'fox' ? 'Fox view' : 'Rabbit view'} · ${replay.role === 'turn' ? 'Follow turns' : 'Recorded game'}`, 25, 59);
      ctx.textAlign = 'right'; ctx.font = '19px Georgia'; ctx.fillText(`Round ${g.round} / ${replay.config.rounds}`, 936, 37); ctx.textAlign = 'left';
      ctx.save(); ctx.translate(originX, originY); ctx.scale(unit, unit);
      for (const cell of board.cells) {
        ctx.beginPath(); hex(cell); const fog = visible && !visible.has(cell.id);
        ctx.fillStyle = fog ? '#3e5140ed' : terrainFill(board.terrain[cell.id], cell.id); ctx.strokeStyle = fog ? '#73836a99' : '#96856878'; ctx.lineWidth = .038; ctx.fill(); ctx.stroke();
        if (!fog) paintTerrain(ctx, cell, board.terrain[cell.id]);
      }
      ctx.save();
      if (visible) { ctx.beginPath(); for (const id of visible) hex(board.cells[id], 1.015); ctx.clip(); }
      const edges = new Set(); ctx.lineCap = 'round';
      for (let id = 0; id < board.cells.length; id++) for (let direction = 0; direction < 6; direction++) if (g.masks[id] & (1 << direction)) {
        const to = board.neighbors[id][direction], key = `${Math.min(id, to)},${Math.max(id, to)}`;
        if (to < 0 || edges.has(key)) continue; edges.add(key);
        const a = board.cells[id], b = board.cells[to];
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.strokeStyle = '#fff8e8'; ctx.lineWidth = .22; ctx.stroke(); const temporary = sandConnection(board, id, to), life = g.expires?.[id * 6 + direction];
        ctx.setLineDash(temporary ? [.18, .12] : []); ctx.strokeStyle = life && life <= g.round + 1 ? '#b55434' : '#906447'; ctx.lineWidth = .12; ctx.stroke(); ctx.setLineDash([]);
      }
      ctx.restore();
      if (!g.covered) for (const [id, mark] of [[board.foxStart, 'FI'], [board.rabbitStart, 'RI']]) if (!visible || visible.has(id)) {
        const c = board.cells[id]; ctx.fillStyle = '#746b5c'; ctx.font = '.38px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillText(mark, c.x, c.y + .78);
      }
      if (!g.covered) for (const [id, letter, color] of [[g.fox, 'F', '#a04b2e'], [g.rabbit, 'r', '#344d3b']]) if (id !== null && id !== undefined) {
        const c = board.cells[id]; ctx.beginPath(); ctx.arc(c.x, c.y, .59, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#ffefd1'; ctx.lineWidth = .1; ctx.stroke();
        ctx.fillStyle = '#fff8e8'; ctx.font = 'bold .78px Georgia'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(letter, c.x, c.y);
      }
      ctx.restore(); ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
      if (g.covered) {
        ctx.fillStyle = '#263a2eee'; ctx.fillRect(264, 327, 432, 85); ctx.fillStyle = '#fbf7ed'; ctx.font = 'bold 24px Georgia'; ctx.fillText('Rabbit turn', 480, 362); ctx.font = '15px Arial'; ctx.fillText('Construction and movement stay hidden.', 480, 389);
      }
      ctx.fillStyle = '#352b21'; ctx.font = g.winner ? 'bold 19px Georgia' : '15px Arial'; ctx.fillText(caption(g), 480, 726);
      ctx.textAlign = 'left';
      gif.frame(indexPixels(ctx.getImageData(0, 0, width, height).data, lookup), frame === 0 ? 700 : frame === replay.frames.length - 1 ? 1800 : delay);
      if (frame % 5 === 0 || frame === replay.frames.length - 1) self.postMessage({ type: 'progress', completed: frame + 1, total: replay.frames.length });
    }
    const bytes = gif.finish(); self.postMessage({ type: 'complete', bytes: bytes.buffer }, [bytes.buffer]);
  } catch (error) { self.postMessage({ type: 'error', message: error.message }); }
};
