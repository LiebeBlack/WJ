/* ============================================================================
   VoidMedia Studio — js/modules/decoders/hdr.js
   Loader mínimo del decodificador Radiance RGBE (.hdr).
   La implementación del parser vive en js/modules/images.js (sin
   dependencias) y se expone temporalmente como window.VMSDecodeHDR;
   este archivo publica la API pública window.parseHdr(ab) usada por el
   cargador perezoso «bajo demanda».
   ========================================================================== */

(function () {
  'use strict';

  window.parseHdr = function parseHdr(arrayBuffer) {
    if (typeof window.VMSDecodeHDR === 'function') {
      return window.VMSDecodeHDR(arrayBuffer);
    }
    throw new Error('El módulo de imágenes aún no está inicializado.');
  };
})();
