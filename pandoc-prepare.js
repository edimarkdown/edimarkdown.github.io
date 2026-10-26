import { readZipEntries, mimeForPath, bytesToDataUri } from './zip-reader.js';
import { createZip } from './zip-writer.js';
import { extractOdtTableHeaders, restoreTableHeaders } from './odt-tables.js';
import { normalizeFormulaHrefs } from './odt-formulas.js';
import {
  TWIPS_PER_CM,
  applyDocxColumnSections,
  applyDocxFigureAlignment,
  applyDocxHyphenation,
  applyDocxMargins,
  applyDocxPageSize,
  applyDocxStyles,
  applyDocxTheme,
  applyOdtColumnSections,
  applyOdtFigureAlignment,
  applyOdtMargins,
  applyOdtPageSize,
  applyOdtStyles,
} from './office-format.js';

/*
  Pure Markdown preparation helpers used by pandoc-exporter.js.

  This module has no browser dependencies on purpose: every function here is
  plain string handling, so it can be unit tested outside the browser.
*/

export const MARKDOWN_READER = [
  'markdown',
  '+tex_math_dollars',
  '+tex_math_single_backslash',
  '+tex_math_double_backslash',
  '+raw_tex',
  '+autolink_bare_uris',
  '+task_lists',
  // La hoja conserva la puntuación literal; la exportación debe hacer lo mismo.
  '-smart',
].join('');

export const MARKDOWN_READER_NO_AUTO_IDS = `${MARKDOWN_READER}-auto_identifiers`;

/*
  Pandoc's Markdown writer defaults to space-aligned "simple" tables, which the
  preview (and GitHub-flavoured Markdown in general) renders as plain text.
  Every conversion back to Markdown asks for pipe tables instead.

  `smart` also goes: on the way out it spells typography back as ASCII, so a
  document that came in with rayas, comillas tipográficas and puntos
  suspensivos returned full of `---`, `"` and `...`. The characters are what
  the author wrote and what every one of these formats stores, so they travel
  as themselves. The reader also preserves literal typography, matching the preview.
*/
export const MARKDOWN_WRITER = [
  MARKDOWN_READER_NO_AUTO_IDS,
  '-simple_tables',
  '-multiline_tables',
  '-grid_tables',
  '+pipe_tables',
  '-smart',
].join('');

/*
  Columnas del DOCX y del ODT. En la hoja, un bloque `<div style="column-count:
  4">` reparte su contenido en columnas, pero los escritores de Pandoc no leen
  el estilo de un `div` y lo sacaban todo en una. Los dos formatos sí tienen
  columnas, solo que en otra pieza: Word las pone en la sección, así que el
  bloque se rodea de dos cortes de sección continuos, y LibreOffice en una
  sección propia (`text:section`). Se leen las mismas propiedades que entiende
  el navegador: `column-count`, `column-width`, el atajo `columns`, la
  separación (`column-gap`) y la línea entre columnas (`column-rule`).
*/
const CM_PER_UNIT = {
  px: 2.54 / 96, pt: 2.54 / 72, pc: 2.54 / 6, in: 2.54, cm: 1, mm: 0.1, q: 0.025,
  // Un `em` del navegador, con la letra de 16 px que trae por omisión.
  em: 16 * 2.54 / 96, rem: 16 * 2.54 / 96,
};

function lengthInCm(value) {
  const match = String(value || '').trim().match(/^(\d*\.?\d+)([a-z]*)$/i);
  if (!match) return null;
  const unit = match[2].toLowerCase();
  if (!unit) return Number(match[1]) === 0 ? 0 : null;
  return unit in CM_PER_UNIT ? Number(match[1]) * CM_PER_UNIT[unit] : null;
}

/*
  Lo mismo que hace el navegador con un ancho de columna: cuantas quepan en la
  línea, sin pasar del número pedido si también lo hay. El ancho del texto
  solo hace falta en ese caso; por omisión, el de un A4 con márgenes de 2,5 cm.
*/
export function readColumnLayout(style, textWidthCm = 16) {
  const declarations = {};
  String(style || '').split(';').forEach((declaration) => {
    const colon = declaration.indexOf(':');
    if (colon > 0) {
      declarations[declaration.slice(0, colon).trim().toLowerCase()] = declaration.slice(colon + 1).trim().toLowerCase();
    }
  });
  let count = 0;
  let widthCm = 0;
  (declarations.columns || '').split(/\s+/).filter(Boolean).forEach((part) => {
    if (/^\d+$/.test(part)) count = Number(part);
    else if (lengthInCm(part)) widthCm = lengthInCm(part);
  });
  if (/^\d+$/.test(declarations['column-count'] || '')) count = Number(declarations['column-count']);
  if (lengthInCm(declarations['column-width'])) widthCm = lengthInCm(declarations['column-width']);
  const gap = lengthInCm(declarations['column-gap']);
  const gapCm = gap === null ? CM_PER_UNIT.em : gap;
  if (widthCm) {
    const fit = Math.max(1, Math.floor((textWidthCm + gapCm) / (widthCm + gapCm)));
    count = count ? Math.min(count, fit) : fit;
  }
  if (count < 2) return null;
  const rule = [declarations['column-rule'], declarations['column-rule-style']]
    .filter(Boolean)
    .some(value => !/\b(none|hidden)\b/.test(value));
  return { count, gapCm: Math.round(gapCm * 1000) / 1000, rule };
}

/*
  El nombre del estilo de la sección del ODT lleva sus medidas, para que
  `applyOdtColumnSections` lo pueda declarar luego sin más datos.
*/
export function odtColumnStyleName({ count, gapCm, rule }) {
  return `EdiMarkdownColumns_${count}_${gapCm}cm${rule ? '_rule' : ''}`;
}

/*
  En Word, las propiedades de una sección van en el último párrafo de esa
  sección. Por eso el bloque necesita dos: uno antes, que cierra lo anterior
  en una columna, y otro al final, que cierra las columnas. Son párrafos
  vacíos, de modo que se les quita la altura casi entera.
*/
function docxSectionBreak(layout) {
  const cols = layout
    ? `<w:cols w:num="${layout.count}" w:space="${Math.round(layout.gapCm * TWIPS_PER_CM)}"${layout.rule ? ' w:sep="1"' : ''} />`
    : '';
  return '<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact" />'
    + `<w:sectPr><w:type w:val="continuous" />${cols}</w:sectPr></w:pPr></w:p>`;
}

/*
  Solo los bloques que están al nivel del cuerpo: ni Word ni LibreOffice
  admiten un cambio de sección dentro de una lista o de una cita. Un bloque en
  columnas dentro de otro tampoco: se queda en las columnas del de fuera.
*/
export function splitColumnSections(ast, kind, { toc = false, textWidthCm } = {}) {
  let sections = 0;
  // Con índice, lo primero del documento es el índice: tiene que quedar fuera.
  let afterBreak = !toc;
  const raw = text => ({ t: 'RawBlock', c: [kind === 'docx' ? 'openxml' : 'opendocument', text] });
  const walk = blocks => blocks.flatMap((block) => {
    if (block.t !== 'Div') {
      afterBreak = false;
      return [block];
    }
    const style = (block.c[0][2] || []).find(([key]) => key === 'style');
    const layout = style ? readColumnLayout(style[1], textWidthCm) : null;
    if (!layout) {
      block.c[1] = walk(block.c[1]);
      return [block];
    }
    sections += 1;
    const opening = kind === 'docx'
      ? (afterBreak ? [] : [raw(docxSectionBreak(null))])
      : [raw(`<text:section text:style-name="${odtColumnStyleName(layout)}" text:name="EdiMarkdownColumns${sections}">`)];
    const closing = raw(kind === 'docx' ? docxSectionBreak(layout) : '</text:section>');
    afterBreak = true;
    return [...opening, block, closing];
  });
  ast.blocks = walk(ast.blocks);
  return sections;
}

