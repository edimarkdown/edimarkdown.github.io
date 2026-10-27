/*
  Diagramas Mermaid en la hoja y al exportar.

  Un bloque de código con la etiqueta `mermaid` se dibuja en la hoja. El
  Markdown no cambia: el código queda guardado en el propio elemento
  (`data-edimark-mermaid`) y vuelve tal cual cuando la hoja se convierte en
  Markdown o en HTML (`restore`). Al exportar con Pandoc, cada diagrama pasa a
  ser una imagen PNG (`replaceWithImages`), para que el documento enseñe lo
  mismo que la pantalla.

  Mermaid pesa unos 5 MB, así que solo se descarga cuando el documento tiene
  algún diagrama. La web lo toma del CDN con su huella SRI; la aplicación de
  escritorio lleva su copia, y `scripts/build-desktop.mjs` cambia aquí la
  dirección por la local.

  La configuración es la de Sirena (`initMermaid` en sirenaapp.github.io): los
  rótulos van como texto SVG salvo que el diagrama tenga fórmulas, y así el
  navegador deja convertir el dibujo en PNG. El diagrama se dibuja siempre en
  claro, también con el tema oscuro, porque es lo que sale en el papel y en
  el documento exportado.
*/
(function initMermaidDiagrams(root) {
  const MERMAID_URL = 'https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.min.js';
  const MERMAID_SRI = 'sha384-8xUhuLNMjW/cI2Dacg3DR4WliYznvIg0LVG1stctThKD/YVrJFI9TNCFxft5NYgp';
  // La etiqueta `mermaid` del bloque, o la clase `{.mermaid}` de Pandoc, que
  // marked deja tal cual en la clase del código. Igual que reconoce la
  // exportación (`mapMermaidBlocks`).
  const MERMAID_CLASS = /(?:^|\s)language-(?:mermaid|\{\.mermaid\})(?:\s|$)/i;

  function mermaidCodeElements(container) {
    return Array.from(container.querySelectorAll('pre > code'))
      .filter(code => MERMAID_CLASS.test(code.className) || code.parentElement.classList.contains('mermaid'));
  }
  const CACHE_MAX = 60;
  const EXPORT_SCALE = 2;

  // Lo ya dibujado, por código: la hoja se rehace entera con cada tecla y sin
  // esto el diagrama parpadearía y se volvería a dibujar cada vez.
  const cache = new Map();
  let loading = null;
  let renderChain = Promise.resolve();
  let renderCount = 0;
  let formulasConfigured = null;

  function t(key, fallback) {
    return typeof root.getTranslation === 'function' ? root.getTranslation(key, fallback) : fallback;
  }

  function hasFormulas(code) {
    return /\$\$[\s\S]+?\$\$/.test(code);
  }

  function loadMermaid() {
    if (root.mermaid) return Promise.resolve(root.mermaid);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = MERMAID_URL;
      if (/^https:/.test(MERMAID_URL)) {
        script.integrity = MERMAID_SRI;
        script.crossOrigin = 'anonymous';
      }
      script.onload = () => (root.mermaid ? resolve(root.mermaid) : reject(new Error('Mermaid no se ha cargado')));
      script.onerror = () => reject(new Error('Mermaid no se ha podido descargar'));
      document.head.appendChild(script);
    }).catch((error) => {
      loading = null;
      throw error;
    });
    return loading;
  }

  function configure(mermaid, conFormulas) {
    if (formulasConfigured === conFormulas) return;
    formulasConfigured = conFormulas;
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'default',
      fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
      htmlLabels: conFormulas,
      flowchart: conFormulas
        ? { useMaxWidth: false, htmlLabels: true, wrappingWidth: 300 }
        : { useMaxWidth: false, htmlLabels: false },
      sequence: { useMaxWidth: false },
      gantt: { useMaxWidth: false },
      er: { useMaxWidth: false },
      journey: { useMaxWidth: false },
      class: { useMaxWidth: false, htmlLabels: conFormulas },
      state: { useMaxWidth: false, htmlLabels: conFormulas },
      pie: { useMaxWidth: false },
      mindmap: { useMaxWidth: false },
    });
  }

  function remember(code, entry) {
    cache.delete(code);
    cache.set(code, entry);
    while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  }

  // Mermaid no admite dos dibujos a la vez: van en fila.
  function draw(code) {
    const cached = cache.get(code);
    if (cached) return Promise.resolve(cached);
    const job = renderChain.then(async () => {
      const again = cache.get(code);
      if (again) return again;
      let entry;
      const id = `edimark-mermaid-${++renderCount}`;
      try {
        const mermaid = await loadMermaid();
        configure(mermaid, hasFormulas(code));
        // Se analiza antes de dibujar: con un error, `render` deja en la página
        // el dibujo de su bomba de aviso.
        await mermaid.parse(code);
        const { svg } = await mermaid.render(id, code);
        entry = { svg };
      } catch (error) {
        if (!root.mermaid) throw error;
        // Lo que Mermaid deja a medias fuera de la hoja (`d` + id es su caja de
        // trabajo); el dibujo de la hoja tiene otro id.
        const leftover = document.getElementById(`d${id}`);
        if (leftover) leftover.remove();
        entry = { error: String(error && error.message ? error.message : error).trim() };
      }
      remember(code, entry);
      return entry;
    });
    renderChain = job.catch(() => {});
    return job;
  }

  function sourceBlock(code) {
    const pre = document.createElement('pre');
    pre.className = 'edimark-mermaid-source';
    const codeElement = document.createElement('code');
    codeElement.textContent = code;
    pre.appendChild(codeElement);
    return pre;
  }

  // Lápiz de Lucide, como el resto de los iconos de la aplicación.
  const PENCIL = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" '
    + 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622'
    + 'l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>';

  /*
    El botón que abre el diagrama en Sirena. El doble clic hace lo mismo, pero
    en una pantalla táctil no hay doble clic fiable ni ratón que pase por
    encima: allí el botón se ve siempre. Lo atiende script.js.
  */
  function editButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'edimark-mermaid-edit';
    const label = t('sirena_edit', 'Editar con Sirena');
    button.title = label;
    button.setAttribute('aria-label', label);
    button.innerHTML = PENCIL;
    return button;
  }

  function fill(wrapper, entry) {
    const code = wrapper.dataset.edimarkMermaid;
    wrapper.classList.remove('edimark-mermaid-pending', 'edimark-mermaid-error');
    if (entry && entry.svg) {
      wrapper.innerHTML = entry.svg;
      wrapper.appendChild(editButton());
      return;
    }
    wrapper.replaceChildren(sourceBlock(code));
    if (!entry) {
      wrapper.classList.add('edimark-mermaid-pending');
      return;
    }
    wrapper.classList.add('edimark-mermaid-error');
    const message = document.createElement('p');
    message.className = 'edimark-mermaid-message';
    message.textContent = entry.offline
      ? t('mermaid_unavailable', 'No se ha podido cargar Mermaid para dibujar el diagrama.')
      : t('mermaid_error', 'El diagrama tiene un error:');
    wrapper.appendChild(message);
    // El aviso de Mermaid dice en qué línea y qué esperaba, con una marca bajo
    // el punto exacto: va en letra de ancho fijo para que la marca caiga ahí.
    if (entry.error) {
      const detail = document.createElement('pre');
      detail.className = 'edimark-mermaid-detail';
      detail.textContent = entry.error;
      wrapper.appendChild(detail);
      // Un diagrama con errores es justo el que más conviene abrir en Sirena.
      wrapper.appendChild(editButton());
    }
  }

  /*
    Cambia cada bloque de código Mermaid por su diagrama. Es síncrono: lo que ya
    está dibujado entra en el acto y lo nuevo se dibuja después, con el código
    a la vista mientras tanto. Un solo elemento ocupa el lugar del bloque, para
    que el índice de líneas de la hoja siga casando con el Markdown.
  */
  function prepare(container) {
    if (!container) return 0;
    const pending = [];
    mermaidCodeElements(container).forEach((codeElement) => {
      const pre = codeElement.parentElement;
      const code = codeElement.textContent.replace(/\n$/, '');
      const wrapper = document.createElement('div');
      wrapper.className = 'edimark-mermaid';
      wrapper.contentEditable = 'false';
      wrapper.dataset.edimarkMermaid = code;
      // La etiqueta con que se escribió, para devolverla igual al Markdown.
      const label = (codeElement.className.match(/(?:^|\s)(language-\S+)/) || [])[1];
      if (label) wrapper.dataset.edimarkMermaidLabel = label;
      pre.replaceWith(wrapper);
      const cached = cache.get(code);
      fill(wrapper, cached);
      if (!cached) pending.push(wrapper);
    });
    pending.forEach((wrapper) => {
      const code = wrapper.dataset.edimarkMermaid;
      draw(code).then((entry) => {
        if (wrapper.isConnected && wrapper.dataset.edimarkMermaid === code) fill(wrapper, entry);
      }).catch(() => {
        if (wrapper.isConnected) fill(wrapper, { offline: true });
      });
    });
    return container.querySelectorAll('.edimark-mermaid').length;
  }

  // El diagrama vuelve a ser su bloque de código antes de salir de la hoja.
  function restore(container) {
    if (!container || typeof container.querySelectorAll !== 'function') return container;
    container.querySelectorAll('.edimark-mermaid[data-edimark-mermaid]').forEach((wrapper) => {
      const pre = wrapper.ownerDocument.createElement('pre');
      const codeElement = wrapper.ownerDocument.createElement('code');
      codeElement.className = wrapper.dataset.edimarkMermaidLabel || 'language-mermaid';
      codeElement.textContent = wrapper.dataset.edimarkMermaid;
      pre.appendChild(codeElement);
      wrapper.replaceWith(pre);
    });
    return container;
  }

  /*
    Algunos tipos de diagrama colocan los rótulos en `<foreignObject>` aunque
    se pidan como texto SVG. Con eso el navegador no deja convertir el dibujo
    en PNG, así que en la copia que se exporta se sustituyen por texto SVG.
    Es la función `flattenForeignObjects` de Sirena, que resolvió lo mismo.
    Con fórmulas no se toca: el diagrama entero va en HTML y se dibuja desde
    una dirección de datos, que el navegador acepta.
  */
  function flattenForeignObjects(copy, original) {
    if (original.querySelector('.katex')) return;
    const source = original.querySelectorAll('foreignObject');
    copy.querySelectorAll('foreignObject').forEach((node, index) => {
      const content = source[index] || node;
      const text = (content.textContent || '').trim();
      const inner = content.querySelector('div, span, p');
      const style = inner ? getComputedStyle(inner) : null;
      const size = style ? parseFloat(style.fontSize) || 12 : 12;
      const width = parseFloat(node.getAttribute('width')) || 0;
      const height = parseFloat(node.getAttribute('height')) || size;
      const x = parseFloat(node.getAttribute('x')) || 0;
      const y = parseFloat(node.getAttribute('y')) || 0;
      const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      label.setAttribute('x', x + width / 2);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('font-family', style ? style.fontFamily : 'sans-serif');
      label.setAttribute('font-size', size);
      label.setAttribute('font-weight', style ? style.fontWeight : 'normal');
      label.setAttribute('fill', style ? style.color : 'currentColor');
      const perLine = Math.max(4, Math.floor(width / (size * 0.58)));
      const lines = [];
      text.split(/\s+/).forEach((word) => {
        const last = lines[lines.length - 1];
        if (last && `${last} ${word}`.length <= perLine) lines[lines.length - 1] = `${last} ${word}`;
        else lines.push(word);
      });
      if (!lines.length) lines.push('');
      const blockHeight = lines.length * size * 1.2;
      const top = y + Math.max(0, (height - blockHeight) / 2) + size;
      lines.forEach((line, i) => {
        const span = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        span.setAttribute('x', x + width / 2);
        span.setAttribute('y', top + i * size * 1.2);
        span.textContent = line;
        label.appendChild(span);
      });
      node.replaceWith(label);
    });
  }

  // El PNG se saca del dibujo puesto en la página (fuera de la vista), porque
  // aplanar los rótulos necesita medir su letra.
  async function toPng(svgMarkup) {
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;';
    host.innerHTML = svgMarkup;
    document.body.appendChild(host);
    try {
      const svg = host.querySelector('svg');
      if (!svg) throw new Error('El diagrama no tiene dibujo');
      const box = svg.getBoundingClientRect();
      const width = (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width) || box.width;
      const height = (svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.height) || box.height;
      const copy = svg.cloneNode(true);
      flattenForeignObjects(copy, svg);
      copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      copy.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
      copy.setAttribute('width', width);
      copy.setAttribute('height', height);
      copy.style.removeProperty('max-width');
      const markup = new XMLSerializer().serializeToString(copy);
      /*
        Como dirección de datos y no como blob: con un rótulo HTML dentro, el
        blob contamina el lienzo y el navegador no deja sacar el PNG; y WebKit,
        con la política de seguridad de la aplicación de escritorio, ni
        siquiera carga el blob.
      */
      const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('El diagrama no se ha podido convertir en imagen'));
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * EXPORT_SCALE));
      canvas.height = Math.max(1, Math.round(height * EXPORT_SCALE));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('El diagrama no se ha podido convertir en imagen');
      return { bytes: new Uint8Array(await blob.arrayBuffer()), width: Math.round(width) };
    } finally {
      host.remove();
    }
  }

  function accessibleTitle(code) {
    const match = code.match(/^\s*accTitle\s*:\s*(.+)$/m);
    return match ? match[1].trim() : '';
  }

  function escapeAlt(text) {
    return text.replace(/[\\[\]]/g, '\\$&');
  }

  /*
    Para Pandoc: cada diagrama pasa a ser una imagen PNG montada junto al
    documento. La imagen lleva su ancho en píxeles, porque el PNG va al doble
    de resolución y sin él saldría al doble de tamaño.

    Va centrada y sin pie, como en la hoja. Sola en su párrafo, Pandoc la haría
    figura y pondría debajo su texto alternativo como pie; el espacio de no
    separación que la sigue lo evita. El centrado lo da el estilo «Figure»
    (el de las figuras en DOCX y ODT, y su misma regla CSS en HTML y EPUB) y,
    en LaTeX, un entorno `center` que los demás formatos no leen.
    Un diagrama con errores se queda como bloque de código, y se avisa.
  */
  async function replaceWithImages(markdown, {
    mapBlocks,
    collectBlocks,
    fileName = index => `edimark-diagram-${index}.png`,
    source = name => `/${name}`,
  } = {}) {
    const blocks = collectBlocks ? collectBlocks(markdown) : [];
    if (!blocks.length) return { markdown, files: {}, failed: 0 };
    const images = [];
    let failed = 0;
    for (const code of blocks) {
      try {
        const entry = await draw(code);
        if (!entry.svg) throw new Error(entry.error || 'error');
        images.push(await toPng(entry.svg));
      } catch (error) {
        console.warn('No se ha podido convertir un diagrama en imagen:', error);
        images.push(null);
        failed += 1;
      }
    }
    const files = {};
    const prepared = mapBlocks(markdown, (code, index) => {
      const image = images[index];
      if (!image) return undefined;
      const name = fileName(index);
      files[name] = image.bytes;
      const alt = escapeAlt(accessibleTitle(code) || t('mermaid_alt', 'Diagrama'));
      return [
        '```{=latex}', '\\begin{center}', '```', '',
        '::: {custom-style="Figure"}', `![${alt}](${source(name)}){width=${image.width}px}\u00a0`, ':::', '',
        '```{=latex}', '\\end{center}', '```',
      ].join('\n');
    });
    return { markdown: prepared, files, failed };
  }

  root.EdiMarkMermaid = {
    prepare,
    restore,
    replaceWithImages,
    draw,
    // Lo pendiente de dibujar en la hoja, antes de imprimirla.
    ready: () => renderChain.then(() => new Promise(resolve => requestAnimationFrame(() => resolve()))),
  };
})(window);
