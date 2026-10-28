import assert from 'node:assert/strict';
import test from 'node:test';

import platformModule from '../platform-api.js';

const { createPlatformApi, fileNameFromPath } = platformModule;

test('extrae el nombre de rutas de Linux, Windows y macOS', () => {
  assert.equal(fileNameFromPath('/home/juanjo/Apuntes.md'), 'Apuntes.md');
  assert.equal(fileNameFromPath('C:\\Documentos\\Tema 1.md'), 'Tema 1.md');
  assert.equal(fileNameFromPath('file:///Users/juanjo/Apuntes%20de%20clase.md'), 'Apuntes de clase.md');
});

test('abre un documento de texto mediante los plugins de Tauri', async () => {
  const calls = [];
  const platform = createPlatformApi({
    Blob,
    __EDIMARK_TAURI__: {
      dialog: {
        open: async options => {
          calls.push(['open', options]);
          return '/tmp/tema.md';
        },
      },
      fs: {
        readTextFile: async path => {
          calls.push(['read', path]);
          return '# Tema';
        },
      },
    },
  });

  assert.equal(platform.isDesktop, true);
  assert.deepEqual(await platform.openTextDocument(), {
    path: '/tmp/tema.md',
    name: 'tema.md',
    content: '# Tema',
  });
  assert.equal(calls[0][0], 'open');
  assert.deepEqual(calls[1], ['read', '/tmp/tema.md']);
});

test('guarda texto en la ruta existente sin volver a preguntar', async () => {
  let written;
  const platform = createPlatformApi({
    Blob,
    __TAURI__: {
      dialog: {
        save: async () => assert.fail('no debe abrir el diálogo'),
      },
      fs: {
        writeTextFile: async (path, content) => { written = { path, content }; },
      },
    },
  });

  const result = await platform.saveFile({
    suggestedName: 'tema.md',
    contents: '# Tema nuevo',
    existingPath: '/tmp/tema.md',
  });

  assert.deepEqual(written, { path: '/tmp/tema.md', content: '# Tema nuevo' });
  assert.deepEqual(result, { saved: true, path: '/tmp/tema.md', name: 'tema.md' });
});

test('escribe el Markdown desde Rust, que no depende del permiso de la sesión', async () => {
  const escrituras = [];
  const platform = createPlatformApi({
    Blob,
    __EDIMARK_TAURI__: {
      dialog: { save: async () => assert.fail('no debe abrir el diálogo') },
      fs: {
        writeTextFile: async (path, content) => { escrituras.push(['fs', path, content]); },
      },
      app: {
        writeMarkdownDocument: async (path, contents) => { escrituras.push(['app', path, contents]); },
      },
    },
  });

  await platform.saveFile({
    suggestedName: 'tema.md',
    contents: '# Tema de ayer',
    existingPath: '/tmp/tema.md',
  });
  // Los demás formatos salen siempre del diálogo de esta sesión, así que
  // siguen pasando por el plugin de archivos.
  await platform.saveFile({
    suggestedName: 'tema.html',
    contents: '<h1>Tema</h1>',
    existingPath: '/tmp/tema.html',
  });

  assert.deepEqual(escrituras, [
    ['app', '/tmp/tema.md', '# Tema de ayer'],
    ['fs', '/tmp/tema.html', '<h1>Tema</h1>'],
  ]);
});

test('guarda datos binarios en la ruta escogida', async () => {
  let written;
  const platform = createPlatformApi({
    Blob,
    __TAURI__: {
      dialog: { save: async () => '/tmp/tema.epub' },
      fs: {
        writeFile: async (path, bytes) => { written = { path, bytes: [...bytes] }; },
      },
    },
  });

  const result = await platform.saveFile({
    suggestedName: 'tema.epub',
    contents: new Uint8Array([1, 2, 3]),
    extensions: ['epub'],
  });

  assert.deepEqual(written, { path: '/tmp/tema.epub', bytes: [1, 2, 3] });
  assert.equal(result.saved, true);
});

