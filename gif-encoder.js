// GIF89a: https://www.w3.org/Graphics/GIF/spec-gif89a.txt
// Original local encoder. One global palette, LZW, and changed rectangles.
class Bytes {
  constructor() { this.data = new Uint8Array(65536); this.length = 0; }
  write(values) {
    if (this.length + values.length > 64 * 1024 * 1024) throw new Error('This GIF exceeds 64 MB. Try the smaller size or a shorter replay.');
    if (this.length + values.length > this.data.length) {
      const next = new Uint8Array(Math.max(this.data.length * 2, this.length + values.length)); next.set(this.data); this.data = next;
    }
    this.data.set(values, this.length); this.length += values.length;
  }
  byte(value) { this.write([value]); }
  word(value) { this.write([value & 255, value >> 8]); }
  string(value) { this.write(new TextEncoder().encode(value)); }
  finish() { return this.data.slice(0, this.length); }
}
export function lzw(pixels) {
  const bytes = new Bytes(), dictionary = new Map();
  let next = 258, width = 9, bits = 0, buffer = 0;
  const emit = code => { buffer |= code << bits; bits += width; while (bits >= 8) { bytes.byte(buffer & 255); buffer >>>= 8; bits -= 8; } };
  emit(256); let prefix = pixels[0];
  for (let i = 1; i < pixels.length; i++) {
    const value = pixels[i], key = prefix * 256 + value, found = dictionary.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next < 4096) { dictionary.set(key, next++); if (next > (1 << width) && width < 12) width++; }
    else { emit(256); dictionary.clear(); next = 258; width = 9; }
    prefix = value;
  }
  emit(prefix);
  if (next === (1 << width) && width < 12) width++;
  emit(257); if (bits) bytes.byte(buffer & 255);
  return bytes.finish();
}
export class GifEncoder {
  constructor(width, height, palette) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 2048 || height > 2048 || palette.length !== 768) throw new Error('Invalid GIF dimensions or palette.');
    this.width = width; this.height = height; this.output = new Bytes(); this.previous = null;
    const out = this.output;
    out.string('GIF89a'); out.word(width); out.word(height); out.write([247, 0, 0]); out.write(palette);
    out.write([33, 255, 11]); out.string('NETSCAPE2.0'); out.write([3, 1, 0, 0, 0]);
  }
  frame(pixels, delayMs) {
    if (pixels.length !== this.width * this.height) throw new Error('Invalid GIF frame.');
    let left = this.width, top = this.height, right = -1, bottom = -1;
    for (let y = 0, i = 0; y < this.height; y++) for (let x = 0; x < this.width; x++, i++) {
      if (!this.previous || pixels[i] !== this.previous[i]) { left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
    }
    if (right < 0) { left = top = right = bottom = 0; }
    const width = right - left + 1, height = bottom - top + 1, region = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) region.set(pixels.subarray((top + y) * this.width + left, (top + y) * this.width + left + width), y * width);
    const out = this.output;
    out.write([33, 249, 4, 4]); out.word(Math.max(2, Math.min(65535, Math.round(delayMs / 10)))); out.write([0, 0]);
    out.byte(44); out.word(left); out.word(top); out.word(width); out.word(height); out.byte(0); out.byte(8);
    const compressed = lzw(region);
    for (let offset = 0; offset < compressed.length; offset += 255) { const block = compressed.subarray(offset, offset + 255); out.byte(block.length); out.write(block); }
    out.byte(0); this.previous = pixels.slice();
  }
  finish() { this.output.byte(59); return this.output.finish(); }
}

const fixed = ['f3eddf','fbf7ed','352b21','746b5c','344d3b','263a2e','a04b2e','906447','fff8e8','ffefd1','3e5140','73836a','968568','f1e7d0','c29851','d7cdb9','d4d7b8','dce0c6','ccd1ad','e9d097','eedaaa','e4c68c','9faea7','b1bbb0','94a39b','788e85','61776e','c7d0bc','c4caba','bf9b58','cfaf73','ab8b4e','89966d','a9b28a','b55434'];
export function makePalette(rgba) {
  const histogram = new Uint32Array(32768);
  for (let i = 0; i < rgba.length; i += 16) histogram[(rgba[i] >> 3) * 1024 + (rgba[i + 1] >> 3) * 32 + (rgba[i + 2] >> 3)]++;
  const colors = [];
  for (let key = 0; key < histogram.length; key++) if (histogram[key]) colors.push({ rgb: [(key >> 10) * 8 + 4, ((key >> 5) & 31) * 8 + 4, (key & 31) * 8 + 4], weight: histogram[key] });
  const box = items => {
    const range = [0, 1, 2].map(axis => Math.max(...items.map(c => c.rgb[axis])) - Math.min(...items.map(c => c.rgb[axis])));
    const axis = range.indexOf(Math.max(...range)), count = items.reduce((n, c) => n + c.weight, 0);
    return { items, axis, count, score: items.length > 1 ? range[axis] * Math.sqrt(count) : 0 };
  };
  const boxes = [box(colors)];
  while (boxes.length < 256 - fixed.length) {
    boxes.sort((a, b) => b.score - a.score); const current = boxes.shift();
    if (!current.score) { boxes.unshift(current); break; }
    current.items.sort((a, b) => a.rgb[current.axis] - b.rgb[current.axis]);
    let total = 0, split = 0;
    do { total += current.items[split++].weight; } while (total < current.count / 2 && split < current.items.length - 1);
    boxes.push(box(current.items.slice(0, split)), box(current.items.slice(split)));
  }
  const palette = new Uint8Array(768);
  fixed.forEach((hex, i) => palette.set(hex.match(/../g).map(x => parseInt(x, 16)), i * 3));
  boxes.forEach((b, i) => palette.set([0, 1, 2].map(axis => Math.round(b.items.reduce((sum, c) => sum + c.rgb[axis] * c.weight, 0) / b.count)), (fixed.length + i) * 3));
  const lookup = new Uint8Array(32768), count = fixed.length + boxes.length;
  for (let key = 0; key < lookup.length; key++) {
    const r = (key >> 10) * 8 + 4, g = ((key >> 5) & 31) * 8 + 4, b = (key & 31) * 8 + 4; let best = Infinity;
    for (let index = 0; index < count; index++) {
      const p = index * 3, distance = (r - palette[p]) ** 2 + (g - palette[p + 1]) ** 2 + (b - palette[p + 2]) ** 2;
      if (distance < best) { best = distance; lookup[key] = index; }
    }
  }
  return { palette, lookup };
}
export function indexPixels(rgba, lookup) {
  const pixels = new Uint8Array(rgba.length / 4);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) pixels[p] = lookup[(rgba[i] >> 3) * 1024 + (rgba[i + 1] >> 3) * 32 + (rgba[i + 2] >> 3)];
  return pixels;
}
