import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  collectMermaidBlocks,
  mapMermaidBlocks,
  ensureEpubMetadata,
  ensureExportMetadata,
  prepareLatexStandalone,
  insertLatexPageBreaksBeforeH1,
  extractMarkdownTitle,
  hasYamlFrontMatter,
  collectRemoteImageUrls,
  collectFetchableImageUrls,
  replaceImageUrls,
  dropImagesByUrl,
  trimInlineMath,
  normalizeNewlines,
  normalizeThematicBreaks,
  buildImportArgs,
  buildExportArgs,
  readOutlineFromFrontMatter,
  resolveOutlineOptions,
  outlineFrontMatterEntries,
  stripEpubAnchorPrefixes,
  collapseThematicBreaks,
  expandDisplayMath,
  restoreImportedCitations,
  dropDuplicateEpubTitle,
  stripUnsafeMarkup,
  collectArchiveImagePaths,
  inlineArchiveImages,
  prepareOdtForImport,
  requestDocxFieldUpdate,
  collectDocxHeadings,
  collectOdtHeadings,
  fillOdtTableOfContents,
  readColumnLayout,
  splitColumnSections,
  hasColumnBlocks,
  convertWithAstPasses,
} from '../pandoc-prepare.js';
import { readZipEntries, mimeForPath } from '../zip-reader.js';
import { createZip } from '../zip-writer.js';
import { normalizeFormulaHrefs } from '../odt-formulas.js';
import { extractOdtTableHeaders, restoreTableHeaders } from '../odt-tables.js';
import { makeZip } from './helpers/make-zip.mjs';

test('las citas importadas recuperan sus corchetes sin tocar código ni fórmulas', () => {
  const source = String.raw`Citas: \[@ejemplo2026\], \[-@ejemplo2026\] y \[@ejemplo2026; \@segunda2025\].`;
  assert.equal(restoreImportedCitations(source), 'Citas: [@ejemplo2026], [-@ejemplo2026] y [@ejemplo2026; @segunda2025].');
  const code = '`' + String.raw`\[@ejemplo2026\]` + '`\n\n```text\n' + String.raw`\[@ejemplo2026\]` + '\n```';
  assert.equal(restoreImportedCitations(code), code);
  assert.equal(restoreImportedCitations('$$@x$$ y $a^2$'), '$$@x$$ y $a^2$');
  const formulas = String.raw`$$\@x + \[@y\]$$ y $\@z$.`;
  assert.equal(restoreImportedCitations(formulas), formulas);
  assert.equal(restoreImportedCitations(String.raw`Según \@ejemplo2026.`), 'Según @ejemplo2026.');
});

test('hasYamlFrontMatter distingue metadatos de una línea horizontal', () => {
  assert.equal(hasYamlFrontMatter('---\ntitle: X\n---\n\nTexto\n'), true);
  assert.equal(hasYamlFrontMatter('---\ntitle: X\n...\n\nTexto\n'), true);
  assert.equal(hasYamlFrontMatter('\n\n---\ntitle: X\n---\n'), true);
  // Una raya horizontal suelta no es un bloque de metadatos.
  assert.equal(hasYamlFrontMatter('---\n\n# Título\n\nTexto\n'), false);
  assert.equal(hasYamlFrontMatter('# Título\n\nTexto\n'), false);
});

test('extractMarkdownTitle ignora los bloques de código', () => {
  const markdown = '```bash\n# Instalar dependencias\nnpm install\n```\n\n# Guía real\n';
  assert.equal(extractMarkdownTitle(markdown), 'Guía real');
  assert.equal(extractMarkdownTitle('~~~\n# falso\n~~~\n\n# verdadero\n'), 'verdadero');
  assert.equal(extractMarkdownTitle('## Solo nivel 2\n'), '');
  assert.equal(extractMarkdownTitle('# Con cierre ###\n'), 'Con cierre');
});

test('ensureEpubMetadata respeta lo que el documento declara y completa el resto', () => {
  const original = '---\ntitle: "Mío"\nauthor: Ana\n---\n\n# Cuerpo\n';
  const result = ensureEpubMetadata(original, { fallbackTitle: 'otro', lang: 'es' });
  // El título es suyo; el idioma faltaba y se añade sin tocar lo demás.
  assert.match(result.markdown, /title: "Mío"\nauthor: Ana\nlang: "es"/);
  assert.equal(result.markdown.includes('title: "otro"'), false);
  assert.equal(result.titleFromHeading, false);

  const completo = '---\ntitle: "Mío"\nlang: "de"\n---\n\n# Cuerpo\n';
  assert.equal(ensureEpubMetadata(completo, { lang: 'es' }).markdown, completo);
  assert.equal(ensureEpubMetadata(completo, { lang: 'es' }).injected, false);
});

test('ensureEpubMetadata inyecta título e idioma cuando faltan', () => {
  const result = ensureEpubMetadata('# Mi libro\n\nTexto\n', { fallbackTitle: 'archivo', lang: 'ca' });
  assert.match(result.markdown, /^---\ntitle: "Mi libro"\nlang: "ca"\n---\n/);
  assert.equal(result.titleFromHeading, true);
});

test('ensureEpubMetadata encadena encabezado, nombre del documento y sin título', () => {
  const conNombre = ensureEpubMetadata('Solo texto\n', { fallbackTitle: 'apuntes', lang: 'es' });
  assert.match(conNombre.markdown, /title: "apuntes"/);
  assert.equal(conNombre.titleFromHeading, false);

  // Un encabezado vacío no debe saltarse el nombre del documento.
  const vacio = ensureEpubMetadata('#   \n\nTexto\n', { fallbackTitle: 'apuntes', lang: 'es' });
  assert.match(vacio.markdown, /title: "apuntes"/);

  const sinNada = ensureEpubMetadata('Texto\n', { fallbackTitle: '', untitledLabel: 'Sin título', lang: 'es' });
  assert.match(sinNada.markdown, /title: "Sin título"/);
});

/*
  El índice y la numeración son banderas del conversor, no metadatos: el
  escritor DOCX ignora `toc: true` y la numeración no sale sin la bandera.
*/
test('buildExportArgs añade índice y numeración solo cuando se piden', () => {
  assert.equal(/--toc(?:\s|$)/.test(buildExportArgs('docx', {})), false);
  assert.match(buildExportArgs('docx', { toc: true }), /--toc(?!-)/);
  assert.match(buildExportArgs('docx', { toc: true, tocDepth: 2 }), /--toc-depth=2/);
  assert.match(buildExportArgs('docx', { numberSections: true }), /--number-sections/);
  // El EPUB ya trae su índice de navegación; otro encima sobra.
  assert.equal(/--toc(?:\s|$)/.test(buildExportArgs('epub3', { toc: true })), false);
  assert.match(buildExportArgs('epub3', { toc: true, numberSections: true }), /--number-sections/);
});

test('readOutlineFromFrontMatter distingue el sí, el no y el silencio', () => {
  const dicho = readOutlineFromFrontMatter('---\ntoc: true\nnumbersections: false\n---');
  assert.deepEqual(dicho, { toc: true, tocDepth: '', numberSections: false });
  // Sin línea, el documento no se pronuncia y manda la opción general.
  assert.deepEqual(readOutlineFromFrontMatter('---\nlang: "es"\n---'), { toc: '', tocDepth: '', numberSections: '' });
  assert.equal(readOutlineFromFrontMatter('---\ntoc-depth: 2\n---').tocDepth, 2);
  assert.equal(readOutlineFromFrontMatter('---\ntoc-depth: 7\n---').tocDepth, '');
  // El bloque se teclea a mano: valen las formas que escribiría una persona.
  assert.equal(readOutlineFromFrontMatter('---\ntoc: "sí"\n---').toc, true);
  assert.equal(readOutlineFromFrontMatter('---\ntoc: no  # esta vez no\n---').toc, false);
  // Lo que no se entiende se descarta en vez de decidir por el usuario.
  assert.equal(readOutlineFromFrontMatter('---\ntoc: quizá\n---').toc, '');
});

test('el documento manda sobre el índice general, también para quitarlo', () => {
  const general = { toc: true, tocDepth: 2, numberSections: true };
  assert.deepEqual(resolveOutlineOptions(general, {}), { toc: true, tocDepth: 2, numberSections: true });
  assert.deepEqual(
    resolveOutlineOptions(general, { toc: false, numberSections: false }),
    { toc: false, tocDepth: 2, numberSections: false },
  );
  assert.deepEqual(
    resolveOutlineOptions({}, { toc: true, numberSections: '' }),
    { toc: true, tocDepth: 3, numberSections: false },
  );
});

