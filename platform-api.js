(function initPlatformApi(root, factory) {
  const exported = factory(root);
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  } else {
    root.EdiMarkPlatform = exported.createPlatformApi(root);
  }
}(typeof window !== 'undefined' ? window : globalThis, function platformApiFactory(defaultRoot) {
  /*
    Solo una dirección lleva consulta, ancla y caracteres codificados. Una ruta
    del disco puede tener `?` —la forma extendida de Windows, `\\?\C:\…`, que
    es la que llega con el doble clic— y `%` o `#` en el nombre del archivo:
    tratarla como dirección dejaba el nombre vacío o lo cambiaba.
  */
  function fileNameFromPath(path) {
    const text = String(path || '');
    const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
    const raw = isUrl ? text.replace(/[?#].*$/, '') : text;
    const segments = raw.split(/[\\/]/);
    const encodedName = segments[segments.length - 1] || '';
    if (!isUrl) return encodedName;
    try {
      return decodeURIComponent(encodedName);
    } catch (_) {
      return encodedName;
    }
  }

  function extensionFromName(name) {
    const match = String(name || '').match(/\.([^.\\/]+)$/);
    return match ? match[1].toLowerCase() : '';
  }

  function directoryFromPath(path) {
    const raw = String(path || '');
    const index = Math.max(raw.lastIndexOf('/'), raw.lastIndexOf('\\'));
    return index < 0 ? '' : raw.slice(0, index);
  }

  function resolveChildPath(directory, relativePath) {
    const windowsStyle = directory.includes('\\') && !directory.includes('/');
    const separator = windowsStyle ? '\\' : '/';
    return `${directory.replace(/[\\/]+$/, '')}${separator}${relativePath.replaceAll('/', separator)}`;
  }

  function browserDownload(root, contents, suggestedName, mimeType) {
    const blob = contents instanceof root.Blob
      ? contents
      : new root.Blob([contents], { type: mimeType || 'application/octet-stream' });
    const url = root.URL.createObjectURL(blob);
    const link = root.document.createElement('a');
    link.href = url;
    link.download = suggestedName;
    root.document.body.appendChild(link);
    link.click();
    root.document.body.removeChild(link);
    root.setTimeout(() => root.URL.revokeObjectURL(url), 1000);
  }

  /*
    Guardar en el navegador con el diálogo del sistema, cuando lo hay.

    Un `<a download>` no guarda: descarga. El navegador decide solo dónde cae
    el archivo y lo hace pasar por su filtro de descargas, que con un `.md`
    grande —el manual importado, con sus imágenes en base64— avisa de que el
    archivo «no es seguro»; y si el usuario elige un nombre que ya existe, el
    aviso de reemplazo lo da el propio navegador y luego descarta la descarga
    sin escribir nada ni volver a preguntar. `showSaveFilePicker` es un
    «Guardar como» de verdad: la ruta la elige el usuario, el reemplazo lo
    resuelve el sistema de archivos y nada de esto es una descarga.

    Firefox todavía no lo tiene, y el propio Chrome lo rechaza fuera de un
    gesto del usuario, así que cualquier fallo que no sea una cancelación
    vuelve al camino de siempre en lugar de dejar el trabajo sin guardar.
  */
  function saveFilePickerTypes(suggestedName, mimeType) {
    const extension = extensionFromName(suggestedName);
    if (!extension) return undefined;
    return [{
      description: extension.toUpperCase(),
      accept: { [mimeType || 'application/octet-stream']: [`.${extension}`] },
    }];
  }

  async function writeFileHandle(fileHandle, contents) {
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(contents);
      await writable.close();
    } catch (error) {
      if (typeof writable.abort === 'function') await writable.abort().catch(() => {});
      throw error;
    }
  }

  /*
    El permiso de escritura sobre un archivo elegido dura lo que dura la
    página, y el usuario puede retirarlo. Se comprueba antes de escribir para
    que un permiso caducado acabe en el diálogo de siempre y no en un error.
  */
  async function canWriteToHandle(fileHandle) {
    if (!fileHandle || typeof fileHandle.createWritable !== 'function') return false;
    if (typeof fileHandle.queryPermission !== 'function') return true;
    const options = { mode: 'readwrite' };
    try {
      if (await fileHandle.queryPermission(options) === 'granted') return true;
      if (typeof fileHandle.requestPermission !== 'function') return false;
      return await fileHandle.requestPermission(options) === 'granted';
    } catch (error) {
      console.warn('No se pudo comprobar el permiso del archivo guardado:', error);
      return false;
    }
  }

  /*
    Volver a guardar el mismo documento escribe en el archivo que ya se eligió,
    sin preguntar otra vez: es lo que hace `Ctrl+S` en la aplicación de
    escritorio. Si el archivo ya no está donde estaba, o el permiso caducó, se
    vuelve al diálogo en lugar de dar un error.
  */
  async function browserSaveToHandle(fileHandle, contents, suggestedName) {
    if (!await canWriteToHandle(fileHandle)) return null;
    try {
      await writeFileHandle(fileHandle, contents);
    } catch (error) {
      console.warn('No se pudo escribir en el archivo guardado:', error);
      return null;
    }
    return { saved: true, name: fileHandle.name || suggestedName, fileHandle };
  }

  async function browserSaveWithPicker(root, contents, suggestedName, mimeType, prepareForSave) {
    if (typeof root.showSaveFilePicker !== 'function') return null;
    let fileHandle;
    try {
      fileHandle = await root.showSaveFilePicker({
        suggestedName,
        types: saveFilePickerTypes(suggestedName, mimeType),
      });
    } catch (error) {
      if (error && error.name === 'AbortError') return { saved: false };
      console.warn('No se pudo abrir el diálogo de guardado del navegador:', error);
      return null;
    }
    // El diálogo del navegador también deja cambiar el nombre, y de él depende
    // cómo se llama la carpeta propia del documento.
    const name = fileHandle.name || suggestedName;
    let finalContents = contents;
    if (typeof prepareForSave === 'function') {
      const prepared = await prepareForSave({ path: '', name, contents, companionFiles: [] });
      if (prepared && typeof prepared === 'object'
        && Object.prototype.hasOwnProperty.call(prepared, 'contents')) {
        finalContents = prepared.contents;
      }
    }
    await writeFileHandle(fileHandle, finalContents);
    return {
      saved: true,
      name,
      fileHandle,
      // Solo cuando el nombre elegido ha cambiado lo que se escribe: así el
      // resultado no crece para quien no lo necesita.
      ...(finalContents === contents ? {} : { contents: finalContents }),
    };
  }

  async function toBytes(root, contents) {
    if (contents instanceof Uint8Array) return contents;
    if (contents instanceof ArrayBuffer) return new Uint8Array(contents);
    if (ArrayBuffer.isView(contents)) {
      return new Uint8Array(contents.buffer, contents.byteOffset, contents.byteLength);
    }
    if (root.Blob && contents instanceof root.Blob) {
      return new Uint8Array(await contents.arrayBuffer());
    }
    return new TextEncoder().encode(String(contents ?? ''));
  }

  /*
    Una carpeta elegida para guardar solo puede recibir rutas descendentes.
    Además de evitar que un ZIP contenga entradas peligrosas, esto impide que
    una referencia como `../comunes/logo.png` escriba fuera de la carpeta que
    el usuario acaba de autorizar.
  */
  function safeCompanionPath(path) {
    const value = String(path || '').replace(/\\/g, '/');
    if (!value || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) return '';
    const segments = value.split('/');
    if (segments.some(segment => !segment || segment === '.' || segment === '..')) return '';
    return segments.join('/');
  }

  function usableCompanionFiles(files) {
    return (Array.isArray(files) ? files : [])
      .map(file => ({
        path: safeCompanionPath(file && (file.relativePath || file.path)),
        contents: file && file.contents,
      }))
      .filter(file => file.path && file.contents != null);
  }

  async function writeDirectoryFile(directory, path, contents) {
    const segments = path.split('/');
    const name = segments.pop();
    let targetDirectory = directory;
    for (const segment of segments) {
      targetDirectory = await targetDirectory.getDirectoryHandle(segment, { create: true });
    }
    const fileHandle = await targetDirectory.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(contents);
      await writable.close();
    } catch (error) {
      if (typeof writable.abort === 'function') await writable.abort().catch(() => {});
      throw error;
    }
  }

  async function saveBrowserDocumentWithAssets(root, {
    suggestedName,
    contents,
    mimeType,
    companionFiles,
    directoryHandle,
  }) {
    const files = usableCompanionFiles(companionFiles);
    let directory = directoryHandle || null;

    if (!directory && typeof root.showDirectoryPicker === 'function') {
      try {
        directory = await root.showDirectoryPicker({ mode: 'readwrite' });
      } catch (error) {
        if (error && error.name === 'AbortError') {
          return { saved: false, path: '', name: suggestedName };
        }
        throw error;
      }
    }

    if (directory) {
      await writeDirectoryFile(directory, suggestedName, contents);
      for (const file of files) {
        await writeDirectoryFile(directory, file.path, file.contents);
      }
      return {
        saved: true,
        path: '',
        name: suggestedName,
        directoryHandle: directory,
        companionCount: files.length,
      };
    }

    /*
      Firefox no ofrece todavía un selector de carpeta con permiso de
      escritura. Varias descargas sueltas perderían `imagenes/…`, porque el
      atributo `download` no puede crear subcarpetas. Un ZIP conserva el `.md`
      y exactamente la misma estructura relativa en todos los navegadores.
    */
    const archiveFiles = new Map([[suggestedName, await toBytes(root, contents)]]);
    for (const file of files) {
      archiveFiles.set(file.path, await toBytes(root, file.contents));
    }
    const { createZip } = await import('./zip-writer.js');
    const archive = await createZip(archiveFiles);
    const archiveName = suggestedName.replace(/\.[^.]+$/, '') + '.zip';
    browserDownload(root, archive, archiveName, 'application/zip');
    return {
      saved: true,
      path: '',
      name: suggestedName,
      archiveName,
      companionCount: files.length,
    };
  }

  function createPlatformApi(root = defaultRoot) {
    const tauri = root && root.__TAURI__;
    const injected = root && root.__EDIMARK_TAURI__;
    const dialog = (injected && injected.dialog) || (tauri && tauri.dialog);
    const fs = (injected && injected.fs) || (tauri && tauri.fs);
    const opener = (injected && injected.opener) || (tauri && tauri.opener);
    const app = injected && injected.app;
    const settingsStore = injected && injected.settings;
    /*
      La última carpeta usada, mientras dure la sesión. Los diálogos nativos
      abren donde el sistema quiera si no se les dice nada, y quien trabaja en
      una carpeta de apuntes acaba navegando hasta ella una y otra vez. No se
      guarda en el disco a propósito: es un atajo de esta sesión, no una
      preferencia que haya que arrastrar de un día para otro.
    */
    let lastDirectory = '';

    function rememberDirectory(path) {
        const directory = directoryFromPath(path);
        if (directory) lastDirectory = directory;
        return path;
    }

    /* Un nombre suelto se abre en la última carpeta; una ruta entera manda. */
    function defaultPathFor(suggestedName = '') {
        if (!lastDirectory) return suggestedName || undefined;
        if (!suggestedName) return lastDirectory;
        return resolveChildPath(lastDirectory, suggestedName);
    }
    const updater = injected && injected.update;
    const clipboard = injected && injected.clipboard;
    const desktop = Boolean(dialog && fs);

    return {
      isDesktop: desktop,
      fileNameFromPath,

      async openExternalUrl(url) {
        const parsed = new URL(String(url));
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error('Solo se pueden abrir enlaces HTTP o HTTPS.');
        }
        if (desktop && opener && typeof opener.openUrl === 'function') {
          await opener.openUrl(parsed.href);
          return;
        }
        if (root && typeof root.open === 'function') {
          root.open(parsed.href, '_blank', 'noopener');
        }
      },

      /*
        Abre la carpeta de un archivo en el gestor de archivos del sistema, con
        el archivo marcado: el Explorador en Windows, el Finder en macOS y en
        Linux el gestor del escritorio (si no admite marcarlo, abre la carpeta
        sin más). En el navegador no hay ruta que abrir.
      */
      canRevealInFolder: Boolean(desktop && opener && typeof opener.revealItemInDir === 'function'),

      async revealInFolder(path) {
        if (!desktop || !opener || typeof opener.revealItemInDir !== 'function') {
          throw new Error('Solo la aplicación de escritorio puede abrir carpetas.');
        }
        if (!path) throw new Error('El documento no está guardado en ningún archivo.');
        await opener.revealItemInDir(String(path));
      },

      /*
        Opciones de la aplicación en el disco. En el navegador no hay dónde
        guardarlas, así que devuelve null y manda `localStorage`; en el
        escritorio, el archivo es la copia buena y `localStorage` solo el
        espejo que lee el resto del código sin esperar a nada.
      */
      async readSettingsFile(name = 'settings.json') {
        if (!desktop || !settingsStore || typeof settingsStore.read !== 'function') return null;
        try {
          const contents = await settingsStore.read(name);
          return typeof contents === 'string' ? contents : null;
        } catch (error) {
          console.warn('No se han podido leer las opciones guardadas:', error);
          return null;
        }
      },

      async writeSettingsFile(contents, name = 'settings.json') {
        if (!desktop || !settingsStore || typeof settingsStore.write !== 'function') return false;
        try {
          await settingsStore.write(name, String(contents));
          return true;
        } catch (error) {
          console.warn('No se han podido guardar las opciones en el disco:', error);
          return false;
        }
      },

      /*
        Preguntas y avisos.

        En el escritorio no valen los del navegador: WebKitGTK trae apagados
        los diálogos modales de JavaScript, de modo que `confirm` no enseña
        nada y responde que no, y `alert` se pierde sin que nadie lo lea. Con
        el diálogo del sistema la pregunta se ve y la respuesta es la del
        usuario. En el navegador siguen valiendo los de siempre.
      */
      async confirm(text, { title = 'EdiMarkdown' } = {}) {
        if (desktop && dialog && typeof dialog.ask === 'function') {
          return Boolean(await dialog.ask(String(text), { title, kind: 'warning' }));
        }
        return Boolean(root.confirm(String(text)));
      },

      async notify(text, { title = 'EdiMarkdown', kind = 'info' } = {}) {
        if (desktop && dialog && typeof dialog.message === 'function') {
          await dialog.message(String(text), { title, kind });
          return;
        }
        root.alert(String(text));
      },

      /*
        Impresión, que es también la vía al PDF. En el escritorio la pide Rust
        al motor del webview: `window.print()` no hace nada en macOS y así los
        tres sistemas se comportan igual.

        La página del documento —sus márgenes y su papel— viaja con la orden
        porque en Linux hace falta: allí el motor es WebKitGTK, que no hace
        caso a `@page` e imprime con los márgenes de su cuadro, así que se los
        pone Rust antes de abrirlo.
      */
      async print(page = null) {
        if (desktop && app && typeof app.printDocument === 'function') {
          await app.printDocument(page);
          return;
        }
        if (typeof root.print === 'function') root.print();
      },

      async openTextDocument({ extensions = ['md', 'markdown'] } = {}) {
        if (!desktop) return null;
        const selected = await dialog.open({
          multiple: false,
          directory: false,
          defaultPath: defaultPathFor(),
          filters: [{ name: 'Markdown', extensions }],
        });
        const path = Array.isArray(selected) ? selected[0] : selected;
        if (!path) return null;
        rememberDirectory(path);
        return {
          path,
          name: fileNameFromPath(path),
          content: await fs.readTextFile(path),
        };
      },

      async openTextDocumentAtPath(path) {
        if (!desktop || !app || typeof app.readMarkdownDocument !== 'function') return null;
        // Vale para el arrastre y para los archivos con los que arranca la
        // aplicación: la carpeta de trabajo suele ser esa.
        rememberDirectory(path);
        return {
          path,
          name: fileNameFromPath(path),
          content: await app.readMarkdownDocument(path),
        };
      },

      /*
        Bytes de una imagen que acompaña al documento abierto, para que la vista
        previa pueda mostrar las rutas relativas del Markdown. Devuelve null en
        el navegador, donde no hay acceso al disco y las imágenes salen de la
        carpeta que el usuario vincule.
      */
      async readDocumentAsset(path) {
        if (!desktop || !app || typeof app.readDocumentAsset !== 'function') return null;
        const data = await app.readDocumentAsset(path);
        if (!data) return null;
        if (data instanceof Uint8Array) return data;
        if (data instanceof ArrayBuffer) return new Uint8Array(data);
        if (Array.isArray(data)) return new Uint8Array(data);
        if (ArrayBuffer.isView(data)) {
          return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
        }
        return null;
      },

      async readDocumentResource(documentPath, relativePath) {
        if (!desktop || !app || typeof app.readDocumentResource !== 'function') return null;
        const text = await app.readDocumentResource(documentPath, relativePath);
        return typeof text === 'string' ? text : null;
      },

      /*
        Corrector ortográfico del sistema. En Linux el webview lo trae apagado y
        hay que encenderlo desde Rust indicando el idioma; en el navegador y en
        los demás sistemas basta con el atributo `spellcheck` del editor.
      */
      async setSpellChecking(enabled, lang) {
        if (!desktop || !app || typeof app.setSpellChecking !== 'function') return;
        try {
          await app.setSpellChecking(Boolean(enabled), String(lang || ''));
        } catch (error) {
          console.warn('No se pudo ajustar el corrector ortográfico:', error);
        }
      },

      /* Diálogo nativo para elegir una imagen: devuelve su ruta en el disco,
         que es lo que permite escribirla en el Markdown como ruta relativa. */
      async pickImageFile() {
        if (!desktop) return null;
        const selected = await dialog.open({
          multiple: false,
          directory: false,
          defaultPath: defaultPathFor(),
          filters: [{
            name: 'Imágenes',
            extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'],
          }],
        });
        const path = Array.isArray(selected) ? selected[0] : selected;
        if (!path) return null;
        rememberDirectory(path);
        return { path, name: fileNameFromPath(path) };
      },

      async initialTextDocumentPaths() {
        if (!desktop || !app || typeof app.initialMarkdownPaths !== 'function') return [];
        const paths = await app.initialMarkdownPaths();
        return Array.isArray(paths) ? paths : [];
      },

      onTextDocumentPaths(callback) {
        if (!desktop || !app || typeof app.onOpenMarkdownPaths !== 'function') return () => {};
        return app.onOpenMarkdownPaths(callback);
      },

      /*
        El arrastre del escritorio. En el navegador lo resuelve el DOM con sus
        `File`; aquí llegan rutas, así que la aplicación pregunta primero qué
        hay dentro de lo soltado —una carpeta puede traer documentos— y luego
        lee lo que necesite.
      */
      onNativeFileDrop(callback) {
        if (!desktop || !app || typeof app.onNativeDrop !== 'function') return () => {};
        return app.onNativeDrop(callback);
      },

      async expandDroppedPaths(paths) {
        if (!desktop || !app || typeof app.droppedDocumentPaths !== 'function') return [];
        const found = await app.droppedDocumentPaths(Array.from(paths || []));
        return Array.isArray(found) ? found : [];
      },

      async readDroppedDocumentBytes(path) {
        if (!desktop || !app || typeof app.readDroppedDocument !== 'function') return null;
        const bytes = await app.readDroppedDocument(path);
        return bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : new Uint8Array(bytes || []);
      },

      /* Cierra la aplicación de escritorio; en el navegador no hace nada. */
      async quitApplication() {
        if (!desktop || !app || typeof app.quit !== 'function') return false;
        await app.quit();
        return true;
      },

      /* Sistema y arquitectura («linux/x86_64») para elegir el instalador. */
      async updateTarget() {
        if (!desktop || !updater || typeof updater.target !== 'function') return '';
        return updater.target();
      },

      /*
        `fetch` nativo para las actualizaciones: GitHub redirige los adjuntos a
        un servidor que no responde con cabeceras CORS, así que el webview los
        rechazaría. En el navegador no hay actualizaciones y devuelve null.
      */
      updateFetch() {
        if (!desktop || !updater || typeof updater.fetch !== 'function') return null;
        return (input, init) => updater.fetch(input, init);
      },

      /* Entrega al sistema el instalador ya descargado y devuelve su ruta. */
      async installDownloadedUpdate(fileName, bytes) {
        if (!desktop || !updater || typeof updater.installDownloaded !== 'function') {
          throw new Error('Esta versión no puede instalar actualizaciones.');
        }
        // El nombre viaja como cabecera del IPC, que solo admite ASCII.
        const safeName = String(fileName || '').replace(/[^A-Za-z0-9._+~-]/g, '-');
        if (!safeName) throw new Error('El instalador no tiene un nombre válido.');
        return updater.installDownloaded(safeName, bytes);
      },

      async readClipboardImage() {
        if (!desktop || !clipboard || typeof clipboard.readImage !== 'function') return null;
        return clipboard.readImage();
      },

      async saveFile({
        suggestedName = 'documento',
        contents = '',
        mimeType = 'application/octet-stream',
        existingPath = '',
        extensions,
        companionFiles,
        directoryHandle,
        fileHandle,
        prepareForSave,
      } = {}) {
        if (!desktop) {
          if (Array.isArray(companionFiles) && companionFiles.length) {
            return saveBrowserDocumentWithAssets(root, {
              suggestedName,
              contents,
              mimeType,
              companionFiles,
              directoryHandle,
            });
          }
          const picked = (fileHandle && await browserSaveToHandle(fileHandle, contents, suggestedName))
            || await browserSaveWithPicker(root, contents, suggestedName, mimeType, prepareForSave);
          if (picked) {
            return {
              saved: picked.saved,
              path: '',
              name: picked.name || suggestedName,
              ...(picked.contents === undefined ? {} : { contents: picked.contents }),
              ...(picked.fileHandle ? { fileHandle: picked.fileHandle } : {}),
            };
          }
          browserDownload(root, contents, suggestedName, mimeType);
          return { saved: true, path: '', name: suggestedName };
        }

        let path = existingPath;
        if (!path) {
          const usableExtensions = Array.isArray(extensions) && extensions.length
            ? extensions
            : [extensionFromName(suggestedName)].filter(Boolean);
          path = await dialog.save({
            defaultPath: defaultPathFor(suggestedName),
            filters: usableExtensions.length
              ? [{ name: usableExtensions.map(ext => ext.toUpperCase()).join('/'), extensions: usableExtensions }]
              : undefined,
          });
        }
        if (!path) return { saved: false, path: '', name: suggestedName };
        rememberDirectory(path);

        /*
          Algunas partes del documento dependen del nombre elegido en el
          diálogo. Es el caso de la carpeta propia de imágenes: al guardar
          `tema.md` como `resumen.md`, `tema/01.png` debe convertirse en
          `resumen/01.png`. Se prepara el contenido después de conocer la ruta
          y antes de escribir nada.
        */
        if (typeof prepareForSave === 'function') {
          const prepared = await prepareForSave({
            path,
            name: fileNameFromPath(path) || suggestedName,
            contents,
            companionFiles,
          });
          if (prepared && typeof prepared === 'object') {
            if (Object.prototype.hasOwnProperty.call(prepared, 'contents')) {
              contents = prepared.contents;
            }
            if (Object.prototype.hasOwnProperty.call(prepared, 'companionFiles')) {
              companionFiles = prepared.companionFiles;
            }
          }
        }

        /*
          El `.md` se escribe desde Rust cuando se puede. El diálogo autoriza al
          plugin de archivos a tocar la ruta elegida, pero ese permiso caduca
          con la sesión, y la aplicación recuerda los documentos abiertos de un
          arranque a otro: sin esto, volver a guardar uno de ayer moría en un
          error o pedía otra vez la ubicación.
        */
        const markdownTarget = typeof contents === 'string'
          && app
          && typeof app.writeMarkdownDocument === 'function'
          && ['md', 'markdown'].includes(extensionFromName(path));
        if (markdownTarget) {
          await app.writeMarkdownDocument(path, contents);
        } else if (typeof contents === 'string') {
          await fs.writeTextFile(path, contents);
        } else {
          await fs.writeFile(path, await toBytes(root, contents));
        }

        const files = usableCompanionFiles(companionFiles);
        const targetDirectory = directoryFromPath(path);
        for (const file of files) {
          const bytes = await toBytes(root, file.contents);
          const extension = extensionFromName(file.path);
          if (app && typeof app.writeDocumentResource === 'function'
              && ['bib', 'json', 'csl'].includes(extension)) {
            await app.writeDocumentResource(path, file.path, bytes);
            continue;
          }
          if (app && typeof app.writeDocumentAsset === 'function') {
            await app.writeDocumentAsset(path, file.path, bytes);
            continue;
          }
          const targetPath = resolveChildPath(targetDirectory, file.path);
          const parentDirectory = directoryFromPath(targetPath);
          if (parentDirectory && typeof fs.mkdir === 'function') {
            await fs.mkdir(parentDirectory, { recursive: true });
          }
          await fs.writeFile(targetPath, bytes);
        }
        const result = {
          saved: true,
          path,
          name: fileNameFromPath(path) || suggestedName,
        };
        if (Array.isArray(companionFiles)) result.companionCount = files.length;
        return result;
      },
    };
  }

  return { createPlatformApi, fileNameFromPath };
}));