test('en escritorio copia las imágenes relativas junto al Markdown guardado', async () => {
  const writes = [];
  const platform = createPlatformApi({
    Blob,
    __EDIMARK_TAURI__: {
      dialog: { save: async () => '/tmp/copia/tema.md' },
      fs: {
        writeTextFile: async (path, contents) => writes.push([path, contents]),
        writeFile: async () => assert.fail('la imagen debe pasar por el comando seguro'),
      },
      app: {
        writeDocumentAsset: async (documentPath, relativePath, contents) => {
          writes.push(['asset', documentPath, relativePath, [...contents]]);
        },
      },
    },
  });

  const result = await platform.saveFile({
    suggestedName: 'tema.md',
    contents: '# Tema',
    companionFiles: [{
      relativePath: 'imagenes/grafico.png',
      contents: new Uint8Array([1, 2, 3]),
    }],
  });

  assert.deepEqual(writes, [
    ['/tmp/copia/tema.md', '# Tema'],
    ['asset', '/tmp/copia/tema.md', 'imagenes/grafico.png', [1, 2, 3]],
  ]);
  assert.equal(result.companionCount, 1);
});

test('en escritorio lee y guarda una bibliografía mediante el canal restringido de recursos', async () => {
  const writes = [];
  const platform = createPlatformApi({
    Blob,
    __EDIMARK_TAURI__: {
      dialog: { save: async () => '/tmp/copia/tema.md' },
      fs: { writeTextFile: async (path, contents) => writes.push(['text', path, contents]) },
      app: {
        readDocumentResource: async (documentPath, relativePath) => {
          assert.equal(documentPath, '/tmp/copia/tema.md');
          assert.equal(relativePath, 'tema/references.bib');
          return '@book{demo, title={Demo}}';
        },
        writeDocumentResource: async (documentPath, relativePath, contents) => {
          writes.push(['resource', documentPath, relativePath, new TextDecoder().decode(contents)]);
        },
        writeDocumentAsset: async () => assert.fail('la bibliografía no debe pasar por el lector de imágenes'),
      },
    },
  });

  assert.equal(
    await platform.readDocumentResource('/tmp/copia/tema.md', 'tema/references.bib'),
    '@book{demo, title={Demo}}',
  );
  await platform.saveFile({
    suggestedName: 'tema.md',
    contents: '---\nbibliography: "tema/references.bib"\n---',
    companionFiles: [{ relativePath: 'tema/references.bib', contents: '@book{demo}' }],
  });
  assert.deepEqual(writes[1], [
    'resource', '/tmp/copia/tema.md', 'tema/references.bib', '@book{demo}',
  ]);
});

test('cancelar el diálogo no escribe ni marca el documento como guardado', async () => {
  const platform = createPlatformApi({
    Blob,
    __TAURI__: {
      dialog: { save: async () => null },
      fs: { writeTextFile: async () => assert.fail('no debe escribir') },
    },
  });

  assert.deepEqual(await platform.saveFile({ suggestedName: 'tema.md', contents: 'texto' }), {
    saved: false,
    path: '',
    name: 'tema.md',
  });
});

test('en web guarda el Markdown y sus imágenes relativas dentro de la carpeta elegida', async () => {
  const writes = new Map();

  function directoryHandle(prefix = '') {
    return {
      async getDirectoryHandle(name, options) {
        assert.deepEqual(options, { create: true });
        return directoryHandle(`${prefix}${name}/`);
      },
      async getFileHandle(name, options) {
        assert.deepEqual(options, { create: true });
        const path = `${prefix}${name}`;
        return {
          async createWritable() {
            return {
              async write(contents) {
                writes.set(path, contents instanceof Blob
                  ? new Uint8Array(await contents.arrayBuffer())
                  : contents);
              },
              async close() {},
            };
          },
        };
      },
    };
  }

  const selectedDirectory = directoryHandle();
  let pickerOptions;
  const platform = createPlatformApi({
    Blob,
    showDirectoryPicker: async options => {
      pickerOptions = options;
      return selectedDirectory;
    },
  });

  const result = await platform.saveFile({
    suggestedName: 'tema.md',
    contents: '# Tema\n\n![Gráfico](imagenes/grafico.png)',
    mimeType: 'text/markdown',
    companionFiles: [{
      relativePath: 'imagenes/grafico.png',
      contents: new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }),
    }],
  });

  assert.deepEqual(pickerOptions, { mode: 'readwrite' });
  assert.equal(writes.get('tema.md'), '# Tema\n\n![Gráfico](imagenes/grafico.png)');
  assert.deepEqual([...writes.get('imagenes/grafico.png')], [1, 2, 3]);
  assert.equal(result.saved, true);
  assert.equal(result.name, 'tema.md');
  assert.equal(result.directoryHandle, selectedDirectory);
  assert.equal(result.companionCount, 1);
});

