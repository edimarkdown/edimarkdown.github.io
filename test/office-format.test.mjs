import assert from 'node:assert/strict';
import test from 'node:test';

import {
  INDENT_CM,
  TWIPS_PER_CM,
  applyDocxColumnSections,
  applyDocxHyphenation,
  applyDocxMargins,
  applyDocxPageSize,
  applyDocxStyles,
  applyDocxTheme,
  applyOdtColumnSections,
  applyOdtMargins,
  applyOdtPageSize,
  applyOdtStyles,
} from '../office-format.js';

/* Recortes de lo que escribe Pandoc, con la forma que tienen sus plantillas. */
const DOCX_STYLES = `<w:styles><w:docDefaults><w:rPrDefault><w:rPr>`
  + `<w:rFonts w:asciiTheme="minorHAnsi" w:cstheme="minorBidi" w:hAnsiTheme="minorHAnsi" />`
  + `<w:sz w:val="24" /><w:szCs w:val="24" /><w:lang w:val="es" />`
  + `</w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="200" /></w:pPr></w:pPrDefault>`
  + `</w:docDefaults>`
  + `<w:style w:styleId="Heading1" w:type="paragraph"><w:rPr><w:sz w:val="40" /><w:szCs w:val="40" /></w:rPr></w:style>`
  + `<w:style w:type="paragraph" w:customStyle="1" w:styleId="SourceCode"><w:name w:val="Source Code" />`
  + `<w:basedOn w:val="Normal" /><w:pPr><w:wordWrap w:val="off" /></w:pPr></w:style>`
  + `<w:style w:styleId="Heading2" w:type="paragraph"><w:rPr><w:sz w:val="32" /><w:szCs w:val="32" /></w:rPr></w:style>`
  + `</w:styles>`;

const ODT_STYLES = `<office:document-styles><office:font-face-decls>`
  + `<style:font-face style:name="Arial" svg:font-family="Arial" /></office:font-face-decls>`
  + `<office:styles><style:style style:family="paragraph" style:name="Standard" />`
  + `<style:style style:family="paragraph" style:name="Preformatted_20_Text" style:parent-style-name="Standard">`
  + `<style:paragraph-properties style:contextual-spacing="false" fo:margin-bottom="0in" fo:margin-top="0in" />`
  + `<style:text-properties fo:font-family="monospace" /></style:style>`
  + `<style:style style:family="paragraph" style:name="Heading" style:parent-style-name="Standard">`
  + `<style:text-properties style:font-name="Arial" style:font-name-asian="Lucida Sans Unicode"`
  + ` style:font-size-asian="14pt" fo:font-size="14pt" /></style:style></office:styles>`
  + `<office:automatic-styles><style:page-layout style:name="Mpm1">`
  + `<style:page-layout-properties fo:margin-bottom="1in" fo:margin-left="1in" fo:margin-right="1in" fo:margin-top="1in" />`
  + `</style:page-layout></office:automatic-styles></office:document-styles>`;

test('sin nada que fijar, los estilos salen intactos', () => {
  const styles = { align: '', fontName: '', fontSizePt: 0, lineHeight: 0, indent: '', hyphenate: '', marginsCm: {} };
  assert.equal(applyDocxStyles(DOCX_STYLES, styles), DOCX_STYLES);
  assert.equal(applyOdtStyles(ODT_STYLES, styles), ODT_STYLES);
  assert.equal(applyDocxMargins('<w:body><w:sectPr /></w:body>', {}), '<w:body><w:sectPr /></w:body>');
});

test('la letra del DOCX sustituye a la del tema, que si no gana ella', () => {
  const result = applyDocxStyles(DOCX_STYLES, { fontName: 'Times New Roman', fontSizePt: 14 });
  assert.match(result, /<w:rFonts w:ascii="Times New Roman" w:cs="Times New Roman" w:eastAsia="Times New Roman" w:hAnsi="Times New Roman" \/>/);
  assert.equal(/asciiTheme/.test(result), false);
  // Medios puntos: 14 pt son 28.
  assert.match(result, /<w:sz w:val="28" \/><w:szCs w:val="28" \/>/);
});

