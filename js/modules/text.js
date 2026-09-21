/* ============================================================================
   VoidMedia Studio — js/modules/text.js
   Limpieza de lotes de texto/código 100% client-side:
   - Eliminar líneas vacías, recortar espacios, colapsar espacios múltiples.
   - Normalizar saltos a LF, tabulaciones → 4 espacios, sin línea final vacía.
   - Lote: pega texto o carga varios archivos; cada archivo se procesa por
     separado conservando su nombre.
   - Descarga simple o .zip automática vía VMSZipper.deliverOutputs().
   ========================================================================== */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {};

  const state = { files: [] }; // archivos cargados para procesamiento por lote
  let results = []; // { name, text, originalBytes, cleanedBytes }

  /* -------------------------------------------------------------------------
   * Núcleo de limpieza
   * ---------------------------------------------------------------------- */

  /**
   * Aplica las reglas activadas al contenido.
   * @param {string} src Texto de entrada.
   * @param {Object} o   { removeEmpty, collapseEmpty, trimLines, collapseSpaces,
   *                      dedupe, sortDir, noTrailingBlank, normalizeNl, tabsToSpaces }
   */
  function cleanText(src, o) {
    let t = src;

    if (o.normalizeNl) t = t.replace(/\r\n?/g, '\n');
    if (o.tabsToSpaces) t = t.replace(/\t/g, '    ');
    if (o.collapseSpaces) t = t.replace(/[ \t]{2,}/g, ' ');
    if (o.trimLines) t = t.split('\n').map((line) => line.trim()).join('\n');

    if (o.removeEmpty) {
      t = t.split('\n').filter((line) => line.trim() !== '').join('\n');
    } else if (o.collapseEmpty) {
      // Colapsar ráfagas de líneas vacías consecutivas a una sola
      const out = [];
      for (const line of t.split('\n')) {
        const isEmpty = line.trim() === '';
        if (isEmpty && out.length && out[out.length - 1].trim() === '') continue;
        out.push(line);
      }
      t = out.join('\n');
    }

    if (o.dedupe) {
      const seen = new Set();
      t = t
        .split('\n')
        .filter((line) => {
          if (seen.has(line)) return false;
          seen.add(line);
          return true;
        })
        .join('\n');
    }

    if (o.sortDir === 'asc' || o.sortDir === 'desc') {
      // Comparación natural: respeta acentos y números dentro del texto
      const coll = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
      const lines = t.split('\n').sort(coll.compare);
      if (o.sortDir === 'desc') lines.reverse();
      t = lines.join('\n');
    }

    if (o.noTrailingBlank) t = t.replace(/\n+$/, '');

    return t;
  }

  /* -------------------------------------------------------------------------
   * Render de resultados
   * ---------------------------------------------------------------------- */
  function renderResults() {
    els.resultsCount.textContent = String(results.length);
    els.download.disabled = results.length === 0;
    els.copy.disabled = results.length === 0;
    els.zip.disabled = results.length === 0;

    const list = els.results;
    if (!results.length) {
      list.innerHTML =
        '<p class="px-4 py-10 text-center text-xs text-zinc-600">Los textos limpios aparecerán aquí.</p>';
      return;
    }

    list.innerHTML = results
      .map((r, i) => {
        const saved = r.originalBytes
          ? Math.max(0, Math.round((1 - r.cleanedBytes / r.originalBytes) * 100))
          : 0;
        const lines = r.text.split('\n').length;
        const words = r.text.split(/\s+/).filter(Boolean).length;
        return `
        <div class="queue-row" data-index="${i}">
          <div class="queue-ico">TXT</div>
          <div class="queue-name">
            <div class="q-title">${VMS.escapeHtml(r.name)}</div>
            <div class="q-meta">${lines} líneas · ${words} palabras · ${VMS.formatBytes(r.originalBytes)} → ${VMS.formatBytes(r.cleanedBytes)} · −${saved}%</div>
          </div>
          <div class="flex items-center gap-1.5">
            <button class="btn-ghost btn-xs" data-view="${i}" type="button">Ver</button>
            <button class="row-remove" data-remove="${i}" type="button" title="Quitar" aria-label="Quitar ${VMS.escapeHtml(r.name)}">×</button>
          </div>
        </div>`;
      })
      .join('');
  }

  /** Muestra el resultado en el textarea de entrada (vista rápida). */
  function showResult(i) {
    const r = results[i];
    if (r) els.source.value = r.text;
  }

  /* -------------------------------------------------------------------------
   * Acciones
   * ---------------------------------------------------------------------- */

  function clean() {
    const sortRadio = document.querySelector('input[name="text-sort-dir"]:checked');
    const opts = {
      removeEmpty: els.rmEmpty.checked,
      collapseEmpty: els.collapseEmpty.checked,
      trimLines: els.trimLines.checked,
      collapseSpaces: els.collapse.checked,
      dedupe: els.dedupe.checked,
      sortDir: els.sort.checked ? (sortRadio ? sortRadio.value : 'asc') : null,
      noTrailingBlank: els.noTrailing.checked,
      normalizeNl: els.normalizeNl.checked,
      tabsToSpaces: els.tabs.checked,
    };

    if (state.files.length > 0) {
      processFileBatch(opts);
    } else {
      const src = els.source.value;
      if (!src.trim()) {
        toast('Pega o carga texto para limpiar.', 'error');
        return;
      }
      const out = cleanText(src, opts);
      results = [
        {
          name: 'cleaned.txt',
          text: out,
          originalBytes: new Blob([src]).size,
          cleanedBytes: new Blob([out]).size,
        },
      ];
      afterBatch();
    }
  }

  /** Procesa cada archivo cargado por separado, conservando su nombre. */
  async function processFileBatch(opts) {
    els.cleanBtn.disabled = true;
    results = [];
    try {
      for (const f of state.files) {
        const text = await VMS.readFileAsText(f);
        const out = cleanText(text, opts);
        results.push({
          name: f.name,
          text: out,
          originalBytes: new Blob([text]).size,
          cleanedBytes: new Blob([out]).size,
        });
      }
      afterBatch();
    } catch (err) {
      toast(`Error procesando el lote: ${err.message}`, 'error', 5000);
    } finally {
      els.cleanBtn.disabled = false;
    }
  }

  function afterBatch() {
    VMS.state.outputs.text = results.map((r) => ({
      name: r.name,
      blob: new Blob([r.text], { type: 'text/plain;charset=utf-8' }),
    }));
    renderResults();

    const totalOriginal = results.reduce((acc, r) => acc + r.originalBytes, 0);
    const totalCleaned = results.reduce((acc, r) => acc + r.cleanedBytes, 0);
    const saved = totalOriginal ? Math.round((1 - totalCleaned / totalOriginal) * 100) : 0;
    els.stats.textContent = `${results.length} elemento(s) · −${saved}% de tamaño total`;
    toast(`Limpieza lista: ${results.length} elemento(s).`, 'success');
  }

  function clearAll() {
    state.files = [];
    els.filesCount.textContent = '0';
    els.source.value = '';
    results = [];
    VMS.state.outputs.text = [];
    renderResults();
    els.stats.textContent = '';
  }

  async function loadFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    state.files = files;
    els.filesCount.textContent = String(files.length);

    // Precarga el primero en el textarea como referencia visual
    try {
      const first = await VMS.readFileAsText(files[0]);
      els.source.value = first;
    } catch (_) { /* noop */ }

    toast(
      `${files.length} archivo(s) cargado(s): se procesarán como lote conservando sus nombres.`,
      'success',
      4500
    );
  }

  async function handleDownload() {
    if (!results.length) return;
    const unbindProgress = VMS.bindProgress(els.download);
    try {
      const res = await VMSZipper.deliverOutputs(VMS.state.outputs.text, {
        forceZip: results.length > 3,
        prefix: 'voidmedia-text',
      });
      toast(
        res.mode === 'zip' ? `ZIP con ${res.count} textos descargado.` : `Descargado: ${res.name}`,
        'success'
      );
    } catch (err) {
      toast(`Descarga fallida: ${err.message}`, 'error', 5000);
    }
  }

  async function handleZip() {
    if (!results.length) {
      toast('Procesa algo primero.', 'error');
      return;
    }
    const unbindProgress = VMS.bindProgress(els.zip);
    try {
      await VMSZipper.downloadAsZip(
        VMS.state.outputs.text,
        `voidmedia-text-${new Date().toISOString().slice(0, 10)}.zip`
      );
      toast('ZIP descargado.', 'success');
    } catch (err) {
      toast(`ZIP fallido: ${err.message}`, 'error', 5000);
    } finally {
      unbindProgress();
    }
  }

  async function handleCopy() {
    if (!results.length) return;
    try {
      await navigator.clipboard.writeText(results.map((r) => r.text).join('\n\n'));
      toast('Texto limpio copiado al portapapeles.', 'success');
    } catch (err) {
      toast(`No se pudo copiar: ${err.message}`, 'error');
    }
  }

  /* -------------------------------------------------------------------------
   * Init
   * ---------------------------------------------------------------------- */
  function init() {
    Object.assign(els, {
      source: $('text-source'),
      filesCount: $('text-files-count'),
      results: $('text-results'),
      resultsCount: $('text-results-count'),
      rmEmpty: $('text-rm-empty'),
      collapseEmpty: $('text-collapse-empty'),
      trimLines: $('text-trim-lines'),
      collapse: $('text-collapse-spaces'),
      dedupe: $('text-dedupe'),
      sort: $('text-sort'),
      noTrailing: $('text-rm-trailing'),
      normalizeNl: $('text-normalize-nl'),
      tabs: $('text-tabs-to-spaces'),
      cleanBtn: $('text-clean'),
      download: $('text-download'),
      copy: $('text-copy'),
      zip: $('text-zip'),
      loadBtn: $('text-load-files'),
      input: $('text-input'),
      stats: $('text-stats'),
    });

    els.cleanBtn.addEventListener('click', clean);
    els.download.addEventListener('click', handleDownload);
    els.copy.addEventListener('click', handleCopy);
    els.zip.addEventListener('click', handleZip);
    els.loadBtn.addEventListener('click', () => els.input.click());
    els.input.addEventListener('change', () => {
      loadFiles(Array.from(els.input.files || []));
      els.input.value = '';
    });

    els.results.addEventListener('click', (e) => {
      const view = e.target.closest('[data-view]');
      if (view) showResult(Number(view.dataset.view));
      const rm = e.target.closest('[data-remove]');
      if (rm) {
        const i = Number(rm.dataset.remove);
        results.splice(i, 1);
        VMS.state.outputs.text.splice(i, 1);
        renderResults();
      }
    });

    renderResults();
  }

  window.VMSModules = window.VMSModules || {};
  window.VMSModules.text = { id: 'text', init };
})();