test('en web no permite que una imagen acompañante salga de la carpeta elegida', async () => {
  const writes = [];
  const selectedDirectory = {
    async getDirectoryHandle() {
      assert.fail('no debe crear una carpeta superior');
    },
    async getFileHandle(name) {
      return {
        async createWritable() {
          return {
            async write() { writes.push(name); },
            async close() {},
          };
        },
      };
    },
  };
  const platform = createPlatformApi({
    Blob,
    showDirectoryPicker: async () => selectedDirectory,
  });

  const result = await platform.saveFile({
    suggestedName: 'tema.md',
    contents: '# Tema',
    companionFiles: [{ relativePath: '../privada.png', contents: new Uint8Array([1]) }],
  });

  assert.deepEqual(writes, ['tema.md']);
  assert.equal(result.companionCount, 0);
});

test('en web sin escritura de carpetas descarga un ZIP con el Markdown y sus imágenes', async () => {
  let downloadedBlob;
  let downloadedName;
  const link = {
    click() { downloadedName = this.download; },
  };
  const platform = createPlatformApi({
    Blob,
    URL: {
      createObjectURL(blob) {
        downloadedBlob = blob;
        return 'blob:prueba';
      },
      revokeObjectURL() {},
    },
    document: {
      createElement: () => link,
      body: {
        appendChild() {},
        removeChild() {},
      },
    },
    setTimeout() {},
  });

  const result = await platform.saveFile({
    suggestedName: 'tema.md',
    contents: '# Tema\n\n![Gráfico](imagenes/grafico.png)',
    companionFiles: [{
      relativePath: 'imagenes/grafico.png',
      contents: new Uint8Array([1, 2, 3]),
    }],
  });

  const { readZipEntries } = await import('../zip-reader.js');
  const entries = await readZipEntries(await downloadedBlob.arrayBuffer());
  assert.equal(downloadedName, 'tema.zip');
  assert.equal(result.archiveName, 'tema.zip');
  assert.equal(new TextDecoder().decode(entries.get('tema.md')), '# Tema\n\n![Gráfico](imagenes/grafico.png)');
  assert.deepEqual([...entries.get('imagenes/grafico.png')], [1, 2, 3]);
});

test('abre los enlaces externos con el navegador del sistema en Tauri', async () => {
  let openedUrl = '';
  const platform = createPlatformApi({
    Blob,
    __EDIMARK_TAURI__: {
      dialog: {},
      fs: {},
      opener: { openUrl: async url => { openedUrl = url; } },
    },
  });

  await platform.openExternalUrl('https://edimarkdown.github.io/');
  assert.equal(openedUrl, 'https://edimarkdown.github.io/');
  await assert.rejects(() => platform.openExternalUrl('file:///etc/passwd'));
});

test('abre la carpeta de un archivo solo en Tauri y con ruta', async () => {
  const revealed = [];
  const platform = createPlatformApi({
    Blob,
    __EDIMARK_TAURI__: {
      dialog: {},
      fs: {},
      opener: { openUrl: async () => {}, revealItemInDir: async path => { revealed.push(path); } },
    },
  });

  assert.equal(platform.canRevealInFolder, true);
  await platform.revealInFolder('/docs/tema.md');
  assert.deepEqual(revealed, ['/docs/tema.md']);
  await assert.rejects(() => platform.revealInFolder(''));

  const web = createPlatformApi({ Blob });
  assert.equal(web.canRevealInFolder, false);
  await assert.rejects(() => web.revealInFolder('/docs/tema.md'));
});

test('abre las rutas Markdown recibidas al iniciar o desde una segunda instancia', async () => {
  let subscriber;
  const platform = createPlatformApi({
    Blob,
    __EDIMARK_TAURI__: {
      dialog: {},
      fs: {},
      app: {
        initialMarkdownPaths: async () => ['/tmp/inicial.md'],
        readMarkdownDocument: async path => `Contenido de ${path}`,
        onOpenMarkdownPaths: callback => {
          subscriber = callback;
          return () => { subscriber = null; };
        },
      },
    },
  });

  assert.deepEqual(await platform.initialTextDocumentPaths(), ['/tmp/inicial.md']);
  assert.deepEqual(await platform.openTextDocumentAtPath('/tmp/inicial.md'), {
    path: '/tmp/inicial.md',
    name: 'inicial.md',
    content: 'Contenido de /tmp/inicial.md',
  });
  let received;
  const unsubscribe = platform.onTextDocumentPaths(paths => { received = paths; });
  subscriber(['/tmp/segundo.markdown']);
  assert.deepEqual(received, ['/tmp/segundo.markdown']);
  unsubscribe();
  assert.equal(subscriber, null);
});