/*
  El esquema de OOXML es una secuencia: si `w:jc` se cuela delante de
  `w:spacing`, Word declara el archivo dañado en vez de abrirlo.
*/
test('el párrafo por omisión respeta el orden que exige el esquema', () => {
  const result = applyDocxStyles(DOCX_STYLES, { align: 'justify', lineHeight: 1.5, indent: 'yes' });
  const pPr = result.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/)[1];
  const order = [...pPr.matchAll(/<w:(\w+)/g)].map(match => match[1]);
  assert.deepEqual(order, ['spacing', 'ind', 'jc']);
  // Y el interlineado se suma al spacing que ya estaba, sin duplicarlo.
  assert.equal((pPr.match(/<w:spacing/g) || []).length, 1);
  assert.match(pPr, /w:after="200"/);
  assert.match(pPr, /w:line="360" w:lineRule="auto"/);
  assert.match(pPr, new RegExp(`w:firstLine="${Math.round(INDENT_CM * TWIPS_PER_CM)}"`));
});

test('quitar la sangría es fijarla en cero, no callarse', () => {
  const result = applyDocxStyles(DOCX_STYLES, { indent: 'no' });
  assert.match(result, /<w:ind w:firstLine="0" \/>/);
});

/*
  El escritor de DOCX de Pandoc escribe el bloque de código entero como un solo
  párrafo con saltos de línea dentro, así que justificarlo estira todas sus
  líneas menos la última y descuadra un texto de ancho fijo.
*/
test('el código del DOCX no hereda la justificación ni la sangría del documento', () => {
  const result = applyDocxStyles(DOCX_STYLES, { align: 'justify', indent: 'yes' });
  const code = result.match(/<w:style\b[^>]*w:styleId="SourceCode"[\s\S]*?<\/w:style>/)[0];
  assert.match(code, /<w:jc w:val="start" \/>/);
  assert.match(code, /<w:ind w:firstLine="0" \/>/);
  // Lo que el estilo ya traía sigue ahí, y en el orden que exige el esquema.
  assert.deepEqual(
    [...code.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/)[1].matchAll(/<w:(\w+)/g)].map(match => match[1]),
    ['wordWrap', 'ind', 'jc'],
  );
  // Y el documento conserva la suya: solo se protege el código.
  assert.match(result, /<w:pPrDefault>[\s\S]*<w:jc w:val="both" \/>/);
});

test('con el documento alineado a la izquierda el código se queda como estaba', () => {
  const result = applyDocxStyles(DOCX_STYLES, { align: 'left' });
  const code = result.match(/<w:style\b[^>]*w:styleId="SourceCode"[\s\S]*?<\/w:style>/)[0];
  assert.equal(/<w:jc/.test(code), false, 'se tocó el código sin necesidad');
  assert.equal(/<w:ind/.test(code), false);
});

test('los encabezados del DOCX se estiran con el cuerpo para no perder la jerarquía', () => {
  const result = applyDocxStyles(DOCX_STYLES, { fontSizePt: 18, headingScale: 1.5 });
  assert.match(result, /Heading1[\s\S]*?<w:sz w:val="60" \/>/);
  assert.match(result, /Heading2[\s\S]*?<w:sz w:val="48" \/>/);
});

test('el H1 del DOCX puede empezar siempre en página nueva', () => {
  const result = applyDocxStyles(DOCX_STYLES, { pageBreakBeforeH1: 'yes' });
  assert.match(result, /Heading1[\s\S]*?<w:pPr><w:pageBreakBefore \/><\/w:pPr>/);
  assert.equal(/Heading2[\s\S]*pageBreakBefore/.test(result), false);
});

