/*
  Formato del documento: alineación, letra, interlineado, márgenes, sangría y
  partición de palabras.

  Son ajustes que no cambian el Markdown, solo cómo se ve el texto: viajan en el
  bloque de metadatos del propio documento —igual que el idioma y el autor— y
  desde ahí llegan a la vista previa y a las cinco exportaciones. Cada ajuste
  admite quedarse vacío, que significa «lo que decidan las opciones generales»,
  y si tampoco hay valor general no se escribe nada: un documento de siempre se
  exporta exactamente igual que antes.

  Las claves son las de Pandoc siempre que existan (`fontsize`, `linestretch`,
  `indent`, `margin-*`), porque así el escritor de LaTeX las aprovecha solo.
  `align`, `font` y `hyphenate` no existen en Pandoc y las traduce cada
  exportador: `font: serif` como nombre de paquete LaTeX sería un error de
  compilación, de ahí que no se use la variable `fontfamily` de Pandoc.

  Aquí viven solo el modelo y sus conversiones, sin DOM, para poder probarlas
  con `node --test`.
*/
(function initDocumentFormat(root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  } else {
    root.EdiMarkDocumentFormat = exported;
  }
}(typeof window !== 'undefined' ? window : globalThis, function documentFormatFactory() {
  const ALIGNMENTS = ['left', 'justify', 'right'];
  const FONT_KINDS = ['serif', 'sans', 'mono'];
  const ORIENTATIONS = ['portrait', 'landscape'];
  /*
    El pie que la hoja pone al imprimir: nada, el número de página, o el nombre
    del documento y el número. Es cosa del papel que sale del navegador; los
    formatos de oficina no lo reciben.
  */
  const PRINT_FOOTERS = ['none', 'page', 'name'];
  /*
    Y la cabecera: nada, el nombre del documento, la fecha en que se imprime o
    las dos cosas. Como el pie, es cosa del papel que sale del navegador.
  */
  const PRINT_HEADERS = ['none', 'name', 'date', 'name-date'];

  /*
    Familias genéricas en vez de nombres sueltos: cada formato de salida entiende
    una cosa distinta, y un «Calibri» escrito a mano no significa nada para
    LaTeX. Quien quiera una tipografía concreta la escribe igualmente y solo la
    respetarán los formatos que sepan resolverla.
  */
  const FONT_STACKS = {
    serif: {
      css: 'Georgia, "Times New Roman", serif',
      office: 'Times New Roman',
      latexPackage: 'newtxtext',
    },
    sans: {
      css: 'Inter, Arial, Helvetica, sans-serif',
      office: 'Arial',
      latexPackage: 'helvet',
    },
    mono: {
      css: '"Fira Code", "Courier New", monospace',
      office: 'Courier New',
      latexPackage: 'courier',
    },
  };

  /*
    Tamaños de papel. Son los dos que usa casi todo el mundo —A4 en Europa y
    América Latina, Carta en Estados Unidos y buena parte de Centroamérica—, y
    lo que deciden es dónde parte la página: sin saber cuánto mide el papel, la
    hoja de la vista previa no puede enseñar por dónde va a cortar.
  */
  const PAPER_SIZES = {
    a4: { widthCm: 21, heightCm: 29.7, css: 'A4', latex: 'a4' },
    letter: { widthCm: 21.59, heightCm: 27.94, css: 'Letter', latex: 'letter' },
  };

  // Los márgenes se guardan en centímetros, que es como se piden en pantalla.
  const MARGIN_SIDES = ['top', 'right', 'bottom', 'left'];
  const MARGIN_MIN_CM = 0;
  const MARGIN_MAX_CM = 15;
  const FONT_SIZE_MIN_PT = 5;
  const FONT_SIZE_MAX_PT = 72;
  const LINE_HEIGHT_MIN = 0.8;
  const LINE_HEIGHT_MAX = 4;

  /*
    La plantilla del DOCX mide los encabezados en puntos, no en proporción al
    cuerpo, así que subir el texto a 14 pt sin tocarlos aplasta la jerarquía.
    Este es el tamaño base de esa plantilla, contra el que se calcula cuánto
    hay que escalarlos. En HTML, EPUB y LaTeX no hace falta: allí los
    encabezados ya se miden en `em` y siguen al cuerpo solos.
  */
  const OFFICE_BASE_FONT_PT = 12;

  const EMPTY = {
    align: '',
    font: '',
    fontSize: '',
    lineHeight: '',
    paperSize: '',
    orientation: '',
    marginTop: '',
    marginRight: '',
    marginBottom: '',
    marginLeft: '',
    indent: '',
    hyphenate: '',
    pageBreakBeforeH1: '',
    printHeader: '',
    printFooter: '',
  };

  function marginKey(side) {
    return `margin${side[0].toUpperCase()}${side.slice(1)}`;
  }

  /* Un número dentro de un rango, o cadena vacía si no lo es. */
  function normalizeNumber(value, { min, max, decimals = 2 } = {}) {
    if (value === null || typeof value === 'undefined') return '';
    const raw = String(value).trim().replace(',', '.');
    if (!raw) return '';
    const number = Number.parseFloat(raw);
    if (!Number.isFinite(number)) return '';
    if (typeof min === 'number' && number < min) return '';
    if (typeof max === 'number' && number > max) return '';
    // Sin ceros de relleno: 1.50 se guarda como 1.5 y 12.0 como 12.
    return String(Number(number.toFixed(decimals)));
  }

  /* Los interruptores admiten sí, no o nada: vacío significa heredar. */
  function normalizeSwitch(value) {
    if (value === true) return 'yes';
    if (value === false) return 'no';
    const raw = String(value ?? '').trim().toLowerCase();
    if (['yes', 'true', 'sí', 'si', '1'].includes(raw)) return 'yes';
    if (['no', 'false', '0'].includes(raw)) return 'no';
    return '';
  }

  function normalizePaperSize(value) {
    const raw = String(value ?? '').trim().toLowerCase().replace(/paper$/, '');
    // `a4paper` y `letterpaper` son como lo escribe LaTeX, y alguien puede
    // haberlo copiado de ahí al bloque de metadatos.
    return Object.prototype.hasOwnProperty.call(PAPER_SIZES, raw) ? raw : '';
  }

  function normalizeFont(value) {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const lowered = raw.toLowerCase();
    if (FONT_KINDS.includes(lowered)) return lowered;
    // Cualquier otra cosa es el nombre de una tipografía concreta.
    return raw;
  }

  /*
    Deja el conjunto en su forma canónica y descarta lo que no se entiende, que
    es tanto lo que teclee un usuario en el bloque de metadatos como lo que
    llegue de una versión anterior de la aplicación.
  */
  function normalizeDocumentFormat(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const alignment = String(source.align ?? '').trim().toLowerCase();
    const format = {
      ...EMPTY,
      align: ALIGNMENTS.includes(alignment) ? alignment : '',
      font: normalizeFont(source.font),
      fontSize: normalizeNumber(source.fontSize, {
        min: FONT_SIZE_MIN_PT,
        max: FONT_SIZE_MAX_PT,
        decimals: 1,
      }),
      lineHeight: normalizeNumber(source.lineHeight, {
        min: LINE_HEIGHT_MIN,
        max: LINE_HEIGHT_MAX,
      }),
      paperSize: normalizePaperSize(source.paperSize),
      orientation: ORIENTATIONS.includes(String(source.orientation ?? '').trim().toLowerCase())
        ? String(source.orientation).trim().toLowerCase()
        : '',
      indent: normalizeSwitch(source.indent),
      hyphenate: normalizeSwitch(source.hyphenate),
      pageBreakBeforeH1: normalizeSwitch(source.pageBreakBeforeH1),
      printHeader: PRINT_HEADERS.includes(String(source.printHeader ?? '').trim().toLowerCase())
        ? String(source.printHeader).trim().toLowerCase()
        : '',
      printFooter: PRINT_FOOTERS.includes(String(source.printFooter ?? '').trim().toLowerCase())
        ? String(source.printFooter).trim().toLowerCase()
        : '',
    };
    MARGIN_SIDES.forEach((side) => {
      format[marginKey(side)] = normalizeNumber(source[marginKey(side)], {
        min: MARGIN_MIN_CM,
        max: MARGIN_MAX_CM,
      });
    });
    return format;
  }

  /* Lo que el documento no diga lo pone el ajuste general. */
  function resolveDocumentFormat(general = {}, own = {}) {
    const base = normalizeDocumentFormat(general);
    const document = normalizeDocumentFormat(own);
    const resolved = { ...base };
    Object.keys(EMPTY).forEach((key) => {
      if (document[key] !== '') resolved[key] = document[key];
    });
    return resolved;
  }

  function isEmptyFormat(format) {
    const normalized = normalizeDocumentFormat(format);
    return Object.keys(EMPTY).every(key => normalized[key] === '');
  }

  /* La clave YAML de cada ajuste, en el orden en que se escriben. */
  const YAML_KEYS = [
    ['align', 'align'],
    ['font', 'font'],
    ['fontSize', 'fontsize'],
    ['lineHeight', 'linestretch'],
    ['paperSize', 'papersize'],
    ['orientation', 'orientation'],
    ['marginTop', 'margin-top'],
    ['marginRight', 'margin-right'],
    ['marginBottom', 'margin-bottom'],
    ['marginLeft', 'margin-left'],
    ['indent', 'indent'],
    ['hyphenate', 'hyphenate'],
    ['pageBreakBeforeH1', 'pagebreak-before-h1'],
    ['printHeader', 'print-header'],
    ['printFooter', 'print-footer'],
  ];

  const UNITS = { fontSize: 'pt', marginTop: 'cm', marginRight: 'cm', marginBottom: 'cm', marginLeft: 'cm' };

  function yamlValue(field, value) {
    if (field === 'indent' || field === 'hyphenate' || field === 'pageBreakBeforeH1') {
      return value === 'yes' ? 'true' : 'false';
    }
    const unit = UNITS[field];
    return unit ? `"${value}${unit}"` : `"${value}"`;
  }

  /*
    Solo lo que tenga valor: un ajuste vacío no debe ocupar una línea en el
    bloque de metadatos ni, sobre todo, tapar el valor general con un hueco.
  */
  function toFrontMatterEntries(format) {
    const normalized = normalizeDocumentFormat(format);
    return YAML_KEYS
      .filter(([field]) => normalized[field] !== '')
      .map(([field, key]) => ({ key, lines: [`${key}: ${yamlValue(field, normalized[field])}`] }));
  }

  /*
    Lee del bloque de metadatos lo que el documento declare por su cuenta. Las
    unidades se aceptan escritas o no (`12pt` y `12` valen igual) porque el
    bloque lo puede haber tecleado una persona.
  */
  function readFromFrontMatter(frontMatter) {
    const source = typeof frontMatter === 'string' ? frontMatter : '';
    const found = {};
    YAML_KEYS.forEach(([field, key]) => {
      const match = source.match(new RegExp(`^${key}\\s*:\\s*(.*)$`, 'm'));
      if (!match) return;
      const raw = match[1].trim().replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '');
      if (!raw) return;
      found[field] = UNITS[field] ? raw.replace(new RegExp(`${UNITS[field]}$`, 'i'), '') : raw;
    });
    return normalizeDocumentFormat(found);
  }

  /*
    Propiedades CSS para la vista previa. Los encabezados no aparecen aquí: la
    hoja de estilos ya los mide en `em`, así que siguen al cuerpo solos. En los
    formatos de salida, donde el tamaño es absoluto, hace falta HEADING_SCALE.
  */
  function toPreviewStyles(format) {
    const resolved = normalizeDocumentFormat(format);
    const styles = {};
    if (resolved.align) styles['text-align'] = resolved.align;
    if (resolved.font) {
      const stack = FONT_STACKS[resolved.font];
      styles['font-family'] = stack ? stack.css : `"${resolved.font}", serif`;
    }
    /*
      El tamaño y los márgenes del documento van en puntos y centímetros, que no
      escalan solos con la lupa de la vista previa como sí lo hace todo lo que
      está en `em`. Se multiplican aquí por `--preview-zoom`, que vale 1 cuando
      nadie la ha tocado, para que la hoja crezca entera y no a trozos. Es cosa
      de la vista previa: `toCssRules` y `toLatex`, que sí salen del programa,
      siguen escribiendo la medida desnuda.
    */
    /*
      El papel, en variables: la hoja se mide con ellas —ancho de la página y
      alto de la caja de texto— y con eso puede enseñar por dónde cortará. Van
      en centímetros porque el navegador ya sabe convertirlos, y la lupa las
      escala aparte para no perder la medida real.
    */
    if (resolved.paperSize) {
      const paper = PAPER_SIZES[resolved.paperSize];
      const landscape = resolved.orientation === 'landscape';
      styles['--paper-width'] = `${landscape ? paper.heightCm : paper.widthCm}cm`;
      styles['--paper-height'] = `${landscape ? paper.widthCm : paper.heightCm}cm`;
    }
    if (resolved.fontSize) styles['font-size'] = `calc(${resolved.fontSize}pt * var(--preview-zoom, 1))`;
    if (resolved.lineHeight) styles['line-height'] = resolved.lineHeight;
    /*
      La sangría, en una variable propia y no en `text-indent`: esa se hereda,
      y puesta en el contenedor de la hoja sangraba también los encabezados,
      las citas y cada elemento de lista. Lo exportado no hace eso —la regla de
      HTML y EPUB dice `p`—, así que la vista previa enseñaba una sangría que
      no salía por ninguna parte. La hoja de estilos la aplica a los párrafos.
    */
    if (resolved.indent) styles['--doc-indent'] = resolved.indent === 'yes' ? '1.5em' : '0';
    if (resolved.hyphenate) styles.hyphens = resolved.hyphenate === 'yes' ? 'auto' : 'manual';
    // Los márgenes de página se sugieren como relleno: la vista previa es una
    // columna de texto, no una hoja, y sin esto el ajuste sería invisible.
    MARGIN_SIDES.forEach((side) => {
      const value = resolved[marginKey(side)];
      if (value) styles[`padding-${side}`] = `calc(${value}cm * var(--preview-zoom, 1))`;
    });
    return styles;
  }

  /* Los tamaños que aceptan article, report y book sin paquetes de por medio. */
  const LATEX_STANDARD_SIZES = ['10', '11', '12'];

  /* Hoja de estilos para HTML y EPUB. */
  function toCssRules(format) {
    const resolved = normalizeDocumentFormat(format);
    const body = [];
    if (resolved.align) body.push(`text-align: ${resolved.align};`);
    if (resolved.font) {
      const stack = FONT_STACKS[resolved.font];
      body.push(`font-family: ${stack ? stack.css : `"${resolved.font}", serif`};`);
    }
    if (resolved.fontSize) body.push(`font-size: ${resolved.fontSize}pt;`);
    if (resolved.lineHeight) body.push(`line-height: ${resolved.lineHeight};`);
    if (resolved.hyphenate) {
      const value = resolved.hyphenate === 'yes' ? 'auto' : 'manual';
      // Los prefijos siguen haciendo falta en los lectores de EPUB antiguos.
      body.push(`-webkit-hyphens: ${value};`, `-epub-hyphens: ${value};`, `hyphens: ${value};`);
    }

    const rules = [];
    if (body.length) rules.push(`body {\n  ${body.join('\n  ')}\n}`);
    if (resolved.font) rules.push('a { font-family: inherit; }');
    // El tamaño de la página lo entienden la impresión del navegador y los
    // lectores de EPUB que paginan.
    if (resolved.paperSize) {
      const orientation = resolved.orientation ? ` ${resolved.orientation}` : '';
      rules.push(`@page {\n  size: ${PAPER_SIZES[resolved.paperSize].css}${orientation};\n}`);
    }
    if (resolved.indent) {
      rules.push(`p {\n  text-indent: ${resolved.indent === 'yes' ? '1.5em' : '0'};\n}`);
    }
    if (resolved.pageBreakBeforeH1 === 'yes') {
      rules.push('body > h1:not(:first-of-type) {\n  break-before: page;\n  page-break-before: always;\n}');
    }
    const margins = MARGIN_SIDES
      .map(side => [side, resolved[marginKey(side)]])
      .filter(([, value]) => value);
    if (margins.length) {
      // `@page` es lo que respetan la impresión del navegador y los lectores
      // que paginan; el relleno del cuerpo cubre a los que no.
      const declarations = margins.map(([side, value]) => `margin-${side}: ${value}cm;`);
      rules.push(`@page {\n  ${declarations.join('\n  ')}\n}`);
      rules.push(`body {\n  ${margins.map(([side, value]) => `padding-${side}: ${value}cm;`).join('\n  ')}\n}`);
    }
    return rules.join('\n');
  }

  /*
    Para LaTeX, lo que Pandoc ya sabe escribir viaja como metadato y el resto
    como preámbulo. `fontsize` solo vale 10, 11 o 12 en las clases estándar: con
    cualquier otro tamaño Pandoc lo descarta en silencio, así que ahí entra el
    paquete `fontsize`, que sí acepta cualquier valor.
  */
  function toLatex(format, { hasGeometry = false } = {}) {
    const resolved = normalizeDocumentFormat(format);
    const entries = [];
    const preamble = [];
    const dropped = [];

    if (resolved.fontSize) {
      if (LATEX_STANDARD_SIZES.includes(resolved.fontSize)) {
        entries.push({ key: 'fontsize', lines: [`fontsize: "${resolved.fontSize}pt"`] });
      } else {
        preamble.push(`\\usepackage[fontsize=${resolved.fontSize}pt]{fontsize}`);
      }
    }
    if (resolved.lineHeight) {
      entries.push({ key: 'linestretch', lines: [`linestretch: "${resolved.lineHeight}"`] });
    }
    /*
      El papel va con los márgenes: los dos los resuelve `geometry`, así que si
      el preámbulo del usuario ya lo carga, este también se queda fuera.
    */
    if (resolved.paperSize) {
      if (hasGeometry) {
        dropped.push('papersize');
      } else {
        entries.push({
          key: 'papersize',
          lines: [`papersize: "${PAPER_SIZES[resolved.paperSize].latex}"`],
        });
      }
    }
    if (resolved.orientation === 'landscape') {
      if (hasGeometry) {
        dropped.push('orientation');
      } else {
        entries.push({ key: 'geometry', lines: ['geometry: "landscape"'] });
      }
    }
    if (resolved.indent) {
      entries.push({ key: 'indent', lines: [`indent: ${resolved.indent === 'yes' ? 'true' : 'false'}`] });
    }
    if (resolved.font) {
      const stack = FONT_STACKS[resolved.font];
      if (stack) {
        preamble.push(`\\usepackage{${stack.latexPackage}}`);
        if (resolved.font === 'sans') preamble.push('\\renewcommand{\\familydefault}{\\sfdefault}');
        if (resolved.font === 'mono') preamble.push('\\renewcommand{\\familydefault}{\\ttdefault}');
      } else {
        // Un nombre suelto solo lo resuelven XeLaTeX y LuaLaTeX.
        entries.push({ key: 'mainfont', lines: [`mainfont: "${resolved.font}"`] });
      }
    }
    if (resolved.font) preamble.push('\\AtBeginDocument{\\urlstyle{same}}');
    // En LaTeX el texto ya sale justificado: lo que hay que decir es lo otro.
    if (resolved.align === 'left') preamble.push('\\usepackage[document]{ragged2e}');
    if (resolved.align === 'right') {
      preamble.push('\\usepackage{ragged2e}', '\\AtBeginDocument{\\RaggedLeft}');
    }
    if (resolved.hyphenate === 'no') {
      preamble.push('\\hyphenpenalty=10000', '\\exhyphenpenalty=10000');
    }

    MARGIN_SIDES.forEach((side) => {
      const value = resolved[marginKey(side)];
      if (!value) return;
      // Pandoc traduce estas variables a `geometry`; si el preámbulo del
      // usuario ya lo carga, cargarlo dos veces aborta la compilación.
      if (hasGeometry) {
        dropped.push(`margin-${side}`);
        return;
      }
      entries.push({ key: `margin-${side}`, lines: [`margin-${side}: "${value}cm"`] });
    });

    return { entries, preamble, dropped };
  }

  /*
    Lo que necesitan DOCX y ODT, ya en sus unidades: los dos miden la letra en
    medios puntos o en puntos y los márgenes en twips o en centímetros, pero eso
    lo resuelve cada escritor.
  */
  function toOfficeStyles(format) {
    const resolved = normalizeDocumentFormat(format);
    const stack = FONT_STACKS[resolved.font];
    const margins = {};
    MARGIN_SIDES.forEach((side) => {
      const value = resolved[marginKey(side)];
      if (value) margins[side] = Number(value);
    });
    const paper = PAPER_SIZES[resolved.paperSize];
    const landscape = resolved.orientation === 'landscape';
    return {
      align: resolved.align || '',
      paperCm: paper ? {
        width: landscape ? paper.heightCm : paper.widthCm,
        height: landscape ? paper.widthCm : paper.heightCm,
        orientation: landscape ? 'landscape' : 'portrait',
      } : null,
      fontName: resolved.font ? (stack ? stack.office : resolved.font) : '',
      fontSizePt: resolved.fontSize ? Number(resolved.fontSize) : 0,
      // Cuánto hay que estirar los encabezados de la plantilla para que la
      // jerarquía siga siendo la misma con el cuerpo en otro tamaño.
      headingScale: resolved.fontSize ? Number(resolved.fontSize) / OFFICE_BASE_FONT_PT : 0,
      lineHeight: resolved.lineHeight ? Number(resolved.lineHeight) : 0,
      marginsCm: margins,
      indent: resolved.indent,
      hyphenate: resolved.hyphenate,
      pageBreakBeforeH1: resolved.pageBreakBeforeH1,
    };
  }

  return {
    ALIGNMENTS,
    FONT_KINDS,
    ORIENTATIONS,
    PRINT_FOOTERS,
    PRINT_HEADERS,
    FONT_STACKS,
    PAPER_SIZES,
    MARGIN_SIDES,
    OFFICE_BASE_FONT_PT,
    YAML_KEYS,
    marginKey,
    normalizeDocumentFormat,
    resolveDocumentFormat,
    isEmptyFormat,
    toFrontMatterEntries,
    readFromFrontMatter,
    toPreviewStyles,
    toCssRules,
    toLatex,
    toOfficeStyles,
  };
}));
