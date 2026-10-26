/*
Formato del texto dentro del DOCX y del ODT.

Ninguno de los dos escritores de Pandoc acepta la alineación, la letra o los
márgenes como metadatos: todo eso sale de su plantilla interna. La única vía
es abrir el archivo que acaba de generar y reescribir sus estilos, que es lo
que se hace aquí —la misma técnica que ya usan `odt-tables.js` y
`odt-formulas.js` para lo que Pandoc no deja arreglar de otro modo.

Solo se toca lo que el usuario haya fijado. Un documento sin formato propio
sale byte a byte como salía antes.

Son funciones de texto a texto, sin ZIP ni DOM, para poder probarlas en Node.
*/
// Word mide en vigésimas de punto, y la letra en medios puntos.
export const TWIPS_PER_CM = 566.9291338582677;
const DOCX_ALIGN = { left: 'start', justify: 'both', right: 'end' };
const ODT_ALIGN = { left: 'start', justify: 'justify', right: 'end' };
// Una sangría clásica de primera línea, en las unidades de cada formato.
export const INDENT_CM = 1.25;

const round = value => Math.round(value);

function escapeXmlAttribute(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ------------------------------------------------------------------ DOCX */

/*
  La plantilla escribe la letra con referencias al tema (`w:asciiTheme`), que
  ganan a cualquier nombre suelto que se añada al lado, así que se sustituyen
  en vez de acompañarlas.
*/
function docxRunDefaults(xml, styles) {
  if (!styles.fontName && !styles.fontSizePt) return xml;
  return xml.replace(/<w:rPrDefault>([\s\S]*?)<\/w:rPrDefault>/, (match, inner) => {
    let updated = inner;
    if (styles.fontName) {
      const font = escapeXmlAttribute(styles.fontName);
      const rFonts = `<w:rFonts w:ascii="${font}" w:cs="${font}" w:eastAsia="${font}" w:hAnsi="${font}" />`;
      updated = /<w:rFonts\b[^>]*\/>/.test(updated)
        ? updated.replace(/<w:rFonts\b[^>]*\/>/, () => rFonts)
        : updated.replace(/<w:rPr>/, () => `<w:rPr>${rFonts}`);
    }
    if (styles.fontSizePt) {
      const halfPoints = round(styles.fontSizePt * 2);
      updated = /<w:sz\b[^>]*\/>/.test(updated)
        ? updated.replace(/<w:sz\b[^>]*\/>/, () => `<w:sz w:val="${halfPoints}" />`)
        : updated.replace(/<w:rPr>/, () => `<w:rPr><w:sz w:val="${halfPoints}" />`);
      updated = /<w:szCs\b[^>]*\/>/.test(updated)
        ? updated.replace(/<w:szCs\b[^>]*\/>/, () => `<w:szCs w:val="${halfPoints}" />`)
        : updated.replace(/<w:sz\b[^>]*\/>/, match2 => `${match2}<w:szCs w:val="${halfPoints}" />`);
    }
    return `<w:rPrDefault>${updated}</w:rPrDefault>`;
  });
}

/*
  Alineación, interlineado y sangría van al párrafo por omisión. El esquema
  de OOXML es una secuencia, no una bolsa: `w:jc` detrás de `w:spacing` y de
  `w:ind`, o Word da el archivo por dañado y se niega a abrirlo.
*/
const DOCX_PPR_ORDER = [
  'w:pStyle', 'w:keepNext', 'w:keepLines', 'w:pageBreakBefore', 'w:framePr',
  'w:widowControl', 'w:numPr', 'w:suppressLineNumbers', 'w:pBdr', 'w:shd',
  'w:tabs', 'w:suppressAutoHyphens', 'w:kinsoku', 'w:wordWrap',
  'w:overflowPunct', 'w:topLinePunct', 'w:autoSpaceDE', 'w:autoSpaceDN',
  'w:bidi', 'w:adjustRightInd', 'w:snapToGrid', 'w:spacing', 'w:ind',
  'w:contextualSpacing', 'w:mirrorIndents', 'w:suppressOverlap', 'w:jc',
  'w:textDirection', 'w:textAlignment', 'w:textboxTightWrap',
  'w:outlineLvl', 'w:divId', 'w:cnfStyle', 'w:rPr', 'w:sectPr', 'w:pPrChange',
];

function docxElementName(element) {
  const match = element.match(/^<([\w:]+)/);
  return match ? match[1] : '';
}

function sortDocxParagraphChildren(elements) {
  return elements
    .map((element, index) => ({ element, index, rank: DOCX_PPR_ORDER.indexOf(docxElementName(element)) }))
    .sort((a, b) => {
      // Lo que no está en la lista conserva su sitio relativo al final.
      const rankA = a.rank === -1 ? DOCX_PPR_ORDER.length : a.rank;
      const rankB = b.rank === -1 ? DOCX_PPR_ORDER.length : b.rank;
      return rankA - rankB || a.index - b.index;
    })
    .map(entry => entry.element);
}

function docxParagraphDefaults(xml, styles) {
  if (!styles.align && !styles.lineHeight && !styles.indent) return xml;
  return xml.replace(/<w:pPrDefault>([\s\S]*?)<\/w:pPrDefault>/, (match, inner) => {
    const pPr = inner.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
    const children = (pPr ? pPr[1] : '').match(/<[\w:]+[^>]*\/>|<([\w:]+)[^>]*>[\s\S]*?<\/\2>/g) || [];

    const kept = children
      .filter(element => !['w:jc', 'w:ind'].includes(docxElementName(element)))
      .map((element) => {
        // El interlineado se suma al `w:spacing` que ya trae la plantilla:
        // dos elementos iguales dejarían el documento fuera del esquema.
        if (docxElementName(element) !== 'w:spacing') return element;
        const cleaned = element.replace(/\s*w:(line|lineRule)="[^"]*"/g, '');
        if (!styles.lineHeight) return cleaned;
        return cleaned.replace(/\s*\/>$/, ` w:line="${round(styles.lineHeight * 240)}" w:lineRule="auto" />`);
      });

    const added = [];
    if (styles.lineHeight && !kept.some(element => docxElementName(element) === 'w:spacing')) {
      added.push(`<w:spacing w:line="${round(styles.lineHeight * 240)}" w:lineRule="auto" />`);
    }
    if (styles.indent) {
      const twips = styles.indent === 'yes' ? round(INDENT_CM * TWIPS_PER_CM) : 0;
      added.push(`<w:ind w:firstLine="${twips}" />`);
    }
    if (styles.align) added.push(`<w:jc w:val="${DOCX_ALIGN[styles.align]}" />`);

    const ordered = sortDocxParagraphChildren([...kept, ...added]);
    return `<w:pPrDefault><w:pPr>${ordered.join('')}</w:pPr></w:pPrDefault>`;
  });
}

/*
  Los encabezados de la plantilla llevan su tamaño en puntos, no en
  proporción al cuerpo, así que con otro tamaño base hay que estirarlos para
  que la jerarquía siga siendo la misma.
*/
function docxHeadingSizes(xml, scale) {
  if (!scale || scale === 1) return xml;
  return xml.replace(
    /<w:style\b[^>]*w:styleId="(Heading\d)"[\s\S]*?<\/w:style>/g,
    style => style.replace(
      /<w:(sz|szCs) w:val="(\d+)" \/>/g,
      (match, tag, value) => `<w:${tag} w:val="${round(Number(value) * scale)}" />`,
    ),
  );
}

function docxHeadingPageBreak(xml, setting) {
  if (!setting) return xml;
  return xml.replace(
    /<w:style\b[^>]*w:styleId="Heading1"[\s\S]*?<\/w:style>/,
    (style) => {
      if (setting === 'no') return style.replace(/<w:pageBreakBefore\b[^>]*\/>/g, '');
      if (/<w:pageBreakBefore\b[^>]*\/>/.test(style)) return style;
      if (/<w:pPr\s*\/>/.test(style)) {
        return style.replace(/<w:pPr\s*\/>/, '<w:pPr><w:pageBreakBefore /></w:pPr>');
      }
      if (/<w:pPr\b[^>]*>/.test(style)) {
        return style.replace(/<\/w:pPr>/, '<w:pageBreakBefore /></w:pPr>');
      }
      return style.replace(/(<w:rPr\b|<\/w:style>)/, '<w:pPr><w:pageBreakBefore /></w:pPr>$1');
    },
  );
}

/*
  El código no se justifica nunca. La alineación del documento va en
  `docDefaults`, así que la hereda todo, y «Source Code» —que no dice nada al
  respecto— la heredaba también: Word escribe el bloque entero como un solo
  párrafo con saltos de línea dentro, de modo que justificarlo estira cada
  línea hasta el margen y deshace las columnas de un texto de ancho fijo. En el
  ODT apenas se nota la justificación porque allí cada línea de código es un
  párrafo suyo, pero una línea que se parta sí se estiraría. Por lo mismo se le
  quita la sangría de primera línea, que en DOCX movería la primera y en ODT
  mueve todas.
*/
function docxCodeAlignment(xml, styles) {
  const alineado = styles.align && styles.align !== 'left';
  const sangrado = styles.indent === 'yes';
  if (!alineado && !sangrado) return xml;
  const propias = [
    ...(alineado ? ['<w:jc w:val="start" />'] : []),
    ...(sangrado ? ['<w:ind w:firstLine="0" />'] : []),
  ];
  return xml.replace(
    /<w:style\b[^>]*w:styleId="SourceCode"[\s\S]*?<\/w:style>/,
    (style) => {
      const pPr = style.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
      const previas = ((pPr ? pPr[1] : '').match(/<[\w:]+[^>]*\/>|<([\w:]+)[^>]*>[\s\S]*?<\/\2>/g) || [])
        .filter(element => !['w:jc', 'w:ind'].includes(docxElementName(element)));
      const cuerpo = `<w:pPr>${sortDocxParagraphChildren([...previas, ...propias]).join('')}</w:pPr>`;
      if (pPr) return style.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, cuerpo);
      if (/<w:pPr\s*\/>/.test(style)) return style.replace(/<w:pPr\s*\/>/, cuerpo);
      return style.replace(/(<w:rPr\b|<\/w:style>)/, `${cuerpo}$1`);
    },
  );
}

