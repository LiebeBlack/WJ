/* ============================================================================
   VoidMedia Studio — js/utils/zipper.js
   Utilidad de empaquetado con JSZip y descargas inteligentes.
   - downloadBlob(): descarga directa de un Blob.
   - deliverOutputs(): decide automáticamente entre descarga simple o .zip
     según la cantidad de archivos (regla: >1 → zip, salvo override).
   - uniqueify()/dedupeNames(): evita colisiones de nombre en un mismo lote
     (dos "foto.png" → "foto.png" y "foto-2.png").
   ========================================================================== */

(function () {
  'use strict';

  /** Descarga un Blob con el nombre indicado mediante un <a> efímero. */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'download';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /** Convierte un Blob a dataURL (Promise<string>). */
  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error('FileReader falló'));
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Empaqueta outputs en un .zip y lo descarga.
   * @param {Array<{name:string, blob:Blob}>} outputs
   * @param {string} zipName  Nombre del archivo .zip
   */
  async function downloadAsZip(outputs, zipName) {
    if (typeof JSZip === 'undefined') {
      throw new Error('JSZip no está disponible (¿CDN bloqueado o sin conexión?)');
    }
    const zip = new JSZip();
    // Dedupe: dos entradas con el mismo nombre pisarían una a otra en el zip.
    const names = uniqueify(outputs.map((o) => o.name));
    outputs.forEach((out, i) => {
      zip.file(names[i], out.blob);
    });
    const blob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      (meta) => {
        if (window.VMS && typeof window.VMS.updateProgress === 'function') {
          window.VMS.updateProgress(Math.round(meta.percent));
        }
      }
    );
    downloadBlob(blob, zipName || 'voidmedia-output.zip');
    return blob;
  }

  /**
   * Entrega resultados: zip automático si hay más de un archivo y el usuario
   * no forzó lo contrario.
   * @param {Array<{name:string, blob:Blob}>} outputs
   * @param {Object} opts
   * @param {boolean} [opts.forceZip]         Forzar zip aunque sea 1 archivo.
   * @param {boolean} [opts.neverZip]         Nunca zip (aunque sean varios).
   * @param {string}  [opts.zipName]          Nombre del zip.
   * @param {string}  [opts.prefix]           Prefijo para el nombre del zip.
   */
  async function deliverOutputs(outputs, opts = {}) {
    if (!outputs || outputs.length === 0) throw new Error('No hay resultados que descargar.');

    const many = outputs.length > 1;
    const useZip = opts.neverZip ? false : (opts.forceZip || many);

    if (useZip) {
      const stamp = new Date().toISOString().slice(0, 10);
      const name = opts.zipName || `${opts.prefix || 'voidmedia'}-${stamp}.zip`;
      await downloadAsZip(outputs, name);
      return { mode: 'zip', count: outputs.length, name };
    }

    await downloadBlob(outputs[0].blob, outputs[0].name);
    return { mode: 'single', count: 1, name: outputs[0].name };
  }

  /** Nombre de archivo seguro: sin rutas, caracteres raros, colisiones. */
  function safeName(name) {
    let n = String(name || 'file')
      .replace(/[\\/]+/g, '-')
      .replace(/[\u0000-\u001f<>:"|?*]/g, '')
      .trim();
    if (!n || n === '.') n = 'file';
    return n;
  }

  /** Devuelve name con otra extensión. */
  function withExt(name, newExt) {
    const base = safeName(name).replace(/\.[^./\\]+$/, '') || 'file';
    return `${base}.${newExt.replace(/^\./, '')}`;
  }

  /** Evita duplicados dentro de una misma tanda: foto.png → foto-2.png */
  function uniqueify(names) {
    const seen = Object.create(null);
    return names.map((raw) => {
      const n = safeName(raw);
      seen[n] = (seen[n] || 0) + 1;
      return seen[n] === 1 ? n : n.replace(/(\.[^.]*)?$/, (ext) => `-${seen[n]}${ext || ''}`);
    });
  }

  /** Alias semántico para claridad en módulos que solo deduplican. */
  const dedupeNames = uniqueify;

  window.VMSZipper = {
    downloadBlob,
    blobToDataURL,
    downloadAsZip,
    deliverOutputs,
    safeName,
    withExt,
    uniqueify,
    dedupeNames,
  };
})();
