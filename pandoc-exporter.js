/*
  Pandoc exporter for EdiMarkdown.
  Reuses the Pandoc WASM bridge from MDAITex (pandoc-wasm.js).
*/
import { pandoc } from './pandoc-wasm.js';
import {
  MARKDOWN_READER_NO_AUTO_IDS,
  MARKDOWN_WRITER,
  convertWithAstPasses,
  buildExportArgs,
  buildImportArgs,
  stripEpubAnchorPrefixes,
  readEpubMetadata,
  dropDuplicateEpubTitle,
  collapseThematicBreaks,
  expandDisplayMath,
  restoreImportedCitations,
  stripUnsafeMarkup,
  normalizeNewlines,
  normalizeThematicBreaks,
  trimInlineMath,
  ensureEpubMetadata,
  ensureExportMetadata,
  requestDocxFieldUpdate,
  fillOdtTableOfContents,
  splitFrontMatter,
  readOutlineFromFrontMatter,
  resolveOutlineOptions,
  outlineFrontMatterEntries,
  appendEpubStylesheet,
  FIGURE_CSS,
  markdownHasFigures,
  applyOfficeFormat,
  mergeFrontMatter,
  prepareLatexStandalone,
  insertLatexPageBreaksBeforeH1,
  extractMarkdownTitle,
  collectFetchableImageUrls,
  inlineArchiveImages,
  restoreOdtTableHeaders,
  prepareOdtForImport,
  replaceImageUrls,
  dropImagesByUrl,
} from './pandoc-prepare.js';

const FORMATS = {
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    defaultFilename: 'documento.docx',
    preparingKey: 'docx_export_preparing',
    preparingFallback: 'Preparando DOCX, espera...',
    doneKey: 'docx_export_done',
    doneFallback: 'Exportación a DOCX completada.',
    errorKey: 'docx_export_error',
    errorFallback: 'Error durante la exportación a DOCX.',
  },
  odt: {
    mime: 'application/vnd.oasis.opendocument.text',
    defaultFilename: 'documento.odt',
    preparingKey: 'odt_export_preparing',
    preparingFallback: 'Preparando ODT, espera...',
    doneKey: 'odt_export_done',
    doneFallback: 'Exportación a ODT completada.',
    errorKey: 'odt_export_error',
    errorFallback: 'Error durante la exportación a ODT.',
  },
  epub: {
    pandocFormat: 'epub3',
    mime: 'application/epub+zip',
    defaultFilename: 'documento.epub',
    preparingKey: 'epub_export_preparing',
    preparingFallback: 'Preparando EPUB, espera...',
    doneKey: 'epub_export_done',
    doneFallback: 'Exportación a EPUB completada.',
    errorKey: 'epub_export_error',
    errorFallback: 'Error durante la exportación a EPUB.',
  },
};

/*
  El comprimido va primero: son 19 MB en lugar de 70 MB para el mismo base64.
  La variante sin comprimir se queda como respaldo porque la descompresión
  necesita DecompressionStream; donde no exista, readResponseAsText devuelve
  una cadena vacía y el bucle pasa a la fuente siguiente. No hay copia en
  otro sitio: la de mdaitex que había de reserva solo entraba si fallaba el
  propio servidor de la aplicación, y entonces ya no carga nada más.
*/
const PANDOC_WASM_SOURCES = [
  { url: 'pandoc.b64.gz', gzip: true },
  { url: 'pandoc.b64', gzip: false },
];
const MAX_RETRIES = 3;
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);

let base64PandocWasm = null;
let pandocInitialized = false;


function translate(key, fallback = '') {
  const catalog = window.__edimarkTranslations;
  if (catalog && Object.prototype.hasOwnProperty.call(catalog, key)) {
    return catalog[key];
  }
  return fallback;
}

function escapeHtmlEntities(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function extractBracedContent(source, command) {
  if (typeof source !== 'string' || !command) return null;
  const regex = new RegExp(`\\\\${command}\\s*\\{`, 'i');
  const match = regex.exec(source);
  if (!match) return null;
  let idx = match.index + match[0].length;
  let depth = 1;
  while (idx < source.length) {
    const char = source[idx];
    if (char === '\\') {
      idx += 2;
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(match.index + match[0].length, idx);
      }
    }
    idx += 1;
  }
  return null;
}

function extractLatexMetadata(latex) {
  const normalized = typeof latex === 'string' ? latex : '';
  const title = extractBracedContent(normalized, 'title');
  const hasMakeTitle = /\\maketitle\b/.test(normalized);
  return {
    title: title ? title.trim() : '',
    hasMakeTitle,
  };
}

function ensureMarkdownTitle(markdown, { title, hasMakeTitle }) {
  if (!title || !hasMakeTitle) return markdown;
  const sanitizedTitle = title.replace(/\s+/g, ' ').trim();
  if (!sanitizedTitle) return markdown;
  const lines = markdown.split(/\r?\n/);
  const firstContentIndex = lines.findIndex(line => line.trim() !== '');
  if (firstContentIndex !== -1) {
    const firstLine = lines[firstContentIndex];
    if (/^#{1,6}\s+/.test(firstLine)) {
      return markdown;
    }
  }
  const insertion = [`# ${sanitizedTitle}`, ''];
  if (firstContentIndex === -1) {
    return insertion.join('\n');
  }
  const updated = [
    ...lines.slice(0, firstContentIndex),
    ...insertion,
    ...lines.slice(firstContentIndex),
  ];
  return updated.join('\n');
}

function currentLanguage() {
  return window.__edimarkLang || document.documentElement.lang || 'es';
}

// Ajustes de exportación del usuario, publicados por script.js al leerlos del
// almacenamiento local.
function documentSettings() {
  const settings = window.__edimarkLatexSettings;
  return settings && typeof settings === 'object' ? settings : {};
}