/*
  Pandoc escribe cada figura en un párrafo `Figure` —`Captioned Figure` hereda
  de él— y su pie en `Image Caption`. Se centran los dos, sin sangría, igual
  que en la hoja; si el documento justifica o sangra, no les llega.
*/
export function applyDocxFigureAlignment(stylesXml) {
  if (typeof stylesXml !== 'string' || !stylesXml) return stylesXml;
  const propias = ['<w:ind w:firstLine="0" />', '<w:jc w:val="center" />'];
  return stylesXml.replace(
    /<w:style\b[^>]*w:styleId="(?:Figure|ImageCaption)"[\s\S]*?<\/w:style>/g,
    (style) => {
      const pPr = style.match(/<w:pPr>([\s\S]*?)<\/w:pPr>/);
      const previas = ((pPr ? pPr[1] : '').match(/<[\w:]+[^>]*\/>|<([\w:]+)[^>]*>[\s\S]*?<\/\2>/g) || [])
        .filter(element => !['w:jc', 'w:ind'].includes(docxElementName(element)));
      const cuerpo = `<w:pPr>${sortDocxParagraphChildren([...previas, ...propias]).join('')}</w:pPr>`;
      if (pPr) return style.replace(/<w:pPr>[\s\S]*?<\/w:pPr>/, cuerpo);
      if (/<w:pPr\s*\/>/.test(style)) return style.replace(/<w:pPr\s*\/>/, cuerpo);
      return style.replace(/(<w:rPr\b|<\/w:style>)/, `${cuerpo}$1`);
    },
  );
}

