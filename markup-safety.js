/*
  La aduana del Markdown importado, en un archivo propio y sin dependencias:
  la usan la exportación con Pandoc y el importador de PDF, y eXeConvert copia
  ese importador tal cual, así que no puede arrastrar el resto de
  `pandoc-prepare.js`.
*/
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
