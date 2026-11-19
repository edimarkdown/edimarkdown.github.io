/*
  Perfiles de formato: un juego de ajustes con nombre —«TFG», «apuntes»— que se
  puede aplicar a cualquier documento.

  Un perfil no es una capa más de herencia. Aplicarlo copia sus valores al
  documento, exactamente igual que si se hubieran escrito a mano en el bloque de
  metadatos, de manera que el `.md` sigue valiendo por sí solo y Pandoc lo
  entiende sin la aplicación. Lo único que queda dicho aparte es de dónde salió
  el perfil, para poder volver a aplicarlo y para avisar cuando el documento se
  ha apartado de él.

  Solo entra aquí lo que se repite entre documentos: formato, índice y
  numeración, estilo de citas y opciones de LaTeX. La bibliografía en sí, la
  portada del EPUB y el autor son de cada documento o de cada persona, no de un
  perfil.

  Un perfil también se guarda como archivo YAML, que es lo que se comparte. El
  lector de más abajo no es un analizador de YAML completo a propósito: entiende
  las dos formas que este archivo necesita —pares `clave: valor` en dos niveles y
  bloques literales `|`— y rechaza el resto con un aviso claro en vez de adivinar.

  Aquí viven solo el modelo y sus conversiones, sin DOM, para poder probarlas
  con `node --test`.
*/
(function initFormatProfiles(root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  // `document-format.js` ya sabe normalizar el formato y conoce sus claves
  // YAML: el perfil las reutiliza en lugar de inventarse un vocabulario propio.
  const documentFormat = isNode
    ? require('./document-format.js')
    : root.EdiMarkDocumentFormat;
  const exported = factory(documentFormat);
  if (isNode) module.exports = exported;
  else root.EdiMarkFormatProfiles = exported;
}(typeof window !== 'undefined' ? window : globalThis, function formatProfilesFactory(documentFormat) {
  const PROFILE_VERSION = 1;
  const PROFILE_KEY = 'edimark-profile';
  const MAX_NAME_LENGTH = 60;

  const CITATION_STYLES = ['apa', 'chicago-author-date', 'modern-language-association', 'ieee', 'custom'];
  const DOCUMENT_CLASSES = ['article', 'report', 'book'];

  /*
    Las claves de índice y numeración se repiten de `pandoc-prepare.js` en vez de
    importarse: aquel es un módulo ESM que la página carga aparte, y este viaja
    en un `<script>` normal. Son tres nombres y su forma no cambia.
  */
  const OUTLINE_KEYS = [
    ['toc', 'toc'],
    ['tocDepth', 'toc-depth'],
    ['numberSections', 'numbersections'],
  ];

  const CITATION_KEYS = [
    ['style', 'style'],
    ['title', 'title'],
    ['headingLevel', 'heading-level'],
    ['cslName', 'csl-name'],
    ['cslContent', 'csl'],
  ];

  const LATEX_KEYS = [
    ['documentClass', 'documentclass'],
    ['classOptions', 'classoptions'],
    ['preamble', 'preamble'],
  ];

  // Los campos que se escriben como bloque literal porque pueden tener saltos
  // de línea; el resto siempre cabe en una línea.
  const BLOCK_FIELDS = ['latex.preamble', 'citations.cslContent'];

  function text(value) {
    return String(value ?? '').replace(/\r\n?/g, '\n').trim();
  }

  function line(value) {
    return text(value).replace(/\s+/g, ' ');
  }

  /* `true`, `false` o vacío, que significa «el perfil no se pronuncia». */
  function normalizeSwitch(value) {
    if (value === true) return true;
    if (value === false) return false;
    const raw = line(value).toLowerCase().replace(/^["']|["']$/g, '');
    if (!raw) return '';
    if (['yes', 'true', 'sí', 'si', '1'].includes(raw)) return true;
    if (['no', 'false', '0'].includes(raw)) return false;
    return '';
  }

  function normalizeInteger(value, min, max) {
    const raw = line(value).replace(/^["']|["']$/g, '');
    if (!raw) return '';
    const number = Number.parseInt(raw, 10);
    return Number.isInteger(number) && number >= min && number <= max ? number : '';
  }

  function normalizeChoice(value, options) {
    const raw = line(value).toLowerCase().replace(/^["']|["']$/g, '');
    return options.includes(raw) ? raw : '';
  }

  function normalizeOutline(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    return {
      toc: normalizeSwitch(source.toc),
      tocDepth: normalizeInteger(source.tocDepth, 1, 3),
      numberSections: normalizeSwitch(source.numberSections),
    };
  }

  /*
    El archivo CSL solo tiene sentido con el estilo propio: si el perfil dice
    APA, guardarlo sería arrastrar cien kilobytes que nadie va a usar y dejar el
    perfil en dos estados que se contradicen.
  */
  function normalizeCitations(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    const style = normalizeChoice(source.style, CITATION_STYLES);
    const custom = style === 'custom';
    return {
      style,
      title: line(source.title).slice(0, 160),
      headingLevel: normalizeInteger(source.headingLevel, 1, 6),
      cslName: custom ? line(source.cslName).slice(0, 160) : '',
      cslContent: custom ? text(source.cslContent) : '',
    };
  }

  function normalizeLatex(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    return {
      documentClass: normalizeChoice(source.documentClass, DOCUMENT_CLASSES),
      classOptions: line(source.classOptions).slice(0, 300),
      preamble: text(source.preamble),
    };
  }

  /* Deja el perfil en su forma canónica y descarta lo que no se entiende. */
  function normalizeProfile(input = {}) {
    const source = input && typeof input === 'object' ? input : {};
    return {
      version: PROFILE_VERSION,
      name: line(source.name).slice(0, MAX_NAME_LENGTH),
      format: documentFormat.normalizeDocumentFormat(source.format),
      outline: normalizeOutline(source.outline),
      citations: normalizeCitations(source.citations),
      latex: normalizeLatex(source.latex),
    };
  }

  /* Un perfil sin un solo valor no cambiaría nada al aplicarse. */
  function isEmptyProfile(profile) {
    const normalized = normalizeProfile(profile);
    return documentFormat.isEmptyFormat(normalized.format)
      && Object.values(normalized.outline).every(value => value === '')
      && Object.values(normalized.citations).every(value => value === '')
      && Object.values(normalized.latex).every(value => value === '');
  }

  /*
    Toma los ajustes tal como los guarda la aplicación y compone un perfil con
    ellos: crear un perfil nunca obliga a rellenar los mismos campos dos veces.
  */
  function profileFromSettings(settings = {}, name = '') {
    const source = settings && typeof settings === 'object' ? settings : {};
    return normalizeProfile({
      name,
      format: source.documentFormat,
      outline: {
        toc: source.documentToc,
        tocDepth: source.documentTocDepth,
        numberSections: source.documentNumberSections,
      },
      citations: {
        style: source.citationStyle,
        title: source.bibliographyTitle,
        headingLevel: source.bibliographyHeadingLevel,
        cslName: source.cslName,
        cslContent: source.cslContent,
      },
      latex: {
        documentClass: source.documentClass,
        classOptions: source.classOptions,
        preamble: source.preamble,
      },
    });
  }

  /*
    Aplicar es copiar: lo que el perfil fija sustituye al ajuste actual y lo que
    deja vacío se queda como estaba. La bibliografía, la portada y el autor no se
    tocan nunca, porque no son del perfil.
  */
  function applyProfileToSettings(settings = {}, profile = {}) {
    const base = settings && typeof settings === 'object' ? { ...settings } : {};
    const wanted = normalizeProfile(profile);
    const format = { ...documentFormat.normalizeDocumentFormat(base.documentFormat) };
    Object.entries(wanted.format).forEach(([key, value]) => {
      if (value !== '') format[key] = value;
    });
    const applied = { ...base, documentFormat: format };
    if (wanted.outline.toc !== '') applied.documentToc = wanted.outline.toc;
    if (wanted.outline.tocDepth !== '') applied.documentTocDepth = wanted.outline.tocDepth;
    if (wanted.outline.numberSections !== '') applied.documentNumberSections = wanted.outline.numberSections;
    if (wanted.citations.style !== '') {
      applied.citationStyle = wanted.citations.style;
      // El estilo propio viaja con su archivo; cualquier otro lo deja atrás para
      // no exportar con un CSL que ya no corresponde al estilo elegido.
      applied.cslContent = wanted.citations.style === 'custom' ? wanted.citations.cslContent : '';
      applied.cslName = wanted.citations.style === 'custom' ? wanted.citations.cslName : '';
    }
    if (wanted.citations.title !== '') applied.bibliographyTitle = wanted.citations.title;
    if (wanted.citations.headingLevel !== '') applied.bibliographyHeadingLevel = wanted.citations.headingLevel;
    if (wanted.latex.documentClass !== '') applied.documentClass = wanted.latex.documentClass;
    if (wanted.latex.classOptions !== '') applied.classOptions = wanted.latex.classOptions;
    if (wanted.latex.preamble !== '') applied.preamble = wanted.latex.preamble;
    return applied;
  }

  /*
    Qué campos del perfil no coinciden con los ajustes actuales, para poder
    avisar de que el documento se ha apartado de él. Solo se miran los campos que
    el perfil fija: los que deja vacíos no dicen nada sobre el documento.
  */
  function profileDifferences(profile = {}, settings = {}) {
    const wanted = normalizeProfile(profile);
    const current = profileFromSettings(settings, wanted.name);
    const differences = [];
    ['format', 'outline', 'citations', 'latex'].forEach((section) => {
      Object.entries(wanted[section]).forEach(([field, value]) => {
        if (value === '') return;
        if (current[section][field] !== value) differences.push(`${section}.${field}`);
      });
    });
    return differences;
  }

  function matchesProfile(profile, settings) {
    return profileDifferences(profile, settings).length === 0;
  }

  /*
    Un documento sin la línea de su perfil —anterior a ella, o escrito a mano—
    se reconoce si sus ajustes son exactamente los de un perfil: ni uno más ni
    uno menos. Que coincida solo lo que el perfil fija no basta, porque uno que
    fije nada más la letra coincidiría con casi cualquier documento. Y si dos
    perfiles encajan igual, no se elige ninguno.
  */
  function profileEqualsSettings(profile, settings) {
    const wanted = normalizeProfile(profile);
    const current = profileFromSettings(settings, wanted.name);
    return ['format', 'outline', 'citations', 'latex'].every(section => (
      Object.keys(wanted[section]).every(field => wanted[section][field] === current[section][field])
    ));
  }

  function findProfileForSettings(profiles, settings) {
    if (isEmptyProfile(profileFromSettings(settings))) return null;
    const found = (Array.isArray(profiles) ? profiles : []).filter(profile => profileEqualsSettings(profile, settings));
    return found.length === 1 ? normalizeProfile(found[0]) : null;
  }

  /*
    El documento dice de qué perfil salió con una línea propia en su bloque de
    metadatos. Así viaja con el `.md` a otro equipo, donde ese perfil se puede
    volver a componer con los ajustes que el propio documento lleva escritos.
    Pandoc no conoce la clave y la deja pasar sin efecto.

    No es `edimark-profile`, que es la primera línea de un archivo de perfil y
    lleva su versión: aquí va un nombre, y la misma clave con dos sentidos se
    confundiría.
  */
  const DOCUMENT_PROFILE_KEY = 'format-profile';

  function readDocumentProfileName(frontMatter) {
    const source = typeof frontMatter === 'string' ? frontMatter : '';
    const match = source.match(new RegExp(`^${DOCUMENT_PROFILE_KEY}\\s*:\\s*(.*)$`, 'm'));
    if (!match) return '';
    return line(unquote(match[1].trim())).slice(0, MAX_NAME_LENGTH);
  }

  function documentProfileEntries(name) {
    const clean = line(name).slice(0, MAX_NAME_LENGTH);
    return clean ? [{ key: DOCUMENT_PROFILE_KEY, lines: [`${DOCUMENT_PROFILE_KEY}: ${quote(clean)}`] }] : [];
  }

  function quote(value) {
    return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }

  function unquote(value) {
    const raw = String(value ?? '').trim();
    if (raw.length > 1 && ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'")))) {
      return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return raw;
  }

  function yamlScalar(value) {
    if (value === true) return 'true';
    if (value === false) return 'false';
    if (typeof value === 'number') return String(value);
    return quote(value);
  }

  /* Un bloque literal no puede cerrar nada: todo lo que lleva va sangrado. */
  function yamlBlock(key, value, indent) {
    const pad = ' '.repeat(indent);
    const lines = String(value).split('\n').map(entry => `${pad}  ${entry}`.trimEnd());
    return [`${pad}${key}: |`, ...lines];
  }

  function sectionLines(name, keys, values, indent = 2) {
    const pad = ' '.repeat(indent);
    const lines = [];
    keys.forEach(([field, key]) => {
      const value = values[field];
      if (value === '' || typeof value === 'undefined') return;
      if (BLOCK_FIELDS.includes(`${name}.${field}`)) lines.push(...yamlBlock(key, value, indent));
      else lines.push(`${pad}${key}: ${yamlScalar(value)}`);
    });
    return lines.length ? [`${name}:`, ...lines] : [];
  }

  /* El perfil como archivo: esto es lo que se comparte entre personas. */
  function toYaml(profile) {
    const normalized = normalizeProfile(profile);
    const lines = [`${PROFILE_KEY}: ${PROFILE_VERSION}`];
    if (normalized.name) lines.push(`name: ${quote(normalized.name)}`);
    lines.push(...sectionLines('format', documentFormat.YAML_KEYS, normalized.format));
    lines.push(...sectionLines('outline', OUTLINE_KEYS, normalized.outline));
    lines.push(...sectionLines('citations', CITATION_KEYS, normalized.citations));
    lines.push(...sectionLines('latex', LATEX_KEYS, normalized.latex));
    return `${lines.join('\n')}\n`;
  }

  const SECTIONS = {
    format: documentFormat.YAML_KEYS,
    outline: OUTLINE_KEYS,
    citations: CITATION_KEYS,
    latex: LATEX_KEYS,
  };

  function fieldFor(section, key) {
    const found = (SECTIONS[section] || []).find(([, name]) => name === key);
    return found ? found[0] : '';
  }

  /*
    Lector deliberadamente corto: reconoce las dos formas que escribe `toYaml` y
    devuelve un error con nombre en cuanto aparece cualquier otra cosa —listas,
    anclas, tabuladores, sangrías inesperadas—. Es preferible decir «no entiendo
    este archivo» a interpretar a medias un YAML ajeno y aplicar ajustes que
    nadie ha pedido.
  */
  function fromYaml(source) {
    const raw = String(source ?? '').replace(/\r\n?/g, '\n');
    if (!raw.trim()) return { ok: false, error: 'empty' };
    if (/^[ ]*\t/m.test(raw)) return { ok: false, error: 'unsupported' };
    const lines = raw.split('\n');
    const profile = { format: {}, outline: {}, citations: {}, latex: {} };
    let version = null;
    let section = '';
    let index = 0;

    while (index < lines.length) {
      const current = lines[index];
      index += 1;
      if (!current.trim() || /^\s*#/.test(current)) continue;

      const indent = current.length - current.trimStart().length;
      const body = current.trim();
      if (/^[-&*]/.test(body) || (indent !== 0 && indent !== 2)) return { ok: false, error: 'unsupported' };

      const match = body.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
      if (!match) return { ok: false, error: 'unsupported' };
      const [, key, value] = match;

      if (indent === 0) {
        if (key === PROFILE_KEY) {
          version = Number.parseInt(unquote(value), 10);
          section = '';
          continue;
        }
        if (key === 'name') {
          profile.name = unquote(value);
          section = '';
          continue;
        }
        if (!Object.prototype.hasOwnProperty.call(SECTIONS, key) || unquote(value)) {
          return { ok: false, error: 'unsupported' };
        }
        section = key;
        continue;
      }

      if (!section) return { ok: false, error: 'unsupported' };
      const field = fieldFor(section, key);
      if (!field) return { ok: false, error: 'unsupported' };

      if (value.trim() === '|') {
        const block = [];
        while (index < lines.length && (!lines[index].trim() || lines[index].startsWith('    '))) {
          block.push(lines[index].slice(4));
          index += 1;
        }
        while (block.length && !block[block.length - 1].trim()) block.pop();
        profile[section][field] = block.join('\n');
        continue;
      }
      profile[section][field] = unquote(value);
    }

    if (version === null) return { ok: false, error: 'not-a-profile' };
    if (!Number.isInteger(version) || version > PROFILE_VERSION) return { ok: false, error: 'unsupported-version' };
    return { ok: true, profile: normalizeProfile(profile) };
  }

  return {
    PROFILE_VERSION,
    PROFILE_KEY,
    CITATION_STYLES,
    DOCUMENT_CLASSES,
    OUTLINE_KEYS,
    CITATION_KEYS,
    LATEX_KEYS,
    normalizeProfile,
    isEmptyProfile,
    profileFromSettings,
    applyProfileToSettings,
    profileDifferences,
    matchesProfile,
    profileEqualsSettings,
    findProfileForSettings,
    DOCUMENT_PROFILE_KEY,
    readDocumentProfileName,
    documentProfileEntries,
    toYaml,
    fromYaml,
  };
}));