export function applyDocxStyles(stylesXml, styles) {
  if (typeof stylesXml !== 'string' || !stylesXml) return stylesXml;
  let updated = docxRunDefaults(stylesXml, styles);
  updated = docxParagraphDefaults(updated, styles);
  updated = docxHeadingSizes(updated, styles.headingScale);
  updated = docxHeadingPageBreak(updated, styles.pageBreakBeforeH1);
  updated = docxCodeAlignment(updated, styles);
  if (styles.fontName) {
    const font = escapeXmlAttribute(styles.fontName);
    updated = updated.replace(
      /<w:style\b[^>]*w:styleId="(?:Hyperlink|FollowedHyperlink)"[\s\S]*?<\/w:style>/g,
      style => {
        const fonts = `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:eastAsia="${font}" w:cs="${font}" />`;
        const clean = style.replace(/<w:rFonts\b[^>]*\/>/g, '');
        if (/<w:rPr>/.test(clean)) return clean.replace('<w:rPr>', `<w:rPr>${fonts}`);
        if (/<w:rPr\s*\/>/.test(clean)) return clean.replace(/<w:rPr\s*\/>/, `<w:rPr>${fonts}</w:rPr>`);
        return clean.replace('</w:style>', `<w:rPr>${fonts}</w:rPr></w:style>`);
      },
    );
  }
  return updated;
}

