/* ============================================================================
   VoidMedia Studio — js/app.js
   Orquestador global:
   - Enrutamiento de pestañas (hash-based, botón atrás + atajos Ctrl+1..4).
   - Selector de acento neón con persistencia en localStorage.
   - Persistencia de la última pestaña activa (sessionStorage).
   - Sistema de toasts + handler global de errores.
   - Estado global y utilidades compartidas para los módulos.
   - Los módulos (images/svg/audio/text) se registran en window.VMSModules
     con { id, init() } y se inicializan desde aquí.
   ========================================================================== */

(function () {
  'use strict';

  /* -------------------------------------------------------------------------
   * 1. Utilidades compartidas (expuestas como window.VMS)
   * ---------------------------------------------------------------------- */

  const VMS = {
    version: '1.3.1',

    /** Formatea bytes a unidad legible. */
    formatBytes(bytes, decimals = 1) {
      if (!Number.isFinite(bytes) || bytes < 0) return '—';
      if (bytes === 0) return '0 B';
      const k = 1024;
      const units = ['B', 'KB', 'MB', 'GB'];
      const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), units.length - 1);
      return `${parseFloat((bytes / Math.pow(k, i)).toFixed(decimals))} ${units[i]}`;
    },

    /** Formatea segundos a m:ss.d */
    formatSeconds(s) {
      if (!Number.isFinite(s)) return '—';
      const m = Math.floor(s / 60);
      const rest = s - m * 60;
      return `${m}:${rest.toFixed(1).padStart(4, '0')}`;
    },

    /** Escapa HTML para interpolation segura. */
    escapeHtml(str) {
      return String(str)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    },

    /** Nombre base sin extensión. */
    basename(name) {
      return String(name || 'file').replace(/\.[^./\\]+$/, '');
    },

    /** Extensión en minúsculas, sin punto. */
    extOf(name) {
      const m = /\.([^./\\]+)$/.exec(String(name || ''));
      return m ? m[1].toLowerCase() : '';
    },

    /** Lee un File/Blob como ArrayBuffer. */
    readFileAsArrayBuffer(file) {
      return file.arrayBuffer
        ? file.arrayBuffer()
        : new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(r.error || new Error('FileReader falló'));
            r.readAsArrayBuffer(file);
          });
    },

    /** Lee un File/Blob como texto (UTF-8). */
    readFileAsText(file) {
      return file.text
        ? file.text()
        : new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(r.result);
            r.onerror = () => reject(r.error || new Error('FileReader falló'));
            r.readAsText(file);
          });
    },

    /**
     * Cablea una dropzone estándar: clic → input, drag&drop, teclado.
     * @param {{zone:HTMLElement, input:HTMLInputElement, onFiles:(files:File[])=>void}} cfg
     */
    setupDropzone(cfg) {
      const { zone, input, onFiles } = cfg;
      if (!zone || !input || typeof onFiles !== 'function') return;

      zone.addEventListener('click', () => input.click());
      zone.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          input.click();
        }
      });
      input.addEventListener('change', () => {
        onFiles(Array.from(input.files || []));
        input.value = ''; // permite re-seleccionar el mismo archivo
      });

      ['dragenter', 'dragover'].forEach((evt) =>
        zone.addEventListener(evt, (e) => {
          e.preventDefault();
          e.stopPropagation();
          zone.classList.add('is-dragover');
        })
      );
      ['dragleave', 'drop'].forEach((evt) =>
        zone.addEventListener(evt, (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (evt === 'dragleave' && e.target !== zone) return;
          zone.classList.remove('is-dragover');
        })
      );
      zone.addEventListener('drop', (e) => {
        const files = Array.from(e.dataTransfer?.files || []);
        if (files.length) onFiles(files);
      });
    },

    /** Pinta una forma de onda normalizada (-1..1) en un canvas pequeño. */
    drawWave(canvas, peaks, accent) {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = canvas.clientWidth || 220;
      const h = canvas.clientHeight || 42;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, w, h);

      const data = peaks && peaks.length ? peaks : new Float32Array(64);
      const bars = Math.min(data.length, 48);
      const step = data.length / bars;
      const barW = Math.max(1.5, (w - (bars - 1) * 2) / bars);
      const color = accent || getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#00e5ff';

      ctx.fillStyle = color;
      ctx.globalAlpha = 0.9;
      for (let i = 0; i < bars; i++) {
        // pico máximo del segmento (una onda por barra)
        let peak = 0;
        for (let j = Math.floor(i * step); j < Math.floor((i + 1) * step) && j < data.length; j++) {
          const v = Math.abs(data[j]);
          if (v > peak) peak = v;
        }
        const bh = Math.max(2, peak * (h - 6));
        const x = i * (barW + 2);
        const y = (h - bh) / 2;
        ctx.beginPath();
        if (ctx.roundRect) ctx.roundRect(x, y, barW, bh, barW / 2);
        else ctx.rect(x, y, barW, bh);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },

    /* -- Estado y progreso global -- */

    state: {
      activeTab: 'images',
      outputs: { images: [], svg: [], audio: [], text: [] },
    },

    onProgress: null,

    /** Actualiza el botón de descarga activo con el progreso del zip. */
    updateProgress(percent) {
      if (typeof this.onProgress === 'function') this.onProgress(percent);
    },

    /**
     * Conecta un botón de descarga con la barra de progreso del zip:
     * muestra «Empaquetando N%» mientras dura la operación.
     * @param {HTMLButtonElement} btn
     * @param {string} [label] Etiqueta original del botón.
     * @returns {() => void} Función para desvincular.
     */
    bindProgress(btn, label) {
      if (!btn) return () => {};
      const original = label || btn.textContent;
      this.onProgress = (pct) => {
        btn.textContent = `Empaquetando ${pct}%`;
      };
      return () => {
        this.onProgress = null;
        btn.textContent = original;
      };
    },
  };

  window.VMS = VMS;

  /* -------------------------------------------------------------------------
   * 2. Toasts
   * ---------------------------------------------------------------------- */

  const ToastRoot = () => document.getElementById('toast-root');

  /**
   * Muestra una notificación flotante.
   * @param {string} message
   * @param {'info'|'success'|'error'} [type]
   * @param {number} [ms]
   */
  function toast(message, type = 'info', ms = 3800) {
    const root = ToastRoot();
    if (!root) return;

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    const ico = type === 'success' ? '✓' : type === 'error' ? '!' : 'i';
    el.innerHTML =
      `<span class="toast-ico">${ico}</span>` +
      `<span class="min-w-0 flex-1 break-words">${VMS.escapeHtml(message)}</span>`;
    root.appendChild(el);

    setTimeout(() => {
      el.classList.add('leaving');
      el.addEventListener('animationend', () => el.remove(), { once: true });
      setTimeout(() => el.remove(), 400); // red de seguridad
    }, ms);
  }

  window.toast = toast;

  /* -------------------------------------------------------------------------
   * 3. Acento neón dinámico
   * ---------------------------------------------------------------------- */

  const ACCENTS = ['cyan', 'purple', 'emerald', 'amber'];
  const ACCENT_KEY = 'voidmedia:accent';

  function applyAccent(name) {
    if (!ACCENTS.includes(name)) name = 'cyan';
    document.documentElement.setAttribute('data-accent', name);
    try { localStorage.setItem(ACCENT_KEY, name); } catch (_) { /* noop */ }

    document.querySelectorAll('.accent-dot').forEach((dot) => {
      dot.classList.toggle('is-active', dot.dataset.accent === name);
    });

    // Redibujar waveforms con el nuevo acento
    document.querySelectorAll('canvas.wave-canvas').forEach((c) => {
      if (c.dataset.peaks) {
        try {
          VMS.drawWave(c, JSON.parse(c.dataset.peaks));
        } catch (_) { /* noop */ }
      }
    });

    // Re-pintar el relleno de los sliders (degradado ligado al acento)
    document.querySelectorAll('input.neon-range').forEach((r) => {
      const min = Number(r.min) || 0;
      const max = Number(r.max) || 100;
      const pct = ((Number(r.value) - min) / (max - min)) * 100;
      r.style.setProperty('--fill', `${pct}%`);
    });
  }

  function initAccents() {
    let saved = null;
    try { saved = localStorage.getItem(ACCENT_KEY); } catch (_) { /* noop */ }
    applyAccent(saved || 'cyan');

    document.querySelectorAll('.accent-dot[data-accent]').forEach((dot) => {
      dot.addEventListener('click', () => applyAccent(dot.dataset.accent));
    });
  }

  /* -------------------------------------------------------------------------
   * 4. Router de pestañas (hash-based)
   * ---------------------------------------------------------------------- */

  const TABS = ['images', 'svg', 'audio', 'text'];

  function activateTab(name, { updateHash = true } = {}) {
    if (!TABS.includes(name)) name = 'images';

    document.querySelectorAll('[role="tab"][data-tab]').forEach((btn) => {
      const active = btn.dataset.tab === name;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', String(active));
    });

    document.querySelectorAll('.tab-panel').forEach((panel) => {
      const match = panel.id === `panel-${name}`;
      panel.classList.toggle('is-visible', match);
      panel.hidden = !match;
    });

    VMS.state.activeTab = name;
    try { sessionStorage.setItem('voidmedia:tab', name); } catch (_) { /* noop */ }
    if (updateHash && location.hash !== `#${name}`) {
      history.replaceState(null, '', `#${name}`);
    }
  }

  function initTabs() {
    document.querySelectorAll('[role="tab"][data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => activateTab(btn.dataset.tab));
      btn.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
        e.preventDefault();
        const idx = TABS.indexOf(VMS.state.activeTab);
        const next = TABS[(idx + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
        activateTab(next);
        document.getElementById(`tab-btn-${next}`)?.focus();
      });
    });

    // Enlaces "logo" y otros data-tab-link
    document.querySelectorAll('[data-tab-link]').forEach((el) => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        activateTab(el.dataset.tabLink);
      });
    });

    // Atajos de teclado: Ctrl/Cmd + 1..4
    document.addEventListener('keydown', (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= TABS.length) {
        e.preventDefault();
        activateTab(TABS[n - 1]);
      }
    });

    // Navegación del navegador (atrás/adelante)
    window.addEventListener('hashchange', () => {
      activateTab(location.hash.replace('#', '') || 'images', { updateHash: false });
    });

    // Restaura la pestaña: hash en URL > última usada (sessionStorage) > images
    let initial = location.hash.replace('#', '');
    if (!TABS.includes(initial)) {
      try { initial = sessionStorage.getItem('voidmedia:tab'); } catch (_) { /* noop */ }
    }
    activateTab(TABS.includes(initial) ? initial : 'images', { updateHash: false });
  }

  /* -------------------------------------------------------------------------
   * 5. Arranque: inicializar módulos registrados
   * ---------------------------------------------------------------------- */

  function init() {
    initAccents();
    initTabs();

    const modules = window.VMSModules || {};
    const errors = [];

    TABS.forEach((id) => {
      const mod = modules[id];
      if (mod && typeof mod.init === 'function') {
        try {
          mod.init();
        } catch (err) {
          console.error(`[app] Error inicializando módulo "${id}":`, err);
          errors.push(id);
        }
      }
    });

    if (errors.length) {
      toast(`Módulos con errores de inicio: ${errors.join(', ')}`, 'error', 6000);
    }

    // Red de seguridad global: cualquier error no capturado avisa sin romper la app
    window.addEventListener('error', (e) => {
      if (e.message && e.message.includes('Script error')) return; // cross-origin (CDN)
      console.error('[app] error no capturado:', e.error || e.message);
      toast(`Error inesperado: ${e.message}`, 'error', 5000);
    });
    window.addEventListener('unhandledrejection', (e) => {
      console.error('[app] promesa rechazada:', e.reason);
      toast(`Error inesperado: ${e.reason && e.reason.message ? e.reason.message : e.reason}`, 'error', 5000);
    });

    console.info(
      `%c VoidMedia Studio v${VMS.version} `,
      'background:#000;color:#00e5ff;font-weight:bold;border:1px solid #00e5ff;border-radius:4px;padding:2px 6px;',
      '· 100% local — nada sale de tu navegador.'
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
