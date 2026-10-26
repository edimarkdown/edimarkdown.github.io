/*
  End-to-end checks against the bundled pandoc.wasm.

  These exist because Pandoc signals an internal failure by leaving its output
  file empty instead of throwing: a broken export used to reach the user as a
  0-byte download labelled "export completed". Every case below therefore
  asserts on real bytes coming out of the real converter.

  Slow by design (the WASM module is ~50 MB): run with `npm run test:export`.
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { runPandoc, readZipEntries } from './helpers/pandoc-runner.mjs';
import bibliographyModel from '../bibliography.js';
import {
  MARKDOWN_READER_NO_AUTO_IDS,
  convertWithAstPasses,
  applyOfficeFormat,
  buildExportArgs,
  ensureEpubMetadata,
  collectRemoteImageUrls,
  dropImagesByUrl,
  normalizeNewlines,
  normalizeThematicBreaks,
  trimInlineMath,
  buildImportArgs,
  prepareLatexStandalone,
  ensureExportMetadata,
  requestDocxFieldUpdate,
  fillOdtTableOfContents,
  stripEpubAnchorPrefixes,
  readEpubMetadata,
  dropDuplicateEpubTitle,
  collapseThematicBreaks,
  expandDisplayMath,
  restoreImportedCitations,
  mergeFrontMatter,
  inlineArchiveImages,
  restoreOdtTableHeaders,
  prepareOdtForImport,
} from '../pandoc-prepare.js';

// Mirrors what exportDocument() sends for format 'epub'.
function exportEpub(markdown, { fallbackTitle = 'documento', lang = 'es' } = {}) {
  const prepared = ensureEpubMetadata(normalizeThematicBreaks(markdown), { fallbackTitle, lang });
  const args = buildExportArgs('epub3', { mathml: true, titleFromHeading: prepared.titleFromHeading });
  return runPandoc(args, prepared.markdown);
}

function assertValidEpub(result, label) {
  assert.ok(
    result.bytes.length > 0,
    `${label}: EPUB vacío (0 bytes). stderr: ${result.stderr.join(' | ') || '(sin salida)'}`,
  );
  const entries = readZipEntries(result.bytes);
  assert.equal(entries.get('mimetype')?.toString('utf8'), 'application/epub+zip', `${label}: mimetype`);
  assert.ok(entries.has('META-INF/container.xml'), `${label}: falta container.xml`);
  assert.ok(entries.has('EPUB/content.opf'), `${label}: falta content.opf`);
  assert.ok(entries.has('EPUB/nav.xhtml'), `${label}: falta nav.xhtml`);
  return entries;
}

/*
  Reproduce el documento que motivó normalizeThematicBreaks: secciones separadas
  por `---`, alguna de ellas seguida inmediatamente por texto en negrita. Pandoc
  lee ese `---` como el delimitador de un bloque YAML y el `*` de la línea
  siguiente como un alias, así que aborta la conversión entera.
*/
const CON_RAYAS = `# Catálogo\n\nIntroducción con *cursiva* y **negrita**.\n\n---\n\n${
  Array.from({ length: 30 }, (_, i) =>
    `## Sección ${i + 1}\n\n_Texto en cursiva._\n\n- punto uno\n- punto dos\n\n---\n${
      i % 5 === 4 ? '**Destacado**: sin línea en blanco tras la raya.\n\n---\n' : ''}`,
  ).join('\n')}`;

const DOCUMENTS = {
  'perfil Markdown completo': await readFile(new URL('./fixtures/markdown-profile.md', import.meta.url), 'utf8'),
  'texto simple': '# Título\n\nUn párrafo normal.\n',
  'acentos y emoji': '# Año 2026 — ñandú 🎓\n\nCafé, camión, ¿qué tal?\n',
  'matemáticas': '# Mates\n\nEn línea $a^2+b^2=c^2$.\n\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$\n',
  'LaTeX crudo': '# Crudo\n\n\\textbf{negrita} y \\emph{cursiva}\n',
  'tabla': '# Tabla\n\n| a | b |\n|---|---|\n| 1 | 2 |\n',
  'bloque de código': '# Código\n\n```python\nprint("hola")\n```\n',
  'HTML incrustado': '# HTML\n\n<div class="aviso">contenido</div>\n',
  'listas y cita': '# Listas\n\n- uno\n- dos\n\n1. a\n2. b\n\n> cita\n',
  'nota al pie': '# Notas\n\nTexto[^1]\n\n[^1]: la nota\n',
  'enlaces': '# Enlaces\n\n[web](https://ejemplo.org) y <https://ejemplo.org>\n',
  'imagen data URI': '# Imagen\n\n![a](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)\n',
  'sin encabezado': 'Solo un párrafo suelto, sin ningún encabezado.\n',
  'raya horizontal inicial': '---\n\n# Tras la raya\n\nTexto.\n',
  // Documento largo con rayas --- entre secciones: Pandoc las leía como
  // metadatos YAML y abortaba la conversión sin producir nada.
  'rayas --- entre secciones': CON_RAYAS,
  'front matter propio': '---\ntitle: "Título propio"\nlang: gl\n---\n\n# Cuerpo\n\nTexto.\n',
};

function profileNodes(value, type) {
  if (!value || typeof value !== 'object') return [];
  return [...(value.t === type ? [value] : []), ...Object.values(value).flatMap(child => profileNodes(child, type))];
}

function profileText(value) {
  if (!value || typeof value !== 'object') return '';
  if (value.t === 'Str') return value.c;
  if (['Space', 'SoftBreak', 'LineBreak'].includes(value.t)) return ' ';
  if (['Code', 'Math'].includes(value.t)) return value.c[1];
  return (Array.isArray(value) ? value : [value.c]).map(profileText).join('');
}

function assertProfileTables(ast, format) {
  const tables = profileNodes(ast.blocks, 'Table');
  const rows = tables.map(({c}) => [
    ...c[3][1], ...c[4].flatMap(body => [...body[2], ...body[3]]), ...c[5][1],
  ].map(row => row[1].map(cell => profileText(cell[4]))));
  assert.deepEqual(rows, [
    [['Sustancia', 'Área'], ['H2O', 'm2']],
    [['Izquierda', 'Centro', 'Derecha'], ['Negrita en celda', 'Cursiva en celda', '123'],
      ['A | B', 'Enlace en celda', '45'], ['Vacía a la derecha', 'H2O', ''], ['Código en celda', 'a + b', '7']],
  ], `${format}: posición y contenido de cada celda`);
}

