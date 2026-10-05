import { RABBIT_STRATEGIES, DEFAULT_MIX, normalizeRabbit } from './rabbit-strategies.js';

export function strategyMixer(container, onChange = () => {}) {
  container.classList.add('strategy-mixer');
  container.innerHTML = `<details><summary>Blend Rabbit strategies</summary><p class="fine">Weights shape every plan. Set a style to 0 to exclude it; any positive total works.</p><div class="mix-presets"><button type="button" data-preset="balanced">Balanced</button><button type="button" data-preset="mobile">Mobile</button><button type="button" data-preset="deceptive">Deceptive</button></div><div class="mix-bar" aria-hidden="true"></div>${RABBIT_STRATEGIES.map((s, i) => `<div class="mix-row" style="--mix-color:var(--strategy-${i})"><label for="${container.id}-${s.id}"><span class="mix-dot"></span>${s.name}<output data-share="${s.id}">20%</output></label><div class="mix-inputs"><input id="${container.id}-${s.id}" type="range" min="0" max="100" step="1" value="20" data-weight="${s.id}" aria-label="${s.name} weight"><input type="number" min="0" max="100" step="1" value="20" data-number="${s.id}" aria-label="${s.name} numeric weight"></div></div>`).join('')}<p class="mix-status fine" role="status"></p><details class="strategy-explanations"><summary>How the five strategies think</summary>${RABBIT_STRATEGIES.map(s => `<p><strong>${s.name}.</strong> ${s.detail}</p>`).join('')}</details></details>`;
  const inputs = [...container.querySelectorAll('[data-weight]')];
  const read = () => Object.fromEntries(inputs.map(input => [input.dataset.weight, Number(input.value)]));
  function refresh() {
    const weights = read(), total = Object.values(weights).reduce((a, b) => a + b, 0);
    for (const s of RABBIT_STRATEGIES) container.querySelector(`[data-share="${s.id}"]`).textContent = total ? `${Math.round(weights[s.id] * 100 / total)}%` : '0%';
    container.querySelector('.mix-bar').innerHTML = RABBIT_STRATEGIES.map((s, i) => `<span style="flex:${weights[s.id]};background:var(--strategy-${i})"></span>`).join('');
    container.querySelector('.mix-status').textContent = total ? `${Object.values(weights).filter(n => n > 0).length} active styles · safety remains the first priority` : 'Enable at least one strategy before starting.';
    container.classList.toggle('mix-invalid', !total); onChange(weights);
  }
  function set(weights = DEFAULT_MIX) {
    for (const input of inputs) { input.value = weights[input.dataset.weight] ?? 0; container.querySelector(`[data-number="${input.dataset.weight}"]`).value = input.value; }
    refresh();
  }
  container.addEventListener('input', event => {
    const target = event.target, id = target.dataset.weight || target.dataset.number; if (!id) return;
    const n = Math.min(100, Math.max(0, Number(target.value) || 0));
    container.querySelector(`[data-weight="${id}"]`).value = n;
    container.querySelector(`[data-number="${id}"]`).value = n; refresh();
  });
  container.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => set({ balanced: DEFAULT_MIX, mobile: { architect: 10, pathfinder: 45, trickster: 10, outrider: 30, ghost: 5 }, deceptive: { architect: 10, pathfinder: 5, trickster: 40, outrider: 10, ghost: 35 } }[button.dataset.preset])));
  set();
  return { set, weights: read, profile: () => normalizeRabbit({ id: 'mixed', weights: read() }), show: visible => { container.hidden = !visible; } };
}
