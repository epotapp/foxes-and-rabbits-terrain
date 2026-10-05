import { gameFetch as fetch } from './transport.js';
export function setupGifExport({ api, currentVersion, downloadSaved, gameReplay, currentReplay, onOpen, onClose }) {
  const $ = id => document.getElementById(id);
  let source = null, worker = null, request = null, run = 0, busy = false;
  function cancel() {
    run++; worker?.terminate(); worker = null; request?.abort(); request = null; busy = false;
    $('gif-options').disabled = false; $('gif-create').disabled = false; $('gif-cancel').textContent = 'Close'; $('gif-cancel').disabled = false;
    $('gif-progress').hidden = true;
  }
  function open(replay) {
    if (!currentVersion()) throw new Error('Open the updated game for GIF export. You can save this game’s replay and open it there.');
    source = replay; $('gif-view').value = replay.view || 'turn';
    $('gif-speed').value = document.getElementById('speed').value === '0' ? '20' : document.getElementById('speed').value;
    $('gif-status').textContent = ''; $('gif-download').hidden = true; $('gif-progress').hidden = true;
    onOpen(); $('gif-dialog').showModal();
  }
  $('export-game-gif').addEventListener('click', () => { try { open({ game: true }); } catch (e) { alertError(e); } });
  $('export-replay-gif').addEventListener('click', () => { try { open(currentReplay()); } catch (e) { alertError(e); } });
  const alertError = e => { const toast = $('toast'); toast.textContent = e.message; toast.hidden = false; setTimeout(() => toast.hidden = true, 6000); };
  $('gif-cancel').addEventListener('click', () => { if (busy) { cancel(); $('gif-status').textContent = 'Export cancelled.'; } else $('gif-dialog').close(); });
  $('gif-dialog').addEventListener('cancel', () => cancel());
  $('gif-dialog').addEventListener('close', () => { cancel(); onClose(); });
  $('gif-form').addEventListener('submit', async event => {
    event.preventDefault(); if (busy) return;
    busy = true; const token = ++run; request = new AbortController(); const signal = request.signal;
    $('gif-options').disabled = true; $('gif-create').disabled = true; $('gif-cancel').textContent = 'Cancel export'; $('gif-download').hidden = true;
    $('gif-status').textContent = 'Preparing the recorded game…'; $('gif-progress').value = 0; $('gif-progress').hidden = false;
    try {
      if (!('OffscreenCanvas' in window) || !('Worker' in window)) throw new Error('GIF export needs a current browser with canvas worker support.');
      const info = source.game ? await api('/api/replays', await gameReplay()) : source;
      if (token !== run) return;
      const response = await fetch(`/api/replays/${info.id}/frames?view=${$('gif-view').value}`, { signal });
      const replay = await response.json(); if (!response.ok) throw new Error(replay.error || 'Replay frames could not load.');
      if (token !== run) return;
      const bytes = await new Promise((resolve, reject) => {
        const encoder = worker = new Worker(new URL('./gif-worker.js', import.meta.url), { type: 'module' });
        signal.addEventListener('abort', () => reject(new DOMException('Export cancelled.', 'AbortError')), { once: true });
        encoder.onerror = event => { event.preventDefault(); reject(new Error('The GIF encoder could not run. Try a smaller image size.')); };
        encoder.onmessage = ({ data }) => {
          if (token !== run) return;
          if (data.type === 'progress') { $('gif-progress').value = data.completed / data.total * 95; $('gif-status').textContent = `Drawing frame ${data.completed} of ${data.total}…`; }
          else if (data.type === 'error') reject(new Error(data.message));
          else if (data.type === 'complete') resolve(data.bytes);
        };
        encoder.postMessage({ replay, width: Number($('gif-size').value), delay: Number($('gif-speed').value) });
      });
      worker?.terminate(); worker = null;
      if (token !== run) return;
      $('gif-status').textContent = 'Saving GIF…'; $('gif-cancel').disabled = true;
      const savedResponse = await fetch(`/api/replays/${info.id}/gif`, { method: 'POST', headers: { 'Content-Type': 'image/gif' }, body: bytes, signal });
      const saved = await savedResponse.json(); if (!savedResponse.ok) throw new Error(saved.error || 'The GIF could not be saved.');
      if (token !== run) return;
      downloadSaved(saved); $('gif-progress').value = 100;
      $('gif-status').textContent = `Saved ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB · ${saved.savedTo}`;
      $('gif-download').href = saved.downloadUrl; $('gif-download').download = saved.filename; $('gif-download').hidden = false;
    } catch (error) { if (token === run) { $('gif-status').textContent = error.message; $('gif-progress').hidden = true; } }
    finally {
      if (token === run) { worker?.terminate(); worker = null; request = null; busy = false; $('gif-options').disabled = false; $('gif-create').disabled = false; $('gif-cancel').textContent = 'Close'; $('gif-cancel').disabled = false; }
    }
  });
}