export function hasColumnBlocks(markdown) {
  return /<div\b[^>]*\bstyle\s*=\s*["'][^"']*\bcolumn(s|-count|-width)\s*:/i.test(markdown || '');
}

/*
  Las pasadas que necesitan el árbol del documento. Esta versión WASM de
  Pandoc no trae Lua, así que no hay filtros: se pide el JSON, se cambia aquí
  y se convierte desde él. Sin nada que cambiar, la conversión es directa.

  - La letra sin serifa se aplica solo a las fórmulas ya analizadas, de modo
    que el código, los dólares escapados, los metadatos y los alfabetos
    matemáticos explícitos quedan intactos.
  - Las columnas, en DOCX y ODT (`columns` lleva el formato y sus datos).
*/
export async function convertWithAstPasses(convert, args, markdown, { mathFont = '', columns = null } = {}) {
  const sansMath = mathFont === 'sans';
  const withColumns = Boolean(columns) && hasColumnBlocks(markdown);
  if (!sansMath && !withColumns) return convert(args, markdown);
  const reader = args.match(/(?:^|\s)-f\s+(\S+)/);
  if (!reader) throw new Error('pandoc_missing_reader');
  const bytes = await convert(`-f ${reader[1]} -t json`, markdown);
  if (!bytes?.length) throw new Error('pandoc_empty_output');
  const ast = JSON.parse(new TextDecoder().decode(bytes));
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.t === 'Math' && Array.isArray(node.c)) {
      node.c[1] = `\\mathsf{${node.c[1].trim()}\n}`;
      return;
    }
    Object.values(node).forEach(visit);
  }
  if (sansMath) visit(ast);
  if (withColumns) splitColumnSections(ast, columns.kind, columns);
  return convert(args.replace(/(^|\s)-f\s+\S+/, '$1-f json'), JSON.stringify(ast));
}

/*
  Kept here so tests exercise the same command line the app sends to Pandoc.

  The table of contents and the section numbering are command-line flags, not
  metadata: `toc: true` in the document works for LaTeX and HTML but is ignored
  by the DOCX writer, and `numbersections: true` numbers nothing outside LaTeX.
  The heading of the table of contents does travel as metadata (`toc-title`),
  which is how it avoids being called "Table of Contents" in a Spanish document.
*/
export function buildExportArgs(pandocFormat, {
  mathml = false,
  titleFromHeading = false,
  toc = false,
  numberSections = false,
  tocDepth = 3,
} = {}) {
  let args = `-f ${MARKDOWN_READER_NO_AUTO_IDS} -t ${pandocFormat}`;
  if (mathml) args += ' --mathml';
  // El EPUB ya trae su propio índice de navegación, que es el que usa el lector.
  if (toc && pandocFormat !== 'epub3') args += ' --toc';
  if (Number.isInteger(tocDepth) && tocDepth >= 1 && tocDepth <= 3) args += ` --toc-depth=${tocDepth}`;
  if (numberSections) args += ' --number-sections';
  if (pandocFormat === 'epub3' && titleFromHeading) {
    // The body already opens with the title, so skip Pandoc's title page.
    args += ' --epub-title-page=false';
  }
  return args;
}

/*
  Índice y numeración de apartados. Son dos interruptores con tres estados: el
  documento puede pedirlos, puede rechazarlos y puede no decir nada, que es
  cuando manda la opción general. Las claves son las de Pandoc (`toc` y
  `numbersections`) aunque las banderas se sigan pasando por la línea de
  órdenes: así el bloque de metadatos se lee igual que el resto.
*/
export const OUTLINE_YAML_KEYS = [
  ['toc', 'toc'],
  ['tocDepth', 'toc-depth'],
  ['numberSections', 'numbersections'],
];