/*
  El arrastre del escritorio no pasa por el DOM —el webview se queda con él—,
  así que la plataforma entrega las rutas soltadas, pregunta a Rust qué hay
  dentro (una carpeta trae documentos) y lee en bruto lo que va a Pandoc.
*/
test('entrega el arrastre nativo, expande lo soltado y lee su contenido', async () => {
  let subscriber;
  let pedidas = null;
  const platform = createPlatformApi({
    Blob,
    __EDIMARK_TAURI__: {
      dialog: {},
      fs: {},
      app: {
        onNativeDrop: (callback) => {
          subscriber = callback;
          return () => { subscriber = null; };
        },
        droppedDocumentPaths: async (paths) => {
          pedidas = paths;
          return ['/tmp/carpeta/uno.md', '/tmp/carpeta/dos.docx'];
        },
        readDroppedDocument: async () => new Uint8Array([80, 75, 3, 4]),
      },
    },
  });

  const recibidos = [];
  const unsubscribe = platform.onNativeFileDrop(event => recibidos.push(event));
  subscriber({ type: 'enter' });
  subscriber({ type: 'drop', paths: ['/tmp/carpeta'] });
  assert.deepEqual(recibidos, [{ type: 'enter' }, { type: 'drop', paths: ['/tmp/carpeta'] }]);

  assert.deepEqual(
    await platform.expandDroppedPaths(['/tmp/carpeta']),
    ['/tmp/carpeta/uno.md', '/tmp/carpeta/dos.docx'],
  );
  assert.deepEqual(pedidas, ['/tmp/carpeta']);
  assert.deepEqual([...await platform.readDroppedDocumentBytes('/tmp/carpeta/dos.docx')], [80, 75, 3, 4]);

  unsubscribe();
  assert.equal(subscriber, null);
});

test('en el navegador el arrastre nativo no existe y no estorba', async () => {
  const platform = createPlatformApi({ Blob });
  assert.equal(typeof platform.onNativeFileDrop(() => {}), 'function');
  assert.deepEqual(await platform.expandDroppedPaths(['/tmp/x.md']), []);
  assert.equal(await platform.readDroppedDocumentBytes('/tmp/x.md'), null);
});

test('expone la imagen del portapapeles nativo solo en escritorio', async () => {
  const nativeImage = { rgba: new Uint8Array([255, 0, 0, 255]), size: { width: 1, height: 1 } };
  const platform = createPlatformApi({
    Blob,
    __EDIMARK_TAURI__: {
      dialog: {},
      fs: {},
      clipboard: { readImage: async () => nativeImage },
    },
  });
  assert.deepEqual(await platform.readClipboardImage(), nativeImage);

  const webPlatform = createPlatformApi({ Blob, URL, document: {}, setTimeout });
  assert.equal(await webPlatform.readClipboardImage(), null);
});

test('entrega el fetch nativo para las actualizaciones y nada en el navegador', async () => {
  const peticiones = [];
  const platform = createPlatformApi({
    Blob,
    __EDIMARK_TAURI__: {
      dialog: { open: async () => null, save: async () => null },
      fs: { readTextFile: async () => '', writeTextFile: async () => {} },
      update: {
        fetch: async (url, init) => {
          peticiones.push([url, init]);
          return { ok: true };
        },
      },
    },
  });

  const fetchImpl = platform.updateFetch();
  assert.equal(typeof fetchImpl, 'function');
  assert.deepEqual(await fetchImpl('https://github.com/edimarkdown/x.deb', { method: 'GET' }), { ok: true });
  assert.deepEqual(peticiones, [['https://github.com/edimarkdown/x.deb', { method: 'GET' }]]);

  const navegador = createPlatformApi({ Blob });
  assert.equal(navegador.updateFetch(), null);
});