/*
  La bibliografía y el estilo viven en los ajustes locales. Pandoc se ejecuta
  dentro de WASM y no ve el disco: bibliography.js les da un nombre fijo, los
  convierte en bytes y devuelve las opciones que apuntan a esos archivos.
*/
const BUILTIN_CSL_FILES = {
  apa: 'apa.csl',
  'chicago-author-date': 'chicago-author-date.csl',
  'modern-language-association': 'modern-language-association.csl',
  ieee: 'ieee.csl',
};
const cslStyleCache = new Map();

async function builtInCsl(style) {
  const filename = BUILTIN_CSL_FILES[style] || BUILTIN_CSL_FILES.apa;
  if (cslStyleCache.has(filename)) return cslStyleCache.get(filename);
  const response = await fetch(`csl/${filename}`);
  if (!response.ok) throw new Error(`csl_http_${response.status}`);
  const content = await response.text();
  cslStyleCache.set(filename, content);
  return content;
}

async function citationResources() {
  const api = window.EdiMarkBibliography;
  if (!api || typeof api.pandocResources !== 'function') return { args: '', files: {} };
  const settings = documentSettings();
  const custom = settings.citationStyle === 'custom' && String(settings.cslContent || '').trim();
  if (custom) return api.pandocResources(settings);
  const resources = api.pandocResources({ ...settings, cslContent: '', cslName: '' });
  if (!resources.args) return resources;
  const content = await builtInCsl(settings.citationStyle || 'apa');
  resources.files['style.csl'] = new TextEncoder().encode(content);
  resources.args += ' --csl=/style.csl';
  return resources;
}

function bibliographySectionTitle() {
  const custom = String(documentSettings().bibliographyTitle || '').replace(/[\r\n]+/g, ' ').trim();
  return custom || translate('bibliography_default_title', 'Referencias');
}