test('los márgenes abren la sección vacía que deja Pandoc', () => {
  const result = applyDocxMargins('<w:body><w:p /><w:sectPr /></w:body>', { top: 2, left: 3 });
  // El esquema de Word exige los siete atributos: lo que no se fija, por omisión.
  assert.match(result, /<w:sectPr><w:pgMar w:top="1134" w:right="1440" w:bottom="1440" w:left="1701" w:header="708" w:footer="708" w:gutter="0" \/><\/w:sectPr>/);
});

test('una sección que ya existe conserva lo suyo y cambia de márgenes', () => {
  const source = '<w:body><w:sectPr><w:pgSz w:w="11906" /><w:pgMar w:top="100" w:left="200" /></w:sectPr></w:body>';
  const result = applyDocxMargins(source, { top: 2 });
  assert.match(result, /<w:pgMar w:top="1134" w:right="1440" w:bottom="1440" w:left="200" /);
  assert.match(result, /<w:pgSz w:w="11906" \/>/);
  assert.equal((result.match(/<w:pgMar/g) || []).length, 1);
});

test('Word solo parte palabras si el documento se lo pide', () => {
  const settings = '<w:settings><w:zoom w:percent="100" /></w:settings>';
  assert.match(applyDocxHyphenation(settings, 'yes'), /<w:autoHyphenation w:val="true" \/><w:zoom/);
  assert.match(applyDocxHyphenation(settings, 'no'), /<w:autoHyphenation w:val="false" \/>/);
  assert.equal(applyDocxHyphenation(settings, ''), settings);
});

test('el tema lleva la tipografía a los encabezados, que no la heredan del cuerpo', () => {
  const theme = '<a:fontScheme><a:majorFont><a:latin typeface="Aptos Display" panose="02" /><a:ea typeface="" />'
    + '</a:majorFont><a:minorFont><a:latin typeface="Aptos" /></a:minorFont></a:fontScheme>';
  const result = applyDocxTheme(theme, 'Times New Roman');
  assert.equal((result.match(/<a:latin typeface="Times New Roman"\/>/g) || []).length, 2);
  assert.match(result, /<a:ea typeface="" \/>/);
});

test('el estilo Standard del ODT viene vacío y hay que abrirlo', () => {
  const result = applyOdtStyles(ODT_STYLES, {
    align: 'justify', fontName: 'Georgia', fontSizePt: 13, lineHeight: 1.5, indent: 'yes', hyphenate: 'yes',
  });
  const standard = result.match(/<style:style[^>]*style:name="Standard"[^>]*>([\s\S]*?)<\/style:style>/)[1];
  assert.match(standard, /fo:text-align="justify"/);
  assert.match(standard, /fo:line-height="150%"/);
  assert.match(standard, new RegExp(`fo:text-indent="${INDENT_CM}cm"`));
  assert.match(standard, /fo:hyphenate="true"/);
  // Sin mínimos, LibreOffice parte dejando una letra sola.
  assert.match(standard, /fo:hyphenation-remain-char-count="2"/);
  assert.match(standard, /style:font-name="Georgia"/);
  assert.match(standard, /fo:font-size="13pt"/);
});

test('el código del ODT no hereda la justificación ni la sangría del documento', () => {
  const result = applyOdtStyles(ODT_STYLES, { align: 'justify', indent: 'yes' });
  const code = result.match(/<style:style\b(?=[^>]*style:name="Preformatted_20_Text")[^>]*>[\s\S]*?<\/style:style>/)[0];
  const standard = result.match(/<style:style\b(?=[^>]*style:name="Standard")[^>]*>[\s\S]*?<\/style:style>/)[0];
  assert.match(code, /fo:text-indent="0cm"/);
  assert.match(code, /fo:text-align="start"/);
  assert.match(code, /style:contextual-spacing="false"/);
  assert.match(code, /fo:margin-bottom="0in"/);
  assert.match(code, /fo:margin-top="0in"/);
  assert.match(standard, new RegExp(`fo:text-indent="${INDENT_CM}cm"`));
  assert.match(standard, /fo:text-align="justify"/);
});

