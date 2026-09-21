/* ============================================================================
   VoidMedia Studio — js/modules/audio.js
   Procesamiento de audio 100% client-side con Web Audio API:
   - Cola de pistas con waveform generada tras decodificar.
   - Recorte (trim) por segundos, ganancia en dB y fades.
   - Export a WAV PCM 16-bit (hand-rolled) o MP3 (lamejs).
   - Descarga simple o .zip automática vía VMSZipper.
   ========================================================================== */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {};

  let queue = []; // { file, url, buffer, peaks, duration }
  let AudioCtx = null;

  function getCtx() {
    if (!AudioCtx) {
      AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) throw new Error('Web Audio API no está disponible en este navegador.');
    }
    return AudioCtx;
  }

  /* -------------------------------------------------------------------------
   * Codificadores de export
   * ---------------------------------------------------------------------- */

  /** Codifica un AudioBuffer a WAV PCM 16-bit (sin dependencias). */
  function audioBufferToWav(buffer, bitDepth = 16) {
    const numCh = Math.min(buffer.numberOfChannels, 2);
    const len = buffer.length;
    const sampleRate = buffer.sampleRate;
    const bytesPerSample = bitDepth / 8;
    const dataSize = len * numCh * bytesPerSample;
    const ab = new ArrayBuffer(44 + dataSize);
    const view = new DataView(ab);

    const writeStr = (off, s) => {
      for (let i =  0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numCh, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numCh * bytesPerSample, true);
    view.setUint32(32, numCh * bytesPerSample, true);
    view.setUint16(34, bitDepth, true);
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    const chans = [];
    for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));

    let off = 44;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        let s = chans[c][i];
        s = Math.max(-1, Math.min(1, s));
        view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([ab], { type: 'audio/wav' });
  }

  /** Codifica un AudioBuffer a MP3 con lamejs (si el CDN cargó). */
  function audioBufferToMp3(buffer, kbps = 192) {
    if (typeof lamejs === 'undefined') {
      return Promise.reject(new Error('lamejs no está disponible (¿CDN bloqueado?)'));
    }
    return new Promise((resolve, reject) => {
      try {
        const numCh = Math.min(buffer.numberOfChannels, 2);
        const sampleRate = buffer.sampleRate;
        const mp3encoder = new lamejs.Mp3Encoder(numCh, sampleRate, kbps);
        const left = buffer.getChannelData(0);
        const right = numCh > 1 ? buffer.getChannelData(1) : null;

        // lamejs espera Int16
        const toInt16 = (f32) => {
          const out = new Int16Array(f32.length);
          for (let i = 0; i < f32.length; i++) {
            const s = Math.max(-1, Math.min(1, f32[i]));
            out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          return out;
        };

        const l16 = toInt16(left);
        const r16 = right ? toInt16(right) : null;

        const blockSize = 1152;
        const data = [];
        for (let i = 0; i < l16.length; i += blockSize) {
          const lChunk = l16.subarray(i, i + blockSize);
          const rChunk = r16 ? r16.subarray(i, i + blockSize) : null;
          const buf = numCh > 1 ? mp3encoder.encodeBuffer(lChunk, rChunk) : mp3encoder.encodeBuffer(lChunk);
          if (buf.length > 0) data.push(new Uint8Array(buf));
        }
        const end = mp3encoder.flush();
        if (end.length > 0) data.push(new Uint8Array(end));

        resolve(new Blob(data, { type: 'audio/mpeg' }));
      } catch (err) {
        reject(err);
      }
    });
  }

  /* -------------------------------------------------------------------------
   * Procesamiento DSP
   * ---------------------------------------------------------------------- */

  /**
   * Aplica recorte, ganancia y fades sobre un AudioBuffer usando
   * OfflineAudioContext, y devuelve un nuevo AudioBuffer.
   */
  async function processBuffer(buffer, cfg) {
    const { trimStart = 0, trimEnd = null, gainDb = 0, fadeIn = 0, fadeOut = 0,
            normalize = false, reverse = false, speed = 1 } = cfg;

    const sr = buffer.sampleRate;
    let start = Math.max(0, trimStart || 0) * sr;
    let end = trimEnd != null && trimEnd > 0 ? trimEnd * sr : buffer.duration * sr;
    start = Math.min(start, buffer.length);
    end = Math.min(end, buffer.length);
    let length = Math.max(0, Math.floor(end - start));
    if (length === 0) throw new Error('El recorte deja la pista vacía (revisa inicio/fin).');

    // Normalizar: medir el pico real del segmento y fijar la ganancia
    // necesaria para alcanzar −1 dBFS (≈ 0.891). Ignora la ganancia manual.
    let effectiveGain = gainDb;
    if (normalize) {
      let peak = 0;
      const s0 = Math.floor(start);
      const s1 = Math.min(buffer.length, Math.floor(end));
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const data = buffer.getChannelData(c);
        for (let i = s0; i < s1; i++) {
          const v = Math.abs(data[i]);
          if (v > peak) peak = v;
        }
      }
      if (peak > 0) {
        const target = Math.pow(10, -1 / 20); // −1 dBFS ≈ 0.891
        effectiveGain = 20 * Math.log10(target / peak);
      }
    }

    const numCh = Math.min(buffer.numberOfChannels, 2);
    // Con playbackRate ≠ 1 la fuente consume muestras más rápido o más lento:
    // la longitud de salida debe ajustarse (rate=2 → mitad de duración).
    const rate = speed !== 1 && Number.isFinite(speed) && speed > 0 ? speed : 1;
    const outLength = Math.max(1, Math.ceil(length / rate));
    const ctx = new OfflineAudioContext(numCh, outLength, sr);
    const src = ctx.createBufferSource();
    // Nota: AudioBufferSourceNode.buffer solo admite UNA asignación no nula,
    // así que la inversión se prepara ANTES de asignar.
    if (reverse) {
      // Copia invertida para no mutar el buffer original de la cola
      const rev = ctx.createBuffer(numCh, buffer.length, sr);
      for (let c = 0; c < numCh; c++) {
        const srcData = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
        const dst = rev.getChannelData(c);
        for (let i = 0, j = buffer.length - 1; i < buffer.length; i++, j--) {
          dst[i] = srcData[j];
        }
      }
      src.buffer = rev;
    } else {
      src.buffer = buffer;
    }
    if (rate !== 1) {
      src.playbackRate.value = rate;
    }

    let node = src;
    if (effectiveGain !== 0) {
      const g = ctx.createGain();
      g.gain.value = Math.pow(10, effectiveGain / 20);
      node.connect(g);
      node = g;
    }
    if (fadeIn > 0 || fadeOut > 0) {
      const g = ctx.createGain();
      const now = 0;
      const dur = outLength / sr;
      if (fadeIn > 0) {
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(1, Math.min(fadeIn, dur / 2));
      }
      if (fadeOut > 0) {
        const t0 = Math.max(0, dur - fadeOut);
        g.gain.setValueAtTime(1, t0);
        g.gain.exponentialRampToValueAtTime(0.0001, dur);
      }
      node.connect(g);
      node = g;
    }
    node.connect(ctx.destination);
    src.start(0, start / sr);
    const out = await ctx.startRendering();
    return out;
  }

  /* -------------------------------------------------------------------------
   * Cola y UI
   * ---------------------------------------------------------------------- */

  async function addFiles(fileList) {
    const files = Array.from(fileList || []).filter((f) => f.type.startsWith('audio/') || /\.(wav|mp3|ogg|m4a|flac|aac)$/i.test(f.name));
    if (!files.length) {
      toast('No se detectaron pistas de audio válidas.', 'error');
      return;
    }

    const Ctx = getCtx();
    const probe = new Ctx({ sampleRate: 48000 });
    for (const file of files) {
      try {
        const ab = await VMS.readFileAsArrayBuffer(file);
        const buffer = await probe.decodeAudioData(ab);
        const peaks = computePeaks(buffer, 96);
        queue.push({ file, buffer, peaks, duration: buffer.duration });
      } catch (err) {
        console.error('[audio] no se pudo decodificar', file.name, err);
        toast(`No se pudo decodificar ${file.name}.`, 'error');
      }
    }
    probe.close();
    renderQueue();
    toast(`${files.length} pista(s) añadida(s).`, 'success');
  }

  /** 96 picos normalizados para la mini-waveform. */
  function computePeaks(buffer, count = 96) {
    const ch = buffer.getChannelData(0);
    const block = Math.max(1, Math.floor(ch.length / count));
    const peaks = new Array(count).fill(0);
    for (let i = 0; i < count; i++) {
      let max = 0;
      const s = i * block;
      for (let j = s; j < s + block && j < ch.length; j++) {
        const v = Math.abs(ch[j]);
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
    return peaks;
  }

  function renderQueue() {
    els.count.textContent = String(queue.length);
    els.process.disabled = queue.length === 0;

    const list = els.queue;
    if (queue.length === 0) {
      list.innerHTML = '<p class="px-4 py-10 text-center text-xs text-zinc-600" data-empty-state>Aún no hay pistas en la cola.</p>';
      return;
    }

    list.innerHTML = queue
      .map((item, i) => {
        return `
        <div class="queue-row" data-index="${i}">
          <div class="queue-ico">♪</div>
          <div class="queue-name">
            <div class="q-title">${VMS.escapeHtml(item.file.name)}</div>
            <div class="q-meta">${VMS.formatBytes(item.file.size)} · ${VMS.formatSeconds(item.duration)} · ${item.buffer.sampleRate} Hz · ${item.buffer.numberOfChannels === 1 ? 'mono' : 'estéreo'}</div>
          </div>
          <canvas class="wave-canvas" data-peaks="${VMS.escapeHtml(JSON.stringify(item.peaks))}" width="220" height="42"></canvas>
          <button class="row-remove" type="button" data-remove="${i}" title="Quitar" aria-label="Quitar ${VMS.escapeHtml(item.file.name)}">×</button>
        </div>`;
      })
      .join('');

    // Pintar waveforms tras insertar en DOM
    requestAnimationFrame(() => {
      list.querySelectorAll('canvas.wave-canvas').forEach((c) => {
        try {
          VMS.drawWave(c, JSON.parse(c.dataset.peaks));
        } catch (_) { /* noop */ }
      });
    });
  }

  function removeAt(i) {
    queue.splice(i, 1);
    renderQueue();
  }

  function clearAll() {
    queue = [];
    renderQueue();
    hideSummary();
  }

  /* -------------------------------------------------------------------------
   * Procesado y descarga
   * ---------------------------------------------------------------------- */
  let processing = false;

  async function processAll() {
    if (processing || queue.length === 0) return;
    processing = true;
    els.process.disabled = true;

    const format = document.querySelector('input[name="audio-format"]:checked').value;
    const kbps = parseInt(els.kbps.value, 10) || 192;
    const trimStart = parseFloat(els.trimStart.value) || 0;
    const trimEndRaw = parseFloat(els.trimEnd.value);
    const trimEnd = Number.isFinite(trimEndRaw) && trimEndRaw > 0 ? trimEndRaw : null;
    const gainDb = parseFloat(els.gain.value) || 0;
    const fadeIn = parseFloat(els.fadeIn.value) || 0;
    const fadeOut = parseFloat(els.fadeOut.value) || 0;
    const normalize = els.normalize.checked;
    const reverse = els.reverse.checked;
    const speed = parseFloat(els.speed.value) || 1;

    const Ctx = getCtx();
    const probe = new Ctx({ sampleRate: 48000 });
    const outputs = [];
    let failures = 0;

    for (const item of queue) {
      try {
        const processed = await processBuffer(item.buffer, {
          trimStart, trimEnd, gainDb, fadeIn, fadeOut, normalize, reverse, speed,
        });
        let blob;
        let ext;
        if (format === 'audio/mpeg') {
          blob = await audioBufferToMp3(processed, kbps);
          ext = 'mp3';
        } else {
          blob = audioBufferToWav(processed, 16);
          ext = 'wav';
        }
        outputs.push({
          name: `${VMSZipper.withExt(item.file.name, ext)}`,
          blob,
        });
      } catch (err) {
        failures++;
        console.error('[audio] falló', item.file.name, err);
        toast(`Error con ${item.file.name}: ${err.message}`, 'error', 5000);
      }
    }
    probe.close();

    VMS.state.outputs.audio = outputs;
    els.process.disabled = false;
    processing = false;

    if (outputs.length) {
      renderSummary(outputs, { failures });
      toast(`Pistas procesadas: ${outputs.length} archivo(s) en ${format === 'audio/mpeg' ? 'MP3' : 'WAV'}.`, 'success');
    } else {
      toast('No se pudo procesar ninguna pista.', 'error');
    }
  }

  function renderSummary(outputs, stats) {
    els.summary.classList.remove('hidden');
    els.summaryTitle.textContent = `Pistas procesadas — ${outputs.length} archivo(s)`;
    const parts = [
      `Formato: ${document.querySelector('input[name="audio-format"]:checked').value === 'audio/mpeg' ? 'MP3 (lamejs)' : 'WAV PCM 16-bit'}.`,
    ];
    if (stats.failures) parts.push(`${stats.failures} pista(s) fallaron.`);
    parts.push(outputs.length > 1 ? 'Descarga en .zip automática.' : 'Descarga individual directa.');
    els.summaryDetail.textContent = parts.join(' ');
  }

  function hideSummary() {
    els.summary.classList.add('hidden');
    VMS.state.outputs.audio = [];
  }

  let downloading = false;

  async function handleDownload() {
    const outputs = VMS.state.outputs.audio;
    if (!outputs.length || downloading) return;
    downloading = true;
    els.download.disabled = true;
    const unbindProgress = VMS.bindProgress(els.download);
    try {
      const res = await VMSZipper.deliverOutputs(outputs, {
        forceZip: els.zipOn.checked,
        prefix: 'voidmedia-audio',
      });
      toast(res.mode === 'zip' ? `ZIP con ${res.count} pistas descargado.` : `Descargado: ${res.name}`, 'success');
    } catch (err) {
      toast(`Descarga fallida: ${err.message}`, 'error', 5000);
    } finally {
      unbindProgress();
      downloading = false;
      els.download.disabled = false;
    }
  }

  /* -------------------------------------------------------------------------
   * Init
   * ---------------------------------------------------------------------- */
  function init() {
    Object.assign(els, {
      dropzone: $('audio-dropzone'),
      input: $('audio-input'),
      queue: $('audio-queue'),
      count: $('audio-count'),
      process: $('audio-process'),
      clear: $('audio-clear'),
      summary: $('audio-summary'),
      summaryTitle: $('audio-summary-title'),
      summaryDetail: $('audio-summary-detail'),
      download: $('audio-download'),
      trimStart: $('audio-trim-start'),
      trimEnd: $('audio-trim-end'),
      gain: $('audio-gain'),
      gainOut: $('audio-gain-out'),
      fadeIn: $('audio-fade-in'),
      fadeOut: $('audio-fade-out'),
      normalize: $('audio-normalize'),
      reverse: $('audio-reverse'),
      speed: $('audio-speed'),
      speedOut: $('audio-speed-out'),
      kbps: $('audio-mp3-kbps'),
      kbpsOut: $('audio-mp3-kbps-out'),
      mp3Quality: $('audio-mp3-quality'),
      zipOn: $('audio-zip-on'),
    });

    VMS.setupDropzone({ zone: els.dropzone, input: els.input, onFiles: addFiles });

    // Ganancia: output en dB + relleno del range
    const paintRange = (range) => {
      const min = Number(range.min);
      const max = Number(range.max);
      const pct = ((Number(range.value) - min) / (max - min)) * 100;
      range.style.setProperty('--fill', `${pct}%`);
    };
    paintRange(els.gain);
    els.gain.addEventListener('input', () => {
      const v = parseFloat(els.gain.value);
      els.gainOut.textContent = `${v >= 0 ? '+' : ''}${v.toFixed(1)} dB`;
      paintRange(els.gain);
    });
    paintRange(els.kbps);
    els.kbps.addEventListener('input', () => {
      els.kbpsOut.textContent = `${els.kbps.value} kbps`;
      paintRange(els.kbps);
    });
    paintRange(els.speed);
    els.speed.addEventListener('input', () => {
      els.speedOut.textContent = `${parseFloat(els.speed.value).toFixed(2)}×`;
      paintRange(els.speed);
    });

    // Mostrar/ocultar calidad MP3 según formato elegido
    document.querySelectorAll('input[name="audio-format"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        const fmt = document.querySelector('input[name="audio-format"]:checked').value;
        els.mp3Quality.classList.toggle('hidden', fmt !== 'audio/mpeg');
      });
    });
    els.mp3Quality.classList.toggle(
      'hidden',
      document.querySelector('input[name="audio-format"]:checked').value !== 'audio/mpeg'
    );

    els.process.addEventListener('click', processAll);
    els.clear.addEventListener('click', clearAll);
    els.download.addEventListener('click', handleDownload);
    els.queue.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove]');
      if (btn) removeAt(Number(btn.dataset.remove));
    });

    renderQueue();
    hideSummary();
  }

  window.VMSModules = window.VMSModules || {};
  window.VMSModules.audio = { id: 'audio', init };
})();
