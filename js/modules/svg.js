/* ============================================================================
   VoidMedia Studio — js/modules/svg.js
   Limpieza y optimización de código SVG 100% client-side:
   - Elimina comentarios, metadatos de editores, <title>/<desc>.
   - Minifica colapsando espacios entre etiquetas.
   - Redondeo opcional de decimales en atributos numéricos.
   - Acepta un SVG pegado o varios concatenados; resultados como lista
     descargable individualmente o empaquetados con JSZip.
   ========================================================================== */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const els = {};

  /** Extrae todos los bloques <svg>…</svg> de un texto libre. */
  function splitSvgs(text) {
    const re = /<svg\b[\s\S]*?<\/svg\s*>/gi;
    const found = text.match(re);
    return found && found.length ? found : text.trim() ? [text.trim()] : [];
  }

  /** Nombre sugerido para cada SVG del lote. */
  function svgName(i) {
    return `optimized-${String(i + 1).padStart(2, '0')}.svg`;
  }

  /* -------------------------------------------------------------------------
   * Núcleo de limpieza
   * ---------------------------------------------------------------------- */

  /**
   * Limpia/minifica un código SVG.
   * @param {string} src Código SVG de entrada.
   * @param {Object} o   Opciones { comments, metadata, titleDesc, minify, round, digits, editorAttrs, responsive }
   * @returns {{code:string, removed:number}}
   */
  function cleanSvg(src, o) {
    let code = src;
    let removed = 0;

    // 1) Comentarios
    if (o.comments) {
      code = code.replace(/<!--[\s\S]*?-->/g, () => {
        removed++;
        return '';
      });
    }

    // 2) Metadatos de editores y elementos de documentación
    if (o.metadata) {
      code = code.replace(
        /<metadata\b[\s\S]*?<\/metadata\s*>|<(?:sodipodi|inkscape):[^>]*>/g,
        () => {
          removed++;
          return '';
        }
      );
    }
    if (o.titleDesc) {
      code = code.replace(/<(?:title|desc)\b[\s\S]*?<\/(?:title|desc)\s*>/g, () => {
        removed++;
        return '';
      });
    }

    // 2b) Atributos de editores: data-name=*, inkscape:*=*, sodipodi:*=*.
    // Los aria-* no se tocan (accesibilidad).
    if (o.editorAttrs) {
      code = code.replace(
        /\s(?:inkscape|sodipodi):[\w-]+\s*=\s*"[^"]*"|\sdata-name\s*=\s*"[^"]*"/g,
        () => {
          removed++;
          return '';
        }
      );
    }

    // 2c) Responsive: quitar TODOS los width/height fijos de la etiqueta
    // <svg> conservando viewBox (recomendado por MDN para SVGs que escalan
    // con su contenedor).
    if (o.responsive) {
      code = code.replace(/<svg\b[^>]*>/gi, (tag) =>
        tag.replace(/\s(?:width|height)\s*=\s*"[^"]*"/gi, '')
      );
    }

    // 3) Redondeo de números largos en atributos y estilos inline
    if (o.round) {
      const d = Math.max(0, Math.min(6, o.digits | 0));
      const re = /(-?\d+\.\d{3,})(\d*)/g;
      code = code.replace(re, (m, intPart) => {
        const rounded = Number(intPart).toFixed(d);
        return rounded.replace(/\.?0+$/, '') || '0';
      });
    }

    // 4) Minificar (protege <style> y <text>)
    if (o.minify) {
      code = minifySvg(code);
    }

    return { code, removed };
  }

  /**
   * Minificador consciente del contenido: no colapsa espacios dentro de
   * <style> ni <text>/<tspan> (donde el whitespace es significativo).
   */
  function minifySvg(code) {
    const protectedRe = /<(style|text)\b[^>]*>[\s\S]*?<\/\1\s*>/gi;
    const chunks = [];
    let out = code.replace(protectedRe, (m) => {
      chunks.push(m);
      return `\u0000${chunks.length - 1}\u0000`;
    });
    out = out
      .replace(/>\s+</g, '><')
      .replace(/\s{2,}/g, ' ')
      .trim();
    // Colapsar también el whitespace junto a los chunks protegidos:
    // los placeholders son elementos completos (<style>…, <text>…), así que
    // el espacio entre ellos y lo demás es ignorable.
    out = out
      .replace(/\s*(\u0000\d+\u0000)\s*/g, '$1')
      .trim();
    return out.replace(/\u0000(\d+)\u0000/g, (m, i) => chunks[Number(i)]);
  }

  /* -------------------------------------------------------------------------
   * Estado y render
   * ---------------------------------------------------------------------- */
  let results = []; // { name, code, originalBytes, cleanedBytes, removed }

  function renderResults() {
    els.count.textContent = String(results.length);
    els.zip.disabled = results.length < 1;
    els.download.disabled = results.length < 1;
    els.copy.disabled = results.length < 1;

    const list = els.results;
    if (!results.length) {
      list.innerHTML = '<p class="px-4 py-10 text-center text-xs text-zinc-600">Los SVG optimizados aparecerán aquí.</p>';
      return;
    }

    list.innerHTML = results
      .map((r, i) => {
        const saved = r.originalBytes
          ? Math.max(0, Math.round((1 - r.cleanedBytes / r.originalBytes) * 100))
          : 0;
        return `
        <div class="queue-row" data-index="${i}">
          <div class="svg-result-thumb">${r.code}</div>
          <div class="queue-name">
            <div class="q-title">${VMS.escapeHtml(r.name)}</div>
            <div class="q-meta">${VMS.formatBytes(r.originalBytes)} → ${VMS.formatBytes(r.cleanedBytes)} · −${saved}% · ${r.removed} nodo(s) eliminado(s)</div>
          </div>
          <div class="flex items-center gap-1.5">
            <button class="btn-ghost btn-xs" data-view="${i}" type="button">Ver</button>
            <button class="row-remove" data-remove="${i}" type="button" title="Quitar" aria-label="Quitar ${VMS.escapeHtml(r.name)}">×</button>
          </div>
        </div>`;
      })
      .join('');
  }

  function showPreview(code) {
    els.preview.innerHTML = code || 'Sin vista previa.';
  }

  /* -------------------------------------------------------------------------
   * Acciones
   * ---------------------------------------------------------------------- */

  function clean() {
    const src = els.source.value;
    if (!src.trim()) {
      toast('Pega o carga un código SVG primero.', 'error');
      return;
    }

    const opts = {
      comments: els.comments.checked,
      metadata: els.metadata.checked,
      titleDesc: els.titleDesc.checked,
      minify: els.minify.checked,
      round: els.round.checked,
      digits: parseInt(els.digits.value, 10) || 2,
      editorAttrs: els.editorAttrs.checked,
      responsive: els.responsive.checked,
    };

    const chunks = splitSvgs(src);
    results = [];
    let totalRemoved = 0;

    chunks.forEach((chunk, i) => {
      const originalBytes = new Blob([chunk]).size;
      const { code, removed } = cleanSvg(chunk, opts);
      const cleanedBytes = new Blob([code]).size;
      totalRemoved += removed;

      results.push({
        name: chunks.length > 1 ? svgName(i) : 'optimized.svg',
        code,
        originalBytes,
        cleanedBytes,
        removed,
      });
    });

    VMS.state.outputs.svg = results.map((r) => ({
      name: r.name,
      blob: new Blob([r.code], { type: 'image/svg+xml' }),
    }));

    renderResults();
    showPreview(results[0].code);
    els.stats.textContent = `${chunks.length} SVG · ${totalRemoved} nodo(s) eliminado(s)`;
    toast(`Optimización lista: ${results.length} SVG · ${totalRemoved} nodo(s) menos.`, 'success');
  }

  function clearSource() {
    els.source.value = '';
    results = [];
    VMS.state.outputs.svg = [];
    renderResults();
    showPreview('');
    els.stats.textContent = '';
  }

  async function loadFiles(fileList) {
    const files = Array.from(fileList || []).filter(
      (f) => VMS.extOf(f.name) === 'svg' || f.type === 'image/svg+xml'
    );
    if (!files.length) {
      toast('No se detectaron archivos .svg válidos.', 'error');
      return;
    }
    const texts = await Promise.all(files.map((f) => VMS.readFileAsText(f)));
    const joined = texts.join('\n');
    els.source.value = els.source.value ? `${els.source.value}\n${joined}` : joined;
    toast(`${files.length} archivo(s) .svg cargado(s) en el editor.`, 'success');
    clean();
  }

  async function handleDownload() {
    if (!results.length) return;
    const unbindProgress = VMS.bindProgress(els.download);
    try {
      const res = await VMSZipper.deliverOutputs(VMS.state.outputs.svg, {
        forceZip: results.length > 3,
        prefix: 'voidmedia-svg',
      });
      toast(res.mode === 'zip' ? `ZIP con ${res.count} SVG descargado.` : `Descargado: ${res.name}`, 'success');
    } catch (err) {
      toast(`Descarga fallida: ${err.message}`, 'error', 5000);
    } finally {
      unbindProgress();
    }
  }

  async function handleZip() {
    if (!results.length) return;
    const unbindProgress = VMS.bindProgress(els.zip);
    try {
      await VMSZipper.downloadAsZip(VMS.state.outputs.svg, `voidmedia-svg-${new Date().toISOString().slice(0, 10)}.zip`);
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
      await navigator.clipboard.writeText(results.map((r) => r.code).join('\n'));
      toast('Código copiado al portapapeles.', 'success');
    } catch (err) {
      toast(`No se pudo copiar: ${err.message}`, 'error');
    }
  }

  /* -------------------------------------------------------------------------
   * Init
   * ---------------------------------------------------------------------- */
  function init() {
    Object.assign(els, {
      source: $('svg-source'),
      comments: $('svg-strip-comments'),
      metadata: $('svg-strip-metadata'),
      titleDesc: $('svg-strip-title-desc'),
      editorAttrs: $('svg-strip-editor-attrs'),
      responsive: $('svg-responsive'),
      minify: $('svg-minify'),
      round: $('svg-round'),
      digits: $('svg-round-digits'),
      clean: $('svg-clean'),
      download: $('svg-download'),
      copy: $('svg-copy'),
      zip: $('svg-zip'),
      count: $('svg-count'),
      results: $('svg-results'),
      preview: $('svg-preview'),
      stats: $('svg-stats'),
      loadBtn: $('svg-load-files'),
      input: $('svg-input'),
      clearBtn: $('svg-clear-src'),
    });

    els.clean.addEventListener('click', clean);
    els.download.addEventListener('click', handleDownload);
    els.zip.addEventListener('click', handleZip);
    els.copy.addEventListener('click', handleCopy);
    els.clearBtn.addEventListener('click', clearSource);
    els.loadBtn.addEventListener('click', () => els.input.click());
    els.input.addEventListener('change', () => {
      loadFiles(Array.from(els.input.files || []));
      els.input.value = '';
    });

    // Redondeo: habilitar/deshabilitar dígitos
    els.round.addEventListener('change', () => {
      els.digits.disabled = !els.round.checked;
    });

    // Vista previa al hacer clic en "Ver"
    els.results.addEventListener('click', (e) => {
      const view = e.target.closest('[data-view]');
      if (view) showPreview(results[Number(view.dataset.view)].code);
      const rm = e.target.closest('[data-remove]');
      if (rm) {
        results.splice(Number(rm.dataset.remove), 1);
        VMS.state.outputs.svg.splice(Number(rm.dataset.remove), 1);
        renderResults();
        showPreview(results[0] ? results[0].code : '');
      }
    });

    renderResults();
  }

  window.VMSModules = window.VMSModules || {};
  window.VMSModules.svg = { id: 'svg', init };
})();