test('alineado a la izquierda y sin sangría deja intacto el código del ODT', () => {
  const result = applyOdtStyles(ODT_STYLES, { align: 'left', indent: '' });
  const pattern = /<style:style\b(?=[^>]*style:name="Preformatted_20_Text")[^>]*>[\s\S]*?<\/style:style>/;
  assert.equal(result.match(pattern)[0], ODT_STYLES.match(pattern)[0]);
});

test('una tipografía nueva se declara antes de usarse', () => {
  const result = applyOdtStyles(ODT_STYLES, { fontName: 'Georgia' });
  assert.match(result, /<style:font-face style:name="Georgia" svg:font-family="Georgia" \/>/);
  // La que ya estaba declarada no se duplica.
  const arial = applyOdtStyles(ODT_STYLES, { fontName: 'Arial' });
  assert.equal((arial.match(/<style:font-face style:name="Arial"/g) || []).length, 1);
});

test('en el ODT los encabezados cuelgan de Heading, que sí mide en puntos', () => {
  const result = applyOdtStyles(ODT_STYLES, { fontSizePt: 18, headingScale: 1.5, fontName: 'Georgia' });
  const heading = result.match(/<style:style[^>]*style:name="Heading"[^>]*>([\s\S]*?)<\/style:style>/)[1];
  assert.match(heading, /fo:font-size="21pt"/);
  assert.match(heading, /style:font-name="Georgia"/);
  assert.match(heading, /style:font-name-asian="Georgia"/);
});

test('el H1 del ODT puede empezar siempre en página nueva', () => {
  const source = ODT_STYLES.replace(
    '</office:styles>',
    '<style:style style:name="Heading_20_1" style:family="paragraph"><style:paragraph-properties /></style:style></office:styles>',
  );
  const result = applyOdtStyles(source, { pageBreakBeforeH1: 'yes' });
  assert.match(result, /Heading_20_1[\s\S]*?fo:break-before="page"/);
});

test('los márgenes del ODT sustituyen a los de la plantilla, en centímetros', () => {
  const result = applyOdtMargins(ODT_STYLES, { top: 2, left: 3 });
  assert.match(result, /fo:margin-top="2cm"/);
  assert.match(result, /fo:margin-left="3cm"/);
  // Los lados que nadie fija se quedan como estaban.
  assert.match(result, /fo:margin-right="1in"/);
});

/*
  Las dos funciones que abren el archivo terminado viven en pandoc-prepare.js,
  con el resto de arreglos sobre el ZIP. Aquí se prueban con archivos armados a
  mano, sin pasar por Pandoc, que es lo que hace el test lento de exportación.
*/
const { appendEpubStylesheet, applyOfficeFormat } = await import('../pandoc-prepare.js');
const { createZip } = await import('../zip-writer.js');
const { readZipEntries } = await import('../zip-reader.js');

const encode = text => new TextEncoder().encode(text);
const decode = bytes => new TextDecoder().decode(bytes);

test('el ODT se reconstruye con el mimetype por delante', async () => {
  const archive = await createZip(new Map([
    ['mimetype', encode('application/vnd.oasis.opendocument.text')],
    ['styles.xml', encode(ODT_STYLES)],
    ['content.xml', encode('<office:document-content />')],
  ]));
  const result = await applyOfficeFormat(archive, { align: 'justify', marginsCm: {} }, 'odt');
  const entries = await readZipEntries(result);
  assert.equal([...entries.keys()][0], 'mimetype');
  assert.match(decode(entries.get('styles.xml')), /fo:text-align="justify"/);
  // Lo que no se toca llega igual.
  assert.equal(decode(entries.get('content.xml')), '<office:document-content />');
});

test('sin ajustes no se rehace el archivo: se devuelve el mismo', async () => {
  const archive = await createZip(new Map([['styles.xml', encode(ODT_STYLES)]]));
  const result = await applyOfficeFormat(archive, { align: '', marginsCm: {} }, 'odt');
  assert.equal(result, archive);
});