function withBibliographySection(markdown, citations) {
  if (!citations.args || !/\[[^\]\n]*@[^\]\n]+\]/.test(markdown)) return markdown;
  // Si el documento ya reservó el lugar de citeproc, respetamos su estructura.
  if (/^:::\s*\{[^}]*#refs\b[^}]*\}\s*$/m.test(markdown)) return markdown;
  const level = Math.min(6, Math.max(1, Number(documentSettings().bibliographyHeadingLevel) || 2));
  const title = bibliographySectionTitle().replace(/([\\`*_[\]{}<>])/g, '\\$1');
  return `${markdown.replace(/\s+$/, '')}\n\n${'#'.repeat(level)} ${title}\n\n::: {#refs}\n:::\n`;
}

/*
  Las rutas que hacen portable el documento —la bibliografía y el estilo propio—
  apuntan a archivos del disco, y Pandoc corre dentro de WASM, donde no existen:
  los mismos archivos entran por `citationResources` con un nombre fijo. Dejar
  las rutas en los metadatos solo serviría para que la exportación fallara al no
  poder abrirlas.
*/
const PORTABLE_METADATA_KEYS = /^(?:bibliography|csl)\s*:/i;

function withoutPortableBibliographyMetadata(markdown) {
  const { frontMatter, body } = splitFrontMatter(markdown);
  if (!frontMatter || !new RegExp(PORTABLE_METADATA_KEYS.source, 'mi').test(frontMatter)) return markdown;
  const kept = frontMatter.split('\n').slice(1, -1)
    .filter(line => !PORTABLE_METADATA_KEYS.test(line));
  return kept.length ? `---\n${kept.join('\n')}\n---\n\n${body}` : body;
}

/*
  Idioma del documento exportado. Por omisión sigue al de la interfaz: fijarlo
  al valor de hoy dejaría los documentos de mañana en un idioma que el usuario
  ya no está usando y no sabría de dónde sale.
*/
function documentLanguage() {
  const chosen = String(documentSettings().documentLanguage || '').trim();
  return chosen && chosen !== 'auto' ? chosen : currentLanguage();
}

// Autor por omisión. Vacío salvo que el usuario lo escriba, y siempre por
// detrás del que el documento declare por su cuenta.
function documentAuthor() {
  return String(documentSettings().documentAuthor || '').trim();
}

/*
  Formato del documento: alineación, letra, interlineado, márgenes, sangría y
  partición. El documento manda sobre los ajustes generales, y lo que ninguno
  fije no se escribe, de modo que un documento sin formato propio se exporta
  como se ha exportado siempre.
*/
function documentFormatApi() {
  return window.EdiMarkDocumentFormat || null;
}

function resolvedDocumentFormat(markdown) {
  const api = documentFormatApi();
  if (!api) return null;
  const general = documentSettings().documentFormat || {};
  const { frontMatter } = splitFrontMatter(typeof markdown === 'string' ? markdown : '');
  const own = api.readFromFrontMatter(frontMatter);
  const resolved = api.resolveDocumentFormat(general, own);
  return api.isEmptyFormat(resolved) ? null : resolved;
}

/*
  Hoja de estilos para HTML y EPUB. En el EPUB va como archivo, que es lo que
  Pandoc empaqueta dentro del libro; en el HTML como bloque en la cabecera,
  porque una hoja aparte sería un enlace roto en cuanto se mueva el archivo.
*/
function documentFormatCss(markdown) {
  const api = documentFormatApi();
  const format = resolvedDocumentFormat(markdown);
  if (!api || !format) return '';
  return api.toCssRules(format);
}

/*
  Lo que el formato del documento aporta al TEX. Lo que Pandoc sabe escribir
  viaja como metadato y el resto se suma al preámbulo del usuario, que va
  primero: si él ya carga `geometry`, sus márgenes mandan y los del menú se
  descartan en vez de romper la compilación con un choque de opciones.
*/
function documentFormatForLatex(markdown, userPreamble) {
  const api = documentFormatApi();
  const format = resolvedDocumentFormat(markdown);
  const preamble = String(userPreamble || '');
  if (!api || !format) return { entries: [], preamble, dropped: [] };
  const hasGeometry = /\\usepackage(\[[^\]]*\])?\{geometry\}/.test(preamble);
  const latex = api.toLatex(format, { hasGeometry });
  const lines = [preamble.trim(), ...latex.preamble].filter(Boolean);
  return { entries: latex.entries, preamble: lines.join('\n'), dropped: latex.dropped };
}

/*
  Portada del EPUB.

  Sin imagen de portada, el libro sale con el icono genérico en la estantería
  del lector. Hay tres modos: ninguna, una generada con el título y el autor, y
  la que elija el usuario.
*/
const COVER_MIME_EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function dataUriToBytes(dataUri) {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(String(dataUri || ''));
  if (!match) return null;
  const [, mime, isBase64, payload] = match;
  try {
    const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return { bytes, mime };
  } catch (error) {
    console.warn('La imagen de portada guardada no se pudo leer:', error);
    return null;
  }
}

/*
  Portada dibujada al vuelo: proporción de libro, el título grande y el autor
  al pie. Se genera en cada exportación en lugar de guardarse, que es una cosa
  menos ocupando el almacenamiento del navegador.
*/
function drawCover({ title, author }) {
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 1800;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(0, canvas.height - 220, canvas.width, 18);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#f8fafc';
  ctx.font = '600 96px Georgia, "Times New Roman", serif';

  // El título se parte por palabras: una línea única se saldría del lienzo.
  const words = String(title || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width > canvas.width - 240 && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);

  const visible = lines.slice(0, 6);
  const startY = canvas.height / 2 - ((visible.length - 1) * 120) / 2;
  visible.forEach((line, index) => ctx.fillText(line, canvas.width / 2, startY + index * 120));

  if (author) {
    ctx.font = '400 56px Georgia, "Times New Roman", serif';
    ctx.fillStyle = '#cbd5f5';
    ctx.fillText(author, canvas.width / 2, canvas.height - 120);
  }

  const dataUri = canvas.toDataURL('image/jpeg', 0.85);
  return dataUriToBytes(dataUri);
}

/*
  Devuelve el nombre del archivo montado y sus bytes, o null si no hay portada.
  El nombre lleva extensión porque Pandoc deduce de ella el tipo de imagen.
*/
function epubCoverFile({ title, author }) {
  const settings = documentSettings();
  const mode = String(settings.epubCover || 'none');
  let image = null;
  if (mode === 'custom') {
    image = dataUriToBytes(settings.epubCoverImage);
  } else if (mode === 'auto') {
    try {
      image = drawCover({ title, author });
    } catch (error) {
      console.warn('No se pudo generar la portada del EPUB:', error);
    }
  }
  if (!image || !image.bytes.length) return null;
  const extension = COVER_MIME_EXTENSIONS[image.mime] || 'png';
  return { name: `cover.${extension}`, bytes: image.bytes };
}

/*
  Índice y numeración de apartados. Se aplican con banderas y no como datos del
  documento: `toc: true` en los metadatos lo entienden LaTeX y HTML, pero el
  escritor DOCX lo ignora, y la numeración solo funciona con la bandera. Aun
  así las claves viven en el bloque de metadatos, porque son decisiones de cada
  documento —un manual quiere índice y una nota de dos párrafos no— y lo que el
  documento no diga lo ponen las opciones generales.
*/
/*
  El ancho del texto en la página, que solo hace falta para convertir un ancho
  de columna en número de columnas. Sin papel ni márgenes propios, el de la
  función que lo usa.
*/
function textWidthCm({ paperCm, marginsCm = {} } = {}) {
  if (!paperCm) return undefined;
  const left = typeof marginsCm.left === 'number' ? marginsCm.left : 2.5;
  const right = typeof marginsCm.right === 'number' ? marginsCm.right : 2.5;
  return Math.max(1, paperCm.width - left - right);
}

function documentOutlineOptions(markdown) {
  const settings = documentSettings();
  const { frontMatter } = splitFrontMatter(typeof markdown === 'string' ? markdown : '');
  return resolveOutlineOptions(
    {
      toc: settings.documentToc === true,
      tocDepth: settings.documentTocDepth,
      numberSections: settings.documentNumberSections === true,
    },
    readOutlineFromFrontMatter(frontMatter),
  );
}

/*
  Rótulo del índice, en el idioma del documento y no en el de la interfaz.

  Pandoc no lo traduce en DOCX ni en ODT: un documento en castellano salía con
  «Table of Contents». Para un idioma que la aplicación no habla se deja el
  suyo, que es mejor que imponerle el español.
*/
const TOC_TITLES = {
  es: 'Índice',
  en: 'Contents',
  ca: 'Índex',
  gl: 'Índice',
  eu: 'Aurkibidea',
};

function tocTitleFor(lang, markdown) {
  if (!documentOutlineOptions(markdown).toc) return '';
  const base = String(lang || '').toLowerCase().split(/[-_]/)[0];
  return TOC_TITLES[base] || '';
}

// Los tres ajustes de LaTeX solo afectan al documento completo.
function currentLatexSettings() {
  const settings = documentSettings();
  return {
    documentClass: settings.documentClass || '',
    classOptions: settings.classOptions || '',
    preamble: settings.preamble || '',
  };
}

/*
  Presupuesto de imágenes incrustadas.

  Pandoc dentro del WASM paga cada imagen muy caro: un GIF de 3 MB tarda unos
  40 s en llegar al ODT, y el coste crece más deprisa que el tamaño, así que un
  documento con varias imágenes grandes deja el navegador colgado. Por encima de
  este presupuesto la imagen se omite y queda su texto alternativo, que es lo que
  Pandoc haría por su cuenta pero sin la espera.
*/
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_IMAGE_BYTES = 4 * 1024 * 1024;

async function fetchImageBlob(url, readLocalImage) {
  const localBlob = await readLocalImage?.(url);
  if (localBlob) return { blob: localBlob, size: localBlob.size, local: true };
  const response = await fetch(url, { mode: 'cors' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  /*
    Una ruta que no existe rara vez responde 404: muchos servidores devuelven
    la página de inicio con un 200 tan campante. Sin mirar el tipo, esa página
    acababa incrustada como `data:text/html` y Pandoc la volcaba como texto,
    llenando el documento exportado de base64.
  */
  const type = (response.headers.get('content-type') || '').toLowerCase();
  if (type && !type.startsWith('image/')) {
    throw new Error(`No es una imagen: ${type}`);
  }
  // Si el servidor anuncia el tamaño, se descarta sin llegar a descargarla.
  const announced = Number(response.headers.get('content-length'));
  if (Number.isFinite(announced) && announced > MAX_IMAGE_BYTES) {
    return { blob: null, size: announced };
  }
  const blob = await response.blob();
  return { blob, size: blob.size };
}

function blobToDataUri(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('read_failed'));
    reader.readAsDataURL(blob);
  });
}

/*
  Pandoc runs inside WASM without network or file system, so any image it has to
  resolve on its own is lost: a remote URL aborts the conversion and a relative
  path (`imagenes/formulas.gif`) is silently replaced by its description.
  Download both here, where the browser resolves them against the page URL, and
  inline them as data URIs. Images that cannot be fetched (CORS, 404) fall back
  to their alt text so the export still produces a valid document.
*/
async function inlineFetchableImages(markdown, { onStatus } = {}) {
  const urls = collectFetchableImageUrls(markdown);
  if (urls.length === 0) {
    return { markdown, skipped: [], oversized: [], files: {} };
  }

  triggerStatus(onStatus, 'images_downloading', 'Descargando imágenes...');

  const readLocalImage = window.EdiMarkDocumentAssets?.createImageReader();
  const downloads = await Promise.all(urls.map(async (url) => {
    try {
      return { url, ...(await fetchImageBlob(url, readLocalImage)) };
    } catch (error) {
      console.warn(`No se pudo incrustar la imagen ${url}:`, error);
      return { url, blob: null, size: 0 };
    }
  }));

  const replacements = new Map();
  const files = {};
  const skipped = [];
  const oversized = [];
  let usedBytes = 0;

  // En orden de aparición, para que el presupuesto se gaste en las primeras.
  for (const { url, blob, size, local } of downloads) {
    if (!blob) {
      // Sin blob por tamaño anunciado es «demasiado grande», no «no se pudo».
      (size > MAX_IMAGE_BYTES ? oversized : skipped).push(url);
      continue;
    }
    // Los recursos del documento ya son locales: equivalen a las imágenes
    // data: originales y no consumen el presupuesto de descargas de Internet.
    if (!local && (size > MAX_IMAGE_BYTES || usedBytes + size > MAX_TOTAL_IMAGE_BYTES)) {
      oversized.push(url);
      continue;
    }
    try {
      if (local) {
        // Montar los bytes evita que Pandoc analice megabytes de Base64 como
        // Markdown; en Firefox una sola imagen grande puede tardar minutos.
        const extension = url.split(/[?#]/)[0].split('.').pop();
        const name = `edimark-image-${Object.keys(files).length}.${/^[a-z0-9]+$/i.test(extension) ? extension : 'png'}`;
        files[name] = new Uint8Array(await blob.arrayBuffer());
        replacements.set(url, `/${name}`);
      } else {
        replacements.set(url, await blobToDataUri(blob));
        usedBytes += size;
      }
    } catch (error) {
      console.warn(`No se pudo leer la imagen ${url}:`, error);
      skipped.push(url);
    }
  }

  const dropped = [...skipped, ...oversized];
  let prepared = replaceImageUrls(markdown, replacements);
  if (dropped.length > 0) {
    prepared = dropImagesByUrl(prepared, dropped);
  }
  return { markdown: prepared, skipped, oversized, files };
}

function stripPandocHeadingIds(markdown) {
  if (typeof markdown !== 'string' || !markdown.includes('{#')) {
    return markdown;
  }
  return markdown.replace(/\s*\{#[^}]+\}/g, '');
}

function sanitizeLatexInput(latex) {
  if (typeof latex !== 'string' || latex.length === 0) {
    return latex;
  }
  let sanitized = latex.replace(/\\label\{[^}]*\}/g, '');
  sanitized = sanitized.replace(/\\protect\\hypertarget\{[^}]*\}\{([^}]*)\}/g, '$1');
  sanitized = sanitized.replace(/\\hypertarget\{[^}]*\}\{([^}]*)\}/g, '$1');
  return sanitized;
}

async function readResponseAsText(response, gzip, throttled = false) {
  if (!gzip) {
    if (throttled || isIOS) {
      const reader = response.body?.getReader();
      if (!reader) {
        return (await response.text()).trim();
      }
      let result = '';
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += decoder.decode(value, { stream: true });
        if (throttled) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      result += decoder.decode();
      return result.trim();
    }
    return (await response.text()).trim();
  }

  if (typeof DecompressionStream === 'function' && response.body) {
    const decompressedStream = response.body.pipeThrough(new DecompressionStream('gzip'));
    const reader = decompressedStream.getReader();
    let result = '';
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      result += decoder.decode(value, { stream: true });
      if (throttled) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    result += decoder.decode();
    return result.trim();
  }

  // Fallback: rely on server-side decompression if available.
  return '';
}

// Recorre las fuentes en orden y devuelve el primer base64 que llegue entero.
async function fetchPandocBase64() {
  for (const source of PANDOC_WASM_SOURCES) {
    try {
      /*
        Sin `cache: 'no-store'`: el módulo pesa decenas de megas y no cambia
        entre versiones, así que forzar una descarga completa en cada visita
        (y en cada recarga) era el mayor coste de red de la aplicación. Con la
        caché normal del navegador basta una revalidación condicional.
      */
      const response = await fetch(source.url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      // El goteo es por presión de memoria en iOS, que la descompresión no
      // evita: lo que se acumula es el base64 ya expandido.
      const throttled = isIOS;
      const text = await readResponseAsText(response, source.gzip, throttled);
      if (text) return text;
    } catch (innerError) {
      console.warn(`Fallo al cargar ${source.url}:`, innerError);
    }
  }
  return '';
}

/*
  El presupuesto de reintentos es por llamada, no de por vida: un precalentado
  silencioso que falle no puede dejar sin exportación al resto de la sesión.
  El resultado solo se guarda cuando es válido, así que un intento fallido
  tampoco deja a medias el base64 que verá el siguiente.
*/
async function loadPandocWasm({ onStatus } = {}, silent = false) {
  if (base64PandocWasm && pandocInitialized) {
    return base64PandocWasm;
  }

  if (!silent && typeof onStatus === 'function') {
    onStatus(translate('initializing_pandoc', 'Inicializando Pandoc...'));
  }

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const text = await fetchPandocBase64();
      if (!text) {
        throw new Error('pandoc_wasm_unavailable');
      }
      if (text.length < 1000) {
        throw new Error('pandoc_wasm_invalid');
      }
      base64PandocWasm = text;
      pandocInitialized = true;
      return base64PandocWasm;
    } catch (error) {
      lastError = error;
      console.error(`Error en carga WASM (intento ${attempt}):`, error);
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  throw lastError || new Error('pandoc_wasm_unavailable');
}

function triggerStatus(onStatus, key, fallback, extra = '') {
  if (typeof onStatus === 'function') {
    const base = translate(key, fallback);
    onStatus(extra ? `${base} ${extra}`.trim() : base);
  }
}

function triggerNotification(onNotification, key, fallback) {
  if (typeof onNotification === 'function') {
    const message = translate(key, fallback);
    if (message) {
      onNotification(message);
    }
  }
}

async function saveBlob(blob, filename) {
  const platform = window.EdiMarkPlatform;
  if (platform && typeof platform.saveFile === 'function') {
    return platform.saveFile({
      suggestedName: filename,
      contents: blob,
      mimeType: blob.type,
      extensions: [String(filename || '').split('.').pop()].filter(Boolean),
    });
  }

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => {
    URL.revokeObjectURL(link.href);
  }, 1000);
  return { saved: true, path: '', name: filename };
}

async function exportDocument({
  format = 'docx',
  markdown = '',
  onStatus = () => {},
  onNotification = () => {},
  outputFilename,
  documentTitle = '',
} = {}) {
  const normalizedFormat = typeof format === 'string' ? format.toLowerCase() : 'docx';
  const config = FORMATS[normalizedFormat];
  if (!config) {
    throw new Error(`Unsupported format: ${format}`);
  }

  let normalized = normalizeThematicBreaks(normalizeNewlines(trimInlineMath(markdown || '')));
  if (!normalized.trim()) {
    const message = translate('no_content', 'No hay contenido para exportar.');
    throw new Error(message || 'No content');
  }
  let titleFromHeading = false;
  if (normalizedFormat === 'epub') {
    const prepared = ensureEpubMetadata(normalized, {
      fallbackTitle: documentTitle,
      untitledLabel: translate('untitled_document', 'Documento sin título'),
      lang: documentLanguage(),
      author: documentAuthor(),
      tocTitle: tocTitleFor(documentLanguage(), normalized),
    });
    normalized = prepared.markdown;
    titleFromHeading = prepared.titleFromHeading;
  } else {
    /*
      DOCX y ODT sin idioma salen marcados como inglés de EE. UU. y el corrector
      subraya el texto entero. El título no se les pasa: Pandoc imprimiría un
      párrafo con estilo «Título» encima del encabezado que el documento ya
      tiene, duplicándolo.
    */
    normalized = ensureExportMetadata(normalized, {
      lang: documentLanguage(),
      author: documentAuthor(),
      tocTitle: tocTitleFor(documentLanguage(), normalized),
    }).markdown;
  }
  // Se lee antes de tocar nada más: las claves siguen en el bloque de metadatos
  // del documento y de ahí salen los estilos que se aplican al archivo final.
  const exportFormat = resolvedDocumentFormat(normalized);
  const outline = documentOutlineOptions(normalized);

  triggerStatus(onStatus, config.preparingKey, config.preparingFallback);

  const {
    markdown: withImages,
    skipped: skippedImages,
    oversized: oversizedImages,
    files: imageFiles,
  } = await inlineFetchableImages(normalized, { onStatus });
  normalized = withImages;
  if (skippedImages.length > 0) {
    triggerNotification(
      onNotification,
      'images_not_embedded',
      'Algunas imágenes no se han podido descargar y se han omitido en el documento exportado.',
    );
  }
  // Motivo distinto, mensaje distinto: aquí la imagen sí estaba disponible.
  if (oversizedImages.length > 0) {
    triggerNotification(
      onNotification,
      'images_too_large',
      'Algunas imágenes son demasiado grandes para incrustarlas y se han omitido en el documento exportado. Se ha conservado su texto alternativo.',
    );
  }

  let iosTimer;
  if (isIOS) {
    const iosAdvice = translate('ios_specific_advice', '');
    if (iosAdvice) {
      iosTimer = setTimeout(() => {
        triggerStatus(onStatus, config.preparingKey, config.preparingFallback, iosAdvice);
      }, 1000);
    }
  }

  try {
    const base64 = await loadPandocWasm({ onStatus });
    let pandocArgs = buildExportArgs(config.pandocFormat || normalizedFormat, {
      mathml: normalizedFormat === 'odt' || normalizedFormat === 'epub',
      titleFromHeading,
      ...outline,
    });
    const citations = await citationResources();
    pandocArgs += citations.args;
    normalized = withoutPortableBibliographyMetadata(normalized);
    normalized = withBibliographySection(normalized, citations);
    /*
      La portada solo existe en el EPUB, y la imagen tiene que estar montada en
      el sistema de ficheros del WASM para que Pandoc la encuentre.
    */
    const extraFiles = { ...citations.files, ...imageFiles };
    if (normalizedFormat === 'epub') {
      const cover = epubCoverFile({
        title: extractMarkdownTitle(normalized) || String(documentTitle || '').trim(),
        author: documentAuthor(),
      });
      if (cover) {
        extraFiles[cover.name] = cover.bytes;
        pandocArgs += ` --epub-cover-image=/${cover.name}`;
      }
    }
    const api = documentFormatApi();
    const officeStyles = exportFormat && api ? api.toOfficeStyles(exportFormat) : {};
    const office = normalizedFormat === 'docx' || normalizedFormat === 'odt';
    const resultadoBytes = await convertWithAstPasses(
      (args, input) => pandoc(args, input, base64, extraFiles),
      pandocArgs, normalized, {
        mathFont: exportFormat?.font,
        columns: office ? { kind: normalizedFormat, toc: outline.toc, textWidthCm: textWidthCm(officeStyles) } : null,
      },
    );
    if (iosTimer) clearTimeout(iosTimer);

    // Pandoc reports internal failures by leaving the output file empty rather
    // than by throwing, so never hand the user a zero-byte download.
    if (!resultadoBytes || resultadoBytes.length === 0) {
      throw new Error('pandoc_empty_output');
    }

    /*
      El índice del DOCX es un campo que calcula Word, no texto: sin pedir la
      actualización de campos, el documento se abre con el índice vacío.
    */
    let finalBytes = resultadoBytes;
    if (outline.toc) {
      if (normalizedFormat === 'docx') finalBytes = await requestDocxFieldUpdate(resultadoBytes, outline.tocDepth);
      else if (normalizedFormat === 'odt') finalBytes = await fillOdtTableOfContents(resultadoBytes, outline.tocDepth);
    }
    /*
      El formato del texto va después del índice: los dos reescriben el mismo
      archivo, y hacerlo al final evita rehacer el ZIP dos veces por nada.
    */
    if (office) {
      finalBytes = await applyOfficeFormat(finalBytes, officeStyles, normalizedFormat);
    }
    if (normalizedFormat === 'epub') {
      const epubCss = [
        exportFormat ? documentFormatCss(normalized) : '',
        markdownHasFigures(normalized) ? FIGURE_CSS : '',
      ].filter(Boolean).join('\n');
      finalBytes = await appendEpubStylesheet(finalBytes, epubCss);
    }

    const blob = new Blob([finalBytes], { type: config.mime });
    const saveResult = await saveBlob(blob, outputFilename || config.defaultFilename);
    if (!saveResult || !saveResult.saved) return saveResult;

    triggerStatus(onStatus, config.doneKey, config.doneFallback);
    return saveResult;
  } catch (error) {
    if (iosTimer) clearTimeout(iosTimer);
    triggerStatus(onStatus, config.errorKey || 'export_error', config.errorFallback || 'Error durante la exportación.');
    if (isIOS) {
      triggerNotification(onNotification, 'ios_specific_advice', 'En iOS, si el problema persiste, prueba a cerrar y reiniciar el navegador.');
    }
    throw error;
  }
}

async function generateHtml({
  markdown = '',
  documentTitle = '',
  standalone = true,
  onStatus = () => {},
  onNotification = () => {},
} = {}) {
  const normalized = normalizeThematicBreaks(normalizeNewlines(trimInlineMath(markdown || '')));
  if (!normalized.trim()) {
    const message = translate('no_content', 'No hay contenido para exportar.');
    throw new Error(message || 'No content');
  }
  /*
    Solo la página completa lleva idioma y título; el fragmento se incrusta en
    una página ajena, que es la que los declara.

    Sin título, Pandoc rellena el <title> con el nombre de su archivo temporal:
    la página acababa titulada «in» en la pestaña del navegador y en las
    búsquedas. El primer encabezado, o el nombre de la pestaña, lo arreglan.
  */
  let withLanguage = standalone
    ? ensureExportMetadata(normalized, {
      lang: documentLanguage(),
      author: documentAuthor(),
      pageTitle: extractMarkdownTitle(normalized) || String(documentTitle || '').trim(),
      tocTitle: tocTitleFor(documentLanguage(), normalized),
    }).markdown
    : normalized;

  // HTML debe ser portable también cuando las imágenes viven en IndexedDB.
  // Los enlaces externos conservan su comportamiento habitual.
  const readLocalImage = window.EdiMarkDocumentAssets?.createImageReader();
  const htmlImages = new Map();
  if (readLocalImage) {
    const replacements = new Map();
    const prefix = `edimark-image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-`;
    for (const url of collectFetchableImageUrls(withLanguage)) {
      const blob = await readLocalImage(url);
      if (blob) {
        const placeholder = `${prefix}${htmlImages.size}.png`;
        replacements.set(url, placeholder);
        htmlImages.set(placeholder, await blobToDataUri(blob));
      }
    }
    withLanguage = replaceImageUrls(withLanguage, replacements);
  }

  const htmlFormatCss = standalone ? documentFormatCss(normalized) : '';

  triggerStatus(onStatus, 'html_export_preparing', 'Preparando HTML, espera...');

  try {
    const base64 = await loadPandocWasm({ onStatus });
    let pandocArgs = `-f ${MARKDOWN_READER_NO_AUTO_IDS} -t html --mathjax`;
    if (standalone) {
      pandocArgs += ' -s';
      const { toc, tocDepth, numberSections } = documentOutlineOptions(normalized);
      if (toc) pandocArgs += ' --toc';
      pandocArgs += ` --toc-depth=${tocDepth}`;
      if (numberSections) pandocArgs += ' --number-sections';
    }
    const citations = await citationResources();
    pandocArgs += citations.args;
    withLanguage = withoutPortableBibliographyMetadata(withLanguage);
    withLanguage = withBibliographySection(withLanguage, citations);
    const resultadoBytes = await convertWithAstPasses(
      (args, input) => pandoc(args, input, base64, citations.files),
      pandocArgs, withLanguage, { mathFont: standalone ? resolvedDocumentFormat(normalized)?.font : '' },
    );
    if (!resultadoBytes || resultadoBytes.length === 0) {
      throw new Error('pandoc_empty_output');
    }
    let htmlResult = new TextDecoder().decode(resultadoBytes);
    // Incrustar después de convertir el Markdown evita el coste de analizar
    // grandes cadenas Base64 y mantiene el HTML completamente autónomo.
    for (const [placeholder, dataUri] of htmlImages) {
      htmlResult = htmlResult.replaceAll(`src="${placeholder}"`, () => `src="${dataUri}"`);
    }

    const htmlCss = [htmlFormatCss, standalone && /<figure\b/.test(htmlResult) ? FIGURE_CSS : '']
      .filter(Boolean).join('\n');
    if (htmlCss) {
      // Al final de la cabecera para ganar a los estilos de la plantilla.
      const styleBlock = `<style>\n${htmlCss}\n</style>\n</head>`;
      htmlResult = htmlResult.replace(/<\/head>/i, () => styleBlock);
    }

    if (standalone) {
      // extractMarkdownTitle salta el código cercado: un `# npm install` dentro
      // de un bloque no es el título del documento.
      const title = extractMarkdownTitle(normalized)
        || translate('untitled_document', 'Documento sin título');
      if (title) {
        const replacement = `<title>${escapeHtmlEntities(title)}</title>`;
        // Con una cadena, un título que contenga `$&` o `$'` se expandiría.
        htmlResult = htmlResult.replace(/<title>.*?<\/title>/i, () => replacement);
      }
    }

    return htmlResult;
  } catch (error) {
    triggerStatus(onStatus, 'html_export_error', 'Error durante la exportación HTML.');
    throw error;
  }
}

async function generateLatex({
  markdown = '',
  standalone = false,
  onStatus = () => {},
  onNotification = () => {},
} = {}) {
  let normalized = normalizeThematicBreaks(normalizeNewlines(trimInlineMath(markdown || '')));
  if (!normalized.trim()) {
    const message = translate('no_content', 'No hay contenido para exportar.');
    throw new Error(message || 'No content');
  }

  /*
    El fragmento suelto va tal cual: se pega dentro de otro documento, que es
    quien pone el idioma y el título. Solo el documento completo los necesita.
  */
  let shiftHeadings = false;
  if (standalone) {
    const settings = currentLatexSettings();
    if (resolvedDocumentFormat(normalized)?.pageBreakBeforeH1 === 'yes') {
      normalized = insertLatexPageBreaksBeforeH1(normalized);
    }
    const latexFormat = documentFormatForLatex(normalized, settings.preamble || '');
    if (latexFormat.dropped.length) {
      // Dos `\usepackage{geometry}` abortan la compilación, así que manda el
      // preámbulo escrito a mano y los márgenes del menú se quedan fuera.
      triggerNotification(
        onNotification,
        'latex_margins_dropped',
        'El preámbulo ya carga geometry, así que los márgenes o la orientación del formato del documento no se han aplicado al TEX.',
      );
    }
    const prepared = prepareLatexStandalone(normalized, {
      lang: documentLanguage(),
      author: documentAuthor(),
      tocTitle: tocTitleFor(documentLanguage(), normalized),
      ...settings,
      preamble: latexFormat.preamble,
      extraEntries: latexFormat.entries,
    });
    normalized = prepared.markdown;
    shiftHeadings = prepared.shiftHeadings;
  }

  triggerStatus(onStatus, 'latex_export_preparing', 'Preparando LaTeX, espera...');

  try {
    const base64 = await loadPandocWasm({ onStatus });
    let pandocArgs = `-f ${MARKDOWN_READER_NO_AUTO_IDS} -t latex --no-highlight`;
    if (standalone) {
      pandocArgs = `-s ${pandocArgs}`;
      // El encabezado promovido a \title dejaría el resto colgando un nivel
      // por debajo del que les corresponde.
      if (shiftHeadings) pandocArgs += ' --shift-heading-level-by=-1';
      const { toc, tocDepth, numberSections } = documentOutlineOptions(normalized);
      if (toc) pandocArgs += ' --toc';
      pandocArgs += ` --toc-depth=${tocDepth}`;
      if (numberSections) pandocArgs += ' --number-sections';
    }
    const citations = await citationResources();
    pandocArgs += citations.args;
    normalized = withoutPortableBibliographyMetadata(normalized);
    normalized = withBibliographySection(normalized, citations);
    const resultadoBytes = await convertWithAstPasses(
      (args, input) => pandoc(args, input, base64, citations.files),
      pandocArgs, normalized, { mathFont: resolvedDocumentFormat(normalized)?.font },
    );
    if (!resultadoBytes || resultadoBytes.length === 0) {
      throw new Error('pandoc_empty_output');
    }
    let latexResult = new TextDecoder().decode(resultadoBytes);
    latexResult = latexResult.replace(/^[ \t]*\\tightlist\s*$(\r?\n)?/gm, '');
    return latexResult;
  } catch (error) {
    triggerStatus(onStatus, 'latex_export_error', 'Error durante la exportación a LaTeX.');
    throw error;
  }
}

async function convertLatexToMarkdown({
  latex = '',
  onStatus = () => {},
} = {}) {
  const normalizedLatex = normalizeNewlines(latex || '');
  if (!normalizedLatex.trim()) {
    const message = translate('no_content', 'No hay contenido para exportar.');
    throw new Error(message || 'No content');
  }

  triggerStatus(onStatus, 'latex_import_preparing', 'Convirtiendo LaTeX a Markdown...');

  try {
    const metadata = extractLatexMetadata(normalizedLatex);
    const base64 = await loadPandocWasm({ onStatus });
    const sanitizedLatex = sanitizeLatexInput(normalizedLatex);
    const pandocArgs = `-f latex -t ${MARKDOWN_WRITER} --wrap=preserve`;
    const resultadoBytes = await pandoc(pandocArgs, sanitizedLatex, base64);
    // Pandoc deja el archivo de salida vacío en lugar de lanzar: sin esta
    // comprobación, el documento abierto se sustituiría por el resultado vacío.
    if (!resultadoBytes || resultadoBytes.length === 0) {
      throw new Error('pandoc_empty_output');
    }
    let markdownResult = new TextDecoder().decode(resultadoBytes);
    markdownResult = ensureMarkdownTitle(markdownResult, metadata);
    markdownResult = stripPandocHeadingIds(markdownResult);
    triggerStatus(onStatus, 'latex_import_done', 'Conversión a Markdown completada.');
    return restoreImportedCitations(trimInlineMath(normalizeNewlines(markdownResult)));
  } catch (error) {
    triggerStatus(onStatus, 'latex_import_error', 'No se pudo convertir el LaTeX.');
    throw error;
  }
}

const IMPORT_FORMATS = {
  latex: { from: 'latex', binary: false },
  docx: { from: 'docx', binary: true },
  odt: { from: 'odt', binary: true },
  epub: { from: 'epub', binary: true },
  html: { from: 'html', binary: false },
};

function normalizeImportData(data, { binary }) {
  if (binary) {
    if (data instanceof Uint8Array) return data;
    if (data instanceof ArrayBuffer) return new Uint8Array(data);
    if (typeof data === 'string') return new TextEncoder().encode(data);
    return new Uint8Array();
  }
  if (typeof data === 'string') return normalizeNewlines(data);
  if (data instanceof Uint8Array) {
    return normalizeNewlines(new TextDecoder().decode(data));
  }
  if (data instanceof ArrayBuffer) {
    return normalizeNewlines(new TextDecoder().decode(new Uint8Array(data)));
  }
  return '';
}

async function importToMarkdown({
  data,
  sourceFormat = 'latex',
  onStatus = () => {},
} = {}) {
  const config = IMPORT_FORMATS[sourceFormat];
  if (!config) {
    throw new Error(`Unsupported import format: ${sourceFormat}`);
  }
  const normalizedInput = normalizeImportData(data, config);
  let preparedInput = normalizedInput;
  let latexSourceForMetadata = null;
  if (config.from === 'latex') {
    const latexString = typeof normalizedInput === 'string'
      ? normalizedInput
      : new TextDecoder().decode(normalizedInput);
    latexSourceForMetadata = latexString;
    preparedInput = sanitizeLatexInput(latexString);
  }
  if ((typeof normalizedInput === 'string' && !normalizedInput.trim()) ||
      (normalizedInput instanceof Uint8Array && normalizedInput.length === 0)) {
    const message = translate('no_content', 'No hay contenido para exportar.');
    throw new Error(message || 'No content');
  }

  triggerStatus(onStatus, 'import_file_status_preparing', 'Importando con Pandoc...');

  try {
    const base64 = await loadPandocWasm({ onStatus });

    /*
      El escritor ODT de Pandoc referencia cada fórmula con una barra final que
      su propio lector no resuelve, así que un ODT exportado por la aplicación
      volvería sin sus fórmulas. Se repara la referencia antes de convertir.
    */
    if (sourceFormat === 'odt') {
      preparedInput = await prepareOdtForImport(normalizedInput);
    }

    const pandocArgs = buildImportArgs(config.from);
    const resultadoBytes = await pandoc(pandocArgs, preparedInput, base64);
    if (!resultadoBytes || resultadoBytes.length === 0) {
      throw new Error('pandoc_empty_output');
    }
    let markdownResult = new TextDecoder().decode(resultadoBytes);
    if (sourceFormat === 'latex') {
      const metadata = extractLatexMetadata(latexSourceForMetadata || '');
      markdownResult = ensureMarkdownTitle(markdownResult, metadata);
    }
    if (sourceFormat === 'epub') {
      markdownResult = stripEpubAnchorPrefixes(markdownResult);
      const book = await readEpubMetadata(normalizedInput);
      markdownResult = dropDuplicateEpubTitle(markdownResult, book.title);
      /*
        El idioma del libro vuelve al documento, que es donde la aplicación lo
        busca. Solo si el documento no trae ya el suyo: lo que diga el texto
        manda sobre lo que diga el envoltorio.
      */
      if (book.language) {
        markdownResult = mergeFrontMatter(markdownResult, [
          { key: 'lang', lines: [`lang: "${book.language.replace(/"/g, '\\"')}"`] },
        ]).markdown;
      }
    }
    if (sourceFormat === 'odt') {
      markdownResult = await restoreOdtTableHeaders(markdownResult, normalizedInput);
    }
    if (config.binary) {
      triggerStatus(onStatus, 'images_extracting', 'Extrayendo imágenes...');
      markdownResult = await inlineArchiveImages(markdownResult, normalizedInput);
    }
    markdownResult = stripPandocHeadingIds(markdownResult);
    // El archivo lo ha traído el usuario, pero no lo ha escrito él.
    markdownResult = stripUnsafeMarkup(markdownResult);
    triggerStatus(onStatus, 'import_file_success', 'Importación completada.');
    /*
      Pandoc escribe un Markdown correcto pero incómodo de editar: la regla
      horizontal como setenta y dos guiones y los `$$` pegados a la fórmula.
      El panel Markdown es el original del documento, así que se devuelven a
      la forma en que se escriben a mano. Después de normalizar los saltos de
      línea, que es lo que estas dos dan por hecho.
    */
    const normalized = trimInlineMath(normalizeNewlines(markdownResult));
    return restoreImportedCitations(collapseThematicBreaks(expandDisplayMath(normalized)));
  } catch (error) {
    triggerStatus(onStatus, 'import_file_error', 'No se pudo importar el archivo.');
    throw error;
  }
}

async function warmUpExporter() {
  try {
    await loadPandocWasm({}, true);
  } catch (error) {
    console.warn('No se pudo precargar Pandoc WASM:', error);
  }
}

window.PandocExporter = {
  exportDocument,
  generateHtml,
  generateLatex,
  convertLatexToMarkdown,
  importToMarkdown,
  trimInlineMath,
  warmUpExporter,
  // La interfaz las necesita para esconder el bloque de metadatos de la vista
  // previa y para escribir el idioma del documento.
  splitFrontMatter,
  mergeFrontMatter,
  // Y para leer y escribir el índice y la numeración de este documento.
  readOutlineFromFrontMatter,
  outlineFrontMatterEntries,
  // El editor visual enseña el índice cuando el documento lo pide, así que
  // necesita resolver lo mismo que la exportación y con el mismo rótulo.
  resolveOutlineOptions,
  tocTitleFor,
};

export { exportDocument, generateHtml, generateLatex, convertLatexToMarkdown, importToMarkdown, trimInlineMath, warmUpExporter, splitFrontMatter, mergeFrontMatter };