/*
  Los encabezados no toman su letra de `docDefaults`, sino de las fuentes
  «major» y «minor» del tema, así que cambiar el tema es lo que hace que el
  documento entero use una sola tipografía —igual que en la vista previa.
*/
export function applyDocxTheme(themeXml, fontName) {
  if (typeof themeXml !== 'string' || !themeXml || !fontName) return themeXml;
  const font = escapeXmlAttribute(fontName);
  return themeXml.replace(/<a:(majorFont|minorFont)>([\s\S]*?)<\/a:\1>/g, (match, tag, inner) => {
    const updated = inner.replace(
      /<a:latin\b[^>]*\/>/,
      () => `<a:latin typeface="${font}"/>`,
    );
    return `<a:${tag}>${updated}</a:${tag}>`;
  });
}

/*
  Los hijos de una sección, en el orden que fija el esquema de Word: con
  `w:pgMar` delante de `w:pgSz`, o `w:type` detrás, se niega a abrir el
  documento.
*/
const DOCX_SECTPR_ORDER = [
  'w:headerReference', 'w:footerReference', 'w:footnotePr', 'w:endnotePr',
  'w:type', 'w:pgSz', 'w:pgMar', 'w:paperSrc', 'w:pgBorders', 'w:lnNumType',
  'w:pgNumType', 'w:cols', 'w:formProt', 'w:vAlign', 'w:noEndnote',
  'w:titlePg', 'w:textDirection', 'w:bidi', 'w:rtlGutter', 'w:docGrid',
  'w:printerSettings', 'w:sectPrChange',
];

/*
  Escribe un hijo en cada sección del documento, sustituyendo el que ya
  hubiera. Normalmente solo hay una, al final del cuerpo, y Pandoc la deja
  vacía (`<w:sectPr />`); un bloque en columnas añade las suyas, y el papel y
  los márgenes tienen que ser los mismos en todas.
*/
function setDocxSectionChild(documentXml, name, build) {
  if (!/<w:sectPr\b/.test(documentXml)) {
    return documentXml.replace(/<\/w:body>/, () => `<w:sectPr>${build('')}</w:sectPr></w:body>`);
  }
  return documentXml.replace(
    /<w:sectPr\b([^>]*?)\s*\/>|<w:sectPr\b([^>]*)>([\s\S]*?)<\/w:sectPr>/g,
    (match, emptyAttributes, attributes, inner) => {
      const children = (inner || '').match(/<[\w:]+[^>]*\/>|<([\w:]+)[^>]*>[\s\S]*?<\/\1>/g) || [];
      const previous = children.find(child => docxElementName(child) === name) || '';
      const ordered = [...children.filter(child => docxElementName(child) !== name), build(previous)]
        .map((child, index) => ({ child, index, rank: DOCX_SECTPR_ORDER.indexOf(docxElementName(child)) }))
        .sort((a, b) => {
          const rankA = a.rank === -1 ? DOCX_SECTPR_ORDER.length : a.rank;
          const rankB = b.rank === -1 ? DOCX_SECTPR_ORDER.length : b.rank;
          return rankA - rankB || a.index - b.index;
        })
        .map(entry => entry.child);
      return `<w:sectPr${emptyAttributes ?? attributes}>${ordered.join('')}</w:sectPr>`;
    },
  );
}

// Pulgada arriba, abajo y a los lados, y 1,25 cm para cabecera y pie.
const DOCX_PAGE_MARGIN_ATTRIBUTES = [
  ['top', 1440], ['right', 1440], ['bottom', 1440], ['left', 1440],
  ['header', 708], ['footer', 708], ['gutter', 0],
];

