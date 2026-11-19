import assert from 'node:assert/strict';
import test from 'node:test';

import profiles from '../format-profiles.js';

const {
  PROFILE_VERSION,
  normalizeProfile,
  isEmptyProfile,
  profileFromSettings,
  applyProfileToSettings,
  profileDifferences,
  matchesProfile,
  toYaml,
  fromYaml,
} = profiles;

const SETTINGS = {
  documentAuthor: 'de Haro, Juan José',
  documentToc: true,
  documentTocDepth: 3,
  documentNumberSections: false,
  documentFormat: {
    font: 'serif',
    fontSize: '12',
    lineHeight: '1.5',
    paperSize: 'a4',
    marginTop: '3',
    marginLeft: '3',
  },
  citationStyle: 'apa',
  bibliographyTitle: 'Referencias',
  bibliographyHeadingLevel: 2,
  bibliographyContent: '@book{x, title = {Y}}',
  bibliographyName: 'la-mia.bib',
  cslContent: '',
  cslName: '',
  documentClass: 'article',
  classOptions: '12pt',
  preamble: '\\usepackage{setspace}\n\\onehalfspacing',
  epubCoverImage: 'data:image/png;base64,AAAA',
};

test('un perfil se compone con los ajustes actuales y descarta lo ajeno', () => {
  const profile = profileFromSettings(SETTINGS, 'TFG');
  assert.equal(profile.version, PROFILE_VERSION);
  assert.equal(profile.name, 'TFG');
  assert.equal(profile.format.fontSize, '12');
  assert.equal(profile.format.paperSize, 'a4');
  assert.equal(profile.outline.toc, true);
  assert.equal(profile.outline.numberSections, false);
  assert.equal(profile.citations.title, 'Referencias');
  assert.equal(profile.latex.preamble, '\\usepackage{setspace}\n\\onehalfspacing');

  // Lo que es de cada documento o de cada persona no entra en el perfil.
  assert.equal(Object.prototype.hasOwnProperty.call(profile, 'bibliographyContent'), false);
  assert.deepEqual(Object.keys(profile).sort(), ['citations', 'format', 'latex', 'name', 'outline', 'version']);
  assert.equal(JSON.stringify(profile).includes('de Haro'), false);
  assert.equal(JSON.stringify(profile).includes('base64'), false);
});

test('el archivo CSL solo viaja con el estilo propio', () => {
  const custom = normalizeProfile({ citations: { style: 'custom', cslName: 'mio.csl', cslContent: '<style/>' } });
  assert.equal(custom.citations.cslContent, '<style/>');
  const apa = normalizeProfile({ citations: { style: 'apa', cslName: 'mio.csl', cslContent: '<style/>' } });
  assert.equal(apa.citations.cslContent, '');
  assert.equal(apa.citations.cslName, '');
});

test('descarta lo que no entiende y admite lo escrito a mano', () => {
  const profile = normalizeProfile({
    name: '  Apuntes  ',
    format: { fontSize: '999', lineHeight: '1,5', paperSize: 'A4paper', align: 'centrado' },
    outline: { toc: 'sí', tocDepth: '9', numberSections: 'no' },
    citations: { style: 'harvard', headingLevel: '2' },
    latex: { documentClass: 'memoir' },
  });
  assert.equal(profile.name, 'Apuntes');
  assert.equal(profile.format.fontSize, '', 'fuera de rango');
  assert.equal(profile.format.lineHeight, '1.5', 'coma decimal');
  assert.equal(profile.format.paperSize, 'a4');
  assert.equal(profile.format.align, '');
  assert.equal(profile.outline.toc, true);
  assert.equal(profile.outline.tocDepth, '');
  assert.equal(profile.outline.numberSections, false);
  assert.equal(profile.citations.style, '');
  assert.equal(profile.citations.headingLevel, 2);
  assert.equal(profile.latex.documentClass, '');
  assert.equal(isEmptyProfile({ name: 'Vacío' }), true);
  assert.equal(isEmptyProfile(profile), false);
});