test('un archivo ilegible se devuelve tal cual en vez de romper la exportación', async () => {
  const broken = encode('esto no es un ZIP');
  assert.equal(await applyOfficeFormat(broken, { align: 'justify', marginsCm: {} }, 'docx'), broken);
  assert.equal(await appendEpubStylesheet(broken, 'body { color: red; }'), broken);
});

test('el EPUB suma el formato a la hoja de Pandoc sin perder la suya', async () => {
  const original = 'body { margin: 0; }\ncode { white-space: pre; }';
  const archive = await createZip(new Map([
    ['mimetype', encode('application/epub+zip')],
    ['EPUB/styles/stylesheet1.css', encode(original)],
  ]));
  const result = await appendEpubStylesheet(archive, 'body {\n  text-align: justify;\n}');
  const entries = await readZipEntries(result);
  const sheet = decode(entries.get('EPUB/styles/stylesheet1.css'));
  assert.match(sheet, /code \{ white-space: pre; \}/);
  assert.match(sheet, /text-align: justify;/);
  assert.ok(sheet.indexOf('white-space') < sheet.indexOf('text-align'));
});

/*
  El tamaño del papel: sin escribirlo, el DOCX y el ODT salen con el de la
  plantilla de Pandoc —Carta— aunque el documento diga A4, y entonces lo que se
  ve en la aplicación y lo que se imprime desde Word no coinciden.
*/
test('el DOCX declara el tamaño del papel antes que los márgenes', () => {
  const result = applyDocxPageSize('<w:body><w:p /><w:sectPr /></w:body>', { width: 21, height: 29.7 });
  // 21 cm y 29,7 cm en twips, que es como los mide Word.
  assert.match(result, /<w:pgSz w:w="11906" w:h="16838" \/>/);

  // Con los dos puestos, el tamaño va delante: el esquema de Word lo exige.
  const conMargenes = applyDocxMargins(result, { top: 2 });
  assert.ok(
    conMargenes.indexOf('<w:pgSz') < conMargenes.indexOf('<w:pgMar'),
    `el orden es el que rechaza Word: ${conMargenes}`,
  );

  // Y si la plantilla ya traía uno, se sustituye en vez de duplicarse.
  const previo = applyDocxPageSize('<w:sectPr><w:pgSz w:w="12240" w:h="15840" /></w:sectPr>', { width: 21, height: 29.7 });
  assert.equal(previo.match(/<w:pgSz/g).length, 1);
  assert.match(previo, /w:w="11906"/);
});

test('el DOCX declara la orientación apaisada', () => {
  const result = applyDocxPageSize('<w:body><w:sectPr /></w:body>', {
    width: 29.7, height: 21, orientation: 'landscape',
  });
  assert.match(result, /w:w="16838" w:h="11906" w:orient="landscape"/);
});

test('el ODT declara el tamaño del papel en su disposición de página', () => {
  const result = applyOdtPageSize(ODT_STYLES, { width: 21.59, height: 27.94 });
  assert.match(result, /fo:page-width="21.59cm"/);
  assert.match(result, /fo:page-height="27.94cm"/);
  assert.match(result, /style:print-orientation="portrait"/);
  // Los márgenes siguen entrando en la misma disposición, sin pisarse.
  const conMargenes = applyOdtMargins(result, { top: 2 });
  assert.match(conMargenes, /fo:margin-top="2cm"/);
  assert.match(conMargenes, /fo:page-width="21.59cm"/);
});

test('el ODT declara la orientación apaisada', () => {
  const result = applyOdtPageSize(ODT_STYLES, {
    width: 29.7, height: 21, orientation: 'landscape',
  });
  assert.match(result, /fo:page-width="29.7cm"/);
  assert.match(result, /style:print-orientation="landscape"/);
});