export function applyDocxMargins(documentXml, marginsCm) {
  if (typeof documentXml !== 'string' || !documentXml) return documentXml;
  const sides = Object.keys(marginsCm || {});
  if (!sides.length) return documentXml;
  /*
    El esquema exige los siete atributos. Los lados que el documento no fija
    conservan el valor que ya tuviera la sección o, si no tenía, el que Word
    usa por omisión.
  */
  return setDocxSectionChild(documentXml, 'w:pgMar', (previous) => {
    const attributes = DOCX_PAGE_MARGIN_ATTRIBUTES.map(([side, fallback]) => {
      const own = typeof marginsCm[side] === 'number' ? round(marginsCm[side] * TWIPS_PER_CM) : null;
      const kept = previous.match(new RegExp(`\\sw:${side}="(-?\\d+)"`));
      return ` w:${side}="${own ?? (kept ? kept[1] : fallback)}"`;
    });
    return `<w:pgMar${attributes.join('')} />`;
  });
}

/* El tamaño del papel, en las mismas secciones que los márgenes. */
export function applyDocxPageSize(documentXml, paperCm) {
  if (typeof documentXml !== 'string' || !documentXml) return documentXml;
  if (!paperCm || !paperCm.width || !paperCm.height) return documentXml;
  const orient = paperCm.orientation === 'landscape' ? ' w:orient="landscape"' : '';
  return setDocxSectionChild(
    documentXml,
    'w:pgSz',
    () => `<w:pgSz w:w="${round(paperCm.width * TWIPS_PER_CM)}" w:h="${round(paperCm.height * TWIPS_PER_CM)}"${orient} />`,
  );
}

/*
  Tras un bloque en columnas, el resto del documento es otra sección: la del
  final del cuerpo. Tiene que empezar en la misma página, no en una nueva, que
  es lo que hace Word con una sección que no dice cómo empieza.
*/
export function applyDocxColumnSections(documentXml) {
  if (typeof documentXml !== 'string' || !documentXml) return documentXml;
  if ((documentXml.match(/<w:sectPr\b/g) || []).length < 2) return documentXml;
  const last = documentXml.lastIndexOf('<w:sectPr');
  return documentXml.slice(0, last)
    + setDocxSectionChild(documentXml.slice(last), 'w:type', () => '<w:type w:val="continuous" />');
}

/* Word parte las palabras solo si el documento se lo pide. */
export function applyDocxHyphenation(settingsXml, hyphenate) {
  if (typeof settingsXml !== 'string' || !settingsXml || !hyphenate) return settingsXml;
  const value = hyphenate === 'yes' ? 'true' : 'false';
  if (/<w:autoHyphenation\b[^>]*\/>/.test(settingsXml)) {
    return settingsXml.replace(/<w:autoHyphenation\b[^>]*\/>/, () => `<w:autoHyphenation w:val="${value}" />`);
  }
  return settingsXml.replace(/(<w:settings\b[^>]*>)/, (match, open) => (
    `${open}<w:autoHyphenation w:val="${value}" />`
  ));
}

/* ------------------------------------------------------------------- ODT */

function odtParagraphProperties(styles) {
  const attributes = [];
  if (styles.align) attributes.push(`fo:text-align="${ODT_ALIGN[styles.align]}"`);
  if (styles.lineHeight) attributes.push(`fo:line-height="${round(styles.lineHeight * 100)}%"`);
  if (styles.indent) {
    attributes.push(`fo:text-indent="${styles.indent === 'yes' ? `${INDENT_CM}cm` : '0cm'}"`);
  }
  if (styles.hyphenate) {
    attributes.push(`fo:hyphenate="${styles.hyphenate === 'yes' ? 'true' : 'false'}"`);
    if (styles.hyphenate === 'yes') {
      // Sin mínimos, LibreOffice parte dejando una letra suelta en la línea.
      attributes.push('fo:hyphenation-remain-char-count="2"', 'fo:hyphenation-push-char-count="2"');
    }
  }
  return attributes;
}

function odtTextProperties(styles) {
  const attributes = [];
  if (styles.fontName) {
    const font = escapeXmlAttribute(styles.fontName);
    attributes.push(`style:font-name="${font}"`, `style:font-name-asian="${font}"`, `style:font-name-complex="${font}"`);
  }
  if (styles.fontSizePt) {
    const size = `${styles.fontSizePt}pt`;
    attributes.push(`fo:font-size="${size}"`, `style:font-size-asian="${size}"`, `style:font-size-complex="${size}"`);
  }
  return attributes;
}