/*
  `true`, `false` o cadena vacía si el documento no se pronuncia. Se aceptan las
  formas que escribiría una persona, no solo las de Pandoc, porque el bloque de
  metadatos se teclea a mano.
*/
export function normalizeOutlineSwitch(value) {
  if (value === true) return true;
  if (value === false) return false;
  const raw = String(value ?? '').trim().toLowerCase().replace(/^["']|["']$/g, '');
  if (!raw) return '';
  if (['yes', 'true', 'sí', 'si', '1'].includes(raw)) return true;
  if (['no', 'false', '0'].includes(raw)) return false;
  return '';
}

export function normalizeTocDepth(value) {
  if (value === null || typeof value === 'undefined' || String(value).trim() === '') return '';
  const depth = Number.parseInt(String(value).trim().replace(/^['"]|['"]$/g, ''), 10);
  return depth >= 1 && depth <= 3 ? depth : '';
}

/* Lo que el documento declare por su cuenta, sin resolver herencias. */
export function readOutlineFromFrontMatter(frontMatter) {
  const source = typeof frontMatter === 'string' ? frontMatter : '';
  const outline = { toc: '', tocDepth: '', numberSections: '' };
  OUTLINE_YAML_KEYS.forEach(([field, key]) => {
    const match = source.match(new RegExp(`^${key}\\s*:\\s*(.*)$`, 'm'));
    if (!match) return;
    const value = match[1].trim().replace(/\s+#.*$/, '');
    outline[field] = field === 'tocDepth' ? normalizeTocDepth(value) : normalizeOutlineSwitch(value);
  });
  return outline;
}

/* Lo que el documento no diga lo pone el ajuste general. */
export function resolveOutlineOptions(general = {}, own = {}) {
  const document = {
    toc: normalizeOutlineSwitch(own.toc),
    tocDepth: normalizeTocDepth(own.tocDepth),
    numberSections: normalizeOutlineSwitch(own.numberSections),
  };
  const generalDepth = normalizeTocDepth(general.tocDepth);
  return {
    toc: document.toc === '' ? general.toc === true : document.toc,
    tocDepth: document.tocDepth === '' ? (generalDepth || 3) : document.tocDepth,
    numberSections: document.numberSections === '' ? general.numberSections === true : document.numberSections,
  };
}

/* Solo lo que el documento fije ocupa una línea en su bloque de metadatos. */
export function outlineFrontMatterEntries(outline = {}) {
  return OUTLINE_YAML_KEYS
    .map(([field, key]) => [key, field === 'tocDepth'
      ? normalizeTocDepth(outline[field])
      : normalizeOutlineSwitch(outline[field])])
    .filter(([, value]) => value !== '')
    .map(([key, value]) => ({
      key,
      lines: [`${key}: ${typeof value === 'boolean' ? (value ? 'true' : 'false') : value}`],
    }));
}

/*
  Importing an EPUB with the default writer produces `:::` fenced divs, empty
  `[]{#ch001.xhtml}` anchors and attribute-laden headings — structure that means
  nothing once the text is back in the editor. Turning those extensions off
  yields plain Markdown instead.
*/
const MARKDOWN_WRITER_PLAIN = [
  MARKDOWN_WRITER,
  '-fenced_divs',
  '-native_divs',
  '-bracketed_spans',
  '-native_spans',
  '-header_attributes',
  '-link_attributes',
  '-raw_html',
].join('');

export function buildImportArgs(fromFormat) {
  let writer = MARKDOWN_WRITER;
  if (fromFormat === 'epub') {
    writer = MARKDOWN_WRITER_PLAIN;
  } else if (fromFormat === 'docx' || fromFormat === 'odt') {
    /*
      By default images arrive as `![](x.png){width="8.876cm" ...}` and that
      attribute block shows up as literal text in the preview. Dropping
      link_attributes alone makes Pandoc fall back to a raw <img> tag, so
      raw_html has to go with it to get a plain `![](x.png)`.
    */
    writer += '-link_attributes-raw_html';
  }
  return `-f ${fromFormat} -t ${writer} --wrap=preserve`;
}

/*
  Pandoc escribe la línea horizontal como setenta y dos guiones y la fórmula en
  bloque con los `$$` pegados al contenido. Las dos formas son correctas y las
  dos se ven igual; el problema es el panel Markdown, que es donde el usuario
  trabaja: una regla de setenta y dos guiones ocupa una línea entera de ruido y
  una matriz que empieza en `$$A = \begin{pmatrix}` cuesta de leer y de editar.
  Se devuelven a la forma en que se escriben a mano, que es como salieron.
*/

/*
  Un renglón de guiones detrás de una línea en blanco es una regla; detrás de
  texto sería el subrayado de un encabezado, y ese no se toca.

  Vuelve como `---`, que es lo que el usuario escribe: al exportar de nuevo,
  `normalizeThematicBreaks` ya se encarga de pasarlo a `***` para que Pandoc no
  lo confunda con el principio de un bloque YAML.
*/
const LONG_THEMATIC_BREAK_RE = /(^|\n)\n-{3,}(?=\n)/g;

export function collapseThematicBreaks(markdown) {
  if (typeof markdown !== 'string') return '';
  return mapOutsideCode(markdown, text => text.replace(LONG_THEMATIC_BREAK_RE, '$1\n---'));
}

/*
  Solo el bloque que ocupa su propio párrafo: `$$` a principio de línea y otro
  al final del bloque. Una fórmula en línea dentro de un texto se queda donde
  está, y el contenido no se toca —ni siquiera se recorta— para no alterar una
  fórmula que ya venía repartida en varias líneas.
*/
const DISPLAY_MATH_RE = /\$\$(?!\$)([\s\S]*?)\$\$(?=\n|$)/g;

/*
  El principio de línea se mira sobre el documento entero, no sobre el tramo:
  partirlo por los códigos deja tramos que empiezan a media línea, y ahí un
  `^` diría que sí a un `$$` que va pegado a un `código`.
*/
export function expandDisplayMath(markdown) {
  const source = typeof markdown === 'string' ? markdown : '';
  let offset = 0;
  return splitCodeSegments(source).map((segment) => {
    const start = offset;
    offset += segment.text.length;
    if (segment.code) return segment.text;
    return segment.text.replace(DISPLAY_MATH_RE, (match, body, index) => {
      const at = start + index;
      if (at !== 0 && source[at - 1] !== '\n') return match;
      const inner = body.replace(/^\n+/, '').replace(/\n+$/, '');
      if (!inner.trim()) return match;
      return `$$\n${inner}\n$$`;
    });
  }).join('');
}

// EPUB internal links carry the source file name (#ch001.xhtml_seccion), which
// is meaningless outside the book.
export function stripEpubAnchorPrefixes(markdown) {
  if (typeof markdown !== 'string') return '';
  return markdown.replace(/\(#[^)\s]*?\.x?html_/g, '(#');
}

/*
  Desarma el HTML crudo que puede venir dentro de un documento importado.

  Un `.html` o un `.docx` ajeno puede traer `<img src=x onerror="…">` o un
  enlace `javascript:`. Ese Markdown acaba renderizado en la vista previa, que
  se ejecuta en el origen de la aplicación y con acceso a los documentos
  guardados, así que el manejador se quita en la aduana: al importar, una sola
  vez, sobre contenido que no ha escrito el usuario.

  Se limita a las etiquetas HTML y a los enlaces Markdown para no tocar la
  prosa: un texto que mencione `onclick=` fuera de una etiqueta se queda igual.
  El código, cercado o en línea, tampoco se toca: ahí un `<img onerror>` es
  texto que se muestra —el manual de la aplicación documenta etiquetas así— y
  reescribirlo estropearía el documento sin ganar nada.
*/
/*
  Los valores entrecomillados se consumen enteros, `>` incluido. Con un simple
  `[^>]*` la etiqueta se cortaba en el primer `>` aunque estuviera dentro de una
  comilla, y `<img src="a>" onerror="alert(1)">` se quedaba con su manejador
  mientras el navegador —que sí respeta las comillas— lo ejecutaba.
*/
const HTML_TAG_RE = /<[a-zA-Z][a-zA-Z0-9-]*(?:"[^"]*"|'[^']*'|[^>"'])*>/g;
const EVENT_ATTR_RE = /\s+on[a-zA-Z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g;
const URL_ATTR_RE = /\s+(href|src|xlink:href|action|formaction)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi;
// El destino admite paréntesis equilibrados, `javascript:alert(1)` entre ellos.
const MARKDOWN_LINK_RE = /(\]\(\s*)([^()\s]*(?:\([^()]*\)[^()\s]*)*)(\s+[^)]*)?(\))/g;
const INLINE_CODE_RE = /(`+[^`]*`+)/;
const UNSAFE_SCHEME_RE = /^(?:javascript:|vbscript:|data:text\/html)/i;

// Los caracteres de control parten esquemas como `java&#9;script:`.
function isUnsafeUrl(value) {
  const unquoted = String(value || '').replace(/^["']|["']$/g, '');
  return UNSAFE_SCHEME_RE.test(unquoted.replace(/[\u0000-\u0020]/g, ''));
}

function stripUnsafeFragment(text) {
  if (!text.includes('<') && !text.includes('](')) return text;
  return text
    .replace(HTML_TAG_RE, tag => tag
      .replace(EVENT_ATTR_RE, '')
      .replace(URL_ATTR_RE, (match, _name, value) => (isUnsafeUrl(value) ? '' : match)))
    .replace(MARKDOWN_LINK_RE, (match, prefix, url, _title, close) => (
      isUnsafeUrl(url) ? `${prefix}#${close}` : match
    ));
}

// Al partir por un grupo capturador, los índices impares son el código.
function stripUnsafeOutsideInlineCode(line) {
  return line
    .split(INLINE_CODE_RE)
    .map((part, index) => (index % 2 === 1 ? part : stripUnsafeFragment(part)))
    .join('');
}

export function stripUnsafeMarkup(markdown) {
  if (typeof markdown !== 'string' || markdown.length === 0) return markdown || '';
  let fence = null;
  return markdown.split('\n').map((line) => {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      return line;
    }
    return fence === null ? stripUnsafeOutsideInlineCode(line) : line;
  }).join('\n');
}

export function normalizeNewlines(str) {
  return typeof str === 'string' ? str.replace(/\r\n?/g, '\n') : '';
}

/*
  Matches the inline math trim used in MDAITex.

  Fuera del código, como todo lo que busca fórmulas: un `$` escrito dentro de
  un `código` no abre nada, pero el emparejamiento no lo sabía y acababa
  uniendo el `$` suelto de un ejemplo con el de la fórmula siguiente. En el
  manual, que explica los delimitadores escribiéndolos, «los delimitadores
  propios de LaTeX: $E = mc^2$» perdía el espacio de delante de la fórmula.
*/
export function trimInlineMath(content) {
  if (typeof content !== 'string') return '';
  return mapOutsideCode(content, text => text.replace(/\$(\s*)([^$\n]+?)(\s*)\$(?!\$)/g, (_match, _p1, expr) => {
    return `$${expr}$`;
  }));
}

export function escapeYamlValue(str) {
  return String(str).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// True only for a real YAML metadata block: an opening `---` with a matching
// `---` or `...` terminator. A lone `---` is a horizontal rule, not metadata.
export function hasYamlFrontMatter(markdown) {
  if (typeof markdown !== 'string') return false;
  const lines = markdown.split('\n');
  let index = 0;
  while (index < lines.length && lines[index].trim() === '') index += 1;
  if (index >= lines.length || lines[index].trim() !== '---') return false;
  for (let i = index + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === '---' || trimmed === '...') return true;
  }
  return false;
}

/*
  The YAML block split from the body.

  `frontMatter` keeps the raw text, delimiters included, so that it can be put
  back untouched: anything the user wrote there (comments, quoting style, key
  order) survives a round trip through the preview.

  `keys` only lists the top-level keys, which is all the callers need to know:
  whether the document already says something about a piece of metadata. The
  values of nested or multi-line entries are not parsed, and do not need to be.
*/
export function splitFrontMatter(markdown) {
  const source = typeof markdown === 'string' ? markdown : '';
  const empty = { frontMatter: '', body: source, keys: [], lang: '' };
  if (!hasYamlFrontMatter(source)) return empty;

  const lines = source.split('\n');
  let open = 0;
  while (open < lines.length && lines[open].trim() === '') open += 1;
  let close = -1;
  for (let i = open + 1; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (trimmed === '---' || trimmed === '...') { close = i; break; }
  }
  if (close === -1) return empty;

  const keys = [];
  let lang = '';
  for (let i = open + 1; i < close; i += 1) {
    // Solo el primer nivel: lo indentado pertenece a la clave anterior.
    const match = lines[i].match(/^([A-Za-z][\w-]*)\s*:(.*)$/);
    if (!match) continue;
    keys.push(match[1]);
    if (match[1] === 'lang') {
      lang = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }

  // El salto en blanco que separa los metadatos del cuerpo se va con ellos.
  let bodyStart = close + 1;
  if (bodyStart < lines.length && lines[bodyStart].trim() === '') bodyStart += 1;

  return {
    frontMatter: lines.slice(0, close + 1).join('\n'),
    body: lines.slice(bodyStart).join('\n'),
    keys,
    lang,
  };
}

/*
  Adds the entries the document does not already declare, keeping its own block
  as it is. Each entry brings its YAML lines already formatted, because a value
  can be a scalar, a list or a literal block.
*/
export function mergeFrontMatter(markdown, entries = []) {
  const source = typeof markdown === 'string' ? markdown : '';
  const { frontMatter, body, keys } = splitFrontMatter(source);
  const missing = entries.filter(entry => entry && entry.key && !keys.includes(entry.key));
  if (!missing.length) return { markdown: source, added: [] };

  const added = missing.flatMap(entry => entry.lines);
  if (!frontMatter) {
    return { markdown: `---\n${added.join('\n')}\n---\n\n${source}`, added: missing.map(e => e.key) };
  }
  const lines = frontMatter.split('\n');
  const closing = lines.pop();
  return {
    markdown: `${[...lines, ...added, closing].join('\n')}\n\n${body}`,
    added: missing.map(e => e.key),
  };
}

// First level-1 heading, skipping fenced code blocks so that a shell comment
// such as `# npm install` cannot be mistaken for the document title.
export function extractMarkdownTitle(markdown) {
  if (typeof markdown !== 'string') return '';
  const lines = markdown.split('\n');
  let fence = null;
  for (const line of lines) {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) {
        fence = marker;
      } else if (fence === marker) {
        fence = null;
      }
      continue;
    }
    if (fence !== null) continue;
    const heading = line.match(/^#\s+(.*)$/);
    if (heading) {
      const title = heading[1].trim().replace(/\s+#+\s*$/, '');
      if (title) return title;
    }
  }
  return '';
}

/*
  Pandoc reads a `---` line that follows a blank line as the start of a YAML
  metadata block, anywhere in the document. A Markdown file that uses `---` as
  a thematic break therefore fails to convert with a YAML parse error, and the
  conversion produces no output at all. Rewriting those breaks as `***` (same
  rendering, no ambiguity) keeps such documents exportable.

  Left untouched: `---` inside fenced code, a leading YAML metadata block, and
  a `---` directly under text, which is a level-2 setext heading.
*/
export function normalizeThematicBreaks(markdown) {
  if (typeof markdown !== 'string' || !markdown.includes('---')) return markdown || '';
  const lines = markdown.split('\n');

  let start = 0;
  if (hasYamlFrontMatter(markdown)) {
    while (start < lines.length && lines[start].trim() === '') start += 1;
    start += 1;
    while (start < lines.length && !['---', '...'].includes(lines[start].trim())) start += 1;
    start += 1;
  }

  let fence = null;
  for (let i = start; i < lines.length; i += 1) {
    const fenceMatch = lines[i].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      continue;
    }
    if (fence !== null) continue;
    if (lines[i].trim() !== '---') continue;
    /*
      Con cuatro espacios o más ya no es una raya, es código sangrado, y ahí
      Pandoc tampoco lo confunde con el principio de un bloque YAML: lo lee
      como lo que es. Importa porque un bloque cercado vuelve sangrado de
      cualquier conversión, y el manual explica el bloque de ajustes
      escribiéndolo entero —rayas incluidas—, que salía convertido en `***`.
    */
    if (/^ {4,}|^\t/.test(lines[i])) continue;
    // Text immediately above makes it a setext heading, not a break.
    if (i > start && lines[i - 1].trim() !== '') continue;
    lines[i] = lines[i].replace('---', '***');
  }

  return lines.join('\n');
}

/*
  EPUB requires a non-empty title and a language; without them Pandoc falls
  back to the temporary input filename ("in") and to en-US.

  Returns the markdown to convert plus `titleFromHeading`, which tells the
  caller whether the body already displays the title (so that Pandoc's
  generated title page would repeat it).

  What the document declares is kept and only the rest is filled in: since the
  language can now live in the document's own block, an all-or-nothing rule
  would cost it its title as soon as the user picked a language.
*/
export function ensureEpubMetadata(markdown, {
  fallbackTitle = '',
  untitledLabel = 'Documento sin título',
  lang = 'es',
  author = '',
  tocTitle = '',
} = {}) {
  const source = typeof markdown === 'string' ? markdown : '';
  const { keys } = splitFrontMatter(source);
  const headingTitle = keys.includes('title') ? '' : extractMarkdownTitle(source);
  const title = headingTitle || String(fallbackTitle || '').trim() || untitledLabel;
  const entries = [
    { key: 'title', lines: [`title: "${escapeYamlValue(title)}"`] },
    { key: 'lang', lines: [`lang: "${escapeYamlValue(lang || 'es')}"`] },
  ];
  // En un lector de libros el autor es un campo visible, y salía vacío.
  if (String(author || '').trim()) {
    entries.push({ key: 'author', lines: [`author: "${escapeYamlValue(String(author).trim())}"`] });
  }
  if (String(tocTitle || '').trim()) {
    entries.push({ key: 'toc-title', lines: [`toc-title: "${escapeYamlValue(String(tocTitle).trim())}"`] });
  }
  const { markdown: merged, added } = mergeFrontMatter(source, entries);
  return {
    markdown: merged,
    titleFromHeading: Boolean(headingTitle),
    injected: added.length > 0,
  };
}

/*
  Metadata for the formats that carry no block of their own: DOCX, ODT and
  standalone HTML.

  Without `lang` Pandoc writes `w:lang w:val="en-US"` into the DOCX styles and
  `fo:language="en" fo:country="US"` into the ODT ones, so Word and LibreOffice
  spell-check a Spanish text against an English dictionary and underline every
  other word. Standalone HTML is worse off: it gets `lang=""`, which tells a
  screen reader nothing at all.

  `pageTitle` becomes `pagetitle`, which is the HTML `<title>` and nothing else.
  Plain `title` would fill it too, but it also makes the template print a title
  block into the body, repeating the heading the document already opens with —
  and in DOCX and ODT it prints a "Title" paragraph above that same heading.
  That is why the title only travels to HTML, and through the back door.

  Whatever the document declares wins; this only fills what is missing.
*/
export function ensureExportMetadata(markdown, {
  lang = 'es',
  author = '',
  pageTitle = '',
  tocTitle = '',
} = {}) {
  const source = typeof markdown === 'string' ? markdown : '';
  const entries = [];
  const code = String(lang || '').trim();
  if (code) entries.push({ key: 'lang', lines: [`lang: "${escapeYamlValue(code)}"`] });
  const writer = String(author || '').trim();
  if (writer) entries.push({ key: 'author', lines: [`author: "${escapeYamlValue(writer)}"`] });
  const heading = String(pageTitle || '').trim();
  if (heading) entries.push({ key: 'pagetitle', lines: [`pagetitle: "${escapeYamlValue(heading)}"`] });
  const contents = String(tocTitle || '').trim();
  if (contents) entries.push({ key: 'toc-title', lines: [`toc-title: "${escapeYamlValue(contents)}"`] });
  if (!entries.length) return { markdown: source, injected: false };
  const { markdown: merged, added } = mergeFrontMatter(source, entries);
  return { markdown: merged, injected: added.length > 0 };
}

/*
  Where each level-1 heading sits, ignoring the ones inside fenced code blocks.
  `firstContentLine` is the first line with something other than blank space or
  a fence, which is what tells a title apart from a heading buried in the text.
*/
function scanTopLevelHeadings(lines) {
  const headings = [];
  let firstContentLine = -1;
  let fence = null;
  lines.forEach((line, index) => {
    const fenceMatch = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      if (firstContentLine === -1) firstContentLine = index;
      return;
    }
    if (fence !== null) return;
    if (line.trim() === '') return;
    if (firstContentLine === -1) firstContentLine = index;
    const heading = line.match(/^#\s+(.*)$/);
    if (heading) {
      headings.push({ index, text: heading[1].trim().replace(/\s+#+\s*$/, '') });
    }
  });
  return { headings, firstContentLine };
}

export const LATEX_DOCUMENT_CLASSES = ['article', 'report', 'book'];

/*
  LaTeX no tiene un metadato equivalente a «salto antes de H1». Se insertan
  órdenes raw solo para este escritor, delante de cada H1 salvo el primero; el
  Markdown original no se modifica y los cercados de código quedan intactos.
*/
export function insertLatexPageBreaksBeforeH1(markdown) {
  const source = typeof markdown === 'string' ? markdown : '';
  const { body, frontMatter } = splitFrontMatter(source);
  const lines = body.split('\n');
  const { headings } = scanTopLevelHeadings(lines);
  if (headings.length < 2) return source;
  const breaks = new Set(headings.slice(1).map(heading => heading.index));
  const expanded = [];
  lines.forEach((line, index) => {
    if (breaks.has(index)) expanded.push('\\clearpage', '');
    expanded.push(line);
  });
  return `${frontMatter ? `${frontMatter}\n\n` : ''}${expanded.join('\n')}`;
}

/*
  A user preamble is arbitrary LaTeX: backslashes, colons, quotes and blank
  lines. Quoting it would mean escaping all of that, so it goes in as a YAML
  literal block, where every indented line is taken verbatim. A `---` of the
  user's own cannot close the metadata block from there, because the terminator
  has to sit at column zero.
*/
function yamlLiteralBlock(key, value) {
  const lines = String(value).replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  return [`${key}: |`, ...lines.map(line => (line.trim() === '' ? '' : `  ${line}`))];
}

// "12pt, a4paper" as Pandoc expects it: one entry per option.
function yamlClassOptions(options) {
  const values = String(options)
    .split(',')
    .map(option => option.trim())
    .filter(Boolean);
  if (!values.length) return [];
  return ['classoption:', ...values.map(value => `- "${escapeYamlValue(value)}"`)];
}

/*
  Metadata for a standalone LaTeX document.

  Without `lang` Pandoc loads no babel/polyglossia at all, so a Spanish document
  gets English hyphenation. And a document that opens with a single `# Title`
  means that heading to be the title: promoting it to `\title` (with the rest of
  the headings shifted up a level) produces `\maketitle` instead of a `\section`
  where a title page belongs.

  The promotion is deliberately conservative. With several level-1 headings the
  document is using them as sections, so touching them would break its
  structure; `shiftHeadings` then stays false and only the language is added.
  A title the document already declares is respected as it is, heading included:
  removing the heading then would delete a title the author never asked to move.

  Each key the document declares wins over the app setting, and the rest are
  added. Anything else would mean that picking a language for a document —which
  writes `lang` into its block— silently dropped its class and preamble.

  `documentClass` and `classOptions` cannot be part of the preamble: the
  template has already emitted \documentclass by the time `header-includes`
  is inserted.
*/
export function prepareLatexStandalone(markdown, {
  lang = 'es',
  author = '',
  tocTitle = '',
  documentClass = '',
  classOptions = '',
  preamble = '',
  extraEntries = [],
} = {}) {
  const source = typeof markdown === 'string' ? markdown : '';
  const { keys, body: sourceBody, frontMatter } = splitFrontMatter(source);

  const bodyLines = sourceBody.split('\n');
  const { headings, firstContentLine } = scanTopLevelHeadings(bodyLines);
  const opensWithTitle = !keys.includes('title')
    && headings.length === 1
    && headings[0].index === firstContentLine
    && Boolean(headings[0].text);

  const entries = [];
  if (opensWithTitle) {
    entries.push({ key: 'title', lines: [`title: "${escapeYamlValue(headings[0].text)}"`] });
  }
  entries.push({ key: 'lang', lines: [`lang: "${escapeYamlValue(lang || 'es')}"`] });
  // Aquí el autor sí va en la portada: es donde \maketitle lo espera.
  if (String(author || '').trim()) {
    entries.push({ key: 'author', lines: [`author: "${escapeYamlValue(String(author).trim())}"`] });
  }

  if (String(tocTitle || '').trim()) {
    entries.push({ key: 'toc-title', lines: [`toc-title: "${escapeYamlValue(String(tocTitle).trim())}"`] });
  }
  const cls = String(documentClass || '').trim();
  if (LATEX_DOCUMENT_CLASSES.includes(cls)) {
    entries.push({ key: 'documentclass', lines: [`documentclass: "${escapeYamlValue(cls)}"`] });
  }
  const optionLines = yamlClassOptions(classOptions || '');
  if (optionLines.length) entries.push({ key: 'classoption', lines: optionLines });
  entries.push(...extraEntries);
  if (String(preamble || '').trim()) {
    entries.push({ key: 'header-includes', lines: yamlLiteralBlock('header-includes', preamble) });
  }

  // El encabezado promovido sale del cuerpo para no repetirse bajo \maketitle.
  const withoutTitle = opensWithTitle
    ? `${frontMatter ? `${frontMatter}\n\n` : ''}${bodyLines.filter((_, i) => i !== headings[0].index).join('\n')}`
    : source;
  const { markdown: merged, added } = mergeFrontMatter(withoutTitle, entries);

  return {
    markdown: merged,
    shiftHeadings: opensWithTitle,
    injected: added.length > 0,
  };
}

const MD_IMAGE_RE = /!\[[^\]]*\]\(\s*<?([^\s<>)]+)>?[^)]*\)/g;
const HTML_IMAGE_RE = /<img\b[^>]*?\ssrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi;

const isRemote = url => /^https?:\/\//i.test(url);
const isEmbedded = url => /^data:/i.test(url);

// Remote images abort the Pandoc WASM run (it has no network), so callers must
// resolve them before converting to DOCX/ODT/EPUB.
export function collectRemoteImageUrls(markdown) {
  return collectImageSources(markdown).filter(isRemote);
}

/*
  Everything the browser has to resolve before handing the Markdown to Pandoc.

  Inside the WASM there is neither network nor file system, so a relative path
  (`imagenes/formulas.gif`, `/assets/logo.png`) fails exactly like a remote URL:
  Pandoc warns "Could not fetch resource" and drops the image, keeping only its
  description. The browser can fetch both against the page URL, so both belong
  here. Only `data:` images are already self-contained.
*/
export function collectFetchableImageUrls(markdown) {
  return collectImageSources(markdown).filter(url => url && !isEmbedded(url));
}

// Images Pandoc points at inside the uploaded archive (Pictures/…, media/…).
export function collectArchiveImagePaths(markdown) {
  return collectImageSources(markdown).filter(url => !isRemote(url) && !isEmbedded(url));
}

/*
  Lo escrito como código no es contenido: un manual que enseña `![Foto](x.png)`
  entre acentos graves no está usando ninguna imagen, está hablando de ella.
  Tratarlo como una imagen de verdad llevaba a descargar esa ruta y a incrustar
  en el documento exportado lo que devolviera el servidor —una página de error
  entera, en el peor caso—, así que estos tramos se apartan antes de buscar.

  Se reconocen los bloques cercados y el código en línea. El de cuatro espacios
  se queda fuera: distinguirlo de un párrafo sangrado pide analizar el
  documento entero, y no es la forma en que se escribe un ejemplo suelto.
*/
const CODE_SEGMENT_RE = /(^|\n)([ \t]{0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]{0,3}\3[^\n]*(?=\n|$)|$)|(`+)(?:[^`]|(?!\4)`)*\4/g;

export function splitCodeSegments(markdown) {
  const source = typeof markdown === 'string' ? markdown : '';
  const segments = [];
  let index = 0;
  for (const match of source.matchAll(CODE_SEGMENT_RE)) {
    if (match.index > index) segments.push({ text: source.slice(index, match.index), code: false });
    segments.push({ text: match[0], code: true });
    index = match.index + match[0].length;
  }
  if (index < source.length) segments.push({ text: source.slice(index), code: false });
  return segments;
}

/* Aplica una transformación solo al texto que no es código. */
export function mapOutsideCode(markdown, transform) {
  return splitCodeSegments(markdown)
    .map(segment => (segment.code ? segment.text : transform(segment.text)))
    .join('');
}

// Solo para la salida Markdown generada por Pandoc al importar: una cita sin
// biblioteca llega de Word/ODT como texto, con corchetes escapados. Esos escapes
// coinciden con los delimitadores matemáticos de la hoja. Recuperar la cita
// antes de componerla; el código y las fórmulas ($$ en el escritor) quedan igual.
export function restoreImportedCitations(markdown) {
  return mapOutsideCode(markdown, text => text.replace(
    /(?<!\\)(\$\$[\s\S]*?\$\$|\$(?:\\.|[^$\\\n])+\$)|(?<!\\)\\\[([ \t]*-?\\?@[A-Za-z0-9_](?:\\.|[^\]\\\n])*?)\\\]|(?<![\\\w])\\@(?=[A-Za-z0-9_])/g,
    (match, math, citation) => math ? match : citation ? `[${citation.replace(/\\@/g, '@')}]` : '@',
  ));
}

function collectImageSources(markdown) {
  if (typeof markdown !== 'string') return [];
  const urls = new Set();
  splitCodeSegments(markdown).forEach((segment) => {
    if (segment.code) return;
    for (const match of segment.text.matchAll(MD_IMAGE_RE)) urls.add(match[1]);
    for (const match of segment.text.matchAll(HTML_IMAGE_RE)) urls.add(match[2]);
  });
  return [...urls];
}

// Rewrites image sources only, leaving plain links to the same URL untouched.
export function replaceImageUrls(markdown, replacements) {
  if (typeof markdown !== 'string' || !replacements) return markdown || '';
  const lookup = replacements instanceof Map ? replacements : new Map(Object.entries(replacements));
  if (lookup.size === 0) return markdown;
  // Igual que al buscarlas: un ejemplo escrito como código no es una imagen.
  return mapOutsideCode(markdown, text => text
    .replace(MD_IMAGE_RE, (match, url) => {
      const next = lookup.get(url);
      return next ? match.replace(url, next) : match;
    })
    .replace(HTML_IMAGE_RE, (match, _quote, url) => {
      const next = lookup.get(url);
      return next ? match.replace(url, next) : match;
    }));
}

// Fallback when an image cannot be fetched: keep the alt text so the export
// still succeeds instead of producing an empty file.
export function dropImagesByUrl(markdown, urls) {
  if (typeof markdown !== 'string') return '';
  const targets = new Set(urls || []);
  if (targets.size === 0) return markdown;
  return mapOutsideCode(markdown, text => text
    .replace(MD_IMAGE_RE, (match, url) => {
      if (!targets.has(url)) return match;
      const alt = match.match(/^!\[([^\]]*)\]/);
      return alt ? alt[1] : '';
    })
    .replace(HTML_IMAGE_RE, (match, _quote, url) => (targets.has(url) ? '' : match)));
}

/*
  Lo que el EPUB dice de sí mismo, que Pandoc no devuelve con el texto.

  El idioma vive en `content.opf`, no en el cuerpo del libro, así que un
  documento exportado con `lang: "ca"` volvía sin él y pasaba a corregirse en
  el idioma general. Se lee de ahí y se devuelve al documento.
*/
const OPF_PATH_RE = /^(?:[^/]+\/)?[^/]*\.opf$/i;

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function firstOpfValue(opf, tag) {
  const match = opf.match(new RegExp(`<(?:[a-zA-Z0-9]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${tag}>`, 'i'));
  return match ? decodeXmlEntities(match[1]).replace(/\s+/g, ' ').trim() : '';
}

export async function readEpubMetadata(archiveBytes) {
  const empty = { title: '', language: '', creator: '' };
  if (!archiveBytes || archiveBytes.length === 0) return empty;
  let entries;
  try {
    entries = await readZipEntries(archiveBytes);
  } catch (error) {
    console.warn('No se pudieron leer los datos del EPUB:', error);
    return empty;
  }
  const path = [...entries.keys()].find(name => OPF_PATH_RE.test(name));
  if (!path) return empty;
  const opf = new TextDecoder().decode(entries.get(path));
  return {
    title: firstOpfValue(opf, 'title'),
    language: firstOpfValue(opf, 'language'),
    creator: firstOpfValue(opf, 'creator'),
  };
}

/*
  Un EPUB es una sucesión de capítulos y cada capítulo lleva su encabezado. Si
  el documento tenía algo antes de su primer `# Título` —el logotipo del
  manual, sin ir más lejos—, ese contenido forma un capítulo suelto al que
  Pandoc le pone de título el del libro, y al volver aparecen dos `# Título`
  seguidos. No hay opción de Pandoc que lo evite, así que el que sobra se
  quita aquí, y solo cuando se cumple todo lo que lo delata: es el primer
  encabezado del documento, dice exactamente lo que dice el libro, y el
  siguiente encabezado lo repite sin ninguno de por medio.
*/
export function dropDuplicateEpubTitle(markdown, bookTitle) {
  const source = typeof markdown === 'string' ? markdown : '';
  const title = String(bookTitle || '').trim();
  if (!title || !source.includes(title)) return source;

  const { frontMatter, body } = splitFrontMatter(source);
  const lines = body.split('\n');
  const headings = [];
  let fence = null;
  for (let index = 0; index < lines.length && headings.length < 2; index += 1) {
    const fenceMatch = lines[index].match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fenceMatch) {
      if (!fence) fence = fenceMatch[1];
      else if (fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence) continue;
    const heading = lines[index].match(/^(#{1,6})\s+(.*)$/);
    if (heading) headings.push({ index, level: heading[1].length, text: heading[2].trim().replace(/\s+#+\s*$/, '') });
  }

  const [first, second] = headings;
  if (!first || !second) return source;
  if (first.level !== 1 || second.level !== 1) return source;
  if (first.text !== title || second.text !== title) return source;

  lines.splice(first.index, 1);
  while (lines[first.index] === '') lines.splice(first.index, 1);
  const trimmed = lines.join('\n');
  return frontMatter ? `${frontMatter}\n\n${trimmed}` : trimmed;
}

/*
  DOCX, ODT and EPUB are ZIP archives. Pandoc returns only the converted text,
  so its image references point at paths inside the uploaded file
  (`Pictures/…`, `media/…`) that no longer exist. Read those images straight
  out of the archive and inline them as data URIs.
*/
export async function inlineArchiveImages(markdown, archiveBytes) {
  const paths = collectArchiveImagePaths(markdown);
  if (paths.length === 0 || !archiveBytes || archiveBytes.length === 0) {
    return markdown;
  }

  let entries;
  try {
    entries = await readZipEntries(archiveBytes);
  } catch (error) {
    console.warn('No se pudieron leer las imágenes del archivo:', error);
    return markdown;
  }

  const replacements = new Map();
  for (const path of paths) {
    // Pandoc may shorten the path (media/image1.png for word/media/image1.png).
    const key = entries.has(path)
      ? path
      : [...entries.keys()].find(name => name.endsWith(`/${path}`) || name.endsWith(`/${path.split('/').pop()}`));
    if (!key) continue;
    try {
      replacements.set(path, bytesToDataUri(entries.get(key), mimeForPath(key)));
    } catch (error) {
      console.warn(`No se pudo incrustar la imagen ${path}:`, error);
    }
  }

  return replacements.size > 0 ? replaceImageUrls(markdown, replacements) : markdown;
}

/*
  Repairs the formula references of an ODT so Pandoc can read them.

  Pandoc's ODT writer points at each embedded formula with a trailing slash
  (`Formula-0/`) and its own reader cannot resolve that form, so re-importing a
  document this app exported loses every formula. Rewriting the reference is
  enough; Pandoc then converts the MathML itself.

  Returns the untouched bytes when there is nothing to repair, so an ODT written
  by LibreOffice — which Pandoc already reads correctly — never goes through the
  rewrite.
*/
export async function prepareOdtForImport(archiveBytes) {
  if (!archiveBytes || archiveBytes.length === 0) return archiveBytes;

  let entries;
  try {
    entries = await readZipEntries(archiveBytes);
  } catch (error) {
    console.warn('No se pudo leer el ODT para reparar sus fórmulas:', error);
    return archiveBytes;
  }

  const contentXml = entries.get('content.xml');
  if (!contentXml) return archiveBytes;

  const { xml, changed } = normalizeFormulaHrefs(new TextDecoder().decode(contentXml));
  if (!changed) return archiveBytes;

  const rebuilt = new Map();
  // El mimetype tiene que ser la primera entrada de un ODT.
  if (entries.has('mimetype')) rebuilt.set('mimetype', entries.get('mimetype'));
  for (const [name, bytes] of entries) {
    if (name === 'mimetype') continue;
    rebuilt.set(name, name === 'content.xml' ? new TextEncoder().encode(xml) : bytes);
  }
  return createZip(rebuilt);
}

// El texto sacado del XML llega con sus entidades: hay que deshacerlas antes de
// volver a escaparlo, o un título con & acabaría mostrando «&amp;».
function unescapeXmlText(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function escapeXmlText(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Encabezados de nivel 1 a 3 tal como quedaron en el documento, con su número
// de apartado si se pidió numeración.
const DOCX_HEADING_RE = /<w:p\b[^>]*>(?:(?!<\/w:p>)[\s\S])*?<w:pStyle w:val="Heading([1-3])"\s*\/>(?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g;

export function collectDocxHeadings(documentXml, depth = 3) {
  const maxDepth = normalizeTocDepth(depth) || 3;
  const headings = [];
  for (const match of String(documentXml || '').matchAll(DOCX_HEADING_RE)) {
    const text = match[0]
      // El número del apartado y su título van separados por una tabulación.
      .replace(/<w:tab\s*\/>/g, ' ')
      .replace(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g, (_, value) => value)
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text && Number(match[1]) <= maxDepth) {
      headings.push({ level: Number(match[1]), text: unescapeXmlText(text) });
    }
  }
  return headings;
}

function tocEntriesXml(headings) {
  return headings.map(({ level, text }) => {
    const indent = (level - 1) * 340; // ~0,6 cm por nivel
    return '<w:p><w:pPr>'
      + (indent ? `<w:ind w:left="${indent}"/>` : '')
      + '<w:spacing w:after="0"/></w:pPr>'
      + `<w:r><w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r></w:p>`;
  }).join('');
}

/*
  Fills in the table of contents of a DOCX and asks the reader to refresh it.

  Pandoc writes a Word TOC field and leaves its result empty, because the
  entries and their page numbers belong to whoever lays out the pages. The field
  is flagged dirty and `<w:updateFields w:val="true"/>` goes into settings.xml,
  but neither is enough on its own: LibreOffice opens the document with the
  index still blank, and Word only refreshes if the user agrees to the prompt.

  So the entries are written into the field's cached result, between `separate`
  and `end`. The document then opens with a readable index —headings, numbered
  if the user asked for numbering, indented by level— and updating the field
  replaces it with the real one, page numbers and links included.

  Any failure leaves the original file untouched: an index that needs a manual
  refresh is a nuisance, a corrupted DOCX is a lost document.
*/
export async function requestDocxFieldUpdate(archiveBytes, depth = 3) {
  if (!archiveBytes || archiveBytes.length === 0) return archiveBytes;
  try {
    const entries = await readZipEntries(archiveBytes);
    const settings = entries.get('word/settings.xml');
    const document = entries.get('word/document.xml');
    if (!settings || !document) return archiveBytes;

    const settingsXml = new TextDecoder().decode(settings);
    // El elemento va al principio de <w:settings>, que es donde el esquema lo
    // espera; fuera de orden, Word considera el archivo dañado.
    const updatedSettings = /<w:updateFields\b/.test(settingsXml)
      ? settingsXml
      : settingsXml.replace(/(<w:settings\b[^>]*>)/, '$1<w:updateFields w:val="true"/>');

    const documentXml = new TextDecoder().decode(document);
    let updatedDocument = documentXml;
    const emptyResult = /<w:fldChar w:fldCharType="separate"\s*\/>\s*<w:fldChar w:fldCharType="end"\s*\/>/;
    const headings = collectDocxHeadings(documentXml, depth);
    if (headings.length && emptyResult.test(documentXml)) {
      /*
        El resultado del campo ocupa sus propios párrafos, así que el que abre
        el campo se cierra tras `separate` y otro nuevo lleva el `end`.
      */
      updatedDocument = documentXml.replace(
        emptyResult,
        '<w:fldChar w:fldCharType="separate"/></w:r></w:p>'
        + tocEntriesXml(headings)
        + '<w:p><w:r><w:fldChar w:fldCharType="end"/>',
      );
    }

    if (updatedSettings === settingsXml && updatedDocument === documentXml) return archiveBytes;

    const encoder = new TextEncoder();
    const rebuilt = new Map();
    for (const [name, bytes] of entries) {
      if (name === 'word/settings.xml') rebuilt.set(name, encoder.encode(updatedSettings));
      else if (name === 'word/document.xml') rebuilt.set(name, encoder.encode(updatedDocument));
      else rebuilt.set(name, bytes);
    }
    return createZip(rebuilt);
  } catch (error) {
    console.warn('No se pudo completar el índice del DOCX:', error);
    return archiveBytes;
  }
}

// Encabezados del ODT, con su nivel tomado del atributo de esquema.
const ODT_HEADING_RE = /<text:h\b[^>]*text:outline-level="([1-3])"[^>]*>([\s\S]*?)<\/text:h>/g;

export function collectOdtHeadings(contentXml, depth = 3) {
  const maxDepth = normalizeTocDepth(depth) || 3;
  const headings = [];
  for (const match of String(contentXml || '').matchAll(ODT_HEADING_RE)) {
    const text = unescapeXmlText(
      match[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(),
    );
    if (text && Number(match[1]) <= maxDepth) headings.push({ level: Number(match[1]), text });
  }
  return headings;
}

/*
  Estilos propios para el índice, definidos dentro del propio content.xml.
  La plantilla del índice de Pandoc menciona Contents_20_1 y compañía, pero
  esos estilos no existen en el archivo: un párrafo que los use se vería sin
  formato ninguno.
*/
const ODT_TOC_STYLES = [1, 2, 3].map(level => (
  `<style:style style:name="EdimarkToc${level}" style:family="paragraph" style:parent-style-name="Standard">`
  + `<style:paragraph-properties fo:margin-left="${(level - 1) * 0.6}cm" fo:margin-top="0cm" fo:margin-bottom="0.05cm"/>`
  + '</style:style>'
)).join('')
  + '<style:style style:name="EdimarkTocHead" style:family="paragraph" style:parent-style-name="Standard">'
  + '<style:paragraph-properties fo:margin-bottom="0.25cm"/>'
  + '<style:text-properties fo:font-size="16pt" fo:font-weight="bold"/>'
  + '</style:style>';

/*
  Fills in the table of contents of an ODT.

  Pandoc writes `<text:table-of-content>` with its template but no
  `<text:index-body>`, which is the part that holds what the reader displays, so
  LibreOffice opens the document showing nothing where the index should be. The
  entries go in there, as the DOCX ones go into the field's cached result, and
  updating the index in LibreOffice replaces them with the real thing —page
  numbers and links included, which cannot be known before laying out the pages.

  Any failure leaves the original file untouched.
*/
export async function fillOdtTableOfContents(archiveBytes, depth = 3) {
  if (!archiveBytes || archiveBytes.length === 0) return archiveBytes;
  try {
    const entries = await readZipEntries(archiveBytes);
    const content = entries.get('content.xml');
    if (!content) return archiveBytes;
    const xml = new TextDecoder().decode(content);
    // Ya relleno (o sin índice): no hay nada que hacer.
    if (!xml.includes('<text:table-of-content') || xml.includes('<text:index-body')) return archiveBytes;

    const headings = collectOdtHeadings(xml, depth);
    if (!headings.length) return archiveBytes;

    const titleMatch = /<text:index-title-template[^>]*>([\s\S]*?)<\/text:index-title-template>/.exec(xml);
    const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : '';

    const body = '<text:index-body>'
      + (title
        ? `<text:index-title text:name="EdimarkTocHead"><text:p text:style-name="EdimarkTocHead">${escapeXmlText(title)}</text:p></text:index-title>`
        : '')
      + headings.map(({ level, text }) => (
        `<text:p text:style-name="EdimarkToc${level}">${escapeXmlText(text)}</text:p>`
      )).join('')
      + '</text:index-body>';

    let updated = xml.replace('</text:table-of-content>', `${body}</text:table-of-content>`);
    /*
      Un documento sin estilos automáticos trae la etiqueta cerrada sobre sí
      misma, y entonces no hay ningún `</office:automatic-styles>` donde
      colgarlos: sin contemplarlo, el índice salía sin sangría.
    */
    if (updated.includes('</office:automatic-styles>')) {
      updated = updated.replace('</office:automatic-styles>', `${ODT_TOC_STYLES}</office:automatic-styles>`);
    } else {
      updated = updated.replace(
        /<office:automatic-styles\s*\/>/,
        `<office:automatic-styles>${ODT_TOC_STYLES}</office:automatic-styles>`,
      );
    }
    if (updated === xml) return archiveBytes;

    const rebuilt = new Map();
    // El mimetype tiene que seguir siendo la primera entrada del archivo.
    if (entries.has('mimetype')) rebuilt.set('mimetype', entries.get('mimetype'));
    for (const [name, bytes] of entries) {
      if (name === 'mimetype') continue;
      rebuilt.set(name, name === 'content.xml' ? new TextEncoder().encode(updated) : bytes);
    }
    return createZip(rebuilt);
  } catch (error) {
    console.warn('No se pudo completar el índice del ODT:', error);
    return archiveBytes;
  }
}

/*
  Suma el formato del documento a la hoja de estilos del EPUB.

  Se añade al final de la que escribe Pandoc en vez de pasar `--css`, que la
  sustituiría: esa hoja trae el reset y los estilos del código, las citas y las
  notas, y el libro se quedaría sin ellos.
*/
/*
  Una imagen sola en su párrafo y con texto es una figura para Pandoc, y ese
  texto es su pie. Se centran las dos cosas, como en la hoja.
*/
export const FIGURE_CSS = 'figure { text-align: center; }\nfigure img { margin-inline: auto; }\nfigcaption { text-align: center; font-style: italic; }';

export function markdownHasFigures(markdown) {
  return /(?:^|\n[ \t]*\n)[ \t]*!\[[^\]\n]*\S[^\]\n]*\]\([^)\n]+\)(?:\{[^}\n]*\})?[ \t]*(?=\n[ \t]*\n|\n?$)/
    .test(String(markdown || ''));
}

export async function appendEpubStylesheet(archiveBytes, css) {
  if (!archiveBytes || archiveBytes.length === 0 || !String(css || '').trim()) return archiveBytes;
  try {
    const entries = await readZipEntries(archiveBytes);
    const name = [...entries.keys()].find(entry => /\.css$/i.test(entry));
    if (!name) return archiveBytes;

    const sheet = new TextDecoder().decode(entries.get(name));
    const updated = `${sheet.trimEnd()}\n\n/* Formato del documento (EdiMarkdown) */\n${css}\n`;

    const rebuilt = new Map();
    if (entries.has('mimetype')) rebuilt.set('mimetype', entries.get('mimetype'));
    for (const [entry, bytes] of entries) {
      if (entry === 'mimetype') continue;
      rebuilt.set(entry, entry === name ? new TextEncoder().encode(updated) : bytes);
    }
    return createZip(rebuilt);
  } catch (error) {
    console.warn('No se pudo aplicar el formato al EPUB:', error);
    return archiveBytes;
  }
}

/*
  Aplica el formato del documento —alineación, letra, interlineado, márgenes,
  sangría y partición— al DOCX o al ODT recién generado.

  Ninguno de los dos escritores de Pandoc admite esos ajustes como metadatos:
  salen de su plantilla interna, así que hay que abrir el archivo y reescribir
  los estilos. Si algo no encaja se devuelve el original: más vale exportar sin
  el formato que entregar un archivo que Word no quiera abrir.
*/
export async function applyOfficeFormat(archiveBytes, styles, kind) {
  if (!archiveBytes || archiveBytes.length === 0) return archiveBytes;
  styles = styles || {};

  try {
    const entries = await readZipEntries(archiveBytes);
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const updated = new Map();

    const rewrite = (name, transform) => {
      const bytes = entries.get(name);
      if (!bytes) return;
      const xml = decoder.decode(bytes);
      const result = transform(xml);
      if (result && result !== xml) updated.set(name, encoder.encode(result));
    };

    // Las figuras se centran siempre, como en la hoja; solo si el documento tiene alguna.
    const body = decoder.decode(entries.get(kind === 'docx' ? 'word/document.xml' : 'content.xml') || new Uint8Array());
    const hasFigures = kind === 'docx' ? /w:val="CaptionedFigure"/.test(body) : /text:style-name="FigureWithCaption"/.test(body);

    if (kind === 'docx') {
      rewrite('word/styles.xml', xml => {
        const formatted = applyDocxStyles(xml, styles);
        return hasFigures ? applyDocxFigureAlignment(formatted) : formatted;
      });
      // Papel y márgenes van a cada sección, también a las de las columnas.
      rewrite('word/document.xml', xml => applyDocxMargins(
        applyDocxPageSize(applyDocxColumnSections(xml), styles.paperCm),
        styles.marginsCm,
      ));
      rewrite('word/settings.xml', xml => applyDocxHyphenation(xml, styles.hyphenate));
      rewrite('word/theme/theme1.xml', xml => applyDocxTheme(xml, styles.fontName));
    } else {
      rewrite('content.xml', applyOdtColumnSections);
      rewrite('styles.xml', xml => {
        const formatted = applyOdtMargins(
          applyOdtPageSize(applyOdtStyles(xml, styles), styles.paperCm),
          styles.marginsCm,
        );
        return hasFigures ? applyOdtFigureAlignment(formatted) : formatted;
      });
    }
    if (!updated.size) return archiveBytes;

    const rebuilt = new Map();
    // En un ODT el mimetype tiene que seguir siendo la primera entrada.
    if (entries.has('mimetype')) rebuilt.set('mimetype', entries.get('mimetype'));
    for (const [name, bytes] of entries) {
      if (name === 'mimetype') continue;
      rebuilt.set(name, updated.get(name) || bytes);
    }
    return createZip(rebuilt);
  } catch (error) {
    console.warn('No se pudo aplicar el formato del documento:', error);
    return archiveBytes;
  }
}

/*
  Pandoc's ODT reader ignores <table:table-header-rows>, so imported tables lose
  their header row. Read it back out of the uploaded file.
*/
export async function restoreOdtTableHeaders(markdown, archiveBytes) {
  if (typeof markdown !== 'string' || !markdown.includes('|') || !archiveBytes || archiveBytes.length === 0) {
    return markdown || '';
  }
  try {
    const entries = await readZipEntries(archiveBytes);
    const contentXml = entries.get('content.xml');
    if (!contentXml) return markdown;
    const headers = extractOdtTableHeaders(new TextDecoder().decode(contentXml));
    return restoreTableHeaders(markdown, headers);
  } catch (error) {
    console.warn('No se pudieron recuperar los encabezados de tabla del ODT:', error);
    return markdown;
  }
}