/*
  Las opciones de la aplicación en el disco: en el escritorio es el archivo el
  que manda, y en el navegador no hay ninguno al que acudir.
*/
test('lee y escribe las opciones en el archivo del perfil', async () => {
  const disco = new Map([['settings.json', '{"documentAuthor":"Juanjo"}']]);
  const platform = createPlatformApi({
    Blob,
    __EDIMARK_TAURI__: {
      dialog: { open: async () => null, save: async () => null },
      fs: { readTextFile: async () => '', writeTextFile: async () => {} },
      settings: {
        read: async name => (disco.has(name) ? disco.get(name) : Promise.reject(new Error('no existe'))),
        write: async (name, contents) => { disco.set(name, contents); },
      },
    },
  });

  assert.equal(await platform.readSettingsFile(), '{"documentAuthor":"Juanjo"}');
  assert.equal(await platform.writeSettingsFile('{"documentAuthor":"Ana"}'), true);
  assert.equal(disco.get('settings.json'), '{"documentAuthor":"Ana"}');
});

test('un archivo ilegible no rompe el arranque: se sigue sin él', async () => {
  const platform = createPlatformApi({
    Blob,
    __EDIMARK_TAURI__: {
      dialog: { open: async () => null, save: async () => null },
      fs: { readTextFile: async () => '', writeTextFile: async () => {} },
      settings: {
        read: async () => { throw new Error('permiso denegado'); },
        write: async () => { throw new Error('disco lleno'); },
      },
    },
  });

  assert.equal(await platform.readSettingsFile(), null);
  assert.equal(await platform.writeSettingsFile('{}'), false);
});

test('en el navegador no hay archivo de opciones', async () => {
  const platform = createPlatformApi({ Blob });
  assert.equal(platform.isDesktop, false);
  assert.equal(await platform.readSettingsFile(), null);
  assert.equal(await platform.writeSettingsFile('{}'), false);
});

/*
  La carpeta de trabajo casi nunca cambia dentro de una sesión: los diálogos
  nativos deben volver a la última usada en vez de a donde el sistema decida.
*/
test('los diálogos recuerdan la última carpeta de la sesión', async () => {
  const dialogos = [];
  const platform = createPlatformApi({
    Blob,
    __EDIMARK_TAURI__: {
      dialog: {
        open: async (options) => {
          dialogos.push(['open', options.defaultPath]);
          return '/home/juanjo/apuntes/tema-1.md';
        },
        save: async (options) => {
          dialogos.push(['save', options.defaultPath]);
          return '/home/juanjo/apuntes/tema-1.docx';
        },
      },
      fs: { readTextFile: async () => '# Tema', writeTextFile: async () => {}, writeFile: async () => {} },
    },
  });

  // La primera vez no hay nada que recordar.
  await platform.openTextDocument();
  assert.deepEqual(dialogos[0], ['open', undefined]);

  // La imagen se busca ya en la carpeta del documento abierto…
  await platform.pickImageFile();
  assert.deepEqual(dialogos[1], ['open', '/home/juanjo/apuntes']);

  // …y al guardar, el nombre propuesto cuelga de esa misma carpeta.
  await platform.saveFile({ suggestedName: 'tema-1.docx', contents: 'x', extensions: ['docx'] });
  assert.deepEqual(dialogos[2], ['save', '/home/juanjo/apuntes/tema-1.docx']);
});

/*
  Un `<a download>` no es un guardado: el navegador lo pasa por su filtro de
  descargas y un reemplazo puede acabar sin escribir nada. Donde hay diálogo
  del sistema se usa ese.
*/
test('en web guarda con el diálogo del navegador en lugar de descargar', async () => {
  let pickerOptions;
  let written = '';
  let closed = false;
  const fileHandle = {
    name: 'apuntes.md',
    async createWritable() {
      return {
        async write(contents) { written = contents; },
        async close() { closed = true; },
      };
    },
  };
  const platform = createPlatformApi({
    Blob,
    showSaveFilePicker: async options => {
      pickerOptions = options;
      return fileHandle;
    },
    document: { createElement: () => assert.fail('no debe descargar') },
  });

  const result = await platform.saveFile({
    suggestedName: 'tema.md',
    contents: '# Tema',
    mimeType: 'text/markdown;charset=utf-8',
  });

  assert.equal(pickerOptions.suggestedName, 'tema.md');
  assert.deepEqual(pickerOptions.types, [{
    description: 'MD',
    accept: { 'text/markdown;charset=utf-8': ['.md'] },
  }]);
  assert.equal(written, '# Tema');
  assert.equal(closed, true);
  // El nombre que vale es el que eligió el usuario, no el propuesto.
  assert.deepEqual(result, { saved: true, path: '', name: 'apuntes.md', fileHandle });
});