test('sin tamaño de papel el archivo se queda como estaba', () => {
  assert.equal(applyDocxPageSize('<w:sectPr />', null), '<w:sectPr />');
  assert.equal(applyOdtPageSize(ODT_STYLES, null), ODT_STYLES);
});

/*
  Columnas. En Word, cada bloque en columnas es una sección, de modo que el
  papel y los márgenes tienen que llegar a todas, y la que va detrás del
  bloque tiene que seguir en la misma página.
*/
const DOCX_WITH_COLUMNS = '<w:body><w:p><w:pPr><w:sectPr><w:type w:val="continuous" /></w:sectPr></w:pPr></w:p>'
  + '<w:p><w:pPr><w:sectPr><w:type w:val="continuous" /><w:cols w:num="4" w:space="150" /></w:sectPr></w:pPr></w:p>'
  + '<w:sectPr /></w:body>';

test('el DOCX con columnas lleva el papel y los márgenes a cada sección', () => {
  const result = applyDocxMargins(
    applyDocxPageSize(applyDocxColumnSections(DOCX_WITH_COLUMNS), { width: 21, height: 29.7 }),
    { top: 1.8, right: 1.8, bottom: 1.8, left: 1.8 },
  );
  const sections = result.match(/<w:sectPr>[\s\S]*?<\/w:sectPr>/g);
  assert.equal(sections.length, 3);
  sections.forEach((section) => {
    assert.match(section, /<w:pgSz w:w="11906" w:h="16838" \/>/);
    assert.match(section, /<w:pgMar w:top="1020" w:right="1020" w:bottom="1020" w:left="1020" /);
    // El orden del esquema: tipo, papel, márgenes y columnas.
    const order = ['<w:type', '<w:pgSz', '<w:pgMar', '<w:cols'].map(tag => section.indexOf(tag)).filter(index => index >= 0);
    assert.deepEqual(order, [...order].sort((a, b) => a - b), section);
  });
  // Lo que va detrás del bloque sigue en la misma página.
  assert.match(sections[2], /^<w:sectPr><w:type w:val="continuous" \/>/);
  assert.match(sections[1], /<w:cols w:num="4" w:space="150" \/>/);
});

test('un DOCX sin columnas no cambia de sección', () => {
  const source = '<w:body><w:p /><w:sectPr /></w:body>';
  assert.equal(applyDocxColumnSections(source), source);
});

test('el ODT declara una vez el estilo de cada sección en columnas', () => {
  const content = '<office:document-content><office:automatic-styles><style:style style:name="P1" /></office:automatic-styles>'
    + '<office:body><office:text>'
    + '<text:section text:style-name="EdiMarkdownColumns_4_0.265cm" text:name="EdiMarkdownColumns1"><text:p /></text:section>'
    + '<text:section text:style-name="EdiMarkdownColumns_4_0.265cm" text:name="EdiMarkdownColumns2"><text:p /></text:section>'
    + '<text:section text:style-name="EdiMarkdownColumns_2_1cm_rule" text:name="EdiMarkdownColumns3"><text:p /></text:section>'
    + '</office:text></office:body></office:document-content>';
  const result = applyOdtColumnSections(content);
  assert.equal(result.match(/style:name="EdiMarkdownColumns_4_0.265cm"/g).length, 1);
  assert.match(result, /style:name="EdiMarkdownColumns_4_0.265cm" style:family="section">[\s\S]*?<style:columns fo:column-count="4" fo:column-gap="0.265cm"><\/style:columns>/);
  assert.match(result, /style:name="EdiMarkdownColumns_2_1cm_rule"[\s\S]*?<style:columns fo:column-count="2" fo:column-gap="1cm"><style:column-sep /);
  // Las columnas se equilibran al final, como en la hoja.
  assert.match(result, /text:dont-balance-text-columns="false"/);
  // Los estilos de Pandoc siguen ahí, y una segunda pasada no duplica nada.
  assert.match(result, /<style:style style:name="P1" \/>/);
  assert.equal(applyOdtColumnSections(result), result);
});