test('aplicar un perfil copia lo que fija y respeta lo demás', () => {
  const profile = normalizeProfile({
    name: 'Apuntes',
    format: { fontSize: '11', align: 'left' },
    outline: { numberSections: true },
    latex: { classOptions: 'twocolumn' },
  });
  const applied = applyProfileToSettings(SETTINGS, profile);

  assert.equal(applied.documentFormat.fontSize, '11', 'lo que el perfil fija');
  assert.equal(applied.documentFormat.align, 'left');
  assert.equal(applied.documentFormat.paperSize, 'a4', 'lo que el perfil no toca');
  assert.equal(applied.documentFormat.lineHeight, '1.5');
  assert.equal(applied.documentNumberSections, true);
  assert.equal(applied.documentToc, true, 'el perfil no se pronuncia');
  assert.equal(applied.classOptions, 'twocolumn');
  assert.equal(applied.preamble, SETTINGS.preamble);

  // La bibliografía, la portada y el autor nunca los toca un perfil.
  assert.equal(applied.bibliographyContent, SETTINGS.bibliographyContent);
  assert.equal(applied.bibliographyName, 'la-mia.bib');
  assert.equal(applied.documentAuthor, SETTINGS.documentAuthor);
  assert.equal(applied.epubCoverImage, SETTINGS.epubCoverImage);
  assert.notEqual(applied.documentFormat, SETTINGS.documentFormat, 'no muta lo recibido');
  assert.equal(SETTINGS.documentFormat.fontSize, '12');
});

test('cambiar de estilo de citas deja atrás el CSL propio', () => {
  const conCsl = applyProfileToSettings(SETTINGS, {
    citations: { style: 'custom', cslName: 'mio.csl', cslContent: '<style/>' },
  });
  assert.equal(conCsl.citationStyle, 'custom');
  assert.equal(conCsl.cslContent, '<style/>');

  const aIeee = applyProfileToSettings(conCsl, { citations: { style: 'ieee' } });
  assert.equal(aIeee.citationStyle, 'ieee');
  assert.equal(aIeee.cslContent, '', 'un CSL que ya no corresponde al estilo');
  assert.equal(aIeee.cslName, '');
});

test('sabe si el documento se ha apartado del perfil', () => {
  const profile = profileFromSettings(SETTINGS, 'TFG');
  assert.equal(matchesProfile(profile, SETTINGS), true);
  assert.deepEqual(profileDifferences(profile, SETTINGS), []);

  const cambiado = { ...SETTINGS, documentFormat: { ...SETTINGS.documentFormat, fontSize: '14' }, documentToc: false };
  assert.deepEqual(profileDifferences(profile, cambiado).sort(), ['format.fontSize', 'outline.toc']);

  // Lo que el perfil deja vacío no cuenta como desviación.
  const suelto = normalizeProfile({ format: { fontSize: '12' } });
  assert.deepEqual(profileDifferences(suelto, cambiado), ['format.fontSize']);
  assert.deepEqual(profileDifferences(suelto, SETTINGS), []);
});

test('el perfil va y vuelve del archivo YAML sin perder nada', () => {
  const profile = profileFromSettings({ ...SETTINGS, citationStyle: 'custom', cslName: 'mio.csl', cslContent: '<style>\n  <info/>\n</style>' }, 'TFG');
  const yaml = toYaml(profile);

  assert.match(yaml, /^edimark-profile: 1\n/);
  assert.match(yaml, /^name: "TFG"$/m);
  assert.match(yaml, /^format:\n/m);
  assert.match(yaml, /^  fontsize: "12"$/m);
  assert.match(yaml, /^  toc: true$/m);
  assert.match(yaml, /^  preamble: \|$/m);
  assert.match(yaml, /^    \\usepackage\{setspace\}$/m);
  assert.equal(yaml.includes('margin-right'), false, 'lo que no tiene valor no ocupa una línea');

  const read = fromYaml(yaml);
  assert.equal(read.ok, true);
  assert.deepEqual(read.profile, profile);
});