/*
  `Preformatted_20_Text` hereda de `Standard`. Pandoc escribe cada línea de
  código del ODT en su propio párrafo, de modo que la sangría de primera línea
  desplaza el bloque entero. La justificación solo se aprecia si una línea se
  parte, pero entonces también deshace las columnas del texto de ancho fijo.
*/
function odtCodeAlignment(xml, styles) {
  const attributes = [];
  if (styles.indent === 'yes') attributes.push('fo:text-indent="0cm"');
  if (styles.align && styles.align !== 'left') attributes.push('fo:text-align="start"');
  if (!attributes.length) return xml;

  const addAttributes = tag => attributes.reduce((updated, declaration) => {
    const name = declaration.slice(0, declaration.indexOf('='));
    const existing = new RegExp(`\\s${name.replace(':', '\\:')}="[^"]*"`);
    if (existing.test(updated)) return updated.replace(existing, ` ${declaration}`);
    return updated.replace(/\s*(\/?>)$/, ` ${declaration} $1`);
  }, tag);

  return xml.replace(
    /<style:style\b(?=[^>]*style:name="Preformatted_20_Text")[^>]*(?:\/>|>[\s\S]*?<\/style:style>)/,
    (style) => {
      if (/^<style:style\b[^>]*\/>$/.test(style)) {
        const open = style.replace(/\s*\/>$/, '>');
        return `${open}<style:paragraph-properties ${attributes.join(' ')} /></style:style>`;
      }
      if (/<style:paragraph-properties\b[^>]*\/\>/.test(style)) {
        return style.replace(/<style:paragraph-properties\b[^>]*\/\>/, addAttributes);
      }
      if (/<style:paragraph-properties\b[^>]*>/.test(style)) {
        return style.replace(/<style:paragraph-properties\b[^>]*>/, addAttributes);
      }
      return style.replace(/(<style:text-properties\b|<\/style:style>)/, `<style:paragraph-properties ${attributes.join(' ')} />$1`);
    },
  );
}

/*
  En el ODT la figura va en `Figure` —`FigureWithCaption` hereda de él— y el
  pie en `FigureCaption`. Se centran igual que en el DOCX.
*/
export function applyOdtFigureAlignment(stylesXml) {
  if (typeof stylesXml !== 'string' || !stylesXml) return stylesXml;
  const attributes = ['fo:text-align="center"', 'fo:text-indent="0cm"'];
  const addAttributes = tag => attributes.reduce((updated, declaration) => {
    const name = declaration.slice(0, declaration.indexOf('='));
    const existing = new RegExp(`\\s${name.replace(':', '\\:')}="[^"]*"`);
    if (existing.test(updated)) return updated.replace(existing, ` ${declaration}`);
    return updated.replace(/\s*(\/?>)$/, ` ${declaration} $1`);
  }, tag);
  return stylesXml.replace(
    /<style:style\b(?=[^>]*style:name="(?:Figure|FigureCaption)")[^>]*?(?:\/>|>[\s\S]*?<\/style:style>)/g,
    (style) => {
      if (/^<style:style\b[^>]*\/>$/.test(style)) {
        const open = style.replace(/\s*\/>$/, '>');
        return `${open}<style:paragraph-properties ${attributes.join(' ')} /></style:style>`;
      }
      if (/<style:paragraph-properties\b[^>]*\/?>/.test(style)) {
        return style.replace(/<style:paragraph-properties\b[^>]*?\/?>/, addAttributes);
      }
      return style.replace(/(<style:text-properties\b|<\/style:style>)/, `<style:paragraph-properties ${attributes.join(' ')} />$1`);
    },
  );
}