test('cancelar el diálogo del navegador no descarga ni marca el documento como guardado', async () => {
  const platform = createPlatformApi({
    Blob,
    showSaveFilePicker: async () => {
      const error = new Error('cancelado');
      error.name = 'AbortError';
      throw error;
    },
    document: { createElement: () => assert.fail('no debe descargar') },
  });

  assert.deepEqual(await platform.saveFile({ suggestedName: 'tema.md', contents: '# Tema' }), {
    saved: false,
    path: '',
    name: 'tema.md',
  });
});

/*
  Firefox no tiene el diálogo, y Chrome lo rechaza fuera de un gesto del
  usuario: antes que perder el documento, se descarga como siempre.
*/
test('sin diálogo utilizable el navegador vuelve a la descarga de siempre', async () => {
  let downloadedName = '';
  const platform = createPlatformApi({
    Blob,
    showSaveFilePicker: async () => { throw new Error('gesto de usuario requerido'); },
    URL: { createObjectURL: () => 'blob:tema', revokeObjectURL() {} },
    document: {
      createElement: () => ({ click() {} }),
      body: { appendChild(node) { downloadedName = node.download; }, removeChild() {} },
    },
    setTimeout() {},
  });

  assert.deepEqual(await platform.saveFile({ suggestedName: 'tema.md', contents: '# Tema' }), {
    saved: true,
    path: '',
    name: 'tema.md',
  });
  assert.equal(downloadedName, 'tema.md');
});

/*
  Guardar dos veces el mismo documento no debe volver a preguntar: el segundo
  `Ctrl+S` escribe en el archivo que ya se eligió, como en el escritorio.
*/
test('en web vuelve a escribir en el archivo ya elegido sin abrir el diálogo', async () => {
  const writes = [];
  const permissions = [];
  const fileHandle = {
    name: 'apuntes.md',
    async queryPermission(options) { permissions.push(options); return 'granted'; },
    async createWritable() {
      return { async write(contents) { writes.push(contents); }, async close() {} };
    },
  };
  const platform = createPlatformApi({
    Blob,
    showSaveFilePicker: async () => assert.fail('no debe volver a preguntar'),
    document: { createElement: () => assert.fail('no debe descargar') },
  });

  const result = await platform.saveFile({
    suggestedName: 'tema.md',
    contents: '# Tema corregido',
    fileHandle,
  });

  assert.deepEqual(permissions, [{ mode: 'readwrite' }]);
  assert.deepEqual(writes, ['# Tema corregido']);
  assert.deepEqual(result, { saved: true, path: '', name: 'apuntes.md', fileHandle });
});

test('un permiso retirado sobre el archivo guardado devuelve al diálogo', async () => {
  let asked = false;
  const staleHandle = {
    name: 'apuntes.md',
    async queryPermission() { return 'prompt'; },
    async requestPermission() { return 'denied'; },
    async createWritable() { assert.fail('no debe escribir sin permiso'); },
  };
  const freshHandle = {
    name: 'apuntes.md',
    async createWritable() {
      return { async write() {}, async close() {} };
    },
  };
  const platform = createPlatformApi({
    Blob,
    showSaveFilePicker: async () => { asked = true; return freshHandle; },
  });

  const result = await platform.saveFile({
    suggestedName: 'tema.md',
    contents: '# Tema',
    fileHandle: staleHandle,
  });

  assert.equal(asked, true);
  assert.equal(result.saved, true);
  assert.equal(result.fileHandle, freshHandle);
});

test('si el archivo guardado ya no admite escritura se pide otra ubicación', async () => {
  let asked = false;
  const brokenHandle = {
    name: 'apuntes.md',
    async createWritable() { throw new Error('el archivo ya no está'); },
  };
  const freshHandle = {
    name: 'apuntes.md',
    async createWritable() {
      return { async write() {}, async close() {} };
    },
  };
  const platform = createPlatformApi({
    Blob,
    showSaveFilePicker: async () => { asked = true; return freshHandle; },
  });

  const result = await platform.saveFile({
    suggestedName: 'tema.md',
    contents: '# Tema',
    fileHandle: brokenHandle,
  });

  assert.equal(asked, true);
  assert.equal(result.fileHandle, freshHandle);
});
