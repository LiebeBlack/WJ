/* ============================================================================
   VoidMedia Studio — js/modules/images.js
   Conversión masiva de imágenes 100% client-side:
   - Salida: WebP / JPEG / PNG / AVIF, o «Todo» (las 4 variantes por imagen).
   - Compresión por calidad (canvas.toBlob con quality).
   - Redimensionado por canvas manteniendo proporción (fit, nunca amplía).
   - EXIF: el re-codificado vía canvas elimina inherentemente EXIF/otros
     metadatos; se detecta el marcador APP1 en la entrada para avisar al usuario.
   - Descarga simple o .zip automática vía VMSZipper.deliverOutputs().
   ========================================================================== */

(function () {
  'use strict';

  /* -------------------------------------------------------------------------
   * Referencias DOM
   * ---------------------------------------------------------------------- */
  const $ = (id) => document.getElementById(id);
  const els = {};

  const EXT_FOR = {
    'image/webp': 'webp',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/avif': 'avif',
  };

  /** MIMES objetivo según el radio seleccionado. */
  function targetFormats() {
    const checked = document.querySelector('input[name="img-format"]:checked');
    const value = checked ? checked.value : 'image/webp';
    return value === 'all'
      ? ['image/webp', 'image/jpeg', 'image/png', 'image/avif']
      : [value];
  }

  /**
   * Comprueba si el navegador puede codificar a un MIME dado
   * (AVIF, por ejemplo, no está soportado en todos los navegadores).
   * @returns {Promise<boolean>}
   */
  function canEncode(mime) {
    return new Promise((resolve) => {
      try {
        const c = document.createElement('canvas');
        c.width = 2;
        c.height = 2;
        c.toBlob((b) => resolve(!!b && b.type === mime), mime, 0.8);
      } catch (_) {
        resolve(false);
      }
    });
  }

  /** Cola en memoria: { file, url, results? } — results se rellena al procesar */
  let queue = [];

  /* -------------------------------------------------------------------------
   * UI: cola
   * ---------------------------------------------------------------------- */
  function renderQueue() {
    const list = els.queue;
    els.count.textContent = String(queue.length);
    els.process.disabled = queue.length === 0;

    if (queue.length === 0) {
      list.innerHTML =
        '<p class="px-4 py-10 text-center text-xs text-zinc-600" data-empty-state>Aún no hay imágenes en la cola.</p>';
      return;
    }

    list.innerHTML = queue
      .map((item, i) => {
        // Badges por archivo: una por cada variante generada en el último procesado
        let badges = '';
        if (item.results && item.results.length) {
          badges =
            '<div class="out-badges">' +
            item.results
              .map((r) => {
                const pct = r.from > 0 ? Math.round((1 - r.to / r.from) * 100) : 0;
                const cls = pct >= 5 ? ' is-good' : pct >= 0 ? '' : ' is-warn';
                const ext = (EXT_FOR[r.mime] || '?').toUpperCase();
                return `<span class="out-badge${cls}" title="${VMS.escapeHtml(r.name)} · ${VMS.formatBytes(r.from)} → ${VMS.formatBytes(r.to)}">${ext} −${Math.max(0, pct)}%</span>`;
              })
              .join('') +
            '</div>';
        }
        return `
      <div class="queue-row" data-index="${i}">
        <img class="queue-thumb" src="${item.url}" alt="" loading="lazy" />
        <div class="queue-name">
          <div class="q-title">${VMS.escapeHtml(item.file.name)}</div>
          <div class="q-meta">${VMS.formatBytes(item.file.size)} · ${VMS.extOf(item.file.name) || 'desconocido'}</div>
          ${badges}
        </div>
        <button class="row-remove" type="button" data-remove="${i}" title="Quitar" aria-label="Quitar ${VMS.escapeHtml(item.file.name)}">×</button>
      </div>`;
      })
      .join('');
  }

  function addFiles(fileList) {
    const files = Array.from(fileList || []).filter(
      (f) => f.type.startsWith('image/') || ALL_EXTS.includes(VMS.extOf(f.name))
    );
    if (!files.length) {
      toast('No se detectaron imágenes compatibles. Revisa el panel «Compatibilidad de formatos».', 'error', 5000);
      return;
    }
    queue.push(...files.map((f) => ({ file: f, url: URL.createObjectURL(f) })));
    renderQueue();
    toast(`${files.length} imagen(es) añadida(s) a la cola.`, 'success');
  }

  function removeAt(i) {
    const [item] = queue.splice(i, 1);
    if (item) URL.revokeObjectURL(item.url);
    renderQueue();
  }

  function clearAll() {
    queue.forEach((it) => URL.revokeObjectURL(it.url));
    queue = [];
    renderQueue();
    hideSummary();
  }

  /* -------------------------------------------------------------------------
   * Núcleo de conversión
   * ---------------------------------------------------------------------- */

  /**
   * Decodifica un Blob de imagen a un canvas.
   * Usa createImageBitmap con imageOrientation:'from-image' para respetar la
   * rotación EXIF; hace fallback a <img> si no está disponible.
   */
  async function decodeToCanvas(file) {
    if (window.createImageBitmap) {
      try {
        const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close();
        return c;
      } catch (_) {
        /* fallback abajo */
      }
    }

    // Fallback universal
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('No se pudo decodificar la imagen'));
        im.src = url;
      });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return c;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Dimensiones destino según el modo:
   * - fit:     la imagen entra completa dentro del límite (nunca amplía).
   * - stretch: dimensiones exactas pedidas (deforma si cambia el ratio).
   */
  function computeDims(sw, sh, opts) {
    if (!opts.resizeOn || (!opts.maxW && !opts.maxH)) {
      return { w: sw, h: sh, resized: false };
    }
    if (opts.stretch) {
      const w = opts.maxW > 0 ? opts.maxW : sw;
      const h = opts.maxH > 0 ? opts.maxH : sh;
      return { w, h, resized: w !== sw || h !== sh };
    }
    const maxW = opts.maxW > 0 ? opts.maxW : Infinity;
    const maxH = opts.maxH > 0 ? opts.maxH : Infinity;
    const scale = Math.min(1, maxW / sw, maxH / sh); // nunca amplía
    return {
      w: Math.max(1, Math.round(sw * scale)),
      h: Math.max(1, Math.round(sh * scale)),
      resized: scale < 1,
    };
  }

  /** Escala un canvas a (w,h) con smoothing de alta calidad. */
  function scaleCanvas(src, w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, h);
    return c;
  }

  /** Aplana la transparencia sobre negro (necesario para JPEG). */
  function flattenAlpha(canvas) {
    const ctx = canvas.getContext('2d');
    ctx.globalCompositeOperation = 'destination-over';
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
    return canvas;
  }

  /** Codifica un canvas al MIME dado con la calidad elegida. */
  function encodeCanvas(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new Error(`El navegador no pudo codificar a ${mime}`));
        },
        mime,
        mime === 'image/png' ? undefined : quality
      );
    });
  }

  /**
   * Devuelve true si el buffer contiene un segmento EXIF (APP1 en JPEG,
   * o firma textual en PNG/WebP/AVIF). El re-codificado vía canvas elimina
   * estos metadatos; esto sirve para el aviso informativo de la UI.
   */
  function hasExif(buffer) {
    const b = new Uint8Array(buffer);
    // JPEG: buscar marcador APP1 (0xFFE1) + cabecera "Exif\0\0"
    if (b[0] === 0xff && b[1] === 0xd8) {
      for (let i = 2; i < b.length - 9; ) {
        if (b[i] !== 0xff) break;
        const marker = b[i + 1];
        const len = (b[i + 2] << 8) | b[i + 3];
        if (
          marker === 0xe1 &&
          b[i + 4] === 0x45 && b[i + 5] === 0x78 && // "Ex"
          b[i + 6] === 0x69 && b[i + 7] === 0x66    // "if"
        ) {
          return true;
        }
        if (marker === 0xda) break; // SOS: empiezan los datos de imagen
        i += 2 + len;
      }
      return false;
    }
    // PNG/WEBP/AVIF: heurística por firma en los primeros 256 KB
    try {
      const s = new TextDecoder('latin1').decode(b.subarray(0, Math.min(b.length, 256 * 1024)));
      return /Exif/i.test(s);
    } catch (_) {
      return false;
    }
  }

  /** Genera un nombre único para cada variante de salida. */
  function buildName(originalName, mime, suffix) {
    return VMSZipper.uniqueify([`${VMS.basename(originalName)}${suffix}.${EXT_FOR[mime]}`])[0];
  }

  /* =========================================================================
   * v1.2 — Compatibilidad ampliada de formatos de entrada
   *
   * Tres niveles honestos:
   *   native   → lo decodifica el navegador (createImageBitmap / <img>).
   *   ondemand → decodificador JS/WASM cargado desde CDN solo al procesar
   *              ese formato (el archivo nunca sale del dispositivo).
   *   broken   → no existe decodificación 100% local viable en navegador.
   * ======================================================================= */

  const FORMAT_COMPAT = [
    {
      group: '1 · Ráster estándar (los clásicos)',
      formats: [
        { exts: ['jpg', 'jpeg', 'jfif'], label: 'JPEG', kind: 'native' },
        { exts: ['png'], label: 'PNG', kind: 'native' },
        { exts: ['gif'], label: 'GIF', kind: 'native' },
        { exts: ['bmp', 'dib'], label: 'BMP', kind: 'native' },
        { exts: ['tif', 'tiff'], label: 'TIFF', kind: 'ondemand', lib: 'utif' },
        { exts: ['webp'], label: 'WebP', kind: 'native' },
        { exts: ['avif'], label: 'AVIF', kind: 'native' },
      ],
    },
    {
      group: '2 · Modernos de alta eficiencia',
      formats: [
        { exts: ['jxl'], label: 'JPEG XL', kind: 'ondemand', lib: 'jxl' },
        { exts: ['heic', 'heif', 'hif', 'avci'], label: 'HEIF/HEIC', kind: 'ondemand', lib: 'heic' },
      ],
    },
    {
      group: '3 · Vectoriales',
      formats: [
        { exts: ['svg'], label: 'SVG', kind: 'native' },
        {
          exts: ['ai', 'eps', 'cdr'],
          label: 'EPS · AI · CDR',
          kind: 'broken',
          note: 'Los vectores cerrados (EPS/AI/CDR) requieren el programa de origen. Exporta a SVG o PNG y vuelve aquí.',
        },
      ],
    },
    {
      group: '4 · RAW de cámara (previsualización incrustada)',
      formats: [
        {
          exts: ['dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'orf', 'rw2', 'raf', 'pef', 'srw', 'x3f'],
          label: 'RAW · DNG · CR2/CR3 · NEF · ARW · ORF · RW2…',
          kind: 'ondemand',
          lib: 'raw',
          note: 'Se procesa la previsualización JPEG incrustada en el RAW (lo mismo que muestra el visor de tu cámara). Si el archivo no la trae, se notifica.',
        },
      ],
    },
    {
      group: '5 · Especiales, animados y HDR',
      formats: [
        { exts: ['ico', 'cur'], label: 'ICO', kind: 'native' },
        { exts: ['tga'], label: 'TGA', kind: 'ondemand', lib: 'tga' },
        { exts: ['hdr', 'pic'], label: 'HDR (Radiance)', kind: 'ondemand', lib: 'hdr' },
        { exts: ['exr', 'pfm'], label: 'EXR / PFM', kind: 'ondemand', lib: 'exr' },
        {
          exts: ['apng'],
          label: 'APNG',
          kind: 'broken',
          note: 'Los navegadores solo decodifican el primer fotograma de un APNG. Renómbralo a .png si te sirve el fotograma 1.',
        },
      ],
    },
  ];

  const RAW_EXTS = new Set([
    'dng', 'cr2', 'cr3', 'nef', 'nrw', 'arw', 'srf', 'sr2',
    'orf', 'rw2', 'raf', 'pef', 'srw', 'x3f',
  ]);

  const ALL_EXTS = Array.from(
    new Set(FORMAT_COMPAT.flatMap((g) => g.formats.flatMap((f) => f.exts)))
  );

  /** Métrica de firma (magic bytes) para detectar el formato real. */
  function detectKindBySignature(u8) {
    if (u8.length >= 12) {
      const ascii = (from, to) => String.fromCharCode(...u8.slice(from, to));
      // TIFF: "II*\x00" o "MM\x00*"
      if (
        (u8[0] === 0x49 && u8[1] === 0x49 && u8[2] === 0x2a) ||
        (u8[0] === 0x4d && u8[1] === 0x4d && u8[2] === 0x00)
      ) {
        return 'tiff';
      }
      // ISO BMFF (cajas HEIC/HEIF/AVIF): "ftyp" en offset 4
      if (ascii(4, 8) === 'ftyp') return 'heif';
      // EXR: 0x76 0x2f 0x31 0x01
      if (u8[0] === 0x76 && u8[1] === 0x2f && u8[2] === 0x31 && u8[3] === 0x01) return 'exr';
      // HDR Radiance: "#?RADIANCE" o "#?RGBE"
      if (ascii(0, 10).startsWith('#?RADIANCE') || ascii(0, 7) === '#?RGBE=') return 'hdr';
      // TGA: firma opcional al final del archivo
      if (u8.length >= 18 && ascii(u8.length - 18).startsWith('TRUEVISION-XFILE.')) return 'tga';
    }
    return null;
  }

  /** Resuelve la estrategia de decodificación para un archivo. */
  async function resolveStrategy(file) {
    const ext = VMS.extOf(file.name);
    let head = null;
    try {
      head = new Uint8Array(await VMS.readFileAsArrayBuffer(file.slice(0, 64)));
    } catch (_) { /* noop */ }
    const sig = head ? detectKindBySignature(head) : null;

    // RAW por extensión
    if (RAW_EXTS.has(ext)) {
      return { kind: 'ondemand', lib: 'raw', ext, label: 'RAW' };
    }
    // Tabla por extensión
    for (const grp of FORMAT_COMPAT) {
      for (const f of grp.formats) {
        if (f.exts.includes(ext)) {
          return { kind: f.kind, lib: f.lib, ext, label: f.label, note: f.note || null };
        }
      }
    }
    // Sin extensión conocida → confiar en la firma
    if (sig === 'tiff') return { kind: 'ondemand', lib: 'utif', ext, label: 'TIFF' };
    if (sig === 'tga') return { kind: 'ondemand', lib: 'utif', ext, label: 'TGA' };
    if (sig === 'hdr') return { kind: 'ondemand', lib: 'hdr', ext, label: 'HDR' };
    if (sig === 'exr') return { kind: 'ondemand', lib: 'exr', ext, label: 'EXR' };
    if (sig === 'heif') return { kind: 'ondemand', lib: 'heic', ext, label: 'HEIF/HEIC' };
    if (sig === 'tga') return { kind: 'ondemand', lib: 'tga', ext, label: 'TGA' };
    // Última oportunidad: dejar que el navegador lo intente (MIME image/*)
    return {
      kind: file.type && file.type.startsWith('image/') ? 'native' : 'broken',
      ext,
      label: (ext || 'desconocido').toUpperCase(),
    };
  }

  /* ---- Carga perezosa de decodificadores (single-flight) ---------------- */

  const _decoders = {};

  function loadScriptOnce(key, url) {
    if (!_decoders[key]) {
      _decoders[key] = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => resolve();
        s.onerror = () => {
          delete _decoders[key];
          reject(new Error('No se pudo cargar el decodificador para este formato (¿sin conexión?)'));
        };
        document.head.appendChild(s);
      });
    }
    return _decoders[key];
  }

  async function ensureDecoder(lib) {
    switch (lib) {
      case 'tga':
        return null; // decodificador local, nada que cargar
      case 'utif':
        await loadScriptOnce('utif', 'https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js');
        if (typeof UTIF === 'undefined') throw new Error('El decodificador TIFF/TGA no está disponible.');
        return UTIF;
      case 'jxl':
        await loadScriptOnce('jxl', 'https://cdn.jsdelivr.net/npm/jxl-decoder@0.0.5/dist/jxl_decoder.min.js');
        if (!window.jxlDecoder) throw new Error('El decodificador JPEG XL no está disponible.');
        return window.jxlDecoder;
      case 'heic':
        await loadScriptOnce('heic', 'https://cdn.jsdelivr.net/npm/heic2any@0.0.4/dist/heic2any.min.js');
        if (typeof heic2any === 'undefined') throw new Error('El decodificador HEIC/HEIF no está disponible.');
        return heic2any;
      case 'exr':
        if (!('ImageDecoder' in window)) {
          throw new Error('Este navegador no soporta ImageDecoder (necesario para EXR).');
        }
        return window.ImageDecoder;
      case 'hdr':
        if (typeof parseHdr === 'undefined') {
          await loadScriptOnce('hdr', 'js/modules/decoders/hdr.js');
        }
        if (typeof parseHdr === 'undefined') throw new Error('El decodificador HDR no está disponible.');
        return parseHdr;
      default:
        throw new Error('Formato sin decodificador.');
    }
  }

  /* ---- Decodificadores concretos ---------------------------------------- */

  /** Convierte píxeles RGBA de 8 bits en un canvas. */
  function rgbaToCanvas(rgba, width, height) {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const clamped =
      rgba instanceof Uint8ClampedArray
        ? rgba
        : new Uint8ClampedArray(rgba.buffer || rgba, rgba.byteOffset || 0, rgba.length);
    c.getContext('2d').putImageData(new ImageData(clamped, width, height), 0, 0);
    return c;
  }

  /** TIFF (multi-página: usa la página 1), vía UTIF. */
  async function decodeWithUtif(file) {
    await ensureDecoder('utif');
    const ab = await VMS.readFileAsArrayBuffer(file);
    const ifds = UTIF.decode(ab);
    if (!ifds.length) throw new Error('TIFF sin páginas decodificables.');
    UTIF.decodeImage(ab, ifds[0], ifds);
    const rgba = UTIF.toRGBA8(ifds[0]);
    return rgbaToCanvas(rgba, ifds[0].width, ifds[0].height);
  }

  /**
   * TGA (Truevision) — parser local sin dependencias.
   * Soporta: tipos 2 (RGB sin comprimir), 3 (escala de grises),
   * 10 (RGB RLE) y 11 (grises RLE), con profundidades 16/24/32.
   */
  async function decodeTGA(file) {
    const ab = await VMS.readFileAsArrayBuffer(file);
    const u8 = new Uint8Array(ab);
    if (u8.length < 18) throw new Error('TGA: archivo demasiado corto.');
    const idLen = u8[0];
    const cmapType = u8[1];
    const imgType = u8[2];
    const w = u8[12] | (u8[13] << 8);
    const h = u8[14] | (u8[15] << 8);
    const depth = u8[16];
    const desc = u8[17];
    if (!w || !h) throw new Error('TGA: dimensiones inválidas.');

    let pos = 18 + idLen;
    // Saltar la paleta de color si existe
    if (cmapType === 1) {
      const cmapLen = u8[5] | (u8[6] << 8);
      const cmapEntryBits = u8[7];
      pos += cmapLen * (cmapEntryBits >> 3);
    }

    const total = w * h;
    const rgba = new Uint8Array(total * 4);
    const setPx = (i, b, g, r, a) => {
      const o = i * 4;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = a;
    };

    if (imgType === 2 || imgType === 3) {
      // Sin compresión
      for (let i = 0; i < total; i++) {
        if (imgType === 3) {
          const g8 = u8[pos++];
          setPx(i, g8, g8, g8, 255);
        } else if (depth === 32) {
          setPx(i, u8[pos], u8[pos + 1], u8[pos + 2], u8[pos + 3]);
          pos += 4;
        } else if (depth === 24) {
          setPx(i, u8[pos], u8[pos + 1], u8[pos + 2], 255);
          pos += 3;
        } else if (depth === 16) {
          const v = u8[pos] | (u8[pos + 1] << 8);
          pos += 2;
          setPx(i, (v & 31) << 3, ((v >> 5) & 31) << 3, ((v >> 10) & 31) << 3, 255);
        } else {
          throw new Error(`TGA: profundidad ${depth} bits no soportada.`);
        }
      }
    } else if (imgType === 10 || imgType === 11) {
      // RLE
      let i = 0;
      while (i < total) {
        const pkt = u8[pos++];
        const count = (pkt & 0x7f) + 1;
        if (pkt & 0x80) {
          // Paquete RLE: un valor repetido count veces
          let b = 0, g = 0, r = 0, a = 255;
          if (imgType === 11) {
            b = g = r = u8[pos++];
          } else if (depth === 32) {
            b = u8[pos]; g = u8[pos + 1]; r = u8[pos + 2]; a = u8[pos + 3];
            pos += 4;
          } else {
            b = u8[pos]; g = u8[pos + 1]; r = u8[pos + 2];
            pos += 3;
          }
          for (let k = 0; k < count && i < total; k++, i++) setPx(i, b, g, r, a);
        } else {
          // Paquete bruto: count valores literales
          for (let k = 0; k < count && i < total; k++, i++) {
            if (imgType === 11) {
              const g8 = u8[pos++];
              setPx(i, g8, g8, g8, 255);
            } else if (depth === 32) {
              setPx(i, u8[pos], u8[pos + 1], u8[pos + 2], u8[pos + 3]);
              pos += 4;
            } else {
              setPx(i, u8[pos], u8[pos + 1], u8[pos + 2], 255);
              pos += 3;
            }
          }
        }
      }
    } else {
      throw new Error(`TGA: tipo de imagen ${imgType} no soportado (usa RGB o escala de grises).`);
    }

    // Bit 0x20 = origen arriba-izquierda; si no está, las filas van de abajo hacia arriba
    if (!(desc & 0x20)) {
      const row = w * 4;
      const flipped = new Uint8ClampedArray(rgba.length);
      for (let y = 0; y < h; y++) {
        flipped.set(rgba.subarray((h - 1 - y) * row, (h - y) * row), y * row);
      }
      return rgbaToCanvas(flipped, w, h);
    }
    return rgbaToCanvas(rgba, w, h);
  }

  /** JPEG XL vía jxl-decoder (WASM). */
  async function decodeWithJxl(file) {
    await ensureDecoder('jxl');
    const bytes = new Uint8Array(await VMS.readFileAsArrayBuffer(file));
    const result = await window.jxlDecoder.decode(bytes);
    if (!result || !result.width) throw new Error('JPEG XL: decodificación sin datos.');
    return rgbaToCanvas(result.data, result.width, result.height);
  }

  /** HEIC/HEIF vía heic2any (libhef WASM) → PNG intermedio → canvas. */
  async function decodeWithHeic(file) {
    await ensureDecoder('heic');
    const out = await heic2any({ blob: file, toType: 'image/png', quality: 1 });
    const blob = Array.isArray(out) ? out[0] : out;
    return decodeToCanvas(blob);
  }

  /** EXR vía la API nativa ImageDecoder (Chromium con AV1/EXR habilitado). */
  async function decodeWithImageDecoder(file) {
    await ensureDecoder('exr');
    const decoder = new ImageDecoder({ data: file, type: 'image/x-exr' });
    const { image } = await decoder.decode({ frameIndex: 0 });
    const c = document.createElement('canvas');
    c.width = image.displayWidth || image.width;
    c.height = image.displayHeight || image.height;
    c.getContext('2d').drawImage(image, 0, 0);
    image.close();
    return c;
  }

  /**
   * RAW de cámara: extrae el JPEG de previsualización incrustado (SOI…EOI
   * más grande del archivo) y lo decodifica como si fuera un JPEG normal.
   */
  async function decodeRawPreview(file) {
    const ab = await VMS.readFileAsArrayBuffer(file);
    const u8 = new Uint8Array(ab);
    const candidates = [];
    for (let i = 0; i < u8.length - 3; i++) {
      if (u8[i] === 0xff && u8[i + 1] === 0xd8 && u8[i + 2] === 0xff) {
        let end = -1;
        for (let j = i + 4; j < u8.length - 1; j++) {
          if (u8[j] === 0xff && u8[j + 1] === 0xd9) { end = j + 2; break; }
        }
        if (end > i + 100) candidates.push({ start: i, end, size: end - i });
        i = end > 0 ? end : i + 3;
      }
    }
    if (!candidates.length) {
      throw new Error('Este RAW no trae una previsualización JPEG incrustada procesable.');
    }
    const best = candidates.reduce((a, b) => (b.size > a.size ? b : a));
    const blob = new Blob([u8.slice(best.start, best.end)], { type: 'image/jpeg' });
    return decodeToCanvas(blob);
  }

  /**
   * Radiance RGBE (.hdr) — parser local sin dependencias.
   * Soporta scanlines RLE (las más comunes) y formato plano 4 bytes/píxel.
   */
  function decodeRadianceHDR(ab) {
    const u8 = new Uint8Array(ab);
    const headerText = new TextDecoder('latin1').decode(u8.subarray(0, Math.min(u8.length, 8192)));
    const m = /-Y\s+(\d+)\s+\+X\s+(\d+)\s*\n/.exec(headerText);
    if (!m) throw new Error('HDR: cabecera de resolución no reconocida.');
    const height = +m[1];
    const width = +m[2];
    let pos = m.index + m[0].length;

    const rgb = new Float32Array(width * height * 3);
    let out = 0;
    for (let y = 0; y < height; y++) {
      if (pos + 4 <= u8.length && u8[pos] === 2 && u8[pos + 1] === 2) {
        // Scanline RLE moderna (4 planos)
        const scanW = (u8[pos + 2] << 8) | u8[pos + 3];
        pos += 4;
        if (scanW !== width) throw new Error('HDR: ancho de scanline inconsistente.');
        const planes = [
          new Uint8Array(width), new Uint8Array(width),
          new Uint8Array(width), new Uint8Array(width),
        ];
        for (let c = 0; c < 4; c++) {
          let x = 0;
          while (x < width) {
            const cnt = u8[pos++];
            if (cnt > 128) {
              const run = cnt - 128;
              const val = u8[pos++];
              for (let k = 0; k < run && x < width; k++) planes[c][x++] = val;
            } else {
              for (let k = 0; k < cnt && x < width; k++) planes[c][x++] = u8[pos++];
            }
          }
        }
        for (let x = 0; x < width; x++) {
          rgbeToFloats(planes[0][x], planes[1][x], planes[2][x], planes[3][x], rgb, out);
          out += 3;
        }
      } else {
        // Formato plano: 4 bytes por píxel (RGBE)
        if (pos + 4 * width > u8.length) throw new Error('HDR: datos truncados.');
        for (let x = 0; x < width; x++) {
          rgbeToFloats(u8[pos], u8[pos + 1], u8[pos + 2], u8[pos + 3], rgb, out);
          out += 3;
          pos += 4;
        }
      }
    }

    // Tonemapping Reinhard + gamma 2.2 → canvas sRGB de 8 bits
    const img = new Uint8ClampedArray(width * height * 4);
    for (let i = 0, o = 0; i < width * height; i++) {
      for (let c = 0; c < 3; c++, o++) {
        const v = rgb[i * 3 + c] / (1 + rgb[i * 3 + c]);
        img[o] = Math.pow(v, 1 / 2.2) * 255;
      }
      img[o++] = 255;
    }
    return rgbaToCanvas(img, width, height);
  }

  function rgbeToFloats(r, g, b, e, out, o) {
    if (e === 0) {
      out[o] = 0; out[o + 1] = 0; out[o + 2] = 0;
      return;
    }
    const scale = Math.pow(2, e - 136); // 128 (mantisa) + 8 (fracción)
    out[o] = r * scale;
    out[o + 1] = g * scale;
    out[o + 2] = b * scale;
  }

  // Puente para el loader perezoso decoders/hdr.js → window.parseHdr(ab)
  window.VMSDecodeHDR = decodeRadianceHDR;

  /** Decodificador HDR local (decoders/hdr.js define window.parseHdr). */
  async function decodeWithHdr(file) {
    await ensureDecoder('hdr');
    const ab = await VMS.readFileAsArrayBuffer(file);
    return parseHdr(ab);
  }

  /**
   * Punto de entrada unificado: decodifica CUALQUIER formato soportado a un
   * canvas, eligiendo estrategia por extensión + firma y cargando
   * decodificadores bajo demanda cuando hace falta.
   */
  async function decodeAny(file) {
    const st = await resolveStrategy(file);
    if (st.kind === 'broken') {
      throw new Error(st.note || 'No hay decodificación 100% local para este archivo en el navegador.');
    }
    if (st.note) toast(st.note, 'info', 4500);
    if (st.kind === 'native') return decodeToCanvas(file);

    toast(`Decodificando ${st.label}… (decodificador bajo demanda)`, 'info', 2500);
    switch (st.lib) {
      case 'utif': return decodeWithUtif(file);
      case 'tga': return decodeTGA(file);
      case 'jxl': return decodeWithJxl(file);
      case 'heic': return decodeWithHeic(file);
      case 'exr': return decodeWithImageDecoder(file);
      case 'raw': return decodeRawPreview(file);
      case 'hdr': return decodeWithHdr(file);
      default: throw new Error('Decodificador no disponible.');
    }
  }

  /* -------------------------------------------------------------------------
   * Procesado del lote
   * ---------------------------------------------------------------------- */
  let processing = false;

  async function processQueue() {
    if (processing || queue.length === 0) return;
    processing = true;

    const mimes = targetFormats();
    const quality = parseInt(els.quality.value, 10) / 100;
    const resizeMode = document.querySelector('input[name="img-resize-mode"]:checked');
    const opts = {
      resizeOn: els.resizeOn.checked,
      maxW: parseInt(els.maxW.value, 10) || 0,
      maxH: parseInt(els.maxH.value, 10) || 0,
      stretch: resizeMode ? resizeMode.value === 'stretch' : false,
    };

    // Comprobar soporte real de los formatos pedidos (una sola pasada)
    const usableMimes = [];
    const unsupported = [];
    for (const m of mimes) {
      if (await canEncode(m)) usableMimes.push(m);
      else unsupported.push((EXT_FOR[m] || m).toUpperCase());
    }
    if (unsupported.length) {
      toast(
        `Tu navegador no soporta codificar: ${unsupported.join(', ')}. Esas variantes se omitirán.`,
        'error',
        6000
      );
    }
    if (usableMimes.length === 0) {
      toast('Ninguno de los formatos elegidos está soportado por este navegador.', 'error');
      processing = false;
      return;
    }

    els.process.disabled = true;
    const outputs = [];
    let totalIn = 0;
    let totalOut = 0;
    let exifFound = 0;
    let failures = 0;

    for (const item of queue) {
      item.results = [];
      try {
        // EXIF: basta con los primeros 256 KB para hallar el marcador APP1
        try {
          const head = await VMS.readFileAsArrayBuffer(item.file.slice(0, 256 * 1024));
          if (hasExif(head)) exifFound++;
        } catch (_) { /* no crítico */ }

        const canvas = await decodeAny(item.file);
        const { w, h, resized } = computeDims(canvas.width, canvas.height, opts);
        let source = canvas;
        if (resized) {
          source = scaleCanvas(canvas, w, h);
          canvas.width = canvas.height = 0; // liberar el bitmap original
        }

        // JPEG no soporta transparencia: aplanar sobre una COPIA para no
        // estropear WebP/PNG/AVIF cuando se generan varias variantes.
        const wantsJpeg = usableMimes.includes('image/jpeg');
        const jpegSource = wantsJpeg
          ? flattenAlpha(scaleCanvas(source, source.width, source.height))
          : null;

        for (const mime of usableMimes) {
          const work = mime === 'image/jpeg' ? jpegSource : source;
          const blob = await encodeCanvas(work, mime, quality);
          const suffix = usableMimes.length > 1 ? `-${EXT_FOR[mime]}` : '';
          const out = { name: buildName(item.file.name, mime, suffix), blob, mime };
          outputs.push(out);
          item.results.push({ name: out.name, mime, from: item.file.size, to: blob.size });
          totalOut += blob.size;
        }
        totalIn += item.file.size;
        renderQueue(); // badges en vivo tras cada archivo
      } catch (err) {
        failures++;
        item.failed = true; // se retira de la cola al terminar el lote
        console.error('[images] falló', item.file.name, err);
        toast(`Error con ${item.file.name}: ${err.message}`, 'error', 6000);
      }
    }

    // Los archivos que fallaron se retiran (el toast ya explicó el motivo)
    if (queue.some((it) => it.failed)) {
      queue = queue.filter((it) => !it.failed);
      renderQueue();
    }

    VMS.state.outputs.images = outputs;
    renderQueue();
    els.process.disabled = false;
    processing = false;

    if (outputs.length) {
      renderSummary(outputs, { totalIn, totalOut, exifFound, failures });
      const saved = totalIn > 0 ? Math.max(0, Math.round((1 - totalOut / totalIn) * 100)) : 0;
      toast(
        `Lote listo: ${outputs.length} archivo(s) · ahorro ≈ ${saved}%.`,
        'success'
      );
    } else {
      toast('No se pudo procesar ninguna imagen.', 'error');
    }
  }

  /* -------------------------------------------------------------------------
   * Resumen y descarga
   * ---------------------------------------------------------------------- */
  function renderSummary(outputs, stats) {
    els.summary.classList.remove('hidden');
    els.summaryTitle.textContent = `Lote procesado — ${outputs.length} archivo(s)`;
    const delta = stats.totalIn
      ? Math.round((1 - stats.totalOut / stats.totalIn) * 100)
      : 0;
    const parts = [
      `Entrada: ${VMS.formatBytes(stats.totalIn)} → Salida: ${VMS.formatBytes(stats.totalOut)} (${delta >= 0 ? '−' : '+'}${Math.abs(delta)}%).`,
    ];
    if (stats.exifFound) parts.push(`${stats.exifFound} con EXIF detectado → metadatos eliminados en la salida.`);
    if (stats.failures) parts.push(`${stats.failures} archivo(s) fallaron.`);
    parts.push(
      outputs.length > 1
        ? 'La descarga se empaquetará en .zip automáticamente (o forzado con el toggle).'
        : 'Descarga individual directa.'
    );
    els.summaryDetail.textContent = parts.join(' ');
  }

  function hideSummary() {
    els.summary.classList.add('hidden');
    VMS.state.outputs.images = [];
  }

  let downloading = false;

  async function handleDownload() {
    const outputs = VMS.state.outputs.images;
    if (!outputs.length || downloading) return;
    downloading = true;
    els.download.disabled = true;
    const unbindProgress = VMS.bindProgress(els.download);
    try {
      const res = await VMSZipper.deliverOutputs(outputs, {
        forceZip: els.zipOn.checked,
        prefix: 'voidmedia-images',
      });
      toast(
        res.mode === 'zip'
          ? `ZIP con ${res.count} archivos descargado (${res.name}).`
          : `Descargado: ${res.name}`,
        'success'
      );
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
      dropzone: $('images-dropzone'),
      input: $('images-input'),
      formatGroup: $('images-format-group'),
      quality: $('images-quality'),
      qualityOut: $('images-quality-out'),
      resizeOn: $('images-resize-on'),
      maxW: $('images-max-w'),
      maxH: $('images-max-h'),
      zipOn: $('images-zip-on'),
      queue: $('images-queue'),
      count: $('images-count'),
      process: $('images-process'),
      clear: $('images-clear'),
      summary: $('images-summary'),
      summaryTitle: $('images-summary-title'),
      summaryDetail: $('images-summary-detail'),
      download: $('images-download'),
    });

    // Dropzone
    VMS.setupDropzone({ zone: els.dropzone, input: els.input, onFiles: addFiles });

    // Slider de calidad con relleno dinámico
    const paintRange = (range) => {
      const min = Number(range.min) || 0;
      const max = Number(range.max) || 100;
      const pct = ((Number(range.value) - min) / (max - min)) * 100;
      range.style.setProperty('--fill', `${pct}%`);
    };
    paintRange(els.quality);
    els.quality.addEventListener('input', () => {
      els.qualityOut.textContent = `${els.quality.value}%`;
      paintRange(els.quality);
    });

    // Resize toggle
    const syncResize = () => {
      els.maxW.disabled = !els.resizeOn.checked;
      els.maxH.disabled = !els.resizeOn.checked;
    };
    els.resizeOn.addEventListener('change', syncResize);
    syncResize();

    // Acciones
    els.process.addEventListener('click', processQueue);
    els.clear.addEventListener('click', clearAll);
    els.download.addEventListener('click', handleDownload);
    els.queue.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-remove]');
      if (btn) removeAt(Number(btn.dataset.remove));
    });

    renderQueue();
    hideSummary();
    renderCompatPanel();
  }

  /** Pinta el panel desplegable «Compatibilidad de formatos». */
  function renderCompatPanel() {
    const root = document.getElementById('compat-groups');
    const counter = document.getElementById('compat-ok-count');
    if (!root || !counter) return;
    let ok = 0;
    const html = FORMAT_COMPAT.map((grp) => {
      const chips = grp.formats
        .map((f) => {
          if (f.kind !== 'broken') ok += f.exts.length;
          const cls =
            f.kind === 'native' ? ' is-native' : f.kind === 'broken' ? ' is-broken' : '';
          const title = f.note ? ` title="${VMS.escapeHtml(f.note)}"` : '';
          return `<span class="compat-chip${cls}"${title}>${f.label}</span>`;
        })
        .join('');
      return `<div class="compat-group-title">${VMS.escapeHtml(grp.group)}</div><div class="compat-chips">${chips}</div>`;
    }).join('');
    root.innerHTML = html;
    counter.textContent = `${ok} formatos listos`;
  }

  window.VMSModules = window.VMSModules || {};
  window.VMSModules.images = {
    id: 'images',
    init,
    decodeAny,
    decodeTGA,
    decodeRadianceHDR,
    decodeRawPreview,
    resolveStrategy,
    FORMAT_COMPAT,
  };
})();