/*
  Todo cuelga de `Standard`, que Pandoc deja vacío y autocerrado. Los
  encabezados heredan de `Heading`, cuyo tamaño sí es absoluto: los `115%` de
  «Heading 1» se miden contra él, así que basta con estirar ese.
*/
export function applyOdtStyles(stylesXml, styles) {
  if (typeof stylesXml !== 'string' || !stylesXml) return stylesXml;
  const paragraph = odtParagraphProperties(styles);
  const text = odtTextProperties(styles);
  let updated = stylesXml;

  if (paragraph.length || text.length) {
    const body = [
      paragraph.length ? `<style:paragraph-properties ${paragraph.join(' ')} />` : '',
      text.length ? `<style:text-properties ${text.join(' ')} />` : '',
    ].join('');
    const openTag = /<style:style([^>]*style:name="Standard"[^>]*?)\s*\/>/;
    if (openTag.test(updated)) {
      updated = updated.replace(openTag, (match, attributes) => (
        `<style:style${attributes}>${body}</style:style>`
      ));
    } else {
      updated = updated.replace(
        /(<style:style[^>]*style:name="Standard"[^>]*>)/,
        (match, open) => `${open}${body}`,
      );
    }
  }

  if (styles.fontName) {
    // Un nombre sin declarar deja a LibreOffice adivinando la tipografía.
    const font = escapeXmlAttribute(styles.fontName);
    if (!new RegExp(`<style:font-face[^>]*style:name="${font}"`).test(updated)) {
      updated = updated.replace(
        /(<office:font-face-decls\b[^>]*>)/,
        (match, open) => `${open}<style:font-face style:name="${font}" svg:font-family="${font}" />`,
      );
    }
  }

  if (styles.fontName) {
    // Character styles need their own font: the default text style can
    // otherwise take precedence over the surrounding paragraph in LibreOffice.
    const linkFont = escapeXmlAttribute(styles.fontName);
    updated = updated.replace(
      /<style:style\b[^>]*style:name="(?:Internet_20_link|Visited_20_Internet_20_Link)"[^>]*>[\s\S]*?<\/style:style>/g,
      style => {
        const attrs = ['style:font-name', 'style:font-name-asian', 'style:font-name-complex']
          .map(name => `${name}="${linkFont}"`).join(' ');
        const clean = style.replace(/\s(?:style:font-name(?:-asian|-complex)?|fo:font-family)="[^"]*"/g, '');
        if (/<style:text-properties\b/.test(clean)) {
          return clean.replace('<style:text-properties', `<style:text-properties ${attrs}`);
        }
        return clean.replace('</style:style>', `<style:text-properties ${attrs} /></style:style>`);
      },
    );
    // «Heading» declara su propia tipografía, así que no hereda la de Standard.
    const font = escapeXmlAttribute(styles.fontName);
    updated = updated.replace(
      /(<style:style[^>]*style:name="Heading"[^>]*>[\s\S]*?<\/style:style>)/,
      heading => heading.replace(
        /(style:font-name|style:font-name-asian|style:font-name-complex)="[^"]*"/g,
        (match, attribute) => `${attribute}="${font}"`,
      ),
    );
  }

  if (styles.headingScale && styles.headingScale !== 1) {
    updated = updated.replace(
      /(<style:style[^>]*style:name="Heading"[^>]*>[\s\S]*?<\/style:style>)/,
      heading => heading.replace(
        /(fo:font-size|style:font-size-asian|style:font-size-complex)="([\d.]+)pt"/g,
        (match, attribute, value) => (
          `${attribute}="${Number((Number(value) * styles.headingScale).toFixed(1))}pt"`
        ),
      ),
    );
  }
  if (styles.pageBreakBeforeH1) {
    updated = updated.replace(
      /(<style:style[^>]*style:name="Heading_20_1"[^>]*>)([\s\S]*?)(<\/style:style>)/,
      (match, open, body, close) => {
        if (styles.pageBreakBeforeH1 === 'no') {
          return `${open}${body.replace(/\s*fo:break-before="page"/g, '')}${close}`;
        }
        if (/fo:break-before="page"/.test(body)) return match;
        if (/<style:paragraph-properties\b[^>]*\/>/.test(body)) {
          return `${open}${body.replace(/<style:paragraph-properties\b([^>]*)\/>/, '<style:paragraph-properties$1 fo:break-before="page" />')}${close}`;
        }
        if (/<style:paragraph-properties\b[^>]*>/.test(body)) {
          return `${open}${body.replace(/<style:paragraph-properties\b([^>]*)>/, '<style:paragraph-properties$1 fo:break-before="page">')}${close}`;
        }
        return `${open}<style:paragraph-properties fo:break-before="page" />${body}${close}`;
      },
    );
  }
  return odtCodeAlignment(updated, styles);
}

