import assert from 'node:assert/strict';
import test from 'node:test';

import documentFormat from '../document-format.js';

const {
  normalizeDocumentFormat,
  resolveDocumentFormat,
  isEmptyFormat,
  toFrontMatterEntries,
  readFromFrontMatter,
  toPreviewStyles,
} = documentFormat;

test('un ajuste sin valor significa heredar, no imponer un valor por omisión', () => {
  const empty = normalizeDocumentFormat({});
  assert.equal(empty.align, '');
  assert.equal(empty.fontSize, '');
  assert.equal(empty.indent, '');
  assert.equal(isEmptyFormat(empty), true);

  // Un documento de siempre no escribe ninguna línea nueva en sus metadatos.
  assert.deepEqual(toFrontMatterEntries(empty), []);
});

test('descarta lo que no se entiende en vez de escribirlo en el documento', () => {
  const format = normalizeDocumentFormat({
    align: 'centrado',
    fontSize: '900',
    lineHeight: 'doble',
    marginTop: '-2',
    marginLeft: '99',
  });
  assert.equal(format.align, '');
  assert.equal(format.fontSize, '');
  assert.equal(format.lineHeight, '');
  assert.equal(format.marginTop, '');
  assert.equal(format.marginLeft, '');
});

test('acepta la coma decimal y guarda el número sin ceros de relleno', () => {
  const format = normalizeDocumentFormat({ marginTop: '2,50', lineHeight: '1.500', fontSize: '12.0' });
  assert.equal(format.marginTop, '2.5');
  assert.equal(format.lineHeight, '1.5');
  assert.equal(format.fontSize, '12');
});

test('los interruptores entienden sí, no y vacío', () => {
  assert.equal(normalizeDocumentFormat({ indent: true }).indent, 'yes');
  assert.equal(normalizeDocumentFormat({ indent: 'false' }).indent, 'no');
  assert.equal(normalizeDocumentFormat({ indent: '' }).indent, '');
  assert.equal(normalizeDocumentFormat({ hyphenate: 'sí' }).hyphenate, 'yes');
  assert.equal(normalizeDocumentFormat({ pageBreakBeforeH1: true }).pageBreakBeforeH1, 'yes');
  assert.equal(normalizeDocumentFormat({ orientation: 'landscape' }).orientation, 'landscape');
});

test('el documento manda y lo que calla lo pone el ajuste general', () => {
  const general = { align: 'justify', fontSize: '11', marginTop: '2.5', hyphenate: 'yes' };
  const own = { align: 'left', fontSize: '' };
  const resolved = resolveDocumentFormat(general, own);
  assert.equal(resolved.align, 'left');
  assert.equal(resolved.fontSize, '11');
  assert.equal(resolved.marginTop, '2.5');
  assert.equal(resolved.hyphenate, 'yes');
});

test('escribe las claves de Pandoc con sus unidades', () => {
  const entries = toFrontMatterEntries({
    align: 'justify',
    font: 'serif',
    fontSize: '12',
    lineHeight: '1.5',
    marginTop: '2.5',
    indent: 'yes',
    hyphenate: 'no',
  });
  const lines = entries.flatMap(entry => entry.lines);
  assert.deepEqual(lines, [
    'align: "justify"',
    'font: "serif"',
    'fontsize: "12pt"',
    'linestretch: "1.5"',
    'margin-top: "2.5cm"',
    'indent: true',
    'hyphenate: false',
  ]);
});

test('vuelve a leer lo que escribió, con unidades o sin ellas', () => {
  const frontMatter = [
    '---',
    'lang: "es"',
    'align: "justify"',
    'fontsize: "12pt"',
    'margin-left: 2,5cm',
    'linestretch: 1.5',
    'indent: true',
    'hyphenate: false',
    '---',
  ].join('\n');
  const format = readFromFrontMatter(frontMatter);
  assert.equal(format.align, 'justify');
  assert.equal(format.fontSize, '12');
  assert.equal(format.marginLeft, '2.5');
  assert.equal(format.lineHeight, '1.5');
  assert.equal(format.indent, 'yes');
  assert.equal(format.hyphenate, 'no');
});