test('perfil Markdown: puntuación, enlaces y estructura llegan a Pandoc', async () => {
  const source = DOCUMENTS['perfil Markdown completo'];
  const result = await runPandoc(`-f ${MARKDOWN_READER_NO_AUTO_IDS} -t html --mathjax`, normalizeThematicBreaks(source));
  assert.ok(result.bytes.length, result.stderr.join('\n'));
  const html = new TextDecoder().decode(result.bytes);
  assert.ok(html.includes('"Texto" ... -- --- y «comillas»…'), html);
  assert.match(html, /href="https:\/\/example.org\/bare"/);
  for (const tag of ['h1', 'strong', 'em', 'del', 'sub', 'sup', 'table', 'blockquote', 'pre', 'img']) {
    assert.match(html, new RegExp(`<${tag}[\\s>]`), tag);
  }
  assert.equal((html.match(/type="checkbox"/g) || []).length, 2);
  assert.equal((html.match(/class="math /g) || []).length, 4);
  assert.match(html, /Explicación con/);
  assert.match(html, /data-cites="ejemplo2026"/);
  assert.equal((html.match(/data-cites=/g) || []).length, 5, 'las cinco formas de cita');
  const citationFiles = {
    'markdown-profile.bib': new Uint8Array(await readFile(new URL('./fixtures/markdown-profile.bib', import.meta.url))),
    'style.csl': new Uint8Array(await readFile(new URL('../csl/apa.csl', import.meta.url))),
  };
  for (const format of ['docx', 'odt', 'epub3']) {
    const exported = await runPandoc(buildExportArgs(format, { mathml: format === 'epub3' })
      + ' --citeproc --bibliography=/markdown-profile.bib --csl=/style.csl', normalizeThematicBreaks(source), citationFiles);
    assert.ok(exported.bytes.length, `${format}: ${exported.stderr.join('\n')}`);
    const files = readZipEntries(exported.bytes);
    const xml = format === 'epub3'
      ? [...files].filter(([name]) => /\.xhtml$/.test(name)).map(([, bytes]) => bytes.toString('utf8')).join('\n')
      : files.get(format === 'docx' ? 'word/document.xml' : 'content.xml')?.toString('utf8');
    assert.ok(xml?.includes('Final del documento.'), `${format}: falta el final`);
    assert.ok(xml.includes('... -- ---'), `${format}: puntuación modificada`);
    // Leer el archivo producido permite comprobar las celdas, no solo el ZIP.
    let reread;
    if (format === 'odt') {
      // La ruta real de la aplicación repara las fórmulas y recupera las
      // cabeceras que el lector ODT de Pandoc omite (odt-tables.js).
      const imported = await runPandoc(buildImportArgs('odt'), await prepareOdtForImport(exported.bytes));
      assert.ok(imported.bytes.length, imported.stderr.join('\n'));
      const markdown = await restoreOdtTableHeaders(new TextDecoder().decode(imported.bytes), exported.bytes);
      reread = await runPandoc(`-f ${MARKDOWN_READER_NO_AUTO_IDS} -t json`, markdown);
    } else {
      reread = await runPandoc(`-f ${format === 'epub3' ? 'epub' : format} -t json`, exported.bytes);
    }
    assert.ok(reread.bytes.length, `${format}: ${reread.stderr.join('\n')}`);
    const ast = JSON.parse(new TextDecoder().decode(reread.bytes));
    assertProfileTables(ast, format);
    // Office vuelve a escribir a^2 como a^{2}: son la misma fórmula.
    const formulas = profileNodes(ast.blocks, 'Math');
    assert.deepEqual(formulas.map(n => n.c[1].trim().replace(/\^\{(\d+)\}/g, '^$1')),
      ['a^2', 'b^2', 'c^2', 'd^2'], `${format}: contenido de las cuatro fórmulas editables`);
    // El lector ODT de Pandoc devuelve todas sus ecuaciones como DisplayMath;
    // no sirve para comprobar el modo original. Se documenta esta limitación.
    if (format === 'odt') {
      const frames = [...xml.matchAll(/<draw:frame\b([^>]*)>([\s\S]*?)<\/draw:frame>/g)]
        .map(frame => [frame[0], frame[1], frame[2].match(/<draw:object\b[^>]*xlink:href="(Formula-[^"]+)"/)?.[1]])
        .filter(frame => frame[2]);
      assert.deepEqual(frames.map(frame => frame[1].match(/text:anchor-type="([^"]+)"/)?.[1]),
        ['as-char', 'as-char', 'paragraph', 'paragraph'], 'ODT: dos fórmulas en línea y dos de bloque en el archivo');
      assert.deepEqual(frames.map(frame => files.get(`${frame[2]}content.xml`)?.toString('utf8').match(/display="([^"]+)"/)?.[1]),
        ['inline', 'inline', 'block', 'block'], 'ODT: el MathML también conserva el modo');
    } else assert.deepEqual(formulas.map(n => n.c[0].t),
      ['InlineMath', 'InlineMath', 'DisplayMath', 'DisplayMath'], `${format}: modo de las fórmulas`);
    assert.equal(profileNodes(ast.blocks, 'Image').length, 1, `${format}: imagen conservada`);
    assert.equal(profileNodes(ast.blocks, 'Note').length, 3, `${format}: llamadas a notas`);
  }
});

test('perfil Markdown: reimportar ODT sin biblioteca no convierte sus citas en fórmulas', async () => {
  const source = normalizeThematicBreaks(DOCUMENTS['perfil Markdown completo']);
  const exported = await runPandoc(buildExportArgs('odt'), source);
  assert.ok(exported.bytes.length, exported.stderr.join('\n'));
  const imported = await runPandoc(buildImportArgs('odt'), await prepareOdtForImport(exported.bytes));
  assert.ok(imported.bytes.length, imported.stderr.join('\n'));
  const markdown = restoreImportedCitations(new TextDecoder().decode(imported.bytes));
  const parsed = await runPandoc(`-f ${MARKDOWN_READER_NO_AUTO_IDS} -t json`, markdown);
  assert.ok(parsed.bytes.length, parsed.stderr.join('\n'));
  const ast = JSON.parse(new TextDecoder().decode(parsed.bytes));
  assert.equal(profileNodes(ast.blocks, 'Math').length, 4, 'solo las cuatro fórmulas reales');
  assert.equal(profileNodes(ast.blocks, 'Cite').length, 5, 'las cinco formas de cita vuelven como citas');
});

test('perfil Markdown: las cinco formas de cita conservan modo, claves y página', async () => {
  const source = normalizeThematicBreaks(DOCUMENTS['perfil Markdown completo']);
  const parsed = await runPandoc(`-f ${MARKDOWN_READER_NO_AUTO_IDS} -t json`, source);
  assert.ok(parsed.bytes.length, parsed.stderr.join('\n'));
  const ast = JSON.parse(new TextDecoder().decode(parsed.bytes));
  assertProfileTables(ast, 'Markdown');
  assert.deepEqual(profileNodes(ast.blocks, 'Cite').map(n => n.c[0].map(c => [c.citationId, c.citationMode.t, profileText(c.citationSuffix)])), [
    [['ejemplo2026', 'NormalCitation', '']], [['ejemplo2026', 'AuthorInText', '']],
    [['ejemplo2026', 'SuppressAuthor', '']],
    [['ejemplo2026', 'NormalCitation', ''], ['segunda2025', 'NormalCitation', '']],
    [['ejemplo2026', 'NormalCitation', ', p. 12']],
  ]);
  const result = await runPandoc(`-f ${MARKDOWN_READER_NO_AUTO_IDS} -t html --citeproc --bibliography=/markdown-profile.bib --csl=/style.csl`, source, {
    'markdown-profile.bib': new Uint8Array(await readFile(new URL('./fixtures/markdown-profile.bib', import.meta.url))),
    'style.csl': new Uint8Array(await readFile(new URL('../csl/apa.csl', import.meta.url))),
  });
  assert.ok(result.bytes.length, result.stderr.join('\n'));
  const html = new TextDecoder().decode(result.bytes);
  assert.match(html, /Ejemplo \(2026\)/);
  assert.match(html, /\(2026\)/);
  assert.match(html, /Ejemplo, 2026, p\. 12/);
  assert.match(html, /Manual de prueba del perfil/);
  assert.match(html, /Segunda fuente de prueba/);
  assert.equal((html.match(/class="csl-entry"/g) || []).length, 2, 'dos referencias, sin duplicarlas por cada cita');
});

for (const [label, markdown] of Object.entries(DOCUMENTS)) {
  test(`exporta EPUB no vacío: ${label}`, { timeout: 180000 }, async () => {
    assertValidEpub(await exportEpub(markdown), label);
  });
}

test('el EPUB lleva el título del encabezado y el idioma de la interfaz', { timeout: 180000 }, async () => {
  const result = await exportEpub('# Guía de estudio\n\nTexto.\n', { lang: 'ca' });
  const entries = assertValidEpub(result, 'metadatos');
  const opf = entries.get('EPUB/content.opf').toString('utf8');
  assert.match(opf, /<dc:title[^>]*>Guía de estudio<\/dc:title>/);
  assert.match(opf, /<dc:language>ca<\/dc:language>/);
  // Sin título propio Pandoc usaría el nombre del fichero temporal.
  assert.doesNotMatch(opf, /<dc:title[^>]*>in<\/dc:title>/);
});

test('sin encabezado se usa el nombre del documento como título', { timeout: 180000 }, async () => {
  const result = await exportEpub('Solo texto.\n', { fallbackTitle: 'apuntes de clase' });
  const entries = assertValidEpub(result, 'título de respaldo');
  const opf = entries.get('EPUB/content.opf').toString('utf8');
  assert.match(opf, /<dc:title[^>]*>apuntes de clase<\/dc:title>/);
});

test('el título no se repite: hay portada solo si el cuerpo no lo muestra', { timeout: 180000 }, async () => {
  const conEncabezado = await exportEpub('# Mi libro\n\nTexto.\n');
  const entradasConEncabezado = assertValidEpub(conEncabezado, 'con encabezado');
  assert.ok(
    !entradasConEncabezado.has('EPUB/text/title_page.xhtml'),
    'el cuerpo ya abre con el título, no debería añadirse portada',
  );

  const sinEncabezado = await exportEpub('Solo texto.\n', { fallbackTitle: 'apuntes' });
  const entradasSinEncabezado = assertValidEpub(sinEncabezado, 'sin encabezado');
  assert.ok(
    entradasSinEncabezado.has('EPUB/text/title_page.xhtml'),
    'sin título en el cuerpo debería generarse la portada',
  );
});

test('una imagen remota sin resolver rompe la conversión (razón de inlineFetchableImages)', { timeout: 180000 }, async () => {
  const markdown = '# Con imagen\n\n![alt](https://ejemplo.org/foto.png)\n';
  const result = await exportEpub(markdown);
  assert.equal(result.bytes.length, 0, 'se esperaba que Pandoc fallara sin red');
  assert.ok(
    result.stderr.some(line => line.includes('openURL')),
    `stderr inesperado: ${result.stderr.join(' | ')}`,
  );
});

test('omitir las imágenes que no se pueden descargar salva la exportación', { timeout: 180000 }, async () => {
  const markdown = '# Con imagen\n\n![Diagrama](https://ejemplo.org/foto.png)\n\nTexto final.\n';
  const urls = collectRemoteImageUrls(markdown);
  assert.deepEqual(urls, ['https://ejemplo.org/foto.png']);

  const entries = assertValidEpub(await exportEpub(dropImagesByUrl(markdown, urls)), 'imagen omitida');
  const chapter = [...entries.entries()].find(([name]) => name.includes('/text/ch'))[1].toString('utf8');
  assert.match(chapter, /Diagrama/, 'debería conservarse el texto alternativo');
  assert.doesNotMatch(chapter, /ejemplo\.org/);
});

test('una imagen data URI acaba incrustada en el EPUB', { timeout: 180000 }, async () => {
  const markdown = '# Imagen\n\n![a](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)\n';
  const entries = assertValidEpub(await exportEpub(markdown), 'data URI');
  assert.ok(
    [...entries.keys()].some(name => name.startsWith('EPUB/media/')),
    `la imagen no se incrustó: ${[...entries.keys()].join(', ')}`,
  );
});

function textOf(entries) {
  return [...entries.entries()]
    .filter(([name]) => name.endsWith('.xhtml'))
    .map(([, content]) => content.toString('utf8'))
    .join('\n');
}

/*
  Sin normalizar, un `---` que va tras una línea en blanco abre un bloque de
  metadatos YAML. Si lo que sigue no es YAML válido, Pandoc aborta y no escribe
  nada: exactamente el EPUB de 0 bytes que motivó esta prueba.
*/
test('las rayas --- sin normalizar abortan la conversión', { timeout: 180000 }, async () => {
  const result = await runPandoc(buildExportArgs('epub3', { mathml: true }), CON_RAYAS);
  assert.equal(result.bytes.length, 0, 'se esperaba un fallo de parseo YAML');
  assert.ok(
    result.stderr.some(line => line.includes('YAML')),
    `stderr inesperado: ${result.stderr.join(' | ')}`,
  );
});

test('tras normalizar no se pierde ninguna sección', { timeout: 180000 }, async () => {
  const entries = assertValidEpub(await exportEpub(CON_RAYAS), 'documento con rayas');
  const texto = textOf(entries);
  for (const n of [1, 15, 30]) {
    assert.ok(texto.includes(`Sección ${n}`), `falta la sección ${n} en el EPUB`);
  }
  assert.match(texto, /<hr\s*\/?>/, 'las rayas deberían seguir siendo líneas horizontales');
});

test('un encabezado setext sigue siendo un encabezado tras normalizar', { timeout: 180000 }, async () => {
  const entries = assertValidEpub(await exportEpub('# Doc\n\nSubtítulo real\n---\n\nTexto.\n'), 'setext');
  const chapter = [...entries.entries()].find(([name]) => name.includes('/text/ch'))[1].toString('utf8');
  assert.match(chapter, /<h2[^>]*>Subtítulo real<\/h2>/);
});

test('DOCX y ODT siguen exportando correctamente', { timeout: 180000 }, async () => {
  const markdown = normalizeThematicBreaks('# Documento\n\nTexto con $a^2$ y una tabla.\n\n---\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
  for (const [format, mathml] of [['docx', false], ['odt', true]]) {
    const result = await runPandoc(buildExportArgs(format, { mathml }), markdown);
    assert.ok(
      result.bytes.length > 0,
      `${format}: salida vacía. stderr: ${result.stderr.join(' | ')}`,
    );
    assert.equal(result.bytes[0], 0x50, `${format}: no parece un ZIP`);
  }
});

test('un EPUB se puede volver a importar como Markdown limpio', { timeout: 180000 }, async () => {
  const original = [
    '# Manual',
    '',
    'Ver el [índice](#seccion-uno).',
    '',
    '## Sección uno',
    '',
    'Texto con **negrita**, *cursiva* y $a^2+b^2$.',
    '',
    '- punto uno',
    '- punto dos',
    '',
    '> una cita',
    '',
    '| a | b |',
    '|---|---|',
    '| 1 | 2 |',
    '',
  ].join('\n');

  const exported = await exportEpub(original);
  assertValidEpub(exported, 'ida y vuelta');

  const imported = await runPandoc(buildImportArgs('epub'), exported.bytes);
  assert.ok(imported.bytes.length > 0, `importación vacía: ${imported.stderr.join(' | ')}`);
  const markdown = stripEpubAnchorPrefixes(new TextDecoder().decode(imported.bytes));

  // Sin las extensiones desactivadas, Pandoc devolvería divs y anclas vacías.
  assert.doesNotMatch(markdown, /^:::/m, 'no debería haber bloques :::');
  assert.doesNotMatch(markdown, /\[\]\{#/, 'no debería haber anclas vacías');
  assert.doesNotMatch(markdown, /\.xhtml/, 'no deberían quedar referencias al EPUB');

  assert.match(markdown, /^# Manual$/m);
  assert.match(markdown, /^## Sección uno$/m);
  assert.match(markdown, /\*\*negrita\*\*/);
  assert.match(markdown, /^- +punto uno$/m);
  assert.match(markdown, /^> una cita$/m);
  assert.match(markdown, /\(#seccion-uno\)/);
});

const PNG_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';

/*
  Pandoc only returns text, so an imported image points at a path inside the
  uploaded archive (Pictures/…, media/…) that no longer exists. The image has to
  be pulled out of the file itself.
*/
for (const [label, exportFormat, importFormat] of [
  ['DOCX', 'docx', 'docx'],
  ['ODT', 'odt', 'odt'],
  ['EPUB', 'epub3', 'epub'],
]) {
  test(`las imágenes sobreviven al viaje de ida y vuelta en ${label}`, { timeout: 180000 }, async () => {
    const source = `# Prueba\n\nAntes.\n\n![Un gato](${PNG_DATA_URI})\n\nDespués.\n`;
    const prepared = ensureEpubMetadata(source, { fallbackTitle: 'doc', lang: 'es' });
    const exported = await runPandoc(
      buildExportArgs(exportFormat, { mathml: exportFormat !== 'docx', titleFromHeading: prepared.titleFromHeading }),
      exportFormat === 'epub3' ? prepared.markdown : source,
    );
    assert.ok(exported.bytes.length > 0, `exportación vacía: ${exported.stderr.join(' | ')}`);

    const imported = await runPandoc(buildImportArgs(importFormat), exported.bytes);
    assert.ok(imported.bytes.length > 0, `importación vacía: ${imported.stderr.join(' | ')}`);
    const raw = new TextDecoder().decode(imported.bytes);

    // Pandoc devuelve una ruta interna del archivo, no la imagen.
    assert.match(raw, /!\[[^\]]*\]\([^)]+\)/, 'no hay ninguna imagen en el Markdown importado');
    assert.doesNotMatch(raw, /\{width=/, 'los atributos de tamaño saldrían como texto en la previsualización');
    assert.doesNotMatch(raw, /<img/, 'no debería aparecer HTML crudo');

    const resolved = await inlineArchiveImages(raw, exported.bytes);
    assert.match(resolved, /!\[[^\]]*\]\(data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+\)/, 'la imagen no quedó incrustada');
  });
}

/*
  Pandoc's default Markdown writer aligns tables with spaces. The preview only
  understands pipe tables, so an imported table used to show up as plain text.
*/
for (const [label, exportFormat, importFormat] of [
  ['DOCX', 'docx', 'docx'],
  ['ODT', 'odt', 'odt'],
  ['EPUB', 'epub3', 'epub'],
]) {
  test(`las tablas vuelven como tabla Markdown desde ${label}`, { timeout: 180000 }, async () => {
    const source = '# Datos\n\n| Nombre | Edad | Ciudad    |\n|--------|------|-----------|\n| Ana    | 28   | Barcelona |\n| Marta  | 42   | Valencia  |\n';
    const prepared = ensureEpubMetadata(source, { fallbackTitle: 'doc', lang: 'es' });
    const exported = await runPandoc(
      buildExportArgs(exportFormat, { mathml: exportFormat !== 'docx', titleFromHeading: prepared.titleFromHeading }),
      exportFormat === 'epub3' ? prepared.markdown : source,
    );
    assert.ok(exported.bytes.length > 0, `exportación vacía: ${exported.stderr.join(' | ')}`);

    const imported = await runPandoc(buildImportArgs(importFormat), exported.bytes);
    let markdown = new TextDecoder().decode(imported.bytes);
    // El lector ODT de Pandoc descarta <table:table-header-rows>; la app lo
    // recupera del propio archivo, así que la prueba hace lo mismo.
    if (importFormat === 'odt') {
      markdown = await restoreOdtTableHeaders(markdown, exported.bytes);
    }

    // Lo esencial: una tabla de tuberías, no texto alineado con espacios.
    assert.match(markdown, /^\|.*\|$/m, `sin tabla de tuberías:\n${markdown}`);
    assert.match(markdown, /^\|[-:| ]+\|$/m, 'falta la fila separadora');
    assert.match(markdown, /\|\s*Ana\s*\|\s*28\s*\|\s*Barcelona\s*\|/);
    assert.match(markdown, /\|\s*Marta\s*\|\s*42\s*\|\s*Valencia\s*\|/);
    assert.match(markdown, /^\|\s*Nombre\s*\|\s*Edad\s*\|\s*Ciudad\s*\|/m, 'se perdió el encabezado');
  });
}

/*
  Fórmulas. El manual las escribe con $…$ y $$…$$, y los botones de la barra
  insertan además \(…\) y \[…\]: las cuatro variantes tienen que llegar al
  documento exportado, no solo producir un archivo no vacío.
*/
const MATH_CASES = [
  [
    'dólares (como el manual)',
    '## Fórmulas\n\nComo $ax^2 + bx + c = 0$, se utiliza:\n\n$$\nx = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}\n$$\n',
    /ax\^\{?2\}?/,
  ],
  [
    'barra invertida',
    '## Fórmulas\n\nEn línea \\(E = mc^2\\) y en bloque:\n\n\\[\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n\\]\n',
    /mc\^\{?2\}?/,
  ],
];

// Igual que exportDocument()/generateLatex()/generateHtml() antes de Pandoc.
function prepareForExport(markdown) {
  return normalizeThematicBreaks(normalizeNewlines(trimInlineMath(markdown)));
}

for (const [label, markdown, cuerpo] of MATH_CASES) {
  test(`las fórmulas llegan a LaTeX: ${label}`, { timeout: 180000 }, async () => {
    const args = `-f ${MARKDOWN_READER_NO_AUTO_IDS} -t latex --no-highlight`;
    const result = await runPandoc(args, prepareForExport(markdown));
    assert.ok(result.bytes.length > 0, `salida vacía: ${result.stderr.join(' | ')}`);
    const tex = new TextDecoder().decode(result.bytes);
    assert.match(tex, /\\\(|\\\[|\$/, 'sin delimitadores matemáticos');
    assert.match(tex, cuerpo, `no aparece la fórmula:\n${tex}`);
  });

  test(`las fórmulas llegan a HTML: ${label}`, { timeout: 180000 }, async () => {
    const args = `-f ${MARKDOWN_READER_NO_AUTO_IDS} -t html --mathjax -s`;
    const result = await runPandoc(args, prepareForExport(markdown));
    assert.ok(result.bytes.length > 0, `salida vacía: ${result.stderr.join(' | ')}`);
    const html = new TextDecoder().decode(result.bytes);
    assert.match(html, /class="math (inline|display)"/, 'sin marcado de fórmula');
  });

  test(`las fórmulas llegan a DOCX como OMML: ${label}`, { timeout: 180000 }, async () => {
    const result = await runPandoc(buildExportArgs('docx', {}), prepareForExport(markdown));
    assert.ok(result.bytes.length > 0, `DOCX vacío: ${result.stderr.join(' | ')}`);
    const document = readZipEntries(result.bytes).get('word/document.xml').toString('utf8');
    assert.match(document, /<m:oMath/, 'Word no recibiría una fórmula editable');
  });

  test(`las fórmulas llegan a ODT: ${label}`, { timeout: 180000 }, async () => {
    const result = await runPandoc(buildExportArgs('odt', { mathml: true }), prepareForExport(markdown));
    assert.ok(result.bytes.length > 0, `ODT vacío: ${result.stderr.join(' | ')}`);
    const names = [...readZipEntries(result.bytes).keys()].join(' ');
    assert.match(names, /Formula|Object/i, `sin objetos de fórmula: ${names}`);
  });

  test(`las fórmulas llegan al EPUB como MathML: ${label}`, { timeout: 180000 }, async () => {
    const entries = assertValidEpub(await exportEpub(markdown), label);
    const capitulos = [...entries.entries()]
      .filter(([name]) => name.endsWith('.xhtml'))
      .map(([, bytes]) => bytes.toString('utf8'))
      .join('\n');
    assert.match(capitulos, /<math/, 'sin MathML en el EPUB');
  });
}

test('la ida y vuelta Markdown -> DOCX -> Markdown conserva las fórmulas', { timeout: 240000 }, async () => {
  const [, markdown] = MATH_CASES[0];
  const exported = await runPandoc(buildExportArgs('docx', {}), prepareForExport(markdown));
  assert.ok(exported.bytes.length > 0, `DOCX vacío: ${exported.stderr.join(' | ')}`);

  const imported = await runPandoc(buildImportArgs('docx'), exported.bytes);
  assert.ok(imported.bytes.length > 0, `reimportación vacía: ${imported.stderr.join(' | ')}`);
  const vuelta = trimInlineMath(normalizeNewlines(new TextDecoder().decode(imported.bytes)));

  // Pandoc normaliza los exponentes (ax^2 -> ax^{2}); lo que importa es que la
  // fórmula vuelva delimitada, no que sea idéntica carácter a carácter.
  assert.match(vuelta, /\$ax\^\{?2\}? \+ bx \+ c = 0\$/, `en línea perdida:\n${vuelta}`);
  assert.match(vuelta, /\$\$x = \\frac\{-? ?b \\pm \\sqrt\{b\^\{?2\}? ?-? ?4ac\}\}\{2a\}\$\$/, `bloque perdido:\n${vuelta}`);
});

/*
  Razón de ser de inlineFetchableImages: una ruta relativa no rompe la
  conversión como una URL remota, pero se pierde en silencio. El navegador tiene
  que descargarla antes; aquí se documenta qué pasa si no lo hace.
*/
test('una ruta de imagen relativa se pierde si el navegador no la resuelve', { timeout: 180000 }, async () => {
  const markdown = '# Con imagen\n\n![Diagrama](imagenes/formulas.gif)\n\nTexto final.\n';
  const entries = assertValidEpub(await exportEpub(markdown), 'ruta relativa');
  const chapter = [...entries.entries()].find(([name]) => name.includes('/text/ch'))[1].toString('utf8');
  assert.match(chapter, /Diagrama/, 'solo sobrevive el texto alternativo');
  assert.ok(
    ![...entries.keys()].some(name => name.startsWith('EPUB/media/')),
    'la imagen no debería haberse incrustado sin resolverla antes',
  );
});

/*
  Importación. Un documento con fórmulas que entra por DOCX, ODT, EPUB o LaTeX
  tiene que volver al editor como matemáticas delimitadas, no como texto suelto.
*/
// ODT queda fuera: necesita el paso extra de prepareOdtFormulas y tiene su
// propia prueba con el encadenado completo, más abajo.
for (const [importFormat, exportFormat] of [['docx', 'docx'], ['epub', 'epub3']]) {
  test(`importar ${importFormat.toUpperCase()} devuelve las fórmulas al editor`, { timeout: 240000 }, async () => {
    const source = '# Mates\n\nEn línea $a^2+b^2=c^2$.\n\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$\n';
    const prepared = exportFormat === 'epub3'
      ? ensureEpubMetadata(prepareForExport(source), { fallbackTitle: 'mates', lang: 'es' })
      : null;
    const args = buildExportArgs(exportFormat, {
      mathml: exportFormat !== 'docx',
      titleFromHeading: prepared ? prepared.titleFromHeading : false,
    });
    const exported = await runPandoc(args, prepared ? prepared.markdown : prepareForExport(source));
    assert.ok(exported.bytes.length > 0, `exportación vacía: ${exported.stderr.join(' | ')}`);

    const imported = await runPandoc(buildImportArgs(importFormat), exported.bytes);
    assert.ok(imported.bytes.length > 0, `importación vacía: ${imported.stderr.join(' | ')}`);
    const markdown = trimInlineMath(normalizeNewlines(new TextDecoder().decode(imported.bytes)));

    assert.match(markdown, /\$a\^\{?2\}? ?\+ ?b\^\{?2\}? ?= ?c\^\{?2\}?\$/, `en línea perdida:\n${markdown}`);
    assert.match(markdown, /\\int_\{?0\}?\^\{?1\}?/, `integral perdida:\n${markdown}`);
    assert.match(markdown, /\\frac\{1\}\{3\}/, `fracción perdida:\n${markdown}`);
  });
}

test('importar LaTeX devuelve las fórmulas al editor', { timeout: 180000 }, async () => {
  const latex = [
    '\\documentclass{article}',
    '\\begin{document}',
    'En línea \\(E = mc^2\\) y en bloque:',
    '\\[',
    '\\int_0^1 x^2\\,dx = \\frac{1}{3}',
    '\\]',
    '\\end{document}',
  ].join('\n');

  const imported = await runPandoc(buildImportArgs('latex'), latex);
  assert.ok(imported.bytes.length > 0, `importación vacía: ${imported.stderr.join(' | ')}`);
  const markdown = trimInlineMath(normalizeNewlines(new TextDecoder().decode(imported.bytes)));

  assert.match(markdown, /\$E = mc\^\{?2\}?\$/, `en línea perdida:\n${markdown}`);
  assert.match(markdown, /\\int_\{?0\}?\^\{?1\}?/, `integral perdida:\n${markdown}`);
  assert.match(markdown, /\\frac\{1\}\{3\}/, `fracción perdida:\n${markdown}`);
});

/*
  Fórmulas al importar un ODT.

  El escritor ODT de Pandoc referencia cada fórmula con una barra final
  (`Formula-0/`) que su propio lector no resuelve, así que un ODT exportado por
  la aplicación volvía sin sus fórmulas. prepareOdtForImport repara esa
  referencia y Pandoc convierte el MathML por su cuenta.
*/
async function importOdt(markdown, { reparar = true } = {}) {
  const exported = await runPandoc(buildExportArgs('odt', { mathml: true }), prepareForExport(markdown));
  assert.ok(exported.bytes.length > 0, `ODT vacío: ${exported.stderr.join(' | ')}`);

  const entrada = reparar ? await prepareOdtForImport(exported.bytes) : exported.bytes;
  const imported = await runPandoc(buildImportArgs('odt'), entrada);
  assert.ok(imported.bytes.length > 0, `importación vacía: ${imported.stderr.join(' | ')}`);
  return {
    markdown: trimInlineMath(normalizeNewlines(new TextDecoder().decode(imported.bytes))),
    odt: exported.bytes,
  };
}

test('importar un ODT exportado por la app recupera sus fórmulas', { timeout: 300000 }, async () => {
  const source = '# Mates\n\nEn línea $a^2+b^2=c^2$ y sigue el texto.\n\n$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$\n\nFinal.\n';

  // Sin reparar, Pandoc no encuentra ninguna de las dos fórmulas.
  const { markdown: sinReparar } = await importOdt(source, { reparar: false });
  assert.doesNotMatch(sinReparar, /a\^\{?2\}?/, `Pandoc ya resuelve la referencia; revisar la reparación:\n${sinReparar}`);

  const { markdown } = await importOdt(source);
  assert.match(markdown, /a\^\{?2\}? ?\+ ?b\^\{?2\}? ?= ?c\^\{?2\}?/, `en línea perdida:\n${markdown}`);
  assert.match(markdown, /\\int/, `integral perdida:\n${markdown}`);
  assert.match(markdown, /\\frac\{1\}\{3\}/, `fracción perdida:\n${markdown}`);
  assert.match(markdown, /^Final\.$/m, 'el texto posterior debe seguir intacto');
});

test('las fórmulas conviven con tablas e imágenes al importar un ODT', { timeout: 300000 }, async () => {
  const source = [
    '# Mezcla',
    '',
    '| Nombre | Valor |',
    '|--------|-------|',
    '| pi     | 3.14  |',
    '',
    'Fórmula $E = mc^2$ junto a una imagen:',
    '',
    '![Diagrama](data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7)',
    '',
  ].join('\n');
  const { markdown, odt } = await importOdt(source);

  const conTablas = await restoreOdtTableHeaders(markdown, odt);
  assert.match(conTablas, /E = mc\^\{?2\}?/, `fórmula perdida:\n${conTablas}`);
  assert.match(conTablas, /\|\s*Nombre\s*\|\s*Valor\s*\|/, `encabezado de tabla perdido:\n${conTablas}`);
  assert.match(conTablas, /!\[[^\]]*\]\(/, `imagen perdida:\n${conTablas}`);
});

/*
  El LaTeX autónomo sin metadatos salía siempre en inglés (sin babel, con la
  partición silábica por defecto) y con el título del documento convertido en
  una sección más, donde correspondía una portada.
*/
function latexStandalone(markdown, lang, settings = {}) {
  const prepared = prepareLatexStandalone(markdown, { lang, ...settings });
  let args = `-s -f ${MARKDOWN_READER_NO_AUTO_IDS} -t latex --no-highlight`;
  if (prepared.shiftHeadings) args += ' --shift-heading-level-by=-1';
  return runPandoc(args, prepared.markdown);
}

test('el LaTeX autónomo lleva el idioma de la interfaz y el título del documento', { timeout: 180000 }, async () => {
  const source = '# Ecuaciones\n\n## Planteamiento\n\nTexto con $E=mc^2$.\n\n### Detalle\n\nMás texto.\n';
  const { bytes } = await latexStandalone(source, 'es');
  const latex = new TextDecoder().decode(bytes);

  assert.match(latex, /\\babelprovide\[main,import\]\{spanish\}/, `sin babel español:\n${latex.slice(0, 800)}`);
  assert.match(latex, /\\title\{Ecuaciones\}/, 'el encabezado inicial debe ser el título');
  assert.match(latex, /\\maketitle/, 'falta la portada');
  // Con el título fuera del cuerpo, los encabezados suben un nivel.
  assert.match(latex, /\\section\{Planteamiento\}/);
  assert.match(latex, /\\subsection\{Detalle\}/);
  assert.equal(/\\section\{Ecuaciones\}/.test(latex), false, 'el título no debe repetirse como sección');
});

test('con varios encabezados de nivel 1 solo se añade el idioma', { timeout: 180000 }, async () => {
  const { bytes } = await latexStandalone('# Tema 1\n\nTexto.\n\n# Tema 2\n\nMás.\n', 'ca');
  const latex = new TextDecoder().decode(bytes);

  assert.match(latex, /\\babelprovide\[main,import\]\{catalan\}/);
  assert.equal(/\\maketitle/.test(latex), false, 'sin un título claro no se inventa portada');
  assert.match(latex, /\\section\{Tema 1\}/);
  assert.match(latex, /\\section\{Tema 2\}/);
});

test('los ajustes de LaTeX del usuario llegan al documento generado', { timeout: 180000 }, async () => {
  const { bytes } = await latexStandalone('# Apuntes\n\nTexto.\n', 'es', {
    documentClass: 'report',
    classOptions: '12pt, a4paper',
    preamble: '\\usepackage{amsthm}\n\\newcommand{\\R}{\\mathbb{R}}',
  });
  const latex = new TextDecoder().decode(bytes);

  assert.match(latex, /\\documentclass\[[\s\S]*?12pt,[\s\S]*?a4paper,?[\s\S]*?\]\{report\}/, `clase u opciones perdidas:\n${latex.slice(0, 400)}`);
  assert.match(latex, /\\usepackage\{amsthm\}/, 'falta el paquete del preámbulo');
  assert.match(latex, /\\newcommand\{\\R\}\{\\mathbb\{R\}\}/, 'falta la macro del preámbulo');
  // El preámbulo va antes del cuerpo, no dentro de él.
  assert.ok(latex.indexOf('\\usepackage{amsthm}') < latex.indexOf('\\begin{document}'));
});

/*
  Sin metadato de idioma, Pandoc marca los DOCX y los ODT como inglés de EE. UU.
  y el corrector de Word o LibreOffice subraya el texto entero; el HTML autónomo
  sale con lang="" , que para un lector de pantalla es peor que nada.
*/
test('el idioma del documento llega a DOCX, ODT y HTML', { timeout: 240000 }, async () => {
  const fuente = '# Título\n\nUn texto cualquiera para revisar.\n';
  const conIdioma = ensureExportMetadata(fuente, { lang: 'es' }).markdown;

  const docx = readZipEntries((await runPandoc(buildExportArgs('docx', {}), conIdioma)).bytes);
  const estilosDocx = docx.get('word/styles.xml').toString('utf8');
  assert.match(estilosDocx, /w:lang[^>]*w:val="es"/, 'el DOCX sigue en inglés');

  const odt = readZipEntries((await runPandoc(buildExportArgs('odt', {}), conIdioma)).bytes);
  const estilosOdt = odt.get('styles.xml').toString('utf8');
  assert.match(estilosOdt, /fo:language="es"/, 'el ODT sigue en inglés');

  const html = new TextDecoder().decode(
    (await runPandoc(`-f ${MARKDOWN_READER_NO_AUTO_IDS} -t html --mathjax -s`, conIdioma)).bytes
  );
  assert.match(html, /<html[^>]*\blang="es"/, `el HTML no declara el idioma:\n${html.slice(0, 200)}`);

  // Sin el metadato, el idioma inglés por defecto es lo que se colaba antes.
  const sinIdioma = readZipEntries((await runPandoc(buildExportArgs('docx', {}), fuente)).bytes);
  assert.match(sinIdioma.get('word/styles.xml').toString('utf8'), /w:lang[^>]*w:val="en-US"/);
});

/*
  Sin título, Pandoc rellena el <title> con el nombre de su archivo temporal: la
  página exportada salía titulada «in» en la pestaña del navegador, en los
  resultados de búsqueda y al guardarla.
*/
test('la página HTML sale titulada, no como «in», y sin repetir el encabezado', { timeout: 180000 }, async () => {
  const fuente = '# Ecuaciones de segundo grado\n\nTexto.\n';
  const antes = new TextDecoder().decode(
    (await runPandoc(`-f ${MARKDOWN_READER_NO_AUTO_IDS} -t html --mathjax -s`, fuente)).bytes
  );
  assert.match(antes, /<title>in<\/title>/, 'referencia: así salía antes');

  const preparado = ensureExportMetadata(fuente, {
    lang: 'es',
    author: 'Juan José',
    pageTitle: 'Ecuaciones de segundo grado',
  }).markdown;
  const html = new TextDecoder().decode(
    (await runPandoc(`-f ${MARKDOWN_READER_NO_AUTO_IDS} -t html --mathjax -s`, preparado)).bytes
  );

  assert.match(html, /<title>Ecuaciones de segundo grado<\/title>/);
  assert.match(html, /<meta name="author" content="Juan José"/);
  // El cuerpo no gana un bloque de título que repita el encabezado.
  assert.equal(/<header[^>]*id="title-block-header"/.test(html), false, 'el título no debe repetirse en el cuerpo');
  assert.equal((html.match(/Ecuaciones de segundo grado/g) || []).length, 2, 'solo en <title> y en el encabezado');
});

test('el autor llega a las propiedades del DOCX y del EPUB', { timeout: 240000 }, async () => {
  const fuente = '# Apuntes\n\nTexto.\n';
  const docx = readZipEntries((await runPandoc(
    buildExportArgs('docx', {}),
    ensureExportMetadata(fuente, { lang: 'es', author: 'Juan José' }).markdown,
  )).bytes);
  assert.match(docx.get('docProps/core.xml').toString('utf8'), /<dc:creator>Juan José<\/dc:creator>/);

  const preparado = ensureEpubMetadata(fuente, { fallbackTitle: 'apuntes', lang: 'es', author: 'Juan José' });
  const epub = readZipEntries((await runPandoc(
    buildExportArgs('epub3', { mathml: true, titleFromHeading: preparado.titleFromHeading }),
    preparado.markdown,
  )).bytes);
  const opf = [...epub.keys()].find(name => name.endsWith('.opf'));
  assert.match(epub.get(opf).toString('utf8'), /<dc:creator[^>]*>Juan José<\/dc:creator>/);
});

/*
  Índice y numeración, medidos en el documento real: en DOCX el índice es un
  campo de Word (actualizable), en ODT un índice nativo, y la numeración la
  escribe Pandoc en el propio encabezado. El ODT no admite numeración.
*/
test('el índice y la numeración llegan a DOCX, ODT y LaTeX', { timeout: 300000 }, async () => {
  const fuente = ensureExportMetadata(
    '# Tema 1\n\nTexto.\n\n## Apartado A\n\nMás.\n\n### Detalle\n\nFondo.\n',
    { lang: 'es', tocTitle: 'Índice' },
  ).markdown;

  const docx = readZipEntries((await runPandoc(
    buildExportArgs('docx', { toc: true, tocDepth: 2, numberSections: true }), fuente,
  )).bytes).get('word/document.xml').toString('utf8');
  assert.match(docx, /TOC \\o/, 'el DOCX debe llevar un campo de índice de Word');
  assert.match(docx, /TOC \\o &quot;1-2&quot;/, 'el índice debe detenerse en H2');
  assert.match(docx, /Índice/, 'el rótulo del índice va en el idioma del documento');
  // Cada etiqueta deja su marca: se colapsan para leer el texto seguido.
  const textoDocx = docx.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
  assert.match(textoDocx, /\|1\|Tema 1\|/, 'los apartados deben ir numerados');
  assert.match(textoDocx, /\|1\.1\|Apartado A\|/);

  const odt = readZipEntries((await runPandoc(
    buildExportArgs('odt', { toc: true, tocDepth: 2 }), fuente,
  )).bytes).get('content.xml').toString('utf8');
  assert.match(odt, /text:table-of-content/, 'el ODT debe llevar su índice nativo');
  assert.match(odt, /text:outline-level="2"/, 'el índice ODT debe detenerse en H2');

  const latex = new TextDecoder().decode((await runPandoc(
    `-s -f ${MARKDOWN_READER_NO_AUTO_IDS} -t latex --no-highlight --toc --number-sections`, fuente,
  )).bytes);
  assert.match(latex, /\\tableofcontents/);
  assert.equal(/setcounter\{secnumdepth\}\{-\\maxdimen\}/.test(latex), false, 'la numeración debe quedar activada');
});

test('sin pedirlo, nada cambia', { timeout: 180000 }, async () => {
  const fuente = ensureExportMetadata('# Tema 1\n\nTexto.\n', { lang: 'es' }).markdown;
  const docx = readZipEntries((await runPandoc(buildExportArgs('docx', {}), fuente)).bytes)
    .get('word/document.xml').toString('utf8');
  assert.equal(/TOC \\o/.test(docx), false);
  const texto = docx.replace(/<[^>]+>/g, '|').replace(/\|+/g, '|');
  assert.match(texto, /\|Tema 1\|/, 'el encabezado no debe llevar número');
  assert.equal(/\|1\|Tema 1\|/.test(texto), false);
});

/*
  Un EPUB sin imagen de portada aparece con el icono genérico en la estantería
  del lector. Pandoc la acepta, pero dentro del WASM no hay disco: la imagen
  tiene que ir montada en su sistema de ficheros virtual.
*/
test('la portada llega al EPUB cuando se le monta la imagen', { timeout: 180000 }, async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const preparado = ensureEpubMetadata('# Mi libro\n\nTexto.\n', {
    fallbackTitle: 'libro', lang: 'es', author: 'Juan José',
  });
  const base = buildExportArgs('epub3', { mathml: true, titleFromHeading: preparado.titleFromHeading });

  const conPortada = readZipEntries((await runPandoc(
    `${base} --epub-cover-image=/cover.png`,
    preparado.markdown,
    { 'cover.png': new Uint8Array(png) },
  )).bytes);
  const nombres = [...conPortada.keys()];
  const opf = conPortada.get(nombres.find(name => name.endsWith('.opf'))).toString('utf8');
  assert.ok(nombres.some(name => name.endsWith('media/cover.png')), `la imagen no está: ${nombres.join(', ')}`);
  assert.ok(nombres.some(name => /cover\.xhtml$/.test(name)), 'falta la página de portada');
  assert.match(opf, /properties="cover-image"/, 'el OPF debe marcar cuál es la portada');

  // Sin montarla, el mismo libro sale sin nada de esto.
  const sinPortada = readZipEntries((await runPandoc(base, preparado.markdown)).bytes);
  assert.equal([...sinPortada.keys()].some(name => /cover\.xhtml$/.test(name)), false);
});

/*
  El recorrido completo del índice del DOCX: Pandoc deja el campo vacío y la
  aplicación le escribe dentro las entradas, que es lo que hace que el
  documento se abra con el índice a la vista en lugar de en blanco.
*/
test('el DOCX se abre con el índice ya escrito', { timeout: 240000 }, async () => {
  const fuente = ensureExportMetadata(
    '# Tema 1\n\nTexto.\n\n## Apartado A\n\nMás.\n\n# Tema 2\n\nFin.\n',
    { lang: 'es', tocTitle: 'Índice' },
  ).markdown;
  const generado = (await runPandoc(
    buildExportArgs('docx', { toc: true, numberSections: true }), fuente,
  )).bytes;

  // Tal como sale de Pandoc: el campo está, pero su resultado va vacío.
  const antes = readZipEntries(generado).get('word/document.xml').toString('utf8');
  assert.match(antes, /<w:fldChar w:fldCharType="separate"\s*\/>\s*<w:fldChar w:fldCharType="end"\s*\/>/);

  const entries = await readZipEntries(await requestDocxFieldUpdate(new Uint8Array(generado)));
  const despues = new TextDecoder().decode(entries.get('word/document.xml'));
  const settings = new TextDecoder().decode(entries.get('word/settings.xml'));

  assert.match(settings, /<w:updateFields w:val="true"\/>/);
  // Las entradas van dentro del campo, entre separate y end.
  const dentro = despues.slice(
    despues.indexOf('fldCharType="separate"'),
    despues.indexOf('fldCharType="end"'),
  );
  assert.match(dentro, /1 Tema 1/);
  assert.match(dentro, /1\.1 Apartado A/);
  assert.match(dentro, /2 Tema 2/);
  assert.match(dentro, /<w:ind w:left="340"\/>/, 'el subapartado va sangrado');
});

test('el ODT se abre con el índice ya escrito', { timeout: 240000 }, async () => {
  const fuente = ensureExportMetadata(
    '# Tema 1\n\nTexto.\n\n## Apartado A\n\nMás.\n',
    { lang: 'es', tocTitle: 'Índice' },
  ).markdown;
  const generado = (await runPandoc(buildExportArgs('odt', { toc: true }), fuente)).bytes;

  // Pandoc deja la plantilla del índice, pero no lo que el lector muestra.
  const antes = readZipEntries(generado).get('content.xml').toString('utf8');
  assert.match(antes, /<text:table-of-content\b/);
  assert.equal(antes.includes('<text:index-body'), false);

  const entries = await readZipEntries(await fillOdtTableOfContents(new Uint8Array(generado)));
  const despues = new TextDecoder().decode(entries.get('content.xml'));
  assert.match(despues, /<text:index-body>/);
  assert.match(despues, /EdimarkToc1">Tema 1</);
  assert.match(despues, /EdimarkToc2">Apartado A</);
  assert.match(despues, /<text:p[^>]*>Índice</, 'el rótulo se reutiliza de la plantilla');
  assert.equal([...entries.keys()][0], 'mimetype', 'el ODT exige que mimetype vaya primero');
});

// Igual que importToMarkdown() para un EPUB, después de Pandoc.
async function finishEpubImport(bytes, archive) {
  let markdown = stripEpubAnchorPrefixes(new TextDecoder().decode(bytes));
  const book = await readEpubMetadata(archive);
  markdown = dropDuplicateEpubTitle(markdown, book.title);
  if (book.language) {
    markdown = mergeFrontMatter(markdown, [{ key: 'lang', lines: [`lang: "${book.language}"`] }]).markdown;
  }
  return collapseThematicBreaks(expandDisplayMath(trimInlineMath(normalizeNewlines(markdown))));
}

/*
  El documento entero, de ida y vuelta, con el Pandoc de verdad. Lo que se
  comprueba aquí es lo que el usuario ve al reabrir su manual: que la
  tipografía siga siendo tipografía, que el título no se haya duplicado y que
  el idioma haya vuelto con el documento.
*/
test('el ciclo completo de EPUB devuelve el documento reconocible', { timeout: 180000 }, async () => {
  const original = [
    '![Logotipo](imagen.png)',
    '',
    '# Manual de pruebas',
    '',
    'Tres opciones —Sistema, Claro y Oscuro— y un ejemplo: “Tema 3 – Ecuaciones”…',
    '',
    '---',
    '',
    '## Fórmulas',
    '',
    'En línea $E = mc^2$ y en bloque:',
    '',
    '$$',
    'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}',
    '$$',
    '',
  ].join('\n');

  const exported = await exportEpub(original, { fallbackTitle: 'Manual de pruebas', lang: 'ca' });
  assertValidEpub(exported, 'ciclo completo');

  const imported = await runPandoc(buildImportArgs('epub'), exported.bytes);
  assert.ok(imported.bytes.length > 0, `importación vacía: ${imported.stderr.join(' | ')}`);
  const markdown = await finishEpubImport(imported.bytes, exported.bytes);

  // La tipografía es la que escribió el autor, no su transcripción en ASCII.
  assert.match(markdown, /—Sistema, Claro y Oscuro—/, `rayas perdidas:\n${markdown}`);
  assert.match(markdown, /“Tema 3 – Ecuaciones”…/, `comillas o puntos perdidos:\n${markdown}`);
  assert.doesNotMatch(markdown, /---Sistema/, 'la raya volvió como tres guiones');

  // El logotipo va antes del título, así que Pandoc añadía un capítulo suelto
  // con el título del libro y el documento volvía con dos.
  assert.equal((markdown.match(/^# Manual de pruebas$/gm) || []).length, 1, `título duplicado:\n${markdown}`);

  // El idioma vive en el envoltorio del libro y vuelve al documento.
  assert.match(markdown, /^lang: "ca"$/m, `idioma perdido:\n${markdown}`);

  // La raya, sin los setenta y dos guiones; la fórmula, con sus $$ aparte.
  assert.match(markdown, /\n---\n/, `raya perdida:\n${markdown}`);
  assert.doesNotMatch(markdown, /-{10,}/, 'la raya volvió como una fila de guiones');
  assert.match(markdown, /\$\$\n[^$]*\\frac\{-b[^$]*\n\$\$/, `fórmula en bloque aplastada:\n${markdown}`);
});

test('citeproc aplica APA 7 y escribe el título elegido de la bibliografía en HTML y DOCX', { timeout: 180000 }, async () => {
  const bibliography = new TextEncoder().encode(`
    @book{garcia2024,
      author = {García, Ana},
      title = {Didáctica digital},
      year = {2024},
      publisher = {Aula Abierta}
    }
  `);
  const apa = new Uint8Array(await readFile(new URL('../csl/apa.csl', import.meta.url)));
  const markdown = '# Trabajo\n\nLa propuesta se apoya en una fuente [@garcia2024]. García también lo desarrolla: @garcia2024 [p. 5]. Según García [-@garcia2024, p. 8], es aplicable.\n\n### Fuentes consultadas\n\n::: {#refs}\n:::\n';
  const extraFiles = { 'references.bib': bibliography, 'style.csl': apa };
  const citationArgs = ' --citeproc --bibliography=/references.bib --csl=/style.csl';

  const html = await runPandoc(
    `-f ${MARKDOWN_READER_NO_AUTO_IDS} -t html${citationArgs}`,
    markdown,
    extraFiles,
  );
  const htmlText = new TextDecoder().decode(html.bytes);
  assert.ok(html.bytes.length > 0, `HTML vacío: ${html.stderr.join(' | ')}`);
  assert.match(htmlText, /class="citation"/);
  assert.match(htmlText, /\(García, 2024\)/);
  assert.match(htmlText, /García \(2024,\s+p\. 5\)/);
  assert.match(htmlText, /\(2024,\s+p\. 8\)/);
  assert.match(htmlText, /<h3>Fuentes consultadas<\/h3>/);
  assert.match(htmlText, /id="refs"/);
  assert.match(htmlText, /Didáctica [Dd]igital/);

  const docx = await runPandoc(
    `-f ${MARKDOWN_READER_NO_AUTO_IDS} -t docx${citationArgs}`,
    markdown,
    extraFiles,
  );
  assert.ok(docx.bytes.length > 0, `DOCX vacío: ${docx.stderr.join(' | ')}`);
  const entries = readZipEntries(docx.bytes);
  const documentXml = entries.get('word/document.xml')?.toString('utf8') || '';
  assert.match(documentXml, /Fuentes consultadas/);
  assert.match(documentXml, /Didáctica [Dd]igital/);
  assert.doesNotMatch(documentXml, /@garcia2024/);
});

test('citeproc compone los siete tipos de referencia creados desde la interfaz', { timeout: 180000 }, async () => {
  const references = [
    ['article', 'Artículo probado', { container: 'Revista Escolar', volume: '12', number: '2', pages: '5--9' }],
    ['book', 'Libro probado', { publisher: 'Editorial Aula', edition: '2' }],
    ['chapter', 'Capítulo probado', { container: 'Libro colectivo', publisher: 'Editorial Aula', pages: '20--30' }],
    ['report', 'Informe probado', { institution: 'UNESCO', number: '42' }],
    ['web', 'Web probada', { url: 'https://example.com/recurso', accessed: '2026-09-01' }],
    ['thesis', 'Tesis probada', { institution: 'Universidad Abierta' }],
    ['conference', 'Ponencia probada', { container: 'Congreso Educativo', pages: '40--45' }],
  ];
  let content = '';
  references.forEach(([type, title, fields], index) => {
    const result = bibliographyModel.appendReference(content, 'references.bib', {
      type,
      id: `interfaz${index}`,
      author: 'García, Ana',
      title,
      year: '2026',
      ...fields,
    });
    assert.equal(result.ok, true, type);
    content = result.content;
  });
  const apa = new Uint8Array(await readFile(new URL('../csl/apa.csl', import.meta.url)));
  const citations = references.map((_, index) => `@interfaz${index}`).join('; ');
  const markdown = `# Fuentes\n\n[${citations}]\n\n## Referencias\n\n::: {#refs}\n:::\n`;
  const html = await runPandoc(
    `-f ${MARKDOWN_READER_NO_AUTO_IDS} -t html --citeproc --bibliography=/references.bib --csl=/style.csl`,
    markdown,
    {
      'references.bib': new TextEncoder().encode(content),
      'style.csl': apa,
    },
  );
  const htmlText = new TextDecoder().decode(html.bytes);
  assert.ok(html.bytes.length > 0, `HTML vacío: ${html.stderr.join(' | ')}`);
  references.forEach(([, title]) => assert.match(htmlText, new RegExp(title)));
  assert.match(htmlText, /Revista Escolar/);
  assert.match(htmlText, /Editorial\s+Aula/);
  assert.match(htmlText, /UNESCO/);
  assert.match(htmlText, /Universidad\s+Abierta/);
  assert.match(htmlText, /Congreso\s+Educativo/);
  assert.doesNotMatch(htmlText, /@interfaz/);
});


test('sans llega a las fórmulas de todas las exportaciones sin tocar el código ni los alfabetos explícitos', async () => {
  const markdown = String.raw`---
title: Prueba de fuentes
font: sans
---

Texto [enlace](https://example.org) y $x^2 + \frac{a}{b} + \mathbb{R}$.

$$
y = \sqrt{x}
$$

Código: ${'`'}$sin tocar$${'`'}.

\$5 no es una fórmula.
`;
  const convert = async (args, input) => {
    const result = await runPandoc(args, input);
    assert.ok(result.bytes.length > 0, result.stderr.join('\n'));
    return result.bytes;
  };
  for (const format of ['html', 'latex', 'docx', 'odt', 'epub3']) {
    const args = `-f ${MARKDOWN_READER_NO_AUTO_IDS} -t ${format}`
      + (['odt', 'epub3'].includes(format) ? ' --mathml' : '')
      + (format === 'html' ? ' --mathjax' : '');
    let bytes = await convertWithAstPasses(convert, args, markdown, { mathFont: 'sans' });
    assert.ok(bytes.length > 0);
    if (['docx', 'odt'].includes(format)) {
      bytes = await applyOfficeFormat(bytes, { fontName: 'Arial' }, format);
    }
    const text = new TextDecoder().decode(bytes);
    if (format === 'html' || format === 'latex') {
      assert.ok(text.includes('\\mathsf{'), text);
      assert.ok(text.includes('\\mathbb{R}'), text);
      assert.ok(text.includes(format === 'html' ? '$sin tocar$' : String.raw`\texttt{\$sin\ tocar\$}`), text);
    } else {
      const entries = readZipEntries(bytes);
      if (format === 'docx') {
        const xml = new TextDecoder().decode(entries.get('word/document.xml'));
        assert.match(xml, /m:scr m:val="sans-serif"/);
        assert.match(xml, /m:scr m:val="double-struck"/);
        const styles = new TextDecoder().decode(entries.get('word/styles.xml'));
        assert.match(styles, /w:styleId="Hyperlink"[\s\S]*?w:rFonts w:ascii="Arial"/);
      } else {
        const formulas = [...entries].filter(([name]) => /(?:Formula-.*content\.xml|\.xhtml)$/.test(name))
          .map(([, value]) => new TextDecoder().decode(value)).join('\n');
        assert.match(formulas, /mathvariant="sans-serif"/);
        assert.match(formulas, /mathvariant="double-struck"|ℝ/);
        assert.match(formulas, /𝗑|mathvariant="sans-serif">x/);
        if (format === 'odt') {
          const styles = new TextDecoder().decode(entries.get('styles.xml'));
          assert.match(styles, /style:name="Internet_20_link"[\s\S]*?style:font-name="Arial"/);
        }
      }
    }
  }
});

/*
  La figura con pie sale centrada en Word y LibreOffice, igual que en la hoja,
  aunque el documento no tenga formato propio; y un documento sin figuras sale
  como salía, sin rehacer el archivo.
*/
test('figuras con pie: DOCX y ODT las centran sin sangría', async () => {
  const png = await readFile(new URL('../logo_100px.png', import.meta.url));
  const withFigure = 'Texto justificado.\n\n![Pie de figura](logo.png)\n\nMás texto.\n';
  const withoutFigure = 'Texto con una imagen ![alt](logo.png) en línea.\n';
  const decode = bytes => new TextDecoder().decode(bytes);
  const styleOf = (xml, pattern) => xml.match(pattern)?.[0] || '';
  for (const format of ['docx', 'odt']) {
    const run = async markdown => {
      const result = await runPandoc(`-f ${MARKDOWN_READER_NO_AUTO_IDS} -t ${format}`, markdown, { 'logo.png': png });
      assert.ok(result.bytes.length > 0, result.stderr.join('\n'));
      return result.bytes;
    };
    const plain = await run(withoutFigure);
    assert.equal(await applyOfficeFormat(plain, {}, format), plain, `${format}: sin figuras no debe rehacerse`);

    const exported = await applyOfficeFormat(await run(withFigure), { align: 'justify', indent: 'yes' }, format);
    const entries = readZipEntries(exported);
    if (format === 'docx') {
      const styles = decode(entries.get('word/styles.xml'));
      for (const id of ['Figure', 'ImageCaption']) {
        const style = styleOf(styles, new RegExp(`<w:style\\b[^>]*w:styleId="${id}"[\\s\\S]*?</w:style>`));
        assert.match(style, /<w:pPr><w:ind w:firstLine="0" \/><w:jc w:val="center" \/><\/w:pPr>/, `${id}: ${style}`);
      }
    } else {
      const styles = decode(entries.get('styles.xml'));
      for (const name of ['Figure', 'FigureCaption']) {
        const style = styleOf(styles, new RegExp(`<style:style\\b[^>]*style:name="${name}"[^>]*?(?:/>|>[\\s\\S]*?</style:style>)`));
        assert.match(style, /fo:text-align="center"/, `${name}: ${style}`);
        assert.match(style, /fo:text-indent="0cm"/, `${name}: ${style}`);
      }
      assert.equal(entries.keys().next().value, 'mimetype');
    }
  }
});

/*
  Un bloque `<div style="column-count:…">` sale en columnas en Word y en
  LibreOffice: en el DOCX, entre dos cortes de sección continuos y con el
  papel en todas las secciones; en el ODT, en una sección con su estilo.
*/
test('columnas: DOCX y ODT conservan el bloque en columnas', async () => {
  const markdown = '# Lista\n\n<div style="column-count:4; column-gap:10px;">\n\n## Uno\n\n'
    + Array.from({ length: 40 }, (_, index) => `- [ ] ${index + 1}`).join('\n')
    + '\n\n</div>\n\nFinal en una columna.\n';
  const convert = async (args, input) => {
    const result = await runPandoc(args, input);
    assert.ok(result.bytes.length > 0, result.stderr.join('\n'));
    return result.bytes;
  };
  const styles = { paperCm: { width: 21, height: 29.7 }, marginsCm: { top: 1.8, right: 1.8, bottom: 1.8, left: 1.8 } };
  const decode = bytes => new TextDecoder().decode(bytes);
  for (const kind of ['docx', 'odt']) {
    const args = buildExportArgs(kind, { mathml: kind === 'odt' });
    const bytes = await applyOfficeFormat(
      await convertWithAstPasses(convert, args, markdown, { columns: { kind } }),
      styles,
      kind,
    );
    const entries = readZipEntries(bytes);
    if (kind === 'docx') {
      const xml = decode(entries.get('word/document.xml'));
      const sections = xml.match(/<w:sectPr>[\s\S]*?<\/w:sectPr>/g);
      assert.equal(sections.length, 3, xml.slice(-2000));
      sections.forEach(section => assert.match(section, /<w:type w:val="continuous" \/><w:pgSz w:w="11906" w:h="16838" \/><w:pgMar /));
      assert.match(sections[1], /<w:cols w:num="4" w:space="150" \/>/);
      // El título va delante de las columnas y el párrafo final, detrás.
      assert.ok(xml.indexOf('Lista') < xml.indexOf(sections[0]));
      assert.ok(xml.indexOf(sections[1]) < xml.indexOf('Final en una columna'));
    } else {
      const xml = decode(entries.get('content.xml'));
      assert.match(xml, /<style:style style:name="EdiMarkdownColumns_4_0.265cm" style:family="section">/);
      const section = xml.match(/<text:section text:style-name="EdiMarkdownColumns_4_0.265cm"[^>]*>([\s\S]*?)<\/text:section>/);
      assert.ok(section, xml);
      assert.match(section[1], /Uno/);
      assert.doesNotMatch(section[1], /Final en una columna/);
      assert.equal(entries.keys().next().value, 'mimetype');
    }
  }
});