test('solo lo que el documento fija ocupa una línea en sus metadatos', () => {
  assert.deepEqual(outlineFrontMatterEntries({ toc: '', numberSections: '' }), []);
  assert.deepEqual(
    outlineFrontMatterEntries({ toc: true, numberSections: false }),
    [
      { key: 'toc', lines: ['toc: true'] },
      { key: 'numbersections', lines: ['numbersections: false'] },
    ],
  );
});

test('la profundidad propia del índice viaja en los metadatos', () => {
  assert.deepEqual(outlineFrontMatterEntries({ tocDepth: 2 }), [
    { key: 'toc-depth', lines: ['toc-depth: 2'] },
  ]);
});

test('los saltos LaTeX se insertan solo antes de H1 posteriores y fuera del código', () => {
  const markdown = '# Uno\n\n```md\n# No\n```\n\n# Dos\n';
  const result = insertLatexPageBreaksBeforeH1(markdown);
  assert.equal((result.match(/\\clearpage/g) || []).length, 1);
  assert.match(result, /```md\n# No\n```\n\n\\clearpage\n\n# Dos/);
});

test('el rótulo del índice viaja como metadato', () => {
  const conRotulo = ensureExportMetadata('# Tema\n', { lang: 'es', tocTitle: 'Índice' });
  assert.match(conRotulo.markdown, /toc-title: "Índice"/);
  // Sin rótulo no se inventa ninguno: Pandoc pondrá el suyo.
  assert.equal(ensureExportMetadata('# Tema\n', { lang: 'es' }).markdown.includes('toc-title'), false);
});

test('ensureExportMetadata marca el idioma cuando el documento no lo trae', () => {
  const result = ensureExportMetadata('# Apuntes\n\nTexto\n', { lang: 'gl' });
  assert.equal(result.injected, true);
  assert.match(result.markdown, /^---\nlang: "gl"\n---\n\n# Apuntes/);
});

test('ensureExportMetadata no pisa el front matter del documento ni inventa idiomas', () => {
  const propio = '---\nlang: "de"\nauthor: "Ana"\n---\n\nTexto\n';
  const result = ensureExportMetadata(propio, { lang: 'es', author: 'Otro' });
  assert.equal(result.markdown, propio);
  assert.equal(result.injected, false);

  const sinNada = ensureExportMetadata('Texto\n', { lang: '  ', author: '  ' });
  assert.equal(sinNada.markdown, 'Texto\n');
  assert.equal(sinNada.injected, false);
});

/*
  `pagetitle` es el <title> de la página y nada más. Con `title` a secas, la
  plantilla imprime además un bloque de título en el cuerpo que repite el
  encabezado con el que ya empieza el documento.
*/
test('ensureExportMetadata añade autor y título de página sin tocar el cuerpo', () => {
  const result = ensureExportMetadata('# Ecuaciones\n\nTexto\n', {
    lang: 'es',
    author: 'Juan José',
    pageTitle: 'Ecuaciones',
  });
  assert.match(result.markdown, /^---\nlang: "es"\nauthor: "Juan José"\npagetitle: "Ecuaciones"\n---\n/);
  assert.equal(result.markdown.includes('\ntitle:'), false, 'title duplicaría el encabezado en el cuerpo');
  assert.match(result.markdown, /# Ecuaciones\n\nTexto/);
});

test('prepareLatexStandalone promueve a título el único encabezado inicial', () => {
  const result = prepareLatexStandalone('# Ecuaciones\n\n## Planteamiento\n\nTexto\n', { lang: 'es' });
  assert.match(result.markdown, /^---\ntitle: "Ecuaciones"\nlang: "es"\n---\n/);
  assert.equal(result.shiftHeadings, true);
  // El encabezado promovido sale del cuerpo para no repetirse bajo \\maketitle.
  assert.equal(result.markdown.includes('# Ecuaciones'), false);
  assert.match(result.markdown, /## Planteamiento/);
});

test('prepareLatexStandalone deja intactos los documentos con varios encabezados de nivel 1', () => {
  const result = prepareLatexStandalone('# Tema 1\n\nTexto\n\n# Tema 2\n', { lang: 'es' });
  assert.equal(result.shiftHeadings, false);
  assert.equal(result.markdown.includes('title:'), false);
  assert.match(result.markdown, /lang: "es"/);
  assert.match(result.markdown, /# Tema 1[\s\S]*# Tema 2/);
});

test('prepareLatexStandalone solo asciende el encabezado que abre el documento', () => {
  const trasTexto = prepareLatexStandalone('Introducción\n\n# Desarrollo\n', { lang: 'es' });
  assert.equal(trasTexto.shiftHeadings, false);
  assert.equal(trasTexto.markdown.includes('title:'), false);

  // Una almohadilla dentro de un bloque de código no es un título.
  const enCodigo = prepareLatexStandalone('```sh\n# npm install\n```\n\n# De verdad\n', { lang: 'es' });
  assert.equal(enCodigo.shiftHeadings, false);
});

test('prepareLatexStandalone no mueve un título que el documento ya declara', () => {
  const propio = '---\ntitle: "Mío"\n---\n\n# Cuerpo\n';
  const result = prepareLatexStandalone(propio, { lang: 'eu' });
  assert.match(result.markdown, /title: "Mío"\nlang: "eu"/);
  // El encabezado no se promueve ni se borra: el título ya estaba puesto.
  assert.match(result.markdown, /# Cuerpo/);
  assert.equal(result.shiftHeadings, false);

  const soloTexto = prepareLatexStandalone('Texto suelto\n', { lang: 'gl' });
  assert.match(soloTexto.markdown, /^---\nlang: "gl"\n---\n/);
});

test('prepareLatexStandalone aplica clase, opciones y preámbulo del usuario', () => {
  const result = prepareLatexStandalone('# Apuntes\n\nTexto\n', {
    lang: 'es',
    documentClass: 'report',
    classOptions: '12pt, a4paper',
    preamble: '\\usepackage{geometry}\n\\newcommand{\\R}{\\mathbb{R}}',
  });
  assert.match(result.markdown, /documentclass: "report"/);
  // Pandoc espera una entrada por opción, no la cadena entera.
  assert.match(result.markdown, /classoption:\n- "12pt"\n- "a4paper"\n/);
  assert.match(result.markdown, /header-includes: \|\n {2}\\usepackage\{geometry\}\n {2}\\newcommand/);
});

test('prepareLatexStandalone no deja que el preámbulo rompa el YAML', () => {
  // Comillas, dos puntos, barras y una línea que parece cerrar los metadatos.
  const hostil = '\\title{"x": y}\n---\n\\def\\z{1}\n\n\\usepackage{amsmath}\n';
  const result = prepareLatexStandalone('Texto\n', { lang: 'es', preamble: hostil });
  const lineas = result.markdown.split('\n');
  const cierre = lineas.indexOf('---', 1);

  // El bloque literal va indentado, así que ningún --- del usuario cierra nada.
  assert.match(lineas[cierre - 1], /^ {2}\\usepackage\{amsmath\}$/);
  assert.match(result.markdown, /^ {2}---$/m);
  assert.equal(lineas.slice(cierre).join('\n'), '---\n\nTexto\n');
});

test('prepareLatexStandalone ignora los ajustes vacíos o desconocidos', () => {
  const result = prepareLatexStandalone('Texto\n', {
    lang: 'es',
    documentClass: 'memoir',
    classOptions: ' , ,',
    preamble: '   \n',
  });
  assert.equal(result.markdown, '---\nlang: "es"\n---\n\nTexto\n');
});

/*
  Elegir idioma para un documento le escribe `lang` en su bloque. Con la regla
  de todo o nada, eso le habría costado la clase y el preámbulo configurados.
*/
test('prepareLatexStandalone completa los ajustes que el documento no declara', () => {
  const conIdioma = '---\nlang: "fr"\n---\n\n# Notas\n\nTexto\n';
  const result = prepareLatexStandalone(conIdioma, {
    lang: 'es',
    documentClass: 'book',
    preamble: '\\usepackage{tikz}',
  });
  // Su idioma manda; el resto de ajustes llegan igualmente.
  assert.match(result.markdown, /lang: "fr"/);
  assert.equal(result.markdown.includes('lang: "es"'), false);
  assert.match(result.markdown, /documentclass: "book"/);
  assert.match(result.markdown, /header-includes: \|\n {2}\\usepackage\{tikz\}/);
  // Sigue promoviendo el título, porque el documento no declara ninguno.
  assert.match(result.markdown, /title: "Notas"/);
  assert.equal(result.shiftHeadings, true);
  assert.equal(result.markdown.includes('# Notas'), false);

  const suyo = '---\nlang: "fr"\ndocumentclass: "memoir"\n---\n\nTexto\n';
  const respetado = prepareLatexStandalone(suyo, { lang: 'es', documentClass: 'book' });
  assert.match(respetado.markdown, /documentclass: "memoir"/);
  assert.equal(respetado.markdown.includes('"book"'), false);
});

test('ensureEpubMetadata escapa comillas en el título y el idioma', () => {
  const result = ensureEpubMetadata('# El «"mejor"» libro\n', { lang: 'es"x' });
  assert.match(result.markdown, /title: "El «\\"mejor\\"» libro"/);
  assert.match(result.markdown, /lang: "es\\"x"/);
});

test('una raya horizontal inicial no impide inyectar los metadatos', () => {
  const result = ensureEpubMetadata('---\n\n# Tema 1\n\nTexto\n', { fallbackTitle: 'doc', lang: 'es' });
  assert.equal(result.injected, true);
  assert.match(result.markdown, /title: "Tema 1"/);
});

test('collectRemoteImageUrls encuentra imágenes Markdown y HTML sin duplicar', () => {
  const markdown = [
    '![a](https://ejemplo.org/1.png)',
    '![b](https://ejemplo.org/1.png "título")',
    '<img src="https://ejemplo.org/2.jpg" alt="c">',
    '![local](imagenes/x.png)',
    '![datos](data:image/gif;base64,R0lGOD)',
    '[enlace](https://ejemplo.org/3.html)',
  ].join('\n\n');
  assert.deepEqual(collectRemoteImageUrls(markdown), [
    'https://ejemplo.org/1.png',
    'https://ejemplo.org/2.jpg',
  ]);
});

test('replaceImageUrls sustituye la imagen pero no un enlace a la misma URL', () => {
  const markdown = '![a](https://ejemplo.org/1.png)\n\n[enlace](https://ejemplo.org/1.png)\n';
  const result = replaceImageUrls(markdown, new Map([['https://ejemplo.org/1.png', 'data:image/png;base64,AAA']]));
  assert.match(result, /!\[a\]\(data:image\/png;base64,AAA\)/);
  assert.match(result, /\[enlace\]\(https:\/\/ejemplo\.org\/1\.png\)/);
});

test('dropImagesByUrl conserva el texto alternativo de las imágenes omitidas', () => {
  const markdown = '![Diagrama](https://ejemplo.org/1.png)\n\n<img src="https://ejemplo.org/2.jpg">\n\n![ok](data:image/gif;base64,R0lGOD)\n';
  const result = dropImagesByUrl(markdown, ['https://ejemplo.org/1.png', 'https://ejemplo.org/2.jpg']);
  assert.match(result, /^Diagrama$/m);
  assert.doesNotMatch(result, /ejemplo\.org/);
  assert.match(result, /!\[ok\]\(data:image\/gif/);
});

test('normalizeThematicBreaks convierte las rayas --- en ***', () => {
  // Pandoc leería estos --- como el inicio de un bloque YAML y fallaría.
  assert.equal(
    normalizeThematicBreaks('# Uno\n\nTexto.\n\n---\n\n# Dos\n'),
    '# Uno\n\nTexto.\n\n***\n\n# Dos\n',
  );
  assert.equal(normalizeThematicBreaks('---\n\n# Tras la raya\n'), '***\n\n# Tras la raya\n');
});

test('normalizeThematicBreaks respeta encabezados setext, código y front matter', () => {
  // `---` pegado a un texto es un encabezado de nivel 2, no una raya.
  assert.equal(normalizeThematicBreaks('Encabezado\n---\n\nTexto\n'), 'Encabezado\n---\n\nTexto\n');
  assert.equal(
    normalizeThematicBreaks('# T\n\n```yaml\n\n---\nclave: valor\n```\n'),
    '# T\n\n```yaml\n\n---\nclave: valor\n```\n',
  );
  // El bloque de metadatos inicial debe conservarse íntegro.
  assert.equal(
    normalizeThematicBreaks('---\ntitle: X\n---\n\nTexto\n\n---\n\nFin\n'),
    '---\ntitle: X\n---\n\nTexto\n\n***\n\nFin\n',
  );
  // Cuatro guiones no son ambiguos para Pandoc: se dejan como están.
  assert.equal(normalizeThematicBreaks('Texto\n\n----\n\nMás\n'), 'Texto\n\n----\n\nMás\n');
  assert.equal(normalizeThematicBreaks('Sin rayas\n'), 'Sin rayas\n');
});

test('buildImportArgs pide a Pandoc Markdown plano según el formato', () => {
  const epub = buildImportArgs('epub');
  for (const ext of ['-fenced_divs', '-native_divs', '-bracketed_spans', '-header_attributes', '-raw_html']) {
    assert.ok(epub.includes(ext), `faltaba ${ext}`);
  }
  // DOCX y ODT solo necesitan evitar el `{width=...}` y el <img> crudo.
  for (const format of ['docx', 'odt']) {
    assert.ok(buildImportArgs(format).includes('-link_attributes-raw_html'), format);
    assert.doesNotMatch(buildImportArgs(format), /-fenced_divs/);
  }
  // LaTeX y HTML conservan el comportamiento que ya tenían.
  assert.doesNotMatch(buildImportArgs('latex'), /-link_attributes|-raw_html/);
  assert.doesNotMatch(buildImportArgs('html'), /-link_attributes|-raw_html/);

  // Sin esto Pandoc devuelve tablas alineadas con espacios, que la
  // previsualización muestra como texto plano.
  for (const format of ['epub', 'docx', 'odt', 'html', 'latex']) {
    const args = buildImportArgs(format);
    assert.ok(args.includes('+pipe_tables'), `${format} sin pipe_tables`);
    assert.ok(args.includes('-simple_tables'), `${format} con simple_tables`);
  }
});

test('stripEpubAnchorPrefixes recorta el nombre del archivo interno', () => {
  assert.equal(
    stripEpubAnchorPrefixes('Ver [la sección](#ch001.xhtml_rutinas-de-pensamiento).'),
    'Ver [la sección](#rutinas-de-pensamiento).',
  );
  assert.equal(
    stripEpubAnchorPrefixes('[a](#text/ch012.xhtml_tema) y [b](#normal)'),
    '[a](#tema) y [b](#normal)',
  );
  // Un enlace externo con .html en la ruta no debe tocarse.
  assert.equal(
    stripEpubAnchorPrefixes('[web](https://ejemplo.org/pagina.html)'),
    '[web](https://ejemplo.org/pagina.html)',
  );
});

test('trimInlineMath y normalizeNewlines siguen comportándose igual', () => {
  assert.equal(trimInlineMath('$ a^2 $ y $$b$$'), '$a^2$ y $$b$$');
  assert.equal(normalizeNewlines('a\r\nb\rc'), 'a\nb\nc');
  assert.equal(normalizeNewlines(null), '');
});

test('collectArchiveImagePaths separa rutas internas de URLs y data URIs', () => {
  const markdown = [
    '![a](Pictures/1000.png)',
    '![b](media/image1.png)',
    '![c](https://ejemplo.org/x.png)',
    '![d](data:image/gif;base64,R0lGOD)',
    '<img src="word/media/image2.jpg">',
  ].join('\n\n');
  assert.deepEqual(collectArchiveImagePaths(markdown), [
    'Pictures/1000.png',
    'media/image1.png',
    'word/media/image2.jpg',
  ]);
});

/*
  Dentro del WASM no hay red ni sistema de archivos, así que una ruta relativa
  se pierde igual que una URL remota: Pandoc avisa "Could not fetch resource" y
  deja solo la descripción. El navegador puede resolver ambas.
*/
test('collectFetchableImageUrls recoge también las rutas relativas', () => {
  const markdown = [
    '![logo](logo_100px.png)',
    '![gif](imagenes/formulas.gif)',
    '![absoluta](/assets/portada.png)',
    '![remota](https://ejemplo.org/x.png)',
    '![incrustada](data:image/gif;base64,R0lGOD)',
    '<img src="imagenes/otra.gif">',
  ].join('\n\n');

  assert.deepEqual(collectFetchableImageUrls(markdown), [
    'logo_100px.png',
    'imagenes/formulas.gif',
    '/assets/portada.png',
    'https://ejemplo.org/x.png',
    'imagenes/otra.gif',
  ]);
  // La variante remota sigue existiendo para quien solo necesite esas.
  assert.deepEqual(collectRemoteImageUrls(markdown), ['https://ejemplo.org/x.png']);
});

/*
  Un manual que explica cómo se escribe una imagen no está usando ninguna. Sin
  esto, exportar el manual de EdiMarkdown descargaba `imagenes/01.png`, recibía
  del servidor la página de la aplicación entera y la incrustaba como texto:
  páginas y páginas de base64 en el DOCX, el ODT y el EPUB.
*/
test('las imágenes escritas como código son ejemplos, no imágenes', () => {
  const markdown = [
    '![real](logo.png)',
    'Se escribe `![Gráfico](imagenes/01.png)` y la imagen se queda donde está.',
    '```markdown',
    '![Otro](imagenes/02.png)',
    '<img src="imagenes/03.png">',
    '```',
    '~~~',
    '![Tercero](imagenes/04.png)',
    '~~~',
  ].join('\n\n');

  assert.deepEqual(collectFetchableImageUrls(markdown), ['logo.png']);
});

test('tampoco se sustituye ni se descarta lo que está escrito como código', () => {
  const markdown = 'Ejemplo: `![Gráfico](foto.png)`\n\n![de verdad](foto.png)';

  const replaced = replaceImageUrls(markdown, { 'foto.png': 'data:image/png;base64,AAA' });
  assert.match(replaced, /`!\[Gráfico\]\(foto\.png\)`/);
  assert.match(replaced, /!\[de verdad\]\(data:image\/png;base64,AAA\)/);

  const dropped = dropImagesByUrl(markdown, ['foto.png']);
  assert.match(dropped, /`!\[Gráfico\]\(foto\.png\)`/);
  assert.match(dropped, /\n\nde verdad$/);
});

test('inlineArchiveImages saca las imágenes del archivo y las incrusta', async () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
  const zip = await makeZip({
    'mimetype': 'application/vnd.oasis.opendocument.text',
    'Pictures/1000.png': png,
    // Pandoc acorta la ruta de DOCX: media/… en vez de word/media/…
    'word/media/image1.jpeg': png,
  });

  const markdown = '![Gato](Pictures/1000.png)\n\n![Perro](media/image1.jpeg)\n';
  const result = await inlineArchiveImages(markdown, zip);

  assert.match(result, /!\[Gato\]\(data:image\/png;base64,[A-Za-z0-9+/=]+\)/);
  assert.match(result, /!\[Perro\]\(data:image\/jpeg;base64,[A-Za-z0-9+/=]+\)/);
  assert.doesNotMatch(result, /Pictures\//);
});

test('inlineArchiveImages deja el texto intacto si no encuentra la imagen', async () => {
  const zip = await makeZip({ 'otra/cosa.txt': 'nada' });
  const markdown = '![x](Pictures/ausente.png)\n';
  assert.equal(await inlineArchiveImages(markdown, zip), markdown);
  // Un archivo ilegible tampoco debe romper la importación.
  assert.equal(await inlineArchiveImages(markdown, new Uint8Array([1, 2, 3])), markdown);
  assert.equal(await inlineArchiveImages(markdown, null), markdown);
});

test('readZipEntries omite directorios y descomprime entradas deflate', async () => {
  const zip = await makeZip({ 'dir/': '', 'a.txt': 'hola', 'b.bin': new Uint8Array([0, 1, 2]) });
  const entries = await readZipEntries(zip);
  assert.equal(entries.has('dir/'), false);
  assert.equal(new TextDecoder().decode(entries.get('a.txt')), 'hola');
  assert.deepEqual([...entries.get('b.bin')], [0, 1, 2]);
  assert.equal(mimeForPath('foto.JPG'), 'image/jpeg');
  assert.equal(mimeForPath('raro.xyz'), 'application/octet-stream');
});

const ODT_CONTENT_XML = `<office:document-content>
  <table:table table:name="Tabla1">
    <table:table-header-rows>
      <table:table-row>
        <table:table-cell office:value-type="string"><text:p>Nombre</text:p></table:table-cell>
        <table:table-cell office:value-type="string"><text:p>Edad &amp; m&#225;s</text:p></table:table-cell>
      </table:table-row>
    </table:table-header-rows>
    <table:table-row><table:table-cell><text:p>Ana</text:p></table:table-cell></table:table-row>
  </table:table>
  <table:table table:name="Tabla2">
    <table:table-row><table:table-cell><text:p>1</text:p></table:table-cell></table:table-row>
  </table:table>
</office:document-content>`;

test('extractOdtTableHeaders lee los encabezados y decodifica entidades', () => {
  const headers = extractOdtTableHeaders(ODT_CONTENT_XML);
  assert.equal(headers.length, 2, 'una entrada por tabla del documento');
  assert.deepEqual(headers[0], ['Nombre', 'Edad & más']);
  // Una tabla sin fila de encabezado no aporta nada.
  assert.deepEqual(headers[1], []);
  assert.deepEqual(extractOdtTableHeaders(''), []);
});

test('restoreTableHeaders rellena la fila vacía y realinea la tabla', () => {
  const markdown = '|       |     |\n|-------|-----|\n| Ana   | 28  |\n';
  const result = restoreTableHeaders(markdown, [['Nombre', 'Edad & más']]);
  assert.equal(result, [
    '| Nombre | Edad & más |',
    '|--------|------------|',
    '| Ana    | 28         |',
    '',
  ].join('\n'));
});

test('restoreTableHeaders empareja cada tabla con la suya y respeta la alineación', () => {
  const markdown = [
    '|     |     |', '|:---:|----:|', '| a   | b   |',
    '',
    'Texto.',
    '',
    '|     |', '|-----|', '| z   |',
    '',
  ].join('\n');
  const result = restoreTableHeaders(markdown, [['Uno', 'Dos'], ['Tres']]);
  assert.match(result, /\| Uno \| Dos \|/);
  assert.match(result, /\|:-+:\|-+:\|/, 'debería conservar :---: y ---:');
  assert.match(result, /\| Tres \|/);
});

test('restoreTableHeaders no toca tablas que ya tienen encabezado ni descuadres', () => {
  const conEncabezado = '| Ya | Está |\n|----|------|\n| 1  | 2    |\n';
  assert.equal(restoreTableHeaders(conEncabezado, [['Otro', 'Cosa']]), conEncabezado);

  // Distinto número de columnas: mejor no tocar nada.
  const descuadre = '|     |     |\n|-----|-----|\n| a   | b   |\n';
  assert.equal(restoreTableHeaders(descuadre, [['Solo una']]), descuadre);

  assert.equal(restoreTableHeaders('Sin tablas\n', [['x']]), 'Sin tablas\n');
  assert.equal(restoreTableHeaders(conEncabezado, []), conEncabezado);
});

test('restoreTableHeaders escapa las barras verticales del encabezado', () => {
  const result = restoreTableHeaders('|     |\n|-----|\n| a   |\n', [['uno|dos']]);
  assert.match(result, /\| uno\\\|dos \|/);
});

/*
  Reparación de las referencias de fórmula de un ODT.

  El escritor ODT de Pandoc apunta a cada fórmula con una barra final
  (`Formula-0/`) y su propio lector no resuelve esa forma: la fórmula se pierde
  sin dejar rastro. LibreOffice usa `./Object 1`, que Pandoc sí lee, así que
  solo fallan los ODT exportados por la propia aplicación.
*/
const FRAME_PANDOC = '<draw:frame draw:style-name="fr1" text:anchor-type="as-char">'
  + '<draw:object xlink:href="Formula-0/" xlink:type="simple" /></draw:frame>';
const FRAME_LIBREOFFICE = '<draw:frame draw:name="Objeto1" text:anchor-type="as-char">'
  + '<draw:object xlink:href="./Object 1" xlink:type="simple"/>'
  + '<draw:image xlink:href="./ObjectReplacements/Object 1"/></draw:frame>';

test('normalizeFormulaHrefs quita la barra final que Pandoc no sabe resolver', () => {
  const xml = `<office:text><text:p>Antes ${FRAME_PANDOC} después</text:p></office:text>`;
  const { xml: patched, changed } = normalizeFormulaHrefs(xml);
  assert.equal(changed, true);
  assert.match(patched, /xlink:href="Formula-0"/);
  assert.doesNotMatch(patched, /xlink:href="Formula-0\/"/);
  // Nada más del marco puede alterarse.
  assert.match(patched, /Antes <draw:frame[^>]*><draw:object[^>]*\/><\/draw:frame> después/);
});

test('normalizeFormulaHrefs no toca un ODT de LibreOffice ni las imágenes', () => {
  const xml = `<office:text><text:p>${FRAME_LIBREOFFICE}</text:p></office:text>`;
  const { xml: patched, changed } = normalizeFormulaHrefs(xml);
  assert.equal(changed, false, 'Pandoc ya lee esta forma: no hay que reescribir nada');
  assert.equal(patched, xml);
});

/*
  El índice del DOCX no es texto: es un campo que calcula el procesador de
  textos. Sin pedir la actualización de campos, el documento se abre con el
  índice vacío.
*/
test('collectDocxHeadings lee los encabezados con su número de apartado', () => {
  const xml = '<w:body>'
    + '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>1</w:t></w:r><w:r><w:tab/><w:t>Tema 1</w:t></w:r></w:p>'
    + '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t xml:space="preserve">1.1</w:t></w:r><w:r><w:tab/><w:t>Copiar &amp; pegar</w:t></w:r></w:p>'
    + '<w:p><w:pPr><w:pStyle w:val="FirstParagraph"/></w:pPr><w:r><w:t>Texto normal</w:t></w:r></w:p>'
    + '<w:p><w:pPr><w:pStyle w:val="Heading4"/></w:pPr><w:r><w:t>Demasiado hondo</w:t></w:r></w:p>'
    + '</w:body>';
  assert.deepEqual(collectDocxHeadings(xml), [
    { level: 1, text: '1 Tema 1' },
    // Las entidades del XML vuelven a ser texto legible.
    { level: 2, text: '1.1 Copiar & pegar' },
  ]);
});

/*
  Ni el campo marcado como pendiente ni updateFields bastan: LibreOffice abre el
  documento con el índice en blanco y Word solo lo rellena si el usuario acepta
  el aviso. Las entradas se escriben en el resultado guardado del campo.
*/
test('requestDocxFieldUpdate escribe las entradas dentro del campo del índice', async () => {
  const document = '<w:document xmlns:w="x"><w:body>'
    + '<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/>'
    + '<w:instrText xml:space="preserve">TOC \\o "1-3"</w:instrText>'
    + '<w:fldChar w:fldCharType="separate"/><w:fldChar w:fldCharType="end"/></w:r></w:p>'
    + '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Tema &amp; uno</w:t></w:r></w:p>'
    + '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Apartado</w:t></w:r></w:p>'
    + '</w:body></w:document>';
  const docx = await createZip(new Map([
    ['word/settings.xml', '<w:settings xmlns:w="x"/>'],
    ['word/document.xml', document],
  ]));
  const entries = await readZipEntries(await requestDocxFieldUpdate(docx));
  const resultado = new TextDecoder().decode(entries.get('word/document.xml'));

  assert.match(resultado, /<w:t xml:space="preserve">Tema &amp; uno<\/w:t>/, 'el texto se escapa, no se rompe el XML');
  assert.match(resultado, /<w:ind w:left="340"\/>/, 'el segundo nivel va sangrado');
  // El campo sigue siendo un campo: begin … separate … entradas … end.
  const orden = ['fldCharType="begin"', 'fldCharType="separate"', 'Apartado', 'fldCharType="end"']
    .map(fragmento => resultado.indexOf(fragmento));
  assert.deepEqual(orden, [...orden].sort((a, b) => a - b), `orden inesperado: ${orden}`);
  assert.equal(resultado.split('<w:fldChar w:fldCharType="end"').length - 1, 1, 'un solo cierre de campo');
});

/*
  El ODT tiene el mismo problema por otra vía: Pandoc escribe la plantilla del
  índice pero no <text:index-body>, que es lo que el lector muestra.
*/
test('fillOdtTableOfContents escribe el cuerpo del índice que falta', async () => {
  const content = '<office:document-content xmlns:text="t" xmlns:style="s" xmlns:fo="f" xmlns:office="o">'
    + '<office:automatic-styles/><office:body><office:text>'
    + '<text:table-of-content><text:table-of-content-source text:outline-level="3">'
    + '<text:index-title-template text:style-name="Contents_20_Heading">Índice</text:index-title-template>'
    + '</text:table-of-content-source></text:table-of-content>'
    + '<text:h text:style-name="Heading_20_1" text:outline-level="1">Tema &amp; uno</text:h>'
    + '<text:h text:style-name="Heading_20_2" text:outline-level="2">Apartado</text:h>'
    + '</office:text></office:body></office:document-content>';
  const odt = await createZip(new Map([
    ['mimetype', 'application/vnd.oasis.opendocument.text'],
    ['content.xml', content],
  ]));
  const entries = await readZipEntries(await fillOdtTableOfContents(odt));
  const resultado = new TextDecoder().decode(entries.get('content.xml'));

  assert.match(resultado, /<text:index-body>/);
  assert.match(resultado, /<text:p text:style-name="EdimarkToc1">Tema &amp; uno<\/text:p>/);
  assert.match(resultado, /<text:p text:style-name="EdimarkToc2">Apartado<\/text:p>/);
  // El rótulo se reutiliza de la plantilla, ya traducido por Pandoc.
  assert.match(resultado, /<text:index-title[^>]*><text:p[^>]*>Índice</);
  // Los estilos van dentro del propio archivo: los de la plantilla no existen.
  assert.match(resultado, /style:name="EdimarkToc2"[\s\S]*?fo:margin-left="0.6cm"/);
  // mimetype sigue siendo la primera entrada, o el ODT deja de ser válido.
  assert.equal([...entries.keys()][0], 'mimetype');
});

test('fillOdtTableOfContents no toca un archivo sin índice ni uno ya relleno', async () => {
  const sinIndice = await createZip(new Map([
    ['mimetype', 'application/vnd.oasis.opendocument.text'],
    ['content.xml', '<office:text xmlns:text="t"><text:h text:outline-level="1">Tema</text:h></office:text>'],
  ]));
  assert.equal(await fillOdtTableOfContents(sinIndice), sinIndice);

  const yaRelleno = await createZip(new Map([
    ['content.xml', '<text:table-of-content xmlns:text="t"><text:index-body/></text:table-of-content>'],
  ]));
  assert.equal(await fillOdtTableOfContents(yaRelleno), yaRelleno);
});

test('collectOdtHeadings solo recoge los tres primeros niveles', () => {
  const xml = '<text:h text:outline-level="1">Uno</text:h>'
    + '<text:h text:outline-level="3">Tres <text:span>con formato</text:span></text:h>'
    + '<text:h text:outline-level="4">Cuatro</text:h>'
    + '<text:p>Un párrafo normal</text:p>';
  assert.deepEqual(collectOdtHeadings(xml), [
    { level: 1, text: 'Uno' },
    { level: 3, text: 'Tres con formato' },
  ]);
});

test('requestDocxFieldUpdate pide actualizar los campos sin tocar nada más', async () => {
  const docx = await createZip(new Map([
    ['[Content_Types].xml', '<?xml version="1.0"?><Types/>'],
    ['word/settings.xml', '<?xml version="1.0"?><w:settings xmlns:w="x"><w:zoom w:percent="100"/></w:settings>'],
    ['word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="x"><w:body/></w:document>'],
  ]));
  const actualizado = await requestDocxFieldUpdate(docx);
  const entries = await readZipEntries(actualizado);

  const leer = name => new TextDecoder().decode(entries.get(name));
  const settings = leer('word/settings.xml');
  assert.match(settings, /<w:settings[^>]*><w:updateFields w:val="true"\/>/, 'va al principio, como pide el esquema');
  assert.match(settings, /<w:zoom w:percent="100"\/>/, 'lo que ya había se conserva');
  assert.equal(entries.size, 3, 'ninguna entrada se pierde');
  assert.match(leer('word/document.xml'), /<w:body\/>/);
});

test('requestDocxFieldUpdate no repite el ajuste ni rompe un archivo ilegible', async () => {
  const yaPedido = await createZip(new Map([
    ['word/settings.xml', '<w:settings xmlns:w="x"><w:updateFields w:val="true"/></w:settings>'],
  ]));
  assert.equal(await requestDocxFieldUpdate(yaPedido), yaPedido, 'sin cambios, se devuelve el mismo archivo');

  // Un archivo que no es un ZIP no debe acabar en una descarga corrupta.
  const basura = new Uint8Array([1, 2, 3, 4]);
  assert.equal(await requestDocxFieldUpdate(basura), basura);
});

test('prepareOdtForImport reescribe el ODT y conserva el resto de entradas', async () => {
  const contentXml = `<?xml version="1.0"?><office:document-content><office:body><office:text>`
    + `<text:p>Fórmula ${FRAME_PANDOC} dentro</text:p></office:text></office:body></office:document-content>`;
  const odt = await createZip(new Map([
    ['mimetype', 'application/vnd.oasis.opendocument.text'],
    ['content.xml', contentXml],
    ['Formula-0/content.xml', '<math xmlns="http://www.w3.org/1998/Math/MathML"><mi>a</mi></math>'],
    ['Pictures/1000.png', new Uint8Array([1, 2, 3])],
  ]));

  const bytes = await prepareOdtForImport(odt);
  assert.notEqual(bytes, odt, 'debería reescribirse');

  const entries = await readZipEntries(bytes);
  // mimetype va primero en un ODT.
  assert.equal([...entries.keys()][0], 'mimetype');
  assert.deepEqual([...entries.get('Pictures/1000.png')], [1, 2, 3], 'las imágenes deben sobrevivir');
  assert.match(new TextDecoder().decode(entries.get('Formula-0/content.xml')), /<math/);
  assert.match(new TextDecoder().decode(entries.get('content.xml')), /xlink:href="Formula-0"/);
});

test('prepareOdtForImport devuelve el archivo intacto si no hay nada que reparar', async () => {
  const odt = await createZip(new Map([
    ['mimetype', 'application/vnd.oasis.opendocument.text'],
    ['content.xml', `<office:text><text:p>${FRAME_LIBREOFFICE}</text:p></office:text>`],
  ]));
  assert.equal(await prepareOdtForImport(odt), odt, 'no debería reescribirse');
});

/*
  La versión solo se declara en package.json y APP_VERSION; el cuadro «Acerca
  de» la recibe en tiempo de ejecución. Esta prueba evita que se desincronicen.
*/
test('la versión no se desincroniza entre package.json y la aplicación', () => {
  const leer = nombre => readFileSync(new URL(`../${nombre}`, import.meta.url), 'utf8');
  const packageVersion = JSON.parse(leer('package.json')).version;
  assert.match(packageVersion, /^\d+\.\d+\.\d+$/, 'versión con formato inesperado');

  const declarada = leer('script.js').match(/^const APP_VERSION = '([^']+)';$/m);
  assert.ok(declarada, 'no se encuentra APP_VERSION en script.js');
  assert.equal(declarada[1], packageVersion, 'APP_VERSION y package.json no coinciden');

  // El HTML no puede volver a llevar el número escrito a mano: se completa al
  // abrir «Acerca de» a partir de APP_VERSION.
  const acercaDe = leer('index.html').match(/<dd data-app-version>([^<]*)<\/dd>/);
  assert.ok(acercaDe, 'no se encuentra la versión del cuadro Acerca de');
  assert.doesNotMatch(acercaDe[1], /\d+\.\d+\.\d+/, 'index.html lleva la versión escrita a mano');

  /*
    Los archivos propios se piden con `?v=` para que el navegador no sirva una
    copia vieja junto al HTML nuevo —que es lo que pasaba al desarrollar—. Ese
    número solo sirve si se sube con los demás: uno rezagado deja la caché
    igual de pegada que antes. Puede seguirle una revisión puntual de caché
    (`&rev=`) cuando se publica un arreglo web sin adelantar la release nativa.
  */
  const indexHtml = leer('index.html');
  const versionados = [...indexHtml.matchAll(/(?:src|href)="([a-z0-9-]+\.(?:js|css))(\?v=([^"&]*)(?:&amp;[^\"]*)?)?"/g)];
  assert.ok(versionados.length, 'no se encuentran los archivos propios en index.html');
  for (const [, archivo, , version] of versionados) {
    assert.equal(version, packageVersion, `${archivo} no lleva ?v=${packageVersion} en index.html`);
  }
});

/*
  Lo que llega dentro de un archivo importado se renderiza en la vista previa,
  o sea en el origen de la aplicación y con acceso a los documentos guardados.
*/
test('la importación desarma manejadores y esquemas ejecutables', () => {
  const TAB = String.fromCharCode(9);
  const casos = [
    ['<img src="x.png" onerror="robar()">', '<img src="x.png">'],
    ['<a href="javascript:robar()">pulsa</a>', '<a>pulsa</a>'],
    // El destino del enlace lleva paréntesis: no puede cortarse por el primero.
    ['[pulsa](javascript:robar())', '[pulsa](#)'],
    ['[pulsa](javascript:alert(1) "titulo")', '[pulsa](#)'],
    // Un carácter de control no puede usarse para partir el esquema.
    [`<a href="java${TAB}script:robar()">x</a>`, '<a>x</a>'],
    ["<a HREF='VBScript:robar()'>x</a>", '<a>x</a>'],
    ['<a href="data:text/html,<script>robar()</script>">x</a>', '<a>x</a>'],
    // Un `>` dentro de una comilla no puede cortar la etiqueta antes de tiempo:
    // el navegador respeta las comillas y ejecutaría el manejador.
    ['<img src="a>" onerror="alert(1)">', '<img src="a>">'],
    ["<span data-x='a>b' onclick=\"y()\">z</span>", "<span data-x='a>b'>z</span>"],
  ];
  for (const [entrada, esperado] of casos) {
    assert.equal(stripUnsafeMarkup(entrada), esperado, entrada);
  }
});

/*
  Contrapartida: el saneado no puede comerse contenido legítimo. El caso del
  código importa especialmente porque el manual de la aplicación documenta
  etiquetas HTML dentro de bloques cercados.
*/
test('el saneado de la importación no toca el contenido legítimo', () => {
  const intactos = [
    'Texto normal con la palabra onclick= suelta en medio.',
    '<img src="imagen.png" alt="foto">',
    '<a href="https://example.org/a?b=1&c=2">enlace</a>',
    '[enlace](https://example.org)',
    '[con titulo](https://example.org "Mi titulo")',
    '![imagen](data:image/png;base64,iVBORw0KGgo=)',
    '`<img onerror="x">` dentro de codigo en linea',
    '```html\n<img src=x onerror="alert(1)">\n```',
    '~~~\n[x](javascript:alert(1))\n~~~',
    '| a | b |\n|---|---|\n| `<a href="javascript:x">` | c |',
  ];
  for (const caso of intactos) {
    assert.equal(stripUnsafeMarkup(caso), caso, caso);
  }
});

test('stripUnsafeMarkup tolera entradas que no son texto', () => {
  assert.equal(stripUnsafeMarkup(null), '');
  assert.equal(stripUnsafeMarkup(undefined), '');
  assert.equal(stripUnsafeMarkup(''), '');
});

/*
  Lo que vuelve de una conversión es Markdown correcto, pero no el que se
  escribe a mano, y el panel Markdown es donde el usuario trabaja.
*/
test('collapseThematicBreaks devuelve la raya larga de Pandoc a ---', () => {
  const larga = '-'.repeat(72);
  assert.equal(
    collapseThematicBreaks(`Texto.\n\n${larga}\n\nMás.\n`),
    'Texto.\n\n---\n\nMás.\n',
  );
  // Detrás de texto es el subrayado de un encabezado, no una raya.
  assert.equal(collapseThematicBreaks('Encabezado\n---\n\nTexto\n'), 'Encabezado\n---\n\nTexto\n');
  // Y dentro del código es contenido que se muestra.
  assert.equal(
    collapseThematicBreaks(`\`\`\`\n\n${larga}\n\`\`\`\n`),
    `\`\`\`\n\n${larga}\n\`\`\`\n`,
  );
  // El bloque YAML de cabecera no lleva línea en blanco delante: no se toca.
  assert.equal(collapseThematicBreaks('---\nlang: "ca"\n---\n\nTexto\n'), '---\nlang: "ca"\n---\n\nTexto\n');
});

test('expandDisplayMath separa los $$ del contenido de la fórmula', () => {
  assert.equal(expandDisplayMath('Antes\n\n$$x = 1$$\n\nDespués\n'), 'Antes\n\n$$\nx = 1\n$$\n\nDespués\n');
  // Una matriz vuelve con la primera línea pegada al delimitador.
  assert.equal(
    expandDisplayMath('$$A = \\begin{pmatrix}\na & b\n\\end{pmatrix}$$\n'),
    '$$\nA = \\begin{pmatrix}\na & b\n\\end{pmatrix}\n$$\n',
  );
  // La fórmula en línea es otra cosa y se queda como está.
  assert.equal(expandDisplayMath('Texto $a$ y $b$ final.\n'), 'Texto $a$ y $b$ final.\n');
  // Los delimitadores escritos como ejemplo son texto, no fórmulas.
  assert.equal(expandDisplayMath('`$$a$$` es un delimitador.\n'), '`$$a$$` es un delimitador.\n');
  // Partir por los códigos deja tramos que empiezan a media línea: ahí no vale.
  assert.equal(expandDisplayMath('Ver `x`$$y$$ aquí.\n'), 'Ver `x`$$y$$ aquí.\n');
});

/*
  El `$` de un ejemplo escrito en código no abre ninguna fórmula. El manual
  explica los cuatro delimitadores escribiéndolos, y el emparejamiento unía el
  último `$` del ejemplo con el primero de la fórmula siguiente.
*/
test('trimInlineMath no empareja los dólares escritos dentro de código', () => {
  const linea = 'Delimitadores `$...$` y `$$...$$`, y la fórmula: $E = mc^2$ final.';
  assert.equal(trimInlineMath(linea), linea);
});

/*
  Con algo antes del primer `# Título` —el logotipo del manual—, el EPUB gana
  un capítulo suelto al que Pandoc pone de título el del libro.
*/
test('dropDuplicateEpubTitle quita el encabezado que Pandoc repite', () => {
  assert.equal(
    dropDuplicateEpubTitle('# Manual\n\n![Logo](media/file0.png)\n\n# Manual\n\nTexto.\n', 'Manual'),
    '![Logo](media/file0.png)\n\n# Manual\n\nTexto.\n',
  );
  // El front matter se conserva.
  assert.equal(
    dropDuplicateEpubTitle('---\nlang: "es"\n---\n\n# Manual\n\n![L](x.png)\n\n# Manual\n', 'Manual'),
    '---\nlang: "es"\n---\n\n![L](x.png)\n\n# Manual\n',
  );
});

test('dropDuplicateEpubTitle no toca lo que no es esa repetición', () => {
  // Un encabezado por medio: son dos apartados, no un duplicado.
  const conApartado = '# Manual\n\n## Uno\n\n# Manual\n';
  assert.equal(dropDuplicateEpubTitle(conApartado, 'Manual'), conApartado);
  // El segundo dice otra cosa.
  const distinto = '# Manual\n\nTexto\n\n# Apéndice\n';
  assert.equal(dropDuplicateEpubTitle(distinto, 'Manual'), distinto);
  // No coincide con el título del libro.
  const otroLibro = '# Manual\n\nTexto\n\n# Manual\n';
  assert.equal(dropDuplicateEpubTitle(otroLibro, 'Otro'), otroLibro);
  // Un solo encabezado, que es el caso normal.
  const uno = '# Manual\n\nTexto\n';
  assert.equal(dropDuplicateEpubTitle(uno, 'Manual'), uno);
  // Sin título del libro no hay nada que comparar.
  assert.equal(dropDuplicateEpubTitle(uno, ''), uno);
});

/*
  Un bloque cercado vuelve sangrado de cualquier conversión, y el manual
  explica el bloque de ajustes escribiéndolo entero, rayas incluidas.
*/
test('normalizeThematicBreaks respeta el código sangrado', () => {
  const sangrado = 'Texto.\n\n    ---\n    lang: "ca"\n    ---\n\nMás.\n';
  assert.equal(normalizeThematicBreaks(sangrado), sangrado);
});

test('La estimación del PDF solo habla cuando ya ha medido algo', async () => {
  const { remainingMinutes } = await import('../pdf-import.js');
  // Sin páginas hechas, sin páginas pendientes o recién empezado, no dice nada.
  assert.equal(remainingMinutes(60000, 0, 100), 0);
  assert.equal(remainingMinutes(60000, 10, 0), 0);
  assert.equal(remainingMinutes(3000, 10, 500), 0);
  // Diez páginas en diez segundos: quinientas pendientes son unos ocho minutos.
  assert.equal(remainingMinutes(10000, 10, 500), 8);
  // Por debajo del minuto se calla en vez de decir «0 min».
  assert.equal(remainingMinutes(10000, 100, 20), 0);
});

test('Las páginas escaneadas se nombran agrupadas en intervalos', async () => {
  const { formatPageList } = await import('../pdf-import.js');
  // Las seguidas se juntan; las sueltas van una a una y en orden.
  assert.equal(formatPageList([5, 3, 4, 9]), '3-5, 9');
  assert.equal(formatPageList([]), '');
  // Un libro entero escaneado no vuelca sus cientos de números en el aviso.
  assert.equal(formatPageList([1, 3, 5, 7, 9, 11, 13], 3), '1, 3, 5…');
});

test('La vista previa del PDF enseña el principio y unas pocas imágenes', async () => {
  const { previewMarkdown } = await import('../pdf-import.js');
  const imagen = ruta => [ruta, Uint8Array.from([1, 2, 3])];

  // Un documento corto pasa entero y con todas sus imágenes repuestas.
  const corto = previewMarkdown('# Hola\n\n![](doc/images/01.png)\n', new Map([imagen('doc/images/01.png')]));
  assert.equal(corto.truncated, false);
  assert.equal(corto.hiddenImages, 0);
  assert.match(corto.markdown, /!\[\]\(data:image\/png;base64,/);

  // Uno largo se corta por un final de línea, nunca a mitad de una.
  const largo = previewMarkdown(`${'linea de relleno del informe\n'.repeat(6000)}FINAL`, new Map());
  assert.equal(largo.truncated, true);
  assert.ok(largo.markdown.length <= 80000, String(largo.markdown.length));
  assert.doesNotMatch(largo.markdown, /FINAL/);
  assert.ok(largo.markdown.endsWith('informe'), JSON.stringify(largo.markdown.slice(-30)));

  // Y de trece imágenes se reponen doce: la que falta se cuenta y se nombra.
  const rutas = Array.from({ length: 13 }, (_, i) => `doc/images/${i}.png`);
  const muchas = previewMarkdown(rutas.map(ruta => `![](${ruta})`).join('\n\n'), new Map(rutas.map(imagen)));
  assert.equal(muchas.hiddenImages, 1);
  assert.equal(muchas.markdown.match(/data:image\/png;base64,/g).length, 12);
  assert.match(muchas.markdown, /`doc\/images\/12\.png`/);
});

test('Los cinco idiomas traducen exactamente las mismas claves', () => {
  const idiomas = ['es', 'en', 'ca', 'gl', 'eu'];
  const claves = new Map(idiomas.map(idioma => [
    idioma,
    new Set(Object.keys(JSON.parse(readFileSync(new URL(`../locales/${idioma}.json`, import.meta.url), 'utf8')))),
  ]));
  const referencia = claves.get('es');
  for (const idioma of idiomas.slice(1)) {
    const faltan = [...referencia].filter(clave => !claves.get(idioma).has(clave));
    const sobran = [...claves.get(idioma)].filter(clave => !referencia.has(clave));
    assert.deepEqual(faltan, [], `faltan en ${idioma}: ${faltan.join(', ')}`);
    assert.deepEqual(sobran, [], `sobran en ${idioma}: ${sobran.join(', ')}`);
  }
});

test('Los textos con cantidad tienen su forma singular', () => {
  const es = JSON.parse(readFileSync(new URL('../locales/es.json', import.meta.url), 'utf8'));
  for (const clave of Object.keys(es).filter(clave => clave.endsWith('_many'))) {
    assert.ok(clave.replace(/_many$/, '_one') in es, `${clave} no tiene singular`);
  }
});

test('markdownHasFigures reconoce la imagen sola en su párrafo y con texto', async () => {
  const { markdownHasFigures } = await import('../pandoc-prepare.js');
  assert.equal(markdownHasFigures('![Pie](a.png)'), true);
  assert.equal(markdownHasFigures('Texto.\n\n![Pie](a.png "Título")\n\nMás.'), true);
  assert.equal(markdownHasFigures('![Pie](a.png){width=50%}\n'), true);
  assert.equal(markdownHasFigures('![](a.png)'), false);
  assert.equal(markdownHasFigures('![ ](a.png)'), false);
  assert.equal(markdownHasFigures('Texto ![Pie](a.png) en línea.'), false);
  assert.equal(markdownHasFigures('Texto pegado\n![Pie](a.png)'), false);
});

/*
  Columnas del DOCX y del ODT: se leen las mismas propiedades que entiende el
  navegador, para que el archivo tenga las columnas de la hoja.
*/
test('las columnas se leen como las lee el navegador', () => {
  assert.deepEqual(readColumnLayout('column-count:4; column-gap:10px;'), { count: 4, gapCm: 0.265, rule: false });
  assert.deepEqual(readColumnLayout('columns: 3'), { count: 3, gapCm: 0.423, rule: false });
  assert.equal(readColumnLayout('columns: 12em 2').count, 2);
  // Un ancho de columna da tantas como quepan en la línea.
  assert.equal(readColumnLayout('column-width: 5cm; column-gap: 1cm', 16).count, 2);
  assert.equal(readColumnLayout('column-width: 5cm; column-gap: 1cm', 26).count, 4);
  assert.equal(readColumnLayout('column-count: 3; column-width: 7cm; column-gap: 0', 16).count, 2);
  assert.equal(readColumnLayout('column-rule: 1px solid #ccc; column-count: 2').rule, true);
  assert.equal(readColumnLayout('column-rule: none; column-count: 2').rule, false);
  // Una sola columna, o ninguna, no es un bloque en columnas.
  assert.equal(readColumnLayout('column-count: 1'), null);
  assert.equal(readColumnLayout('color: red'), null);
  assert.equal(readColumnLayout('column-count: auto'), null);
});

const columnDiv = (blocks, style = 'column-count:4; column-gap:10px;') => (
  { t: 'Div', c: [['', [], [['style', style]]], blocks] }
);
const para = text => ({ t: 'Para', c: [{ t: 'Str', c: text }] });

test('en el DOCX, el bloque en columnas queda entre dos cortes de sección', () => {
  const ast = { blocks: [para('antes'), columnDiv([para('dentro')]), para('después')] };
  assert.equal(splitColumnSections(ast, 'docx'), 1);
  assert.deepEqual(ast.blocks.map(block => block.t), ['Para', 'RawBlock', 'Div', 'RawBlock', 'Para']);
  const [, opening, , closing] = ast.blocks;
  assert.equal(opening.c[0], 'openxml');
  assert.match(opening.c[1], /<w:sectPr><w:type w:val="continuous" \/><\/w:sectPr>/);
  assert.match(closing.c[1], /<w:cols w:num="4" w:space="150" \/>/);
});

test('en el DOCX no se abre una sección vacía delante del bloque', () => {
  // Al principio del documento, o justo detrás de otro bloque en columnas.
  const ast = { blocks: [columnDiv([para('a')]), columnDiv([para('b')], 'columns: 2')] };
  splitColumnSections(ast, 'docx');
  assert.deepEqual(ast.blocks.map(block => block.t), ['Div', 'RawBlock', 'Div', 'RawBlock']);
  // Con índice, el índice va delante y tiene que quedar fuera de las columnas.
  const withToc = { blocks: [columnDiv([para('a')])] };
  splitColumnSections(withToc, 'docx', { toc: true });
  assert.deepEqual(withToc.blocks.map(block => block.t), ['RawBlock', 'Div', 'RawBlock']);
});

test('en el ODT, el bloque en columnas va en su propia sección', () => {
  const ast = { blocks: [columnDiv([para('a')]), columnDiv([para('b')], 'columns: 2; column-rule: 1px solid')] };
  assert.equal(splitColumnSections(ast, 'odt'), 2);
  const raws = ast.blocks.filter(block => block.t === 'RawBlock').map(block => block.c);
  assert.deepEqual(raws, [
    ['opendocument', '<text:section text:style-name="EdiMarkdownColumns_4_0.265cm" text:name="EdiMarkdownColumns1">'],
    ['opendocument', '</text:section>'],
    ['opendocument', '<text:section text:style-name="EdiMarkdownColumns_2_0.423cm_rule" text:name="EdiMarkdownColumns2">'],
    ['opendocument', '</text:section>'],
  ]);
});

test('las columnas solo cambian de sección al nivel del cuerpo', () => {
  const nested = columnDiv([para('dentro')], 'columns: 2');
  const list = { t: 'BulletList', c: [[columnDiv([para('en la lista')])]] };
  const plain = { t: 'Div', c: [['', ['nota'], []], [columnDiv([para('en un div')])]] };
  const ast = { blocks: [columnDiv([nested]), list, plain] };
  assert.equal(splitColumnSections(ast, 'docx'), 2);
  // El de dentro de otro bloque en columnas y el de la lista se quedan como están.
  assert.equal(ast.blocks[0].c[1][0], nested);
  assert.equal(ast.blocks[2], list);
  // Un div sin columnas no es un cambio de sección: el de dentro sí cuenta.
  assert.deepEqual(ast.blocks[3].c[1].map(block => block.t), ['RawBlock', 'Div', 'RawBlock']);
});

test('sin bloques en columnas la conversión es directa', async () => {
  assert.equal(hasColumnBlocks('<div style="column-count:4">'), true);
  assert.equal(hasColumnBlocks("<div class='x' style='columns: 2'>"), true);
  assert.equal(hasColumnBlocks('<div style="color: red">'), false);
  const calls = [];
  const convert = async (args, input) => {
    calls.push(args);
    return new TextEncoder().encode(args.includes('-t json') ? JSON.stringify({ blocks: [] }) : input);
  };
  await convertWithAstPasses(convert, '-f markdown -t docx', 'Texto', { columns: { kind: 'docx' } });
  assert.deepEqual(calls, ['-f markdown -t docx']);
  calls.length = 0;
  await convertWithAstPasses(convert, '-f markdown -t docx', '<div style="columns:2">\n\nA\n\n</div>', { columns: { kind: 'docx' } });
  assert.deepEqual(calls, ['-f markdown -t json', '-f json -t docx']);
});

test('los diagramas Mermaid se localizan por la etiqueta de su bloque', () => {
  const markdown = [
    '# Título', '',
    '```mermaid', 'flowchart LR', '  A --> B', '```', '',
    '~~~ {.mermaid}', 'pie', '  "a": 1', '~~~', '',
    '````markdown', '```mermaid', 'ejemplo dentro de otro bloque', '```', '````', '',
    '- lista', '',
    '  ```mermaid', '  graph TD', '    X-->Y', '  ```', '',
    '```js', 'mermaid()', '```',
  ].join('\n');
  assert.deepEqual(collectMermaidBlocks(markdown), ['flowchart LR\n  A --> B', 'pie\n  "a": 1', 'graph TD\n  X-->Y']);
  const replaced = mapMermaidBlocks(markdown, (code, index) => `[diagrama ${index}]`);
  assert.match(replaced, /\n\n\[diagrama 0\]\n\n/);
  assert.match(replaced, /\n\n\[diagrama 1\]\n\n/);
  assert.match(replaced, /- lista\n\n {2}\[diagrama 2\]\n/);
  // Lo que sustituye a un bloque de una lista queda entero dentro de ella.
  const enLista = mapMermaidBlocks('- a\n\n  ```mermaid\n  pie\n  ```\n', () => 'uno\n\ndos');
  assert.equal(enLista, '- a\n\n  uno\n\n  dos\n');
  assert.match(replaced, /```mermaid\nejemplo dentro de otro bloque\n```/);
  assert.match(replaced, /```js\nmermaid\(\)\n```/);
  // Sin sustitución, el bloque se queda tal cual.
  assert.equal(mapMermaidBlocks(markdown, () => undefined), markdown);
});