test('un documento sin ajustes de formato se lee como vacío', () => {
  const format = readFromFrontMatter('---\nlang: "es"\nauthor: "Juan"\n---');
  assert.equal(isEmptyFormat(format), true);
});

test('la vista previa recibe solo las propiedades que se han fijado', () => {
  assert.deepEqual(toPreviewStyles({}), {});
  const styles = toPreviewStyles({
    align: 'justify',
    font: 'sans',
    fontSize: '14',
    lineHeight: '1.5',
    marginLeft: '3',
    hyphenate: 'yes',
    indent: 'no',
  });
  assert.equal(styles['text-align'], 'justify');
  assert.match(styles['font-family'], /sans-serif$/);
  // Con la lupa de la vista previa dentro, para que la hoja crezca entera.
  assert.equal(styles['font-size'], 'calc(14pt * var(--preview-zoom, 1))');
  assert.equal(styles['line-height'], '1.5');
  assert.equal(styles['padding-left'], 'calc(3cm * var(--preview-zoom, 1))');
  assert.equal(styles.hyphens, 'auto');
  // En una variable propia: `text-indent` se hereda y sangraría también los
  // encabezados y los elementos de lista, que no la llevan en lo exportado.
  assert.equal(styles['--doc-indent'], '0');
  assert.equal(styles['text-indent'], undefined);
  assert.equal(styles['padding-right'], undefined);
});

test('una tipografía escrita a mano llega tal cual a la vista previa', () => {
  const styles = toPreviewStyles({ font: 'Garamond' });
  assert.equal(styles['font-family'], '"Garamond", serif');
});

test('la hoja de estilos no toca los encabezados: la plantilla ya los mide en em', () => {
  const css = documentFormat.toCssRules({ fontSize: '14', align: 'justify' });
  assert.match(css, /font-size: 14pt;/);
  assert.equal(/h1|h2|h3/.test(css), false);
});

test('los márgenes salen como @page y como relleno, para quien pagina y quien no', () => {
  const css = documentFormat.toCssRules({ marginTop: '2', marginLeft: '3' });
  assert.match(css, /@page \{\n {2}margin-top: 2cm;\n {2}margin-left: 3cm;\n\}/);
  assert.match(css, /padding-top: 2cm;/);
  assert.match(css, /padding-left: 3cm;/);
});

test('la orientación intercambia las medidas y llega a CSS', () => {
  const preview = toPreviewStyles({ paperSize: 'a4', orientation: 'landscape' });
  assert.equal(preview['--paper-width'], '29.7cm');
  assert.equal(preview['--paper-height'], '21cm');
  assert.match(documentFormat.toCssRules({ paperSize: 'a4', orientation: 'landscape' }), /size: A4 landscape/);
});

test('el salto antes de H1 se escribe para HTML y EPUB', () => {
  const css = documentFormat.toCssRules({ pageBreakBeforeH1: 'yes' });
  assert.match(css, /h1:not\(:first-of-type\)/);
  assert.match(css, /break-before: page/);
});

test('la partición lleva los prefijos que aún piden los lectores de EPUB', () => {
  const css = documentFormat.toCssRules({ hyphenate: 'yes' });
  assert.match(css, /-webkit-hyphens: auto;/);
  assert.match(css, /-epub-hyphens: auto;/);
  assert.match(css, /\n {2}hyphens: auto;/);
});

test('LaTeX toma como metadato lo que Pandoc sabe escribir', () => {
  const { entries, preamble } = documentFormat.toLatex({ fontSize: '11', lineHeight: '1.5', indent: 'yes' });
  const lines = entries.flatMap(entry => entry.lines);
  assert.deepEqual(lines, ['fontsize: "11pt"', 'linestretch: "1.5"', 'indent: true']);
  assert.equal(preamble.length, 0);
});