/*
  El tamaño del papel del ODT, en la misma disposición de página que los
  márgenes. La orientación se escribe también: LibreOffice la deduce de las dos
  medidas, pero dejarla dicha evita que una plantilla apaisada mande sobre un
  documento vertical.
*/
export function applyOdtPageSize(stylesXml, paperCm) {
  if (typeof stylesXml !== 'string' || !stylesXml) return stylesXml;
  if (!paperCm || !paperCm.width || !paperCm.height) return stylesXml;
  return stylesXml.replace(/<style:page-layout-properties\b[^>]*>/, (properties) => {
    let updated = properties;
    [
      ['fo:page-width', `${paperCm.width}cm`],
      ['fo:page-height', `${paperCm.height}cm`],
      ['style:print-orientation', paperCm.orientation === 'landscape' ? 'landscape' : 'portrait'],
    ].forEach(([name, value]) => {
      const declaration = `${name}="${value}"`;
      const existing = new RegExp(`${name.replace(':', '\\:')}="[^"]*"`);
      updated = existing.test(updated)
        ? updated.replace(existing, () => declaration)
        : updated.replace(/^<style:page-layout-properties/, match => `${match} ${declaration}`);
    });
    return updated;
  });
}

/* La caja de la página, en la disposición que declara el propio archivo. */
export function applyOdtMargins(stylesXml, marginsCm) {
  if (typeof stylesXml !== 'string' || !stylesXml) return stylesXml;
  const sides = Object.keys(marginsCm || {});
  if (!sides.length) return stylesXml;
  return stylesXml.replace(/<style:page-layout-properties\b[^>]*>/, (properties) => {
    let updated = properties;
    sides.forEach((side) => {
      const declaration = `fo:margin-${side}="${marginsCm[side]}cm"`;
      const existing = new RegExp(`fo:margin-${side}="[^"]*"`);
      updated = existing.test(updated)
        ? updated.replace(existing, () => declaration)
        : updated.replace(/^<style:page-layout-properties/, match => `${match} ${declaration}`);
    });
    return updated;
  });
}

/*
  Las secciones en columnas del ODT. Pandoc escribe la sección tal cual, pero
  su estilo tiene que estar entre los automáticos del contenido, que genera
  Pandoc; se añade aquí, con las medidas que lleva el propio nombre
  (`odtColumnStyleName`). Las columnas se equilibran al final, como en la hoja.
*/
export function applyOdtColumnSections(contentXml) {
  if (typeof contentXml !== 'string' || !contentXml) return contentXml;
  const names = new Set(
    [...contentXml.matchAll(/<text:section\b[^>]*text:style-name="(EdiMarkdownColumns_\d+_[\d.]+cm(?:_rule)?)"/g)]
      .map(match => match[1])
      .filter(name => !new RegExp(`<style:style\\b[^>]*style:name="${name.replace(/\./g, '\\.')}"`).test(contentXml)),
  );
  if (!names.size) return contentXml;
  const styles = [...names].map((name) => {
    const [, count, gap, rule] = name.match(/^EdiMarkdownColumns_(\d+)_([\d.]+cm)(_rule)?$/);
    const separator = rule
      ? '<style:column-sep style:width="0.02cm" style:color="#000000" style:height="100%" style:vertical-align="top" />'
      : '';
    return `<style:style style:name="${name}" style:family="section">`
      + '<style:section-properties text:dont-balance-text-columns="false" style:editable="false">'
      + `<style:columns fo:column-count="${count}" fo:column-gap="${gap}">${separator}</style:columns>`
      + '</style:section-properties></style:style>';
  }).join('');
  if (/<office:automatic-styles\s*\/>/.test(contentXml)) {
    return contentXml.replace(/<office:automatic-styles\s*\/>/, () => `<office:automatic-styles>${styles}</office:automatic-styles>`);
  }
  if (/<office:automatic-styles\b[^>]*>/.test(contentXml)) {
    return contentXml.replace(/(<office:automatic-styles\b[^>]*>)/, (match, open) => `${open}${styles}`);
  }
  return contentXml.replace(/(<office:body\b)/, (match, body) => `<office:automatic-styles>${styles}</office:automatic-styles>${body}`);
}