test('rechaza con nombre lo que no es un perfil o no sabe leer', () => {
  assert.equal(fromYaml('').error, 'empty');
  assert.equal(fromYaml('name: "Sin versión"\n').error, 'not-a-profile');
  assert.equal(fromYaml('edimark-profile: 99\nname: "Del futuro"\n').error, 'unsupported-version');
  assert.equal(fromYaml('edimark-profile: 1\nformat:\n  - fontsize: "12"\n').error, 'unsupported');
  assert.equal(fromYaml('edimark-profile: 1\nformat:\n\tfontsize: "12"\n').error, 'unsupported');
  assert.equal(fromYaml('edimark-profile: 1\ninventado:\n  cosa: "1"\n').error, 'unsupported');
  assert.equal(fromYaml('edimark-profile: 1\nformat:\n  inventado: "1"\n').error, 'unsupported');
  assert.equal(fromYaml('edimark-profile: 1\n  fontsize: "12"\n').error, 'unsupported');
  assert.equal(fromYaml('edimark-profile: 1\nformat: algo\n').error, 'unsupported');

  // Comentarios y líneas en blanco sí, porque el archivo se edita a mano.
  const read = fromYaml('# Mi perfil\nedimark-profile: 1\n\nformat:\n  fontsize: "11"  \n');
  assert.equal(read.ok, true);
  assert.equal(read.profile.format.fontSize, '11');
});

test('un perfil vacío da un archivo mínimo que se vuelve a leer', () => {
  const yaml = toYaml({ name: 'Vacío' });
  assert.equal(yaml, 'edimark-profile: 1\nname: "Vacío"\n');
  const read = fromYaml(yaml);
  assert.equal(read.ok, true);
  assert.equal(isEmptyProfile(read.profile), true);
  assert.deepEqual(applyProfileToSettings(SETTINGS, read.profile).documentFormat, applyProfileToSettings(SETTINGS, {}).documentFormat);
});

test('el documento recuerda de qué perfil salió con una línea propia', () => {
  const { DOCUMENT_PROFILE_KEY, readDocumentProfileName, documentProfileEntries } = profiles;
  assert.equal(DOCUMENT_PROFILE_KEY, 'format-profile');
  assert.deepEqual(documentProfileEntries('TFG "final"'), [
    { key: 'format-profile', lines: ['format-profile: "TFG \\"final\\""'] },
  ]);
  assert.deepEqual(documentProfileEntries('   '), [], 'sin nombre no se escribe nada');

  // Lo que se escribe se vuelve a leer igual, con comillas o sin ellas.
  const written = documentProfileEntries('TFG "final"')[0].lines[0];
  assert.equal(readDocumentProfileName(`---\ntitle: X\n${written}\n---`), 'TFG "final"');
  assert.equal(readDocumentProfileName("---\nformat-profile: 'Apuntes'\n---"), 'Apuntes');
  assert.equal(readDocumentProfileName('---\nformat-profile: Apuntes de clase\n---'), 'Apuntes de clase');
  assert.equal(readDocumentProfileName('---\ntitle: X\n---'), '');
  assert.equal(readDocumentProfileName(undefined), '');
  // No se confunde con la primera línea de un archivo de perfil.
  assert.equal(readDocumentProfileName('edimark-profile: 1\nname: "TFG"'), '');
});

test('un documento sin la línea se reconoce solo por una coincidencia exacta', () => {
  const { findProfileForSettings, profileEqualsSettings } = profiles;
  const apuntes = profileFromSettings({ documentFormat: { fontSize: '12', printHeader: 'name' } }, 'Apuntes');
  const letra = profileFromSettings({ documentFormat: { fontSize: '12' } }, 'Letra');
  const settings = { documentFormat: { fontSize: '12', printHeader: 'name' } };

  assert.equal(profileEqualsSettings(apuntes, settings), true);
  // El de la letra sola fija menos de lo que lleva el documento: no es el suyo.
  assert.equal(profileEqualsSettings(letra, settings), false);
  assert.equal(findProfileForSettings([letra, apuntes], settings).name, 'Apuntes');

  // Un ajuste de más en el documento y ya no es ninguno.
  assert.equal(findProfileForSettings([apuntes], { documentFormat: { fontSize: '12', printHeader: 'name', align: 'justify' } }), null);
  // Dos perfiles iguales: no se elige ninguno.
  const otro = { ...apuntes, name: 'Otro' };
  assert.equal(findProfileForSettings([apuntes, otro], settings), null);
  // Un documento sin ajustes propios no es de ningún perfil.
  assert.equal(findProfileForSettings([apuntes], {}), null);
  assert.equal(findProfileForSettings(undefined, settings), null);
});