test('un tamaño que la clase de LaTeX no admite pasa por el paquete fontsize', () => {
  const { entries, preamble } = documentFormat.toLatex({ fontSize: '13' });
  assert.equal(entries.length, 0);
  assert.deepEqual(preamble, ['\\usepackage[fontsize=13pt]{fontsize}']);
});

test('en LaTeX lo que hay que declarar es no justificar, que justificado ya está', () => {
  assert.deepEqual(documentFormat.toLatex({ align: 'justify' }).preamble, []);
  assert.deepEqual(documentFormat.toLatex({ align: 'left' }).preamble, ['\\usepackage[document]{ragged2e}']);
  assert.match(documentFormat.toLatex({ align: 'right' }).preamble.join('\n'), /RaggedLeft/);
});

test('con geometry ya cargado los márgenes se descartan en vez de romper la compilación', () => {
  const withoutClash = documentFormat.toLatex({ marginTop: '2' });
  assert.deepEqual(withoutClash.entries.flatMap(e => e.lines), ['margin-top: "2cm"']);
  assert.deepEqual(withoutClash.dropped, []);

  const clash = documentFormat.toLatex({ marginTop: '2', marginLeft: '3' }, { hasGeometry: true });
  assert.deepEqual(clash.entries, []);
  assert.deepEqual(clash.dropped, ['margin-top', 'margin-left']);
});

test('la orientación apaisada usa geometry en LaTeX', () => {
  const normal = documentFormat.toLatex({ orientation: 'landscape' });
  assert.deepEqual(normal.entries.flatMap(entry => entry.lines), ['geometry: "landscape"']);
  const clash = documentFormat.toLatex({ orientation: 'landscape' }, { hasGeometry: true });
  assert.deepEqual(clash.entries, []);
  assert.deepEqual(clash.dropped, ['orientation']);
});

test('una tipografía suelta va como mainfont, que solo resuelven XeLaTeX y LuaLaTeX', () => {
  assert.deepEqual(
    documentFormat.toLatex({ font: 'Garamond' }).entries.flatMap(e => e.lines),
    ['mainfont: "Garamond"'],
  );
  assert.deepEqual(documentFormat.toLatex({ font: 'serif' }).preamble, ['\\usepackage{newtxtext}', '\\AtBeginDocument{\\urlstyle{same}}']);
});

test('DOCX y ODT reciben nombres de fuente reales y cuánto escalar los encabezados', () => {
  const styles = documentFormat.toOfficeStyles({ font: 'sans', fontSize: '18', marginLeft: '2.5' });
  assert.equal(styles.fontName, 'Arial');
  assert.equal(styles.fontSizePt, 18);
  assert.equal(styles.headingScale, 18 / documentFormat.OFFICE_BASE_FONT_PT);
  assert.deepEqual(styles.marginsCm, { left: 2.5 });
});

test('el pie al imprimir admite sus tres valores y viaja en el bloque de metadatos', () => {
  assert.equal(normalizeDocumentFormat({ printFooter: 'Name' }).printFooter, 'name');
  assert.equal(normalizeDocumentFormat({ printFooter: 'page' }).printFooter, 'page');
  assert.equal(normalizeDocumentFormat({ printFooter: 'none' }).printFooter, 'none');
  assert.equal(normalizeDocumentFormat({ printFooter: 'siempre' }).printFooter, '');
  const entries = documentFormat.toFrontMatterEntries({ printFooter: 'name' });
  assert.deepEqual(entries.map(entry => entry.lines[0]), ['print-footer: "name"']);
  assert.equal(documentFormat.readFromFrontMatter('print-footer: page').printFooter, 'page');
  assert.equal(resolveDocumentFormat({ printFooter: 'none' }, { printFooter: 'page' }).printFooter, 'page');
});
