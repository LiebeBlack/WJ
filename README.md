# VoidMedia Studio

> Suite de procesamiento multimedia **100% local** — imágenes (38 formatos de entrada), SVG, audio y texto se procesan íntegramente en tu navegador. Sin servidores, sin uploads, sin rastros. Desplegable directamente en **GitHub Pages** sin build step.

![Stack](https://img.shields.io/badge/stack-Tailwind%20v4%20·%20JSZip%20·%20Web%20Audio-000000?style=flat-square)
![Privacidad](https://img.shields.io/badge/privacidad-100%25%20local-10b981?style=flat-square)
![Deploy](https://img.shields.io/badge/deploy-GitHub%20Pages-00e5ff?style=flat-square)

---

## ✨ Características

| Módulo | Capacidades |
|---|---|
| 🖼️ **Imágenes** | Conversión masiva a **WebP / JPEG / PNG / AVIF** (o las 4 variantes a la vez), compresión por calidad (slider 10–100), redimensionado por canvas en modo **Ajustar** (fit) o **Estirar** (stretch), **eliminación de EXIF** garantizada por re-codificación, y **38 extensiones de entrada** con detección por firma (ver tabla de compatibilidad). Badges de ahorro por archivo y formato. |
| ⚡ **SVG** | Limpieza de comentarios, metadatos de editores (`<metadata>`, tags `sodipodi:`/`inkscape:`), `<title>`/`<desc>`, **atributos de editor** (`data-name`, `inkscape:*`, `sodipodi:*`), modo **responsive** (elimina width/height fijos conservando viewBox), minificado seguro para `<style>`/`<text>`, y redondeo de decimales configurable. Lote de varios SVG, vista previa y estadísticas de ahorro. |
| 🎧 **Audio** | Decodificación con **Web Audio API**, waveform visual por pista, recorte por segundos, ganancia en dB, **normalización a −1 dBFS** (mide el pico real), **invertir pista**, **velocidad de reproducción** (0.25×–2×, estilo cinta), fade-in/out, export a **WAV PCM 16-bit** (sin dependencias) o **MP3** vía lamejs. |
| 📝 **Texto** | Limpieza de lotes: líneas vacías, **colapsar vacías consecutivas**, espacios por línea, colapsar espacios, **eliminar duplicadas**, **ordenar líneas** (A–Z / Z–A con comparación natural que respeta acentos y números), tabs → 4 espacios, normalizar saltos a LF. Contador de líneas y palabras por resultado. |
| 📦 **Empaquetado** | Descarga directa si hay 1 archivo; **.zip automático** con JSZip si hay varios (o forzado con un toggle). Sin colisiones de nombre dentro del mismo zip (`foto.png` → `foto-2.png`). |

**Extras de interfaz:** 4 acentos neón dinámicos (cian, púrpura, esmeralda, ámbar) con persistencia, router de pestañas con hash + botón atrás + **atajos Ctrl/Cmd+1…4**, restauración de la última pestaña usada, toasts glassmorphism, botón de descarga con progreso real de empaquetado («Empaquetando N%») y red de seguridad global de errores.

**Privacidad por diseño:** todo ocurre en memoria del navegador (Canvas API, Web Audio API, Blob/File API). Ningún byte sale de tu dispositivo. Al cerrar la pestaña, no queda rastro.

---

## 🚀 Uso local (desarrollo)

Es un sitio estático puro: no hay compilación. Solo sirve la carpeta con cualquier servidor estático:

```bash
# Con Python (preinstalado en la mayoría de sistemas)
python -m http.server 8080

# O con Node.js
npx serve .
```

En Windows sin Python/Node, usa el servidor incluido:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File server.ps1
# → http://localhost:8123
```

> ⚠️ No abras `index.html` con `file://` — algunos navegadores bloquean la lectura de archivos en ese esquema. Usa siempre un servidor local.

---

## 🔍 SEO y alta en buscadores (Google, Bing, y otros)

La web incluye **6 páginas indexables** (la app + 5 landings por herramienta), `sitemap.xml`, `robots.txt` y datos estructurados schema.org. Para aparecer en los buscadores, tras desplegar:

1. **Sustituye `TU-USUARIO/TU-REPO`** por tu URL real en: `index.html` (canonical, og:url, og:image, JSON-LD), las 5 landings (canonical) y `robots.txt` + `sitemap.xml`.
2. **Google Search Console** → [search.google.com/search-console](https://search.google.com/search-console) → añade la propiedad → verifica (meta tag o archivo) → envía `sitemap.xml`. Pega tu token en el meta `google-site-verification` ya preparado en `index.html`.
3. **Bing Webmaster Tools** → [bing.com/webmasters](https://www.bing.com/webmasters) → añade el sitio → puedes **importar directamente desde Search Console** → envía el sitemap. Token preparado en `msvalidate.01`.
4. **IndexNow (Bing, Yandex, Seznam, Naver…)** — aviso instantáneo de contenido nuevo sin esperar al rastreo: genera una clave (cualquier string hex aleatorio de 32 caracteres), guárdala como `TU-CLAVE.txt` en la raíz con el mismo contenido dentro, y envía:
   ```
   https://api.indexnow.org/indexnow?url=https://TU-USUARIO.github.io/TU-REPO/&key=TU-CLAVE
   ```
5. **DuckDuckGo, Brave Search, Ecosia, Qwant** reutilizan los índices de Bing/Google: con los pasos 2–3 quedan cubiertos. **Yandex** tiene su propio panel ([webmaster.yandex.com](https://webmaster.yandex.com)), token preparado en `yandex-verification`.

Extras ya integrados: Open Graph + Twitter Card (vistas previas ricas en WhatsApp/Twitter/Facebook), `FAQPage` JSON-LD en cada landing (elige a fragmentos enriquecidos), skip-link y `noscript` de accesibilidad, y enlaces internos de herramientas en el footer de la app.

## 📦 Despliegue en GitHub Pages

### Opción A — Rama `main` (raíz) · recomendada

1. Sube estos archivos a la **raíz** de tu repositorio (rama `main`).
2. Ve a **Settings → Pages → Build and deployment**.
3. En **Source** elige **Deploy from a branch**.
4. Selecciona **Branch: `main` · Folder: `/ (root)`** y guarda.
5. En 1–2 minutos estará disponible en `https://TU-USUARIO.github.io/TU-REPO/`.

### Opción B — GitHub Actions

Crea `.github/workflows/deploy.yml`:

```yaml
name: Deploy to GitHub Pages
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: '.'
      - uses: actions/deploy-pages@v4
```

---

## 🗂️ Estructura del proyecto

```
/
├── index.html              # Estructura principal (OLED puro, pestañas, CDNs)
├── comprimir-imagenes.html # Landing SEO: «comprimir imágenes online»
├── convertir-webp-avif.html# Landing SEO: «convertir a WebP/AVIF»
├── optimizar-svg.html      # Landing SEO: «optimizar SVG»
├── convertir-audio.html    # Landing SEO: «convertir/recortar audio»
├── limpiar-texto.html      # Landing SEO: «limpiar texto»
├── manifest.webmanifest    # PWA-lite: instalable como app independiente
├── icon.svg                # Icono de la app / favicon
├── robots.txt              # Reglas de rastreo para buscadores
├── sitemap.xml             # Mapa del sitio (6 URLs) para Search Console/Bing
├── server.ps1              # Servidor estático para Windows (sin Node/Python)
├── css/
│   └── styles.css          # Variables, glassmorphism, acentos neón, scrollbars
├── js/
│   ├── app.js              # Router de pestañas, acentos, toasts, estado global
│   ├── modules/
│   │   ├── images.js       # Conversión masiva, compresión, resize fit/stretch, EXIF
│   │   ├── svg.js          # Limpieza y optimización de código SVG
│   │   ├── audio.js        # Web Audio API: trim, gain, normalize, reverse, speed
│   │   ├── text.js         # Limpieza de lotes de texto/código
│   │   └── decoders/
│   │       └── hdr.js      # Loader perezoso del parser Radiance HDR
│   └── utils/
│       └── zipper.js       # JSZip: empaquetado y descargas inteligentes
└── README.md               # Este archivo
```

---

## 🧩 Compatibilidad de formatos de entrada (Imágenes)

Tres niveles, con total honestidad sobre lo que el navegador puede hacer:

- 🟢 **Nativo** — lo decodifica el navegador.
- 🔵 **Bajo demanda** — se carga un decodificador desde CDN solo al procesar ese formato. El archivo nunca sale de tu equipo.
- 🔴 **No viable** — no existe decodificación 100% local en navegador; la app lo explica y sugiere una alternativa.

| Grupo | Formatos | Nivel |
|---|---|---|
| Ráster clásicos | JPEG/JFIF, PNG, GIF, BMP, WebP, AVIF | 🟢 Nativo |
| Ráster clásicos | **TIFF/TIF** | 🔵 UTIF (WASM/JS) |
| Alta eficiencia | **JPEG XL (.jxl)** | 🔵 jxl-decoder (WASM) |
| Alta eficiencia | **HEIF/HEIC (.heic, .hif, .avci)** — iPhone | 🔵 heic2any (libheif WASM) |
| Vectoriales | SVG | 🟢 Nativo |
| Vectoriales | EPS · AI · CDR | 🔴 No viable — exporta a SVG/PNG |
| RAW cámaras | **DNG, CR2/CR3, NEF/NRW, ARW/SR2, ORF, RW2, RAF, PEF, SRW, X3F** | 🔵 Previsualización JPEG incrustada |
| Especiales | ICO/CUR | 🟢 Nativo |
| Especiales | **TGA** (RGB, gris, RLE) | 🔵 Parser local sin dependencias |
| HDR / VFX | **HDR Radiance** (RGBE, RLE y plano) | 🔵 Parser local + tone-mapping Reinhard |
| HDR / VFX | **EXR / PFM** | 🔵 ImageDecoder API nativa (Chromium) |
| Animados | APNG | 🔴 Solo 1.er fotograma en navegador — renombra a .png |

La detección usa **extensión + firma binaria (magic bytes)**: un TIFF sin extensión se reconoce igualmente. El panel desplegable «Compatibilidad de formatos» dentro de la pestaña Imágenes muestra el estado en vivo y los avisos de cada formato.

## ⌨️ Atajos de teclado

| Atajo | Acción |
|---|---|
| `Ctrl/Cmd + 1` | Pestaña Imágenes |
| `Ctrl/Cmd + 2` | Pestaña SVG |
| `Ctrl/Cmd + 3` | Pestaña Audio |
| `Ctrl/Cmd + 4` | Pestaña Texto |

---

## 🧰 Tecnologías

- **[Tailwind CSS v4](https://tailwindcss.com)** (Play CDN, browser build) — utilidades de layout sin build step.
- **[JSZip](https://stuk.github.io/jszip/)** — empaquetado de resultados en `.zip` descargable.
- **[lamejs](https://github.com/zhuker/lamejs)** — encoder MP3 puro JS (solo módulo de audio).
- **Canvas API** — decodificación, reescalado y re-codificación de imágenes.
- **Web Audio API + OfflineAudioContext** — DSP de audio sin servidores.
- Sin frameworks, sin bundler, sin Node.js. JavaScript vanilla con IIFEs y namespace `window.VMS*`.

---

## 🌐 Compatibilidad

| Función | Requisito |
|---|---|
| WebP / JPEG / PNG | Todos los navegadores modernos |
| AVIF encode | Chrome 85+, Edge 85+, Opera 71+ (la app avisa y omite si no está disponible) |
| Web Audio API | Todos los navegadores modernos |
| `createImageBitmap` | Chrome 50+, Firefox 42+, Safari 15+ (con fallback a `<img>`) |
| MP3 export | Requiere lamejs desde CDN (la lógica sigue siendo 100% local) |
| JSZip / lamejs | Requieren conexión la primera vez (CDN); los datos nunca salen del dispositivo |

---

## 🔒 Privacidad

- No hay cookies, analytics ni telemetría.
- Los archivos se leen con la File API y viven solo en memoria (`ArrayBuffer`, `Blob`, `AudioBuffer`).
- Se persisten únicamente dos preferencias: el acento de color (`localStorage`) y la última pestaña abierta (`sessionStorage`).
- Los CDNs (Tailwind, JSZip, lamejs) solo cargan código; ningún dato se envía a ellos.

---

## 📋 Changelog

### v1.3.1
- Corregidas erratas en JSON-LD de landings; versión actualizada.

### v1.3.0
- **SEO multi-buscador:** canonical + robots + Open Graph + Twitter Card + JSON-LD (WebApplication + FAQPage), meta de verificación preparadas para Google Search Console, Bing Webmaster e Yandex, footer con enlaces internos de herramientas.
- **5 landings de acceso con contenido único y FAQ marcada** (`comprimir-imagenes`, `convertir-webp-avif`, `optimizar-svg`, `convertir-audio`, `limpiar-texto`) — una puerta de entrada indexable por herramienta.
- **`sitemap.xml` y `robots.txt`** listos para Search Console/Bing, con guía completa de alta e IndexNow en el README.
- **Accesibilidad:** skip-link al contenido, banner `noscript`, foco visible y contraste ya presentes.

### v1.2.0
- **Compatibilidad masiva de entrada (38 extensiones):** TIFF, JPEG XL, HEIF/HEIC, RAW de cámara (DNG/CR2/CR3/NEF/ARW/ORF/RW2/…), TGA, HDR Radiance y EXR, con clasificación honesta nativo / bajo demanda / no viable y panel visual de estado en la UI.
- **Decodificadores sin dependencias escritos a medida:** TGA (tipos 2/10/11, 16/24/32 bits, RLE y flip vertical) y HDR Radiance (scanlines RLE y plano RGBE, tone-mapping Reinhard).
- **Detección por firma binaria:** archivos sin extensión reconocida se identifican por magic bytes (TIFF, TGA, HDR, EXR, ISO-BMFF).
- **RAW:** extracción automática del JPEG de previsualización incrustado (el SOI…EOI más grande), con aviso de que se procesa la preview de cámara.
- **Usabilidad:** los archivos que fallan se retiran de la cola automáticamente (el toast explica el motivo); los exitosos permanecen para re-procesar con otros ajustes.
- **Panel de compatibilidad desplegable** con contador de formatos listos y notas por formato.

### v1.1.0
- **Imágenes:** modo de reescalado *fit* / *stretch*, badges de ahorro por archivo y formato, corrección del pipeline multi-formato (JPEG ya no aplana la transparencia de las demás variantes), detección EXIF optimizada (solo 256 KB), `canEncode` sin comprobaciones duplicadas.
- **SVG:** eliminación de atributos de editor (`data-name`, `inkscape:*`, `sodipodi:*`), modo responsive (sin width/height fijos), minificador seguro para `<style>`/`<text>`.
- **Audio:** normalización a −1 dBFS por pico real, inversión de pista, velocidad de reproducción 0.25×–2×.
- **Texto:** colapsar líneas vacías consecutivas, eliminar duplicadas, ordenar con `Intl.Collator` natural (A–Z / Z–A), contador de palabras.
- **Global:** dedupe de nombres en zips, progreso real de empaquetado en el botón de descarga, atajos Ctrl+1…4, restauración de última pestaña, handler global de errores, manifest PWA-lite + icono.

### v1.0.0
- Lanzamiento inicial: 4 módulos, tema OLED con 4 acentos neón, glassmorphism, zip automático.

---

## 📄 Licencia

MIT — haz lo que quieras con esto.
