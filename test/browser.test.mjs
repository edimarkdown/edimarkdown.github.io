import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox } from '@playwright/test';
import { runPandoc } from './helpers/pandoc-runner.mjs';
import { inspectProfile, assertProfile } from './helpers/markdown-profile.mjs';
import { MARKDOWN_READER_NO_AUTO_IDS, normalizeThematicBreaks } from '../pandoc-prepare.js';

const defaultRepoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = process.env.EDIMARK_STATIC_ROOT
  ? resolve(defaultRepoRoot, process.env.EDIMARK_STATIC_ROOT)
  : defaultRepoRoot;
// PNG de un píxel: sirve para comprobar que la imagen llega a la vista previa
// sin arrastrar un archivo binario al repositorio.
const PNG_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/*
  Carpeta de trabajo con una imagen dentro, como la que acompaña a cualquier
  artículo. Playwright exige una carpeta de verdad para los `webkitdirectory`.
*/
async function crearCarpetaConImagen() {
  const raiz = await mkdtemp(join(tmpdir(), 'edimark-imagenes-'));
  await mkdir(join(raiz, 'imagenes'), { recursive: true });
  await writeFile(join(raiz, 'imagenes', '01-grafico.png'), PNG_PIXEL);
  return raiz;
}

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.png', 'image/png'],
]);

// script.js abre el editor en vendor/edicuatex/ cuando corre como aplicación
// nativa. Esa copia no está en el repositorio: EdiCuaTeX es una dependencia de
// npm y `npm run build:desktop` la lleva a dist/ aplicándole los retoques de
// integración, así que es de allí de donde hay que servirla. De paso, la prueba
// comprueba también que esos retoques se aplicaron.
const EDICUATEX_RUTA = 'vendor/edicuatex/';
const edicuatexRoot = join(repoRoot, 'dist', 'vendor', 'edicuatex');

let browser;
let server;
let appUrl;

function startStaticServer() {
  return new Promise((resolveServer, reject) => {
    const instance = createServer(async (request, response) => {
      try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
        // La copia de EdiCuaTeX que usa el escritorio no está en el repositorio:
        // es una dependencia de npm y `scripts/build-desktop.mjs` la lleva a
        // dist/vendor/edicuatex al construir. Aquí se sirve desde donde está,
        // para que la ruta que abre la aplicación nativa exista igual que allí.
        const filePath = relativePath.startsWith(EDICUATEX_RUTA)
          ? resolve(edicuatexRoot, relativePath.slice(EDICUATEX_RUTA.length))
          : resolve(repoRoot, relativePath);
        const raiz = relativePath.startsWith(EDICUATEX_RUTA) ? edicuatexRoot : repoRoot;
        if (filePath !== raiz && !filePath.startsWith(`${raiz}${sep}`)) {
          response.writeHead(403).end();
          return;
        }
        const info = await stat(filePath);
        if (!info.isFile()) throw new Error('not_a_file');
        const body = await readFile(filePath);
        response.writeHead(200, {
          'Content-Type': mimeTypes.get(extname(filePath)) || 'application/octet-stream',
          'Cache-Control': 'no-store',
        });
        response.end(body);
      } catch (_error) {
        response.writeHead(404).end('Not found');
      }
    });
    instance.once('error', reject);
    instance.listen(0, '127.0.0.1', () => resolveServer(instance));
  });
}

/*
  Firefox no conoce los permisos del portapapeles y `newContext` aborta con
  «Unknown permission» si se le pasan, así que allí se piden solo los que
  entiende. Lo que de verdad necesite leer o escribir el portapapeles lo decide
  después cada prueba, con `HAY_PORTAPAPELES`.
*/
const PERMISOS_SIN_FIREFOX = new Set(['clipboard-read', 'clipboard-write']);
const HAY_PORTAPAPELES = process.env.BROWSER !== 'firefox';

function permisosDelNavegador(permissions) {
  if (!permissions) return null;
  if (HAY_PORTAPAPELES) return permissions;
  const admitidos = permissions.filter(permiso => !PERMISOS_SIN_FIREFOX.has(permiso));
  return admitidos.length ? admitidos : null;
}

async function openApp({ locale = 'es-ES', colorScheme, initStorage, permissions, userAgent } = {}) {
  const permisos = permisosDelNavegador(permissions);
  const context = await browser.newContext({
    locale,
    // El tema por defecto es el del sistema, así que esto es lo que enciende el
    // modo oscuro de la aplicación sin tocar sus ajustes.
    ...(colorScheme ? { colorScheme } : {}),
    ...(permisos ? { permissions: permisos } : {}),
    // Para hacerse pasar por el motor de la aplicación de escritorio, que en
    // Linux es WebKitGTK y no imprime como Chromium.
    ...(userAgent ? { userAgent } : {}),
  });
  if (initStorage) {
    await context.addInitScript(initStorage);
  }
  await context.route(/pandoc\.b64(?:\.gz)?(?:\?.*)?$/, route => (
    route.fulfill({ status: 200, contentType: 'text/plain', body: '' })
  ));
  const requests = [];
  const page = await context.newPage();
  page.on('request', request => requests.push(request.url()));
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.tab-name').first().waitFor();
  // La pestaña aparece antes de que el arranque termine de registrar los
  // atajos de teclado: sin esperar, las pruebas que pulsan teclas fallaban
  // una de cada tres veces.
  await page.waitForFunction(() => window.__edimarkReady === true);
  return { context, page, requests };
}

/*
  Deja la hoja a tamaño real y quieta. Con el panel atado a la lupa la hoja
  llena el ancho que tenga el panel —que es lo que se quiere al escribir—, así
  que comprobar que un 13 pt mide 17,33 px o que la hoja mide una A4 pide fijar
  antes el 100 %, que es cuando la pantalla y el papel miden lo mismo.
*/
async function conLaHojaATamanoReal(page) {
  await page.evaluate(() => {
    atarPanelALaLupa(false);
    applyZoom(PREVIEW_ZOOM, 1);
  });
}

before(async () => {
  server = await startStaticServer();
  const address = server.address();
  appUrl = `http://127.0.0.1:${address.port}/index.html`;
  const browserName = process.env.BROWSER === 'firefox' ? 'firefox' : 'chromium';
  const browserType = browserName === 'firefox' ? firefox : chromium;
  const systemChromium = browserName === 'chromium' && existsSync('/usr/bin/chromium')
    ? '/usr/bin/chromium'
    : undefined;
  browser = await browserType.launch({ executablePath: systemChromium, headless: true });
});

after(async () => {
  if (browser) await browser.close();
  if (server) await new Promise(resolveServer => server.close(resolveServer));
});

test('un idioma no disponible recurre al español', async (t) => {
  const { context, page, requests } = await openApp({ locale: 'fr-FR' });
  t.after(() => context.close());

  await page.waitForFunction(() => document.documentElement.lang === 'es');
  assert.equal(await page.locator('#html-output h1').textContent(), 'Manual de EdiMarkdown');
  assert.equal(requests.some(url => url.endsWith('/locales/fr.json')), false);
  assert.equal(await page.locator('.site-footer').count(), 0);
  assert.equal(await page.locator('#desktop-release-banner').isVisible(), true);
  const packageVersion = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8')).version;
  assert.match(await page.locator('#desktop-release-banner').innerText(), new RegExp(`v${packageVersion.replaceAll('.', '\\.')}`));
  assert.equal(
    await page.locator('#desktop-banner-download-link').getAttribute('href'),
    'https://github.com/edimarkweb/edimarkweb.github.io/releases/latest',
  );

  await page.locator('#help-menu-btn').click();
  await page.locator('#about-btn').click();
  await page.locator('#about-modal-overlay').waitFor({ state: 'visible' });
  assert.equal(
    await page.locator('#about-web-link').getAttribute('href'),
    'https://edimarkweb.github.io/',
  );
  assert.equal(
    await page.locator('#about-desktop-link').getAttribute('href'),
    'https://github.com/edimarkweb/edimarkweb.github.io/releases/latest',
  );
  await page.locator('#about-close-btn').click();
  await page.locator('#desktop-banner-never-show').check();
  await page.locator('#desktop-banner-close').click();
  await page.reload();
  await page.waitForFunction(() => document.documentElement.lang === 'es');
  assert.equal(await page.locator('#desktop-release-banner').isVisible(), false);
});

test('la aplicación nativa aprovecha toda la ventana y comparte el cuadro Acerca de', async (t) => {
  const { context, page } = await openApp({
    initStorage: () => {
      try { localStorage.setItem('edimarkweb-theme', 'dark'); } catch (_error) {}
      window.__EDIMARK_TAURI__ = {
        dialog: {},
        fs: {},
        opener: {
          openUrl: async url => {
            window.__openedExternalUrl = url;
          },
        },
      };
    },
  });
  t.after(() => context.close());

  assert.equal(await page.locator('body').evaluate(body => body.classList.contains('desktop-mode')), true);
  const dimensions = await page.locator('#main-container').evaluate((main) => {
    const rect = main.getBoundingClientRect();
    return { left: rect.left, width: rect.width, viewport: window.innerWidth };
  });
  assert.equal(dimensions.left, 0);
  assert.equal(dimensions.width, dimensions.viewport);
  assert.equal(await page.locator('.site-footer').count(), 0);
  assert.equal(await page.locator('#desktop-download-link').count(), 0);
  assert.equal(await page.locator('#desktop-release-banner').isVisible(), false);
  assert.equal(await page.locator('#toggle-width-btn').isVisible(), false);
  /*
    Lo último de la ventana ya no es el editor, sino la barra de estado: es ella
    la que tiene que quedar pegada al borde de abajo para que la aplicación
    aproveche la ventana entera.
  */
  const bottomGap = await page.locator('#status-bar').evaluate((barra) => (
    window.innerHeight - barra.getBoundingClientRect().bottom
  ));
  assert.ok(bottomGap >= 10 && bottomGap <= 17, `margen inferior inesperado: ${bottomGap}px`);

  const packageVersion = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8')).version;
  await page.locator('#help-menu-btn').click();
  await page.locator('#about-btn').click();
  await page.locator('#about-modal-overlay').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#about-modal-overlay [data-app-version]').textContent(), packageVersion);
  assert.match(await page.locator('#about-modal-overlay').innerText(), /Juan José de Haro/);
  assert.match(await page.locator('#about-modal-overlay').innerText(), /GNU AGPL v3/);
  assert.equal(await page.locator('#about-web-link').getAttribute('href'), 'https://edimarkweb.github.io/');
  assert.equal(
    await page.locator('#about-desktop-link').getAttribute('href'),
    'https://github.com/edimarkweb/edimarkweb.github.io/releases/latest',
  );
  await page.locator('#about-web-link').click();
  await page.waitForFunction(() => window.__openedExternalUrl === 'https://edimarkweb.github.io/');
  await page.locator('#about-close-btn').click();
  await page.locator('#about-modal-overlay').waitFor({ state: 'hidden' });

  // El formato se aplica también con el foco en la previsualización: los
  // botones ya no se apagan al pasar a la hoja.
  await page.locator('#html-output').focus();
  assert.equal(await page.locator('#formula-btn').getAttribute('data-controls-disabled'), null);
  assert.equal(await page.locator('#open-edicuatex-btn').getAttribute('data-controls-disabled'), null);

  await page.locator('#markdown-input').focus();
  await page.locator('#open-edicuatex-btn').click();
  await page.locator('#edicuatex-modal-overlay').waitFor({ state: 'visible' });
  const edicuatexUrl = new URL(await page.locator('#edicuatex-frame').getAttribute('src'));
  assert.equal(edicuatexUrl.origin, new URL(appUrl).origin);
  assert.equal(edicuatexUrl.pathname, '/vendor/edicuatex/index.html');
  assert.equal(edicuatexUrl.searchParams.get('lang'), 'es');
  assert.equal(edicuatexUrl.searchParams.get('mode'), 'dark');
  const embeddedEdicuatex = page.frameLocator('#edicuatex-frame');
  await embeddedEdicuatex.getByRole('button', { name: 'Básico', exact: true }).waitFor();
  assert.equal(await embeddedEdicuatex.locator('.tab-btn').count(), 15);
  assert.equal(await embeddedEdicuatex.locator('#toolbar .toolbar-btn').count(), 14);
  assert.equal(await embeddedEdicuatex.locator('html').getAttribute('data-edimark-theme'), 'dark');
  await embeddedEdicuatex.locator('#settings-btn').click();
  assert.equal(await embeddedEdicuatex.locator('#settings-modal').evaluate(modal => modal.classList.contains('active')), true);
  const edicuatexFrame = page.frames().find(frame => frame.url().includes('/vendor/edicuatex/index.html'));
  assert.ok(edicuatexFrame, 'no se cargó el editor EdiCuaTeX incrustado');
  await edicuatexFrame.evaluate(() => {
    const targetOrigin = new URLSearchParams(location.search).get('origin');
    parent.postMessage({
      type: 'edicuatex:result',
      latex: 'x^2',
      delimiter: 'parentheses',
      wrapped: '\\(x^2\\)',
    }, targetOrigin);
  });
  await page.locator('#edicuatex-modal-overlay').waitFor({ state: 'hidden' });
  assert.match(await page.locator('#markdown-input').inputValue(), /\\\(x\^2\\\)/);
});

test('las preferencias del perfil sobreviven a una instalación con el almacén vacío', async (t) => {
  const { context, page } = await openApp({
    locale: 'es-ES',
    initStorage: () => {
      /*
        Una versión recién instalada: el archivo del perfil conserva lo que el
        usuario tenía elegido, pero el almacén del webview llega en blanco.
      */
      const archivos = new Map([['preferences.json', JSON.stringify({
        language: 'en',
        'edimarkweb-theme': 'dark',
        'edimarkweb-markdown-zoom': '1.5',
      })]]);
      window.__edimarkPreferenceFiles = archivos;
      window.__EDIMARK_TAURI__ = {
        dialog: {},
        fs: {},
        settings: {
          read: async name => archivos.get(name) ?? null,
          write: async (name, contents) => { archivos.set(name, contents); },
        },
      };
    },
  });
  t.after(() => context.close());

  await page.waitForFunction(() => document.documentElement.lang === 'en');
  assert.equal(await page.locator('html').evaluate(html => html.classList.contains('dark')), true);
  assert.equal(
    await page.locator('html').evaluate(html => html.style.getPropertyValue('--markdown-zoom')),
    '1.5',
  );

  // Y lo que se cambia ahora vuelve al archivo, no solo al almacén.
  await page.evaluate(() => {
    const select = document.getElementById('language-select');
    select.value = 'ca';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const guardado = window.__edimarkPreferenceFiles.get('preferences.json');
    return guardado ? JSON.parse(guardado).language === 'ca' : false;
  });
});

test('en el escritorio la pestaña con cambios pregunta antes de cerrarse', async (t) => {
  const { context, page } = await openApp({
    initStorage: () => {
      /*
        WebKitGTK trae apagados los diálogos modales de JavaScript, así que la
        aplicación de escritorio pregunta con el diálogo del sistema. Aquí se
        finge ese diálogo para poder responder que no y que sí.
      */
      window.__edimarkPreguntas = [];
      window.__edimarkRespuesta = false;
      window.__EDIMARK_TAURI__ = {
        dialog: {
          ask: async (texto) => {
            window.__edimarkPreguntas.push(texto);
            return window.__edimarkRespuesta;
          },
        },
        fs: {},
      };
    },
  });
  t.after(() => context.close());

  await page.locator('#markdown-input').focus();
  await page.keyboard.type('Un cambio sin guardar');
  await page.locator('.tab').first().locator('.tab-dirty').waitFor({ state: 'visible' });

  // Con la respuesta en «no», la pestaña se queda donde estaba.
  await page.locator('.tab').first().locator('.tab-close').click();
  await page.waitForFunction(() => window.__edimarkPreguntas.length === 1);
  assert.equal(await page.locator('.tab').count(), 1);

  // Y con la respuesta en «sí», se cierra.
  await page.evaluate(() => { window.__edimarkRespuesta = true; });
  await page.locator('.tab').first().locator('.tab-close').click();
  // Era la única: en su lugar queda una en blanco, nunca el editor sin pestaña.
  await page.waitForFunction(() => docs.length === 1 && markdownEditor.getValue() === '');
  assert.equal(await page.locator('.tab').count(), 1);
  assert.equal((await page.evaluate(() => window.__edimarkPreguntas.length)), 2);
});

test('el PDF del menú de exportación sale por la impresión, no por Pandoc', async (t) => {
  const { context, page } = await openApp({});
  t.after(() => context.close());

  /*
    Pandoc no sabe hacer PDF sin un motor LaTeX, así que esa entrada lleva al
    diálogo de impresión, donde el sistema ofrece «Guardar como PDF». Aquí se
    sustituye la impresión para que la prueba no abra un diálogo de verdad.
  */
  await page.evaluate(() => { window.__impresiones = 0; window.print = () => { window.__impresiones += 1; }; });
  await page.locator('#export-menu-btn').click();
  await page.locator('#export-menu').waitFor({ state: 'visible' });
  await page.locator('#export-menu [data-export-format="pdf"]').click();
  await page.waitForFunction(() => window.__impresiones === 1);
  assert.equal(await page.locator('#export-menu').isVisible(), false);
});

/*
  Exportar y copiar son la misma acción con distinto destino, así que el botón
  de exportar funciona igual que el de copiar: repite de un clic el último
  formato, lo dice en su rótulo y guarda la flecha para cambiarlo. Las dos
  listas —la de la cabecera y la de la flecha— alimentan esa memoria.
*/
test('el botón de exportar repite el último formato y lo dice', async (t) => {
  const { context, page } = await openApp({});
  t.after(() => context.close());

  // Se prueba con PDF, que es el único formato que no pasa por Pandoc.
  await page.evaluate(() => { window.__impresiones = 0; window.print = () => { window.__impresiones += 1; }; });

  const rotulo = () => page.locator('#export-quick-btn').innerText();
  assert.equal((await rotulo()).trim(), 'DOCX', 'de partida, el primero de la lista');

  // Elegir en la lista de la cabecera es decir también qué repetirá el botón.
  await page.locator('#export-menu-btn').click();
  await page.locator('#export-menu [data-export-format="pdf"]').click();
  await page.waitForFunction(() => window.__impresiones === 1);
  assert.equal((await rotulo()).trim(), 'PDF');

  // Y el botón lo repite sin abrir nada.
  await page.locator('#export-quick-btn').click();
  await page.waitForFunction(() => window.__impresiones === 2);
  assert.equal(await page.locator('#export-quick-menu').isVisible(), false);

  // La flecha abre la misma lista, con el formato de ahora marcado.
  await page.locator('#export-quick-menu-toggle').click();
  await page.locator('#export-quick-menu').waitFor({ state: 'visible' });
  assert.equal(
    await page.locator('#export-quick-menu [data-export-format="pdf"]').getAttribute('aria-checked'),
    'true',
  );
  assert.equal(
    await page.locator('#export-quick-menu [data-export-format="docx"]').getAttribute('aria-checked'),
    'false',
  );
  // Y se cierra con Escape, como los demás menús.
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#export-quick-menu').isVisible(), false);

  // El formato elegido sobrevive a la recarga.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__edimarkReady === true);
  assert.equal((await rotulo()).trim(), 'PDF');
});

/*
  En el escritorio, un documento llega por su ruta: al abrirlo dos veces —doble
  clic, o soltándolo— no puede acabar en dos pestañas, cada una con su copia,
  porque guardar en una pisaría lo escrito en la otra. Y el arrastre nativo no
  pasa por el DOM: el webview se queda con él, así que la aplicación escucha el
  evento propio de la ventana.
*/
const escritorioConDisco = () => {
  window.__edimarkDisco = { '/docs/tema.md': '# Tema\n\nPrimera versión' };
  window.__EDIMARK_TAURI__ = {
    dialog: {},
    fs: {},
    opener: { revealItemInDir: async path => { window.__carpetasAbiertas = [...(window.__carpetasAbiertas || []), path]; } },
    app: {
      initialMarkdownPaths: async () => ['/docs/tema.md'],
      readMarkdownDocument: async path => window.__edimarkDisco[path] ?? '',
      onOpenMarkdownPaths: (callback) => { window.__abrirRutas = callback; return () => {}; },
      onNativeDrop: (callback) => { window.__soltar = callback; return () => {}; },
      droppedDocumentPaths: async paths => paths,
      readDroppedDocument: async () => new Uint8Array(),
    },
  };
};

test('un documento del sistema abierto dos veces vuelve a su pestaña', async (t) => {
  const { context, page } = await openApp({ initStorage: escritorioConDisco });
  t.after(() => context.close());

  const pestanas = () => page.locator('.tab-name').allTextContents();
  const activa = () => page.locator('.tab[aria-selected="true"] .tab-name').innerText();

  // Al arrancar se abre el documento asociado, y es el que queda delante.
  await page.waitForFunction(() => document.querySelector('.tab[aria-selected="true"] .tab-name')?.textContent === 'tema.md');
  assert.deepEqual(await pestanas(), ['tema.md']);

  // Abrirlo otra vez no lo duplica: vuelve a su pestaña y trae lo que hay en
  // el disco, que puede haber cambiado desde fuera.
  await page.evaluate(() => {
    window.__edimarkDisco['/docs/tema.md'] = '# Tema\n\nSegunda versión';
    window.__abrirRutas(['/docs/tema.md']);
  });
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('Segunda versión'));
  assert.deepEqual(await pestanas(), ['tema.md']);
  assert.equal(await activa(), 'tema.md');
  // Y llega sin marca de cambios: es lo que hay guardado.
  assert.equal(await page.locator('.tab[aria-selected="true"] .tab-dirty').isVisible(), false);

  // Soltarlo sobre la ventana hace lo mismo, por el evento nativo.
  await page.evaluate(() => window.__soltar({ type: 'drop', paths: ['/docs/tema.md'] }));
  await page.waitForTimeout(300);
  assert.deepEqual(await pestanas(), ['tema.md']);

  // Y un documento distinto sí abre su pestaña.
  await page.evaluate(() => {
    window.__edimarkDisco['/docs/otro.md'] = '# Otro';
    window.__soltar({ type: 'drop', paths: ['/docs/otro.md'] });
  });
  await page.waitForFunction(() => document.querySelectorAll('.tab-name').length === 2);
  assert.equal(await activa(), 'otro.md');
});

test('en el escritorio cada pestaña dice dónde está su archivo', async (t) => {
  const { context, page } = await openApp({ initStorage: escritorioConDisco });
  t.after(() => context.close());

  const tema = page.locator('.tab', { hasText: 'tema.md' });
  await tema.waitFor();
  await page.waitForFunction(() => document.querySelector('.tab[aria-selected="true"]')?.title === '/docs/tema.md');

  // Con cambios pendientes lo dice también.
  await page.locator('#markdown-input').focus();
  await page.keyboard.type(' más');
  await page.waitForFunction(() => document.querySelector('.tab[aria-selected="true"]')?.title === '/docs/tema.md\nCambios sin guardar');

  // Un documento nuevo no está en ningún archivo.
  await page.evaluate(() => newDoc('nuevo.md', 'x'));
  assert.match(await page.locator('.tab', { hasText: 'nuevo.md' }).getAttribute('title'), /^Sin guardar en ningún archivo/);

  // El menú de la pestaña empieza por lo mismo, para el táctil y el teclado.
  await tema.click({ button: 'right' });
  assert.equal(await page.locator('#tab-menu-location-text').textContent(), '/docs/tema.md');
  assert.equal(await page.locator('#tab-menu-location').isVisible(), true);

  // Pulsar la ruta abre su carpeta y cierra el menú.
  await page.locator('#tab-menu-location').click();
  assert.deepEqual(await page.evaluate(() => window.__carpetasAbiertas), ['/docs/tema.md']);
  assert.equal(await page.locator('#tab-context-menu').isVisible(), false);

  // Sin archivo no hay carpeta: el aviso no se puede pulsar.
  await page.locator('.tab', { hasText: 'nuevo.md' }).click({ button: 'right' });
  assert.match(await page.locator('#tab-menu-location-text').textContent(), /Sin guardar en ningún archivo/);
  assert.equal(await page.locator('#tab-menu-location').isDisabled(), true);
});

test('en el navegador las pestañas no muestran ubicación', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.evaluate(() => newDoc('nuevo.md', 'x'));
  assert.equal(await page.locator('.tab', { hasText: 'nuevo.md' }).getAttribute('title'), null);
  await page.locator('.tab', { hasText: 'nuevo.md' }).click({ button: 'right' });
  assert.equal(await page.locator('#tab-menu-location').isVisible(), false);
});

/*
  El manual se pide por red y tarda. Si mientras tanto llega un documento del
  sistema, el manual no puede ponerse delante: el archivo que el usuario acaba
  de abrir se quedaría en su pestaña y el foco saltaría a la primera.
*/
test('el manual que llega tarde no le quita el sitio al documento abierto', async (t) => {
  const { context, page } = await openApp({
    initStorage: () => {
      window.__edimarkDisco = { '/docs/tema.md': '# Tema' };
      // El manual, con retraso: es lo que provoca la carrera.
      const original = window.fetch;
      window.fetch = (input, init) => {
        const url = String(typeof input === 'string' ? input : input?.url || '');
        if (/manual[^/]*\.md/.test(url)) {
          return new Promise(resolve => setTimeout(() => resolve(original(input, init)), 600));
        }
        return original(input, init);
      };
      window.__EDIMARK_TAURI__ = {
        dialog: {},
        fs: {},
        app: {
          initialMarkdownPaths: async () => [],
          readMarkdownDocument: async path => window.__edimarkDisco[path] ?? '',
          onOpenMarkdownPaths: (callback) => { window.__abrirRutas = callback; return () => {}; },
          onNativeDrop: () => () => {},
          droppedDocumentPaths: async paths => paths,
          readDroppedDocument: async () => new Uint8Array(),
        },
      };
    },
  });
  t.after(() => context.close());

  // En cuanto la aplicación escucha, llega el documento: el manual sigue en el aire.
  await page.waitForFunction(() => typeof window.__abrirRutas === 'function');
  await page.evaluate(() => window.__abrirRutas(['/docs/tema.md']));
  await page.waitForFunction(() => document.querySelectorAll('.tab-name').length === 2);

  // El manual acaba de llegar y se queda en su pestaña, sin robar el foco.
  const nombres = await page.locator('.tab-name').allTextContents();
  assert.ok(nombres.includes('Manual'), `faltó el manual: ${nombres}`);
  assert.equal(await page.locator('.tab[aria-selected="true"] .tab-name').innerText(), 'tema.md');
});

test('una lista local dañada no impide arrancar y conserva una copia', async (t) => {
  const { context, page } = await openApp({
    locale: 'en-US',
    initStorage: () => {
      try {
        localStorage.setItem('edimarkweb-docslist', '{broken');
      } catch (_error) {
        // The script also runs for the initial opaque document.
      }
    },
  });
  t.after(() => context.close());

  await page.waitForFunction(() => document.documentElement.lang === 'en');
  assert.equal(await page.locator('.tab-name').first().textContent(), 'Manual');
  assert.equal(
    await page.evaluate(() => localStorage.getItem('edimarkweb-docslist-corrupt-backup')),
    '{broken'
  );
  await page.locator('#status-toast-message').getByText('The saved document list was damaged.').waitFor();
});

test('pestañas, sincronización y búsqueda funcionan juntas', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  assert.equal(await page.locator('.tab').count(), 2);

  const markdown = page.locator('#markdown-input');
  await markdown.fill('# Prueba\n\nÁrbol y arbol');
  await page.locator('#html-output h1').getByText('Prueba', { exact: true }).waitFor();

  await page.locator('#open-search-btn').click();
  await page.locator('#search-input').fill('arbol');
  await page.locator('#search-matches-info').getByText('1 / 2', { exact: true }).waitFor();

  await page.evaluate(() => {
    const preview = document.getElementById('html-output');
    preview.focus();
    preview.innerHTML = '<h1>Cambio HTML</h1>';
    preview.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('# Cambio HTML'));
});

/*
  El cuadro de búsqueda roba el foco al abrirse, así que el editor sobre el que
  hay que buscar es el que lo tenía justo antes, no el que lo tiene al buscar.
*/
test('en diseño dual se busca en el panel que se estaba editando', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill('# Solo en Markdown\n');
  await page.locator('#html-output h1').getByText('Solo en Markdown', { exact: true }).waitFor();

  // El panel derecho pasa a mostrar el código HTML y se edita allí. El botón que
  // lo alterna es suyo, así que hay que estar en ese panel para llegar a él.
  await page.locator('#html-output').click();
  await page.locator('#view-toggle-btn').click();
  await page.waitForFunction(() => htmlEditor.getValue().includes('<h1'));
  await page.evaluate(() => htmlEditor.focus());

  // `<h1` solo existe en el panel HTML: si la búsqueda cayera en el Markdown,
  // no habría ninguna coincidencia.
  await page.locator('#open-search-btn').click();
  await page.locator('#search-input').fill('<h1');
  await page.locator('#search-matches-info').getByText('1 / 1', { exact: true }).waitFor();
});

test('cerrar la búsqueda devuelve el foco al editor', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill('texto cualquiera');
  await page.evaluate(() => markdownEditor.focus());

  await page.locator('#open-search-btn').click();
  await page.locator('#search-input').fill('texto');
  await page.locator('#search-matches-info').getByText('1 / 1', { exact: true }).waitFor();
  await page.locator('#close-search-btn').click();

  assert.ok(
    await page.evaluate(() => markdownEditor.hasFocus()),
    'el foco no volvió al editor al cerrar la búsqueda',
  );
});

test('la búsqueda lleva al resultado lejano sin sacar el foco del buscador', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  const lineas = Array.from({ length: 320 }, (_, indice) => (
    indice === 278 ? 'La coincidencia con Ferreras está aquí.' : `Línea de relleno ${indice}.`
  ));
  await page.locator('#markdown-input').fill(lineas.join('\n'));

  await page.locator('#open-search-btn').click();
  await page.locator('#search-input').fill('ferreras');
  await page.locator('#search-matches-info').getByText('1 / 1', { exact: true }).waitFor();

  const estado = await page.evaluate(() => {
    const textarea = document.getElementById('markdown-input');
    const input = document.getElementById('search-input');
    const linea = textarea.value.split('\n').findIndex(texto => texto.includes('Ferreras'));
    const medida = markdownEditor.lineMetrics(linea);
    return {
      foco: document.activeElement === input,
      desplazado: textarea.scrollTop > 0,
      visible: medida.top >= textarea.scrollTop
        && medida.top + medida.height <= textarea.scrollTop + textarea.clientHeight,
      seleccionado: textarea.value.slice(textarea.selectionStart, textarea.selectionEnd),
    };
  });

  assert.equal(estado.foco, true, 'el foco abandonó el cuadro de búsqueda');
  assert.equal(estado.desplazado, true, 'el editor siguió al principio del documento');
  assert.equal(estado.visible, true, 'la línea encontrada quedó fuera de la zona visible');
  assert.equal(estado.seleccionado.toLowerCase(), 'ferreras');
});

/*
  El repintado de la vista previa está limitado en frecuencia, y ese mismo
  repintado es lo que vuelca el Markdown al editor HTML: la escritura seguida no
  puede dejar ningún panel con contenido viejo.
*/
/*
  Una imagen copiada de una página web llega publicada a la vez en `files` y
  como item del portapapeles, y `getAsFile()` devuelve un objeto nuevo cada
  vez: se colaban como dos imágenes distintas y se pegaban por duplicado. El
  portapapeles hay que prepararlo desde la propia página, así que hace falta el
  permiso de escritura, que solo se concede en Chromium.
*/
test('una imagen copiada de la web se pega una sola vez', {
  skip: process.env.BROWSER === 'firefox'
    ? 'preparar un portapapeles con imagen solo funciona en Chromium'
    : false,
}, async (t) => {
  const { context, page } = await openApp({ permissions: ['clipboard-read', 'clipboard-write'] });
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.evaluate(async (pixel) => {
    const bytes = Uint8Array.from(atob(pixel), caracter => caracter.charCodeAt(0));
    await navigator.clipboard.write([new ClipboardItem({
      'image/png': new Blob([bytes], { type: 'image/png' }),
      'text/html': new Blob(['<img src="https://ejemplo.test/foto.png" alt="foto">'], { type: 'text/html' }),
    })]);
  }, PNG_PIXEL.toString('base64'));

  await page.locator('#markdown-input').click();
  await page.keyboard.press('Control+V');
  await page.locator('#html-output img').first().waitFor();

  assert.equal(await page.locator('#html-output img').count(), 1);
  const markdown = await page.locator('#markdown-input').inputValue();
  assert.equal(markdown.match(/!\[/g)?.length ?? 0, 1, `Markdown obtenido: ${markdown.slice(0, 200)}`);
});

test('escribir sin pausas mantiene los dos paneles al día', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').click();
  await page.keyboard.type('# Escritura seguida', { delay: 15 });

  await page.locator('#html-output h1').getByText('Escritura seguida', { exact: true }).waitFor();
  await page.waitForFunction(() => htmlEditor.getValue().includes('Escritura seguida'));
});

/*
  El aviso de privacidad dice que la web no recoge estadísticas ni envía nada a
  terceros. Al abrirla solo puede pedir sus propios archivos y las bibliotecas
  de los CDN. Se sirve desde un host inventado porque en localhost la antigua
  analítica tampoco se cargaba, y así la prueba lo vería si volviera.
*/
test('la web solo pide sus archivos y las bibliotecas al abrirse', {
  skip: Boolean(process.env.EDIMARK_STATIC_ROOT),
}, async (t) => {
  const context = await browser.newContext();
  t.after(() => context.close());

  const host = 'https://edimarkweb.test';
  await context.route(`${host}/**`, async (route) => {
    const ruta = new URL(route.request().url()).pathname;
    const respuesta = await route.fetch({ url: `${appUrl.replace('/index.html', '')}${ruta}` });
    await route.fulfill({ response: respuesta });
  });
  // Pandoc se sirve entero: vacío, la aplicación iría a buscar su copia de
  // reserva fuera y la prueba lo contaría.
  const permitidos = new Set(['edimarkweb.test', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com']);
  const ajenos = [];
  context.on('request', (request) => {
    const url = new URL(request.url());
    if (/^https?:$/.test(url.protocol) && !permitidos.has(url.hostname)) ajenos.push(request.url());
  });

  const page = await context.newPage();
  await page.goto(`${host}/index.html`, { waitUntil: 'load' });
  await page.locator('.tab-name').first().waitFor();
  await page.waitForTimeout(3000);

  assert.deepEqual(ajenos, []);
});

test('los controles de imágenes y de pegado se traducen', async (t) => {
  const { context, page } = await openApp({ locale: 'en-US' });
  t.after(() => context.close());

  await page.waitForFunction(() => document.documentElement.lang === 'en');
  assert.equal(await page.locator('#paste-btn').getAttribute('title'), 'Paste from clipboard (Ctrl+Alt+V)');
  await page.locator('#new-tab-btn').click();
  await page.evaluate(() => markdownEditor.setValue('![Demo](data:image/png;base64,iVBORw0KGgo=)'));
  await page.locator('.base64-hidden-title').getByText('Document images', { exact: true }).waitFor();
  await page.locator('#base64-hidden-toggle').click();
  // Por su etiqueta accesible, no por el rótulo: en un panel estrecho el texto
  // del botón no se dibuja y solo queda el icono.
  const moveButton = page.locator('.base64-hidden-btn[aria-label="Move to folder"]');
  await moveButton.waitFor();
  assert.equal(
    await moveButton.getAttribute('title'),
    'Writes this image as a file in the document folder and leaves its path in the text',
  );
  assert.equal(await page.locator('#base64-extract-btn').isVisible(), false);
});

test('los id de encabezado conservan palabras, guiones y dígitos', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.evaluate(() => markdownEditor.setValue('# Mi Título Principal 2\n'));
  await page.locator('#html-output h1').getByText('Mi Título Principal 2', { exact: true }).waitFor();
  assert.equal(await page.locator('#html-output h1').getAttribute('id'), 'mi-título-principal-2');
});

test('un nombre de documento con marcado no se interpreta como HTML', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const hostileName = '<img src=x onerror="window.__injected = true">.md';
  await page.evaluate(name => newDoc(name, 'contenido'), hostileName);

  assert.equal(await page.locator('.tab-name').last().textContent(), hostileName);
  assert.equal(await page.locator('.tab img').count(), 0);
  assert.equal(await page.evaluate(() => window.__injected === true), false);
});

/*
  Ctrl+T, Ctrl+W y Ctrl+Tab son del navegador y la página no los recibe, así
  que las pestañas se manejan con Ctrl+Alt. Playwright entrega las teclas
  directamente a la página: esta prueba confirma lo que hace la aplicación, no
  lo que el navegador le deja recibir.
*/
test('las pestañas se crean, recorren y cierran con Ctrl+Alt', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const tabs = page.locator('#tab-bar .tab');
  const antes = await tabs.count();
  const activa = () => page.evaluate(() => currentId);
  await page.locator('#markdown-input').focus();
  await page.keyboard.press('Control+Alt+n');
  assert.equal(await tabs.count(), antes + 1);
  const nueva = await activa();

  await page.keyboard.press('Control+Alt+PageDown');
  assert.notEqual(await activa(), nueva);
  await page.keyboard.press('Control+Alt+PageUp');
  assert.equal(await activa(), nueva);

  await page.keyboard.press('Control+Alt+w');
  assert.equal(await tabs.count(), antes);
});

test('Escape y Tab sacan el foco de los dos editores, que tienen nombre', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.evaluate(() => newDoc('tareas.md', '- [ ] uno\n- [x] dos\n'));
  const markdown = page.locator('#markdown-input');
  assert.equal(await markdown.getAttribute('aria-labelledby'), 'markdown-panel-title');
  assert.equal(await page.locator('#html-output').getAttribute('aria-labelledby'), 'html-panel-title');
  await page.locator('#html-output li input[type="checkbox"]').first().waitFor();
  assert.deepEqual(
    await page.locator('#html-output li input[type="checkbox"]').evaluateAll(inputs => inputs.map(i => i.getAttribute('aria-label'))),
    ['Tarea hecha', 'Tarea hecha'],
  );
  assert.doesNotMatch(await page.evaluate(() => buildHtmlWithTex()), /aria-label|data-edimark-label/);

  const focused = () => page.evaluate(() => document.activeElement?.id || '');
  // Tab sangra: sin Escape delante, el foco se queda.
  await markdown.focus();
  await page.keyboard.press('Tab');
  assert.equal(await focused(), 'markdown-input');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  assert.notEqual(await focused(), 'markdown-input');
  await markdown.focus();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Shift+Tab');
  assert.notEqual(await focused(), 'markdown-input');

  // En la hoja, dentro de una lista, Tab también sangra.
  await page.locator('#html-output li').first().click();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Tab');
  assert.notEqual(await focused(), 'html-output');
});

test('renombrar una pestaña admite espacios y clics dentro del campo', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.evaluate(() => newDoc('otro.md', '', { activate: false }));
  const first = page.locator('.tab').first();
  const id = await first.getAttribute('data-id');
  await first.locator('.tab-name').dblclick();
  await page.keyboard.press('ControlOrMeta+a');
  // La barra espaciadora pulsaba la pestaña, que es un botón, y el nombre se
  // quedaba en la primera palabra.
  await page.keyboard.type('Nombre con espacios');
  await page.locator('#tab-bar input').click({ position: { x: 4, y: 4 } });
  await page.keyboard.press('End');
  await page.keyboard.type(' y más');
  await page.keyboard.press('Enter');

  assert.equal(await page.locator(`.tab[data-id="${id}"] .tab-name`).textContent(), 'Nombre con espacios y más');
  assert.equal(await page.locator('#tab-bar input').count(), 0);
  assert.equal(await page.locator(`.tab[data-id="${id}"]`).isVisible(), true);
});

test('una pestaña cruza varias posiciones en un solo arrastre y conserva el cursor', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.evaluate(() => {
    ['uno.md', 'dos.md', 'tres.md', 'cuatro.md', 'cinco.md']
      .forEach(name => newDoc(name, '', { activate: false }));
  });

  const names = () => page.locator('.tab-name').allTextContents();
  const drag = async (source, clientX) => {
    const box = await source.boundingBox();
    assert.ok(box, 'la pestaña que se arrastra debe estar visible');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    // Un único movimiento largo: no debe depender de encadenar intercambios
    // con cada pestaña vecina.
    await page.mouse.move(clientX, box.y + box.height / 2);
    assert.equal(await page.locator('html').evaluate(el => el.classList.contains('is-tab-dragging')), true);
    assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).cursor), 'grabbing');
    await page.mouse.up();
    assert.equal(await page.locator('html').evaluate(el => el.classList.contains('is-tab-dragging')), false);
  };

  const firstBox = await page.locator('.tab').first().boundingBox();
  assert.ok(firstBox);
  await drag(page.locator('.tab').filter({ hasText: 'cinco.md' }), firstBox.x + 2);
  assert.equal((await names())[0], 'cinco.md');

  const lastBox = await page.locator('.tab').last().boundingBox();
  assert.ok(lastBox);
  await drag(page.locator('.tab').first(), lastBox.x + lastBox.width - 2);
  assert.equal((await names()).at(-1), 'cinco.md');
  assert.deepEqual(
    await page.evaluate(() => docs.map(doc => doc.name)),
    await names(),
    'el orden persistido debe coincidir con el de la barra',
  );
});

test('el texto alternativo se lee del Markdown que rodea al marcador base64', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.evaluate(() => markdownEditor.setValue('![Mi imagen](data:image/png;base64,iVBORw0KGgo=)'));
  const alt = await page.evaluate(() => {
    const [placeholder] = currentBase64State.placeholders.keys();
    return findPlaceholderContext(placeholder)?.alt;
  });
  assert.equal(alt, 'Mi imagen');
});

test('reemplazar una coincidencia avanza a la siguiente', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill('gato gato');

  await page.locator('#open-search-btn').click();
  await page.locator('#toggle-replace-btn').click();
  await page.locator('#search-input').fill('gato');
  await page.locator('#replace-input').fill('gatos');
  await page.locator('#search-matches-info').getByText('1 / 2', { exact: true }).waitFor();

  // El reemplazo vuelve a casar con la búsqueda: sin reanudar por detrás del
  // texto insertado, el botón se quedaría siempre en la primera coincidencia.
  await page.locator('#replace-one-btn').click();
  await page.locator('#search-matches-info').getByText('2 / 2', { exact: true }).waitFor();
  assert.equal(await page.locator('#markdown-input').inputValue(), 'gatos gato');
});

test('avisa cuando el navegador bloquea la ventana independiente', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const dialogs = [];
  page.on('dialog', dialog => {
    dialogs.push(dialog.message());
    dialog.dismiss();
  });

  await page.evaluate(() => {
    window.open = () => null;
    document.getElementById('desktop-window-btn').click();
  });
  await page.waitForFunction(() => true);

  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0], /ventanas emergentes/);
});

/*
  Fórmulas en la vista previa. Son KaTeX en el navegador, no pasan por Pandoc,
  así que necesitan su propia comprobación: que se rendericen sin errores y que
  la vuelta a Markdown conserve el delimitador con el que se escribieron.
*/
test('listas desplegables: recuerdan el tipo, teclado y menú móvil sin desbordamiento', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  await page.locator('#new-tab-btn').click();
  await page.evaluate(() => { markdownEditor.setValue('Primera'); markdownEditor.focus(); document.getElementById('markdown-input').select(); });
  await page.locator('#list-menu-btn').click();
  await page.locator('#list-options [data-format="list-ol"]').click();
  assert.match(await page.locator('#markdown-input').inputValue(), /^1\. Primera/);
  assert.equal(await page.locator('#list-options [data-format="list-ol"]').getAttribute('aria-checked'), 'true');
  await page.reload();
  await page.locator('#list-apply-btn').waitFor();
  await page.waitForFunction(() => window.__edimarkReady === true);
  assert.equal(await page.locator('#list-options [data-format="list-ol"]').getAttribute('aria-checked'), 'true');
  await page.evaluate(() => { markdownEditor.setValue('Segunda'); markdownEditor.focus(); document.getElementById('markdown-input').select(); });
  await page.locator('#list-apply-btn').click();
  assert.match(await page.locator('#markdown-input').inputValue(), /^1\. Segunda/);
  await page.locator('#list-menu-btn').focus();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('End');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#list-menu-btn').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('#list-menu-btn').evaluate(n => n === document.activeElement), true);
  await page.setViewportSize({width:360,height:740});
  await page.locator('#mobile-format-toggle').click();
  await page.locator('#list-menu-btn').click();
  for (const id of ['list-apply-btn','list-menu-btn']) {
    const box = await page.locator(`#${id}`).boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, `${id}: superficie táctil`);
  }
  const menu = await page.locator('#list-options').boundingBox();
  assert.ok(menu.x >= 0 && menu.x + menu.width <= 360 && menu.y + menu.height <= 740);
  if (process.env.EDIMARK_SCREENSHOTS) await page.screenshot({path:`/tmp/edimark-lists-mobile-${process.env.BROWSER || 'chromium'}.png`});
  await page.locator('#list-options [data-format="list-task"]').click();
  assert.match(await page.locator('#markdown-input').inputValue(), /^- \[ \] Segunda/);
  await page.setViewportSize({width:320,height:640});
  await page.locator('#list-menu-btn').click();
  const narrowMenu = await page.locator('#list-options').boundingBox();
  const group = await page.locator('#list-dropdown-container').boundingBox();
  // Elegir una opción devuelve el foco al editor y la página se desplaza para
  // enseñarlo: la posición del grupo se cuenta desde arriba de la página.
  const desplazada = await page.evaluate(() => window.scrollY);
  assert.ok(narrowMenu.x >= 0 && narrowMenu.x + narrowMenu.width <= 320 && narrowMenu.y + narrowMenu.height <= 640);
  assert.ok(group.width >= 88 && group.x + group.width <= 320);
  await page.keyboard.press('Escape');
  const sinSitio = Math.ceil(group.y + desplazada + group.height + 60);
  await page.setViewportSize({width:320,height:sinSitio});
  // Sin desplazar la página, como quien toca un botón que ya ve abajo del todo.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('#list-menu-btn').dispatchEvent('click');
  // Si salta, el mensaje dice desde dónde: qué tiene el foco y dónde quedó el menú.
  const salto = await page.evaluate(() => {
    const caja = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map(Math.round).join(','); };
    const foco = document.activeElement;
    return {
      scrollY: window.scrollY,
      foco: foco ? `${foco.tagName}#${foco.id}.${String(foco.className).slice(0, 40)} ${caja(foco)}` : '',
      menu: caja(document.getElementById('list-options')),
      transform: document.getElementById('list-options')?.style.transform || '',
      grupo: caja(document.getElementById('list-dropdown-container')),
      alto: `${window.innerHeight}/${document.documentElement.scrollHeight}`,
    };
  });
  assert.equal(salto.scrollY, 0, `la página salta al abrir el menú: ${JSON.stringify(salto)} (sin sitio: ${sinSitio}, grupo antes: ${JSON.stringify(group)}, página desplazada: ${desplazada})`);
  const arriba = await page.locator('#list-options').boundingBox();
  const grupoArriba = await page.locator('#list-dropdown-container').boundingBox();
  assert.ok(arriba.y >= 0 && arriba.y + arriba.height <= sinSitio, 'el menú sin sitio debajo se sale de la pantalla');
  assert.ok(arriba.y + arriba.height <= grupoArriba.y + 1 || arriba.y >= grupoArriba.y + grupoArriba.height - 1,
    'el menú tapa los botones de la lista');
});

test('barra del perfil: crea tablas alineadas y cambia solo el separador desde Markdown', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').focus();
  await page.locator('[data-format="table"]').click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
  await page.locator('#table-rows').fill('1');
  for (const [i, alignment] of ['left','center','right'].entries()) await page.locator(`#table-align-${i}`).selectOption(alignment);
  await page.locator('#create-table-btn').click();
  const original = await page.locator('#markdown-input').inputValue();
  assert.match(original, /\| :--- \| :---: \| ---: \|/);
  await page.locator('#html-output th').first().waitFor();
  assert.deepEqual(await page.locator('#html-output th').evaluateAll(nodes => nodes.map(n => getComputedStyle(n).textAlign)), ['left','center','right']);
  const openExisting = async () => {
    await page.evaluate(() => {
      const input = document.getElementById('markdown-input');
      input.focus();
      input.setSelectionRange(input.value.indexOf('Celda'), input.value.indexOf('Celda'));
    });
    await page.locator('[data-format="table"]').click();
    assert.equal(await page.locator('#table-modal-title').textContent(), 'Alinear tabla');
    assert.equal(await page.locator('#table-cols').isDisabled(), true);
  };
  await openExisting();
  if (process.env.EDIMARK_SCREENSHOTS) await page.screenshot({path:`/tmp/edimark-toolbar-${process.env.BROWSER || 'chromium'}.png`});
  await page.locator('#table-align-0').selectOption('right');
  await page.locator('#cancel-table-btn').click();
  assert.equal(await page.locator('#markdown-input').inputValue(), original);
  await openExisting();
  await page.locator('#table-align-0').selectOption('right');
  await page.locator('#create-table-btn').click();
  assert.equal(await page.locator('#markdown-input').inputValue(), original.replace('| :--- | :---: | ---: |', '| ---: | :---: | ---: |'));
  await page.locator('#markdown-input').focus();
  await page.keyboard.press('Control+z');
  assert.equal(await page.locator('#markdown-input').inputValue(), original);
});

test('barra del perfil: alinea una tabla existente desde la hoja sin duplicarla', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  await page.locator('#new-tab-btn').click();
  await page.evaluate(() => markdownEditor.setValue('| A | B |\n|---|---|\n| **uno** | dos \\| tres |\n'));
  await page.locator('#html-output td').first().click();
  await page.locator('[data-format="table"]').click();
  assert.equal(await page.locator('#table-modal-title').textContent(), 'Alinear tabla');
  await page.locator('#table-align-0').selectOption('center');
  await page.locator('#table-align-1').selectOption('right');
  await page.locator('#create-table-btn').click();
  await page.waitForFunction(() => document.querySelector('#html-output th')?.getAttribute('align') === 'center');
  assert.equal(await page.locator('#html-output table').count(), 1);
  assert.deepEqual(await page.locator('#html-output td').allTextContents(), ['uno','dos | tres']);
  assert.equal(await page.locator('#html-output td strong').textContent(), 'uno');
  const md = await page.locator('#markdown-input').inputValue();
  assert.match(md, /\|\s*:-+:\s*\|\s*-+:\s*\|/);
  assert.ok(md.includes('dos \\| tres'));
});

test('barra del perfil: crea tareas en ambos paneles y permite marcarlas en la hoja', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  await page.locator('#new-tab-btn').click();
  await page.evaluate(() => {
    markdownEditor.setValue('Primera\nSegunda');
    markdownEditor.focus();
    document.getElementById('markdown-input').select();
  });
  await page.locator('#list-menu-btn').click();
  await page.locator('[data-format="list-task"]').click();
  assert.equal(await page.locator('#markdown-input').inputValue(), '- [ ] Primera\n- [ ] Segunda');
  await page.locator('#html-output input[type="checkbox"]').first().check();
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('- [x] Primera'));
  await page.evaluate(() => { markdownEditor.focus(); markdownEditor.setValue('Tarea visual'); });
  await page.locator('#html-output p').click();
  await page.locator('#list-apply-btn').click();
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('- [ ] Tarea visual'));
  await page.locator('#html-output li').click({position:{x:80,y:10}});
  await page.locator('#list-apply-btn').click();
  await page.waitForFunction(() => !document.getElementById('markdown-input').value.includes('[ ]'));
  assert.match(await page.locator('#markdown-input').inputValue(), /- Tarea visual/);
});

test('barra del perfil: código en línea, bloque con lenguaje y cercas seguras', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  await page.locator('#new-tab-btn').click();
  await page.evaluate(() => {
    markdownEditor.setValue('x < y'); markdownEditor.focus();
    document.getElementById('markdown-input').select();
  });
  await page.locator('[data-format="code"]').click();
  assert.equal(await page.locator('#markdown-input').inputValue(), '`x < y`');
  assert.equal(await page.locator('#html-output p code').textContent(), 'x < y');
  await page.locator('#html-output p').click();
  await page.locator('[data-format="code-block"]').click();
  await page.locator('#code-language').fill('markdown');
  const code = '```python\nprint("hola")\n```';
  await page.locator('#code-content').fill(code);
  await page.locator('#insert-code-btn').click();
  assert.equal((await page.locator('#html-output pre code').textContent()).trimEnd(), code);
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('````markdown'));
  assert.ok((await page.locator('#markdown-input').inputValue()).includes('````markdown'));
});

test('barra del perfil: salto visible y título opcional del enlace', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  await page.locator('#new-tab-btn').click();
  for (const panel of ['markdown','preview']) {
    await page.evaluate(() => markdownEditor.setValue('UnoDos'));
    await page.waitForFunction(() => {
      const p = document.querySelector('#html-output p');
      return p?.textContent === 'UnoDos' && !p.querySelector('br');
    });
    await page.evaluate(target => {
      if (target === 'markdown') { markdownEditor.focus(); markdownEditor.setCursor({line:0,ch:3}); }
      else {
        const root = document.getElementById('html-output'); root.focus();
        const range = document.createRange(); range.setStart(root.querySelector('p').firstChild,3); range.collapse(true);
        window.getSelection().removeAllRanges(); window.getSelection().addRange(range); capturePreviewSelection();
      }
    }, panel);
    await page.locator('[data-format="line-break"]').click();
    await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('Uno  \nDos'));
    await page.locator('#html-output br').waitFor({state:'attached'});
    assert.equal(await page.locator('#html-output br').count(), 1);
  }
  await page.locator('#markdown-input').focus();
  await page.locator('[data-format="link"]').click();
  await page.locator('#link-text').fill('Sitio');
  await page.locator('#link-url').fill('https://example.org');
  await page.locator('#link-title').fill('Un "título"');
  await page.locator('#insert-link-btn').click();
  await page.locator('#html-output a').waitFor();
  assert.equal(await page.locator('#html-output a').getAttribute('title'), 'Un "título"');
});

test('perfil Markdown: la hoja y su edición conservan la estructura y el texto', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  const source = await readFile(new URL('./fixtures/markdown-profile.md', import.meta.url), 'utf8');
  await page.locator('#new-tab-btn').click();
  await page.evaluate(md => markdownEditor.setValue(md), source);
  await page.locator('#html-output .katex').first().waitFor();
  const inspect = () => page.evaluate(() => {
    const sheet = document.getElementById('html-output');
    return {
      heading: sheet.querySelector('h1')?.textContent,
      table: sheet.querySelectorAll('table').length,
      sub: [...sheet.querySelectorAll('sub')].map(n => n.textContent),
      strike: sheet.querySelector('del')?.textContent,
      tasks: [...sheet.querySelectorAll('input[type="checkbox"]')].map(n => n.checked),
      math: sheet.querySelectorAll('.katex').length,
      mathErrors: sheet.querySelectorAll('.katex-error').length,
      notes: sheet.querySelectorAll('.footnote-reference').length,
      bare: sheet.querySelector('a[href="https://example.org/bare"]')?.textContent,
      literal: sheet.textContent.includes('"Texto" ... -- --- y «comillas»…'),
      code: sheet.querySelector('pre code')?.textContent,
      image: sheet.querySelector('img')?.getAttribute('alt'),
      quote: sheet.querySelector('blockquote')?.textContent.trim(),
      nested: sheet.querySelector('ul ul li')?.textContent,
    };
  });
  const before = await inspect();
  assert.equal(before.heading, 'Perfil Markdown');
  assert.equal(before.table, 2);
  assert.deepEqual(before.sub, ['2', '2', '2']);
  assert.equal(before.strike, 'tachado');
  assert.deepEqual(before.tasks, [false, true]);
  assert.equal(before.math, 4);
  assert.equal(before.mathErrors, 0);
  assert.equal(before.notes, 3);
  assert.equal(before.bare, 'https://example.org/bare');
  assert.equal(before.literal, true);
  assert.equal(before.image, 'Píxel');
  assert.equal(before.quote, 'Una cita en bloque.');
  assert.equal(before.nested, 'Anidado');
  assert.ok(before.code.includes('H~2~O y $a^2$'));
  assertProfile(await page.evaluate(inspectProfile));
  await page.emulateMedia({ media: 'print' });
  assertProfile(await page.evaluate(inspectProfile));
  await page.emulateMedia({ media: 'screen' });
  await page.locator('#html-output p').filter({ hasText: /^Final del documento\.$/ }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Edición comprobada.');
  const edited = await page.evaluate(() => {
    document.getElementById('html-output').focus();
    forceMarkdownUpdate = true;
    updateMarkdown();
    return markdownEditor.getValue();
  });
  for (const fragment of ['lang: es', 'author: Ejemplo', '[@ejemplo2026]', '[^nota]:', '# Perfil Markdown', '- [ ] Pendiente', '- [x] Hecho']) {
    assert.ok(edited.includes(fragment), `${fragment} perdido:\n${edited}`);
  }
  assert.ok(edited.includes('Una referencia bibliográfica [@ejemplo2026].'), 'la cita se escapó o perdió');
  for (const fragment of ['Cita narrativa: @ejemplo2026.', 'Solo año: [-@ejemplo2026].',
    'Cita múltiple: [@ejemplo2026; @segunda2025].', 'Con página: [@ejemplo2026, p. 12].',
    '$a^2$', '\\(b^2\\)', '$$\nc^2\n$$', '\\[\nd^2\n\\]']) {
    assert.ok(edited.includes(fragment), `se alteró la sintaxis de ${fragment}`);
  }
  assert.ok(edited.includes('Final del documento. Edición comprobada.'), 'la edición real no llegó al Markdown');
  await page.evaluate(md => { markdownEditor.setValue(md); updateHtml(); }, edited);
  await page.locator('#html-output .katex').first().waitFor();
  assert.deepEqual(await inspect(), before, `cambió el significado al editar la hoja:\n${edited}`);
  assertProfile(await page.evaluate(inspectProfile));
  // Exportar lo que volvió del editor detecta pérdidas que la hoja podría ocultar.
  const exported = await runPandoc(`-f ${MARKDOWN_READER_NO_AUTO_IDS} -t html --mathjax`, normalizeThematicBreaks(edited));
  assert.ok(exported.bytes.length, exported.stderr.join('\n'));
  assert.ok(new TextDecoder().decode(exported.bytes).includes('Edición comprobada.'), 'la edición no llegó a la exportación');
  const converted = await page.evaluate(html => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return {
      math: doc.querySelectorAll('.math').length,
      citations: doc.querySelectorAll('[data-cites]').length,
      notes: doc.querySelectorAll('.footnote-ref').length,
      sub: [...doc.querySelectorAll('sub')].map(n => n.textContent),
      tasks: [...doc.querySelectorAll('input[type="checkbox"]')].map(n => n.checked),
      literal: doc.body.textContent.includes('"Texto" ... -- --- y «comillas»…'),
    };
  }, new TextDecoder().decode(exported.bytes));
  assert.deepEqual(converted, {
    math: before.math, citations: 5, notes: before.notes,
    sub: before.sub, tasks: before.tasks, literal: before.literal,
  }, 'la exportación interpreta de otra forma el Markdown de la hoja');
  assertProfile(await page.evaluate(inspectProfile, new TextDecoder().decode(exported.bytes)));
});

test('el manual renderiza sus fórmulas con KaTeX', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#html-output .katex').first().waitFor();
  const render = await page.evaluate(() => {
    // El manual cita `$...$` dentro de código en línea, y KaTeX no toca los
    // <code>: ese texto literal no cuenta como fórmula sin renderizar.
    const copia = document.getElementById('html-output').cloneNode(true);
    copia.querySelectorAll('code, pre').forEach(node => node.remove());
    const texto = copia.textContent;
    return {
      bloque: document.querySelectorAll('#html-output .katex-display').length,
      linea: [...document.querySelectorAll('#html-output span.katex')]
        .filter(node => !node.closest('.katex-display')).length,
      errores: document.querySelectorAll('#html-output .katex-error').length,
      dolaresSueltos: /\$[^$\n]+\$/.test(texto),
      barrasSueltas: /\\[([][^)\]]*\\[)\]]/.test(texto),
    };
  });
  assert.equal(render.errores, 0, 'KaTeX marcó alguna fórmula como errónea');
  assert.equal(render.linea, 6, `ejemplos en línea: ${JSON.stringify(render)}`);
  assert.equal(render.bloque, 1, `ejemplo en bloque: ${JSON.stringify(render)}`);
  assert.equal(render.dolaresSueltos, false, 'quedó texto $...$ sin renderizar');
  // Los delimitadores con barra no deben quedarse como texto plano.
  assert.equal(render.barrasSueltas, false, 'quedó texto \\(...\\) sin renderizar');
});

test('los cuatro delimitadores se renderizan y sobreviven a la vuelta a Markdown', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const source = [
    'En línea con dólar $a^2+b^2=c^2$ y con barra \\(E = mc^2\\).',
    '',
    '$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$',
    '',
    '\\[\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\\]',
    '',
  ].join('\n');

  await page.locator('#new-tab-btn').click();
  await page.evaluate(md => markdownEditor.setValue(md), source);
  await page.locator('#html-output .katex').first().waitFor();

  const render = await page.evaluate(() => ({
    bloque: document.querySelectorAll('#html-output .katex-display').length,
    linea: [...document.querySelectorAll('#html-output span.katex')]
      .filter(node => !node.closest('.katex-display')).length,
    errores: document.querySelectorAll('#html-output .katex-error').length,
  }));
  assert.equal(render.errores, 0, 'KaTeX marcó alguna fórmula como errónea');
  assert.equal(render.linea, 2, `fórmulas en línea: ${JSON.stringify(render)}`);
  assert.equal(render.bloque, 2, `fórmulas de bloque: ${JSON.stringify(render)}`);

  const vuelta = await page.evaluate(() => {
    document.getElementById('html-output').focus();
    forceMarkdownUpdate = true;
    updateMarkdown();
    return markdownEditor.getValue();
  });
  for (const fragmento of ['$a^2+b^2=c^2$', '\\(E = mc^2\\)', '$$\\int_0^1', '\\[\\sum_']) {
    assert.ok(vuelta.includes(fragmento), `perdido ${fragmento} en:\n${vuelta}`);
  }
});

/*
  La hoja y Pandoc tienen que leer la virgulilla igual, o el documento dice una
  cosa en pantalla y otra al exportarlo: una sola es subíndice, dos son tachado
  y la que no cierra nada es texto. Lo mismo con el acento circunflejo del
  superíndice. Los casos de aquí están comprobados contra el pandoc.wasm que
  lleva la aplicación.
*/
test('subíndice y superíndice se pintan, no chocan con el tachado y vuelven a Markdown', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const source = [
    'El agua es H~2~O y ocupa 3 m^2^.',
    '',
    'Esto va ~~tachado~~ y esto ~texto con espacios~ no es nada.',
    '',
    'Literal: \\~2\\~ y en código `H~2~O`.',
    '',
    'La nota[^1] no es un superíndice cualquiera.',
    '',
    '[^1]: Una nota al pie.',
    '',
  ].join('\n');

  await page.locator('#new-tab-btn').click();
  await page.evaluate(md => markdownEditor.setValue(md), source);
  await page.locator('#html-output sub').first().waitFor();

  const render = await page.evaluate(() => ({
    subindices: [...document.querySelectorAll('#html-output sub')].map(node => node.textContent),
    superindices: [...document.querySelectorAll('#html-output sup:not(.footnote-reference)')]
      .map(node => node.textContent),
    notas: document.querySelectorAll('#html-output sup.footnote-reference').length,
    tachados: [...document.querySelectorAll('#html-output del, #html-output s')].map(node => node.textContent),
    codigo: document.querySelector('#html-output code')?.textContent || '',
    texto: document.getElementById('html-output').textContent,
  }));
  assert.deepEqual(render.subindices, ['2'], 'subíndices de la hoja');
  assert.deepEqual(render.superindices, ['2'], 'superíndices de la hoja');
  assert.equal(render.notas, 1, 'la llamada de la nota al pie sigue siendo una sola');
  assert.deepEqual(render.tachados, ['tachado'], 'la virgulilla suelta no tacha');
  assert.equal(render.codigo, 'H~2~O', 'el código no interpreta la virgulilla');
  assert.ok(render.texto.includes('~texto con espacios~'), `el par con espacios no es marcado:\n${render.texto}`);
  assert.ok(render.texto.includes('Literal: ~2~'), `la virgulilla escapada abrió un subíndice:\n${render.texto}`);

  const vuelta = await page.evaluate(() => {
    document.getElementById('html-output').focus();
    forceMarkdownUpdate = true;
    updateMarkdown();
    return markdownEditor.getValue();
  });
  for (const fragmento of ['H~2~O', 'm^2^', '~~tachado~~', '`H~2~O`', '[^1]']) {
    assert.ok(vuelta.includes(fragmento), `perdido ${fragmento} en:\n${vuelta}`);
  }
  assert.ok(vuelta.includes('Literal: \\~2\\~'), `el literal volvió sin escapar:\n${vuelta}`);
});

/*
  Lo que el autor escribió escapado tiene que seguir siéndolo al volver de la
  hoja, o al repintarlo se convertiría en el marcado del que huía. Y solo eso:
  una virgulilla que no cierra ningún par no se toca, que si no el documento se
  llenaría de barras invertidas al pasar por el editor visual.
*/
test('las virgulillas literales vuelven escapadas y las sueltas no se tocan', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const source = [
    'Escapado: \\~2\\~, \\^3\\^ y \\~\\~cuatro\\~\\~.',
    '',
    'Sueltas: aprox. ~5 kg, el archivo ~/notas.md, 2 ^ 3 y https://x.org/~juan.',
    '',
  ].join('\n');

  await page.locator('#new-tab-btn').click();
  await page.evaluate(md => markdownEditor.setValue(md), source);
  await page.locator('#html-output p').first().waitFor();

  const enLaHoja = await page.evaluate(() => document.getElementById('html-output').textContent);
  assert.ok(enLaHoja.includes('Escapado: ~2~, ^3^ y ~~cuatro~~'), `la hoja interpretó un literal:\n${enLaHoja}`);

  const vuelta = await page.evaluate(() => {
    document.getElementById('html-output').focus();
    forceMarkdownUpdate = true;
    updateMarkdown();
    return markdownEditor.getValue();
  });
  for (const fragmento of ['\\~2\\~', '\\^3\\^', '\\~\\~cuatro\\~\\~']) {
    assert.ok(vuelta.includes(fragmento), `perdido el escape de ${fragmento} en:\n${vuelta}`);
  }
  for (const intacto of ['aprox. ~5 kg', 'el archivo ~/notas.md', '2 ^ 3', 'x.org/~juan']) {
    assert.ok(vuelta.includes(intacto), `escapado de más «${intacto}» en:\n${vuelta}`);
  }

  // Y al repintarlo sigue diciendo lo mismo: la vuelta es estable.
  await page.evaluate(md => markdownEditor.setValue(md), vuelta);
  await page.waitForFunction(
    () => document.getElementById('html-output').textContent.includes('Escapado: ~2~'),
  );
  const segundaHoja = await page.evaluate(() => ({
    indices: document.querySelectorAll('#html-output sub, #html-output sup').length,
    tachados: document.querySelectorAll('#html-output del, #html-output s').length,
  }));
  assert.deepEqual(segundaHoja, { indices: 0, tachados: 0 }, 'el literal se convirtió en marcado al repintarlo');
});

test('los botones de índice envuelven la selección en los dos paneles', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();

  // Desde el panel Markdown.
  for (const [formato, palabra, esperado] of [
    ['superscript', 'superindice', 'Un párrafo de prueba para ^superindice^.'],
    ['subscript', 'subindice', 'Un párrafo de prueba para ~subindice~.'],
  ]) {
    await documentoDePrueba(page, palabra);
    await page.evaluate((texto) => {
      const area = document.getElementById('markdown-input');
      const inicio = area.value.indexOf(texto);
      area.focus();
      area.setSelectionRange(inicio, inicio + texto.length);
      area.dispatchEvent(new Event('select'));
    }, palabra);
    await page.locator(`[data-format="${formato}"]`).click();
    await page.waitForFunction(
      (texto) => document.getElementById('markdown-input').value.trim() === texto,
      esperado,
    );
  }

  // Y desde la hoja, donde el navegador pone la etiqueta y vuelve por Turndown.
  await documentoDePrueba(page, 'metros');
  await seleccionarEnLaHoja(page, 'metros');
  await page.locator('[data-format="superscript"]').click();
  await page.waitForFunction(
    () => document.getElementById('markdown-input').value.trim() === 'Un párrafo de prueba para ^metros^.',
  );
});

/*
  Dentro del WASM no hay red ni sistema de archivos: una ruta relativa se pierde
  igual que una URL remota. El exportador tiene que descargarla antes, cosa que
  aquí se comprueba contando las peticiones (la vista previa hace la primera).
*/
test('la exportación descarga las imágenes de rutas relativas', async (t) => {
  const context = await browser.newContext({ locale: 'es-ES' });
  t.after(() => context.close());
  await context.route(/pandoc\.b64(?:\.gz)?(?:\?.*)?$/, route => (
    route.fulfill({ status: 200, contentType: 'text/plain', body: '' })
  ));

  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  let peticiones = 0;
  await context.route(/imagen-relativa\.gif$/, (route) => {
    peticiones += 1;
    return route.fulfill({ status: 200, contentType: 'image/gif', body: gif });
  });

  const page = await context.newPage();
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.tab-name').first().waitFor();
  await page.locator('#new-tab-btn').click();

  const markdown = '# Con imagen\n\n![Diagrama](imagen-relativa.gif)\n';
  await page.evaluate(md => markdownEditor.setValue(md), markdown);
  // El nodo aparece antes de resolver IndexedDB y, si hace falta, la URL.
  await page.waitForFunction(() => {
    const img = document.querySelector('#html-output img');
    return Boolean(img && img.complete && img.naturalWidth > 0);
  });
  assert.equal(peticiones, 1, 'la vista previa debería haber pedido la imagen una vez');

  // La exportación falla después (pandoc.b64 está vacío en las pruebas), pero
  // la descarga de imágenes ocurre antes de cargar el WASM.
  await page.evaluate(md => window.PandocExporter
    .exportDocument({ format: 'docx', markdown: md })
    .catch(() => {}), markdown);

  assert.equal(peticiones, 2, 'el exportador no descargó la imagen relativa');
});

/*
  El manual existe en los cinco idiomas de la interfaz y las fórmulas son las
  mismas en todos: un fallo de copia en uno solo pasaría inadvertido si solo se
  comprobara el castellano.
*/
for (const [locale, lang] of [['es-ES', 'es'], ['en-US', 'en'], ['ca-ES', 'ca'], ['gl-ES', 'gl'], ['eu-ES', 'eu']]) {
  test(`el manual en ${lang} renderiza todas sus fórmulas`, async (t) => {
    const { context, page } = await openApp({ locale });
    t.after(() => context.close());

    await page.waitForFunction(esperado => document.documentElement.lang === esperado, lang);
    await page.locator('#html-output .katex').first().waitFor();
    const render = await page.evaluate(() => {
      const copia = document.getElementById('html-output').cloneNode(true);
      copia.querySelectorAll('code, pre').forEach(node => node.remove());
      const texto = copia.textContent;
      return {
        bloque: document.querySelectorAll('#html-output .katex-display').length,
        linea: [...document.querySelectorAll('#html-output span.katex')]
          .filter(node => !node.closest('.katex-display')).length,
        errores: document.querySelectorAll('#html-output .katex-error').length,
        formulas: [...document.querySelectorAll('#html-output .katex annotation')]
          .map(node => node.textContent.trim()),
        sinRenderizar: /\$[^$\n]+\$/.test(texto) || /\\[([][^)\]]*\\[)\]]/.test(texto),
      };
    });
    assert.equal(render.errores, 0, `${lang}: KaTeX marcó alguna fórmula como errónea`);
    assert.equal(render.sinRenderizar, false, `${lang}: quedó una fórmula sin renderizar`);
    assert.equal(render.linea, 6, `${lang}: ejemplos en línea del manual`);
    assert.equal(render.bloque, 1, `${lang}: ejemplo en bloque del manual`);
    assert.deepEqual(render.formulas, [
      'ax^2 + bx + c = 0', String.raw`x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}`,
      String.raw`\alpha`, String.raw`\Omega`, 'H_2O', String.raw`\mathbb{R}`, String.raw`A \subseteq B`,
    ], `${lang}: contenido de los siete ejemplos`);
  });
}

test('Acerca de muestra la versión de package.json en cada idioma', async (t) => {
  const packageVersion = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8')).version;
  const { context, page } = await openApp({ locale: 'en-US' });
  t.after(() => context.close());

  await page.waitForFunction(() => document.documentElement.lang === 'en');
  await page.locator('#help-menu-btn').click();
  await page.locator('#about-btn').click();
  await page.locator('#about-modal-overlay').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#about-modal-overlay [data-app-version]').textContent(), packageVersion);
  assert.equal(await page.locator('#about-web-link').innerText(), 'Open the web version');
  assert.equal(await page.locator('#about-desktop-link').innerText(), 'Download the desktop version');
});

test('una coincidencia vacía no se come un carácter al reemplazar', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill('abc');

  await page.locator('#open-search-btn').click();
  await page.locator('#search-regex-toggle-btn').click();
  await page.locator('#toggle-replace-btn').click();
  await page.locator('#search-input').fill('x*');
  await page.locator('#replace-input').fill('-');
  await page.locator('#search-matches-info').getByText('1 / 4', { exact: true }).waitFor();

  page.once('dialog', dialog => dialog.accept());
  await page.locator('#replace-all-btn').click();
  await page.waitForFunction(() => document.getElementById('markdown-input').value !== 'abc');

  // Las letras siguen ahí: solo se inserta en los huecos vacíos.
  assert.equal(await page.locator('#markdown-input').inputValue(), '-a-b-c-');
});

test('el manual sigue recargándose al cambiar de idioma tras renombrar su pestaña', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.waitForFunction(() => document.documentElement.lang === 'es');
  await page.locator('#html-output h1').getByText('Manual de EdiMarkdown', { exact: true }).waitFor();

  await page.evaluate(() => {
    const doc = docs.find(d => d.isManual);
    doc.name = 'Mis apuntes';
    document.querySelector(`.tab[data-id="${doc.id}"] .tab-name`).textContent = doc.name;
  });

  await page.evaluate(() => {
    const select = document.getElementById('language-select');
    select.value = 'en';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('#html-output h1').getByText('EdiMarkdown manual', { exact: true }).waitFor();
});

test('el autoguardado no reescribe un documento que no ha cambiado', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill('contenido estable');

  // Se cuentan las escrituras del autoguardado durante dos ciclos completos.
  await page.evaluate(() => {
    window.__escrituras = 0;
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (clave, valor) {
      if (String(clave).startsWith('edimarkweb-autosave')) window.__escrituras += 1;
      return original.call(this, clave, valor);
    };
  });
  await page.waitForTimeout(7000);

  // Una escritura inicial es legítima; a partir de ahí, silencio.
  assert.ok(
    await page.evaluate(() => window.__escrituras <= 1),
    `el autoguardado escribió ${await page.evaluate(() => window.__escrituras)} veces sin cambios`,
  );

  // Y al cambiar el texto vuelve a guardar.
  await page.locator('#markdown-input').fill('contenido nuevo');
  await page.waitForFunction(() => window.__escrituras >= 2, null, { timeout: 8000 });
});

/*
  El temporizador solo guarda la pestaña activa, así que lo escrito entre el
  último tic y el cambio de pestaña solo llega al almacenamiento si switchTo lo
  vuelca. Los dos casos desactivan el temporizador antes de escribir: si no, la
  prueba pasaría igual sin el volcado, guardado por el tic siguiente.
*/
const detenerTemporizadores = page => page.evaluate(() => {
  const ultimo = setTimeout(() => {}, 0);
  for (let id = 0; id <= Number(ultimo); id += 1) clearInterval(id);
});

const autoguardados = page => page.evaluate(() => Object.keys(localStorage)
  .filter(clave => clave.startsWith('edimarkweb-autosave'))
  .map(clave => localStorage.getItem(clave)));

test('cambiar de pestaña guarda lo escrito en la que se abandona', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await detenerTemporizadores(page);
  await page.locator('#markdown-input').fill('texto de la pestaña abandonada');

  await page.locator('#new-tab-btn').click();

  assert.ok(
    (await autoguardados(page)).includes('texto de la pestaña abandonada'),
    'el documento anterior no se guardó al cambiar de pestaña',
  );
});

test('el menú de la pestaña cierra en grupo y devuelve lo cerrado', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  const nombres = () => page.$$eval('.tab-name', tabs => tabs.map(tab => tab.textContent));

  await page.evaluate(() => {
    newDoc('Uno', 'Contenido uno');
    newDoc('Dos', 'Contenido dos');
    newDoc('Tres', 'Contenido tres');
  });
  await detenerTemporizadores(page);

  await page.locator('.tab', { hasText: 'Dos' }).click({ button: 'right' });
  await page.locator('#tab-context-menu').waitFor();
  await page.locator('[data-tab-action="close-others"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.tab').length === 1);
  assert.deepEqual(await nombres(), ['Dos']);

  // Lo cerrado se apila con la última encima, y vuelve con su texto.
  await page.locator('.tab', { hasText: 'Dos' }).click({ button: 'right' });
  assert.deepEqual(
    await page.$$eval('#tab-menu-reopen-list .tab-menu-name', items => items.map(item => item.textContent)),
    ['Tres', 'Uno', 'Manual'],
  );
  await page.locator('#tab-menu-reopen-list .tab-menu-item', { hasText: 'Uno' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.tab').length === 2);
  assert.equal(await page.evaluate(() => markdownEditor.getValue()), 'Contenido uno');
  assert.equal(await page.locator('#tab-context-menu').isHidden(), true);

  // Y una vez recuperada ya no está en la lista.
  await page.locator('.tab', { hasText: 'Uno' }).click({ button: 'right' });
  assert.deepEqual(
    await page.$$eval('#tab-menu-reopen-list .tab-menu-name', items => items.map(item => item.textContent)),
    ['Tres', 'Manual'],
  );
  await page.locator('[data-tab-action="close-all"]').click();
  // Cerrarlas todas deja una en blanco, no el editor sin pestaña.
  await page.waitForFunction(() => docs.length === 1 && docs[0].md === '');
  assert.deepEqual(await nombres(), [await page.evaluate(() => getTranslation('untitled_document', 'Documento sin título'))]);
  assert.equal(await page.locator('.tab[aria-selected="true"]').count(), 1);

  // Esa pestaña en blanco, cerrada, no va a «Reabrir»: no hay nada que recuperar.
  const reabrir = () => page.$$eval('#tab-menu-reopen-list .tab-menu-name', items => items.map(item => item.textContent));
  await page.locator('.tab').first().click({ button: 'right' });
  const antes = await reabrir();
  assert.deepEqual(antes, ['Dos', 'Uno', 'Tres', 'Manual']);
  await page.locator('[data-tab-action="close"]').click();
  await page.waitForFunction(() => docs.length === 1 && docs[0].md === '');
  await page.locator('.tab').first().click({ button: 'right' });
  assert.deepEqual(await reabrir(), antes);
});

test('ocultar la página guarda el documento abierto', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await detenerTemporizadores(page);
  await page.locator('#markdown-input').fill('texto sin guardar al cerrar');

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });

  assert.ok(
    (await autoguardados(page)).includes('texto sin guardar al cerrar'),
    'el documento abierto no se guardó al ocultarse la página',
  );
});

/*
  Buscar y reemplazar conviviendo con el plegado de imágenes base64: el editor
  maneja a la vez el texto visible (con el marcador) y el expandido, y el
  reemplazo tiene que caer en el visible sin tocar la imagen.
*/
test('buscar y reemplazar acierta con una imagen base64 plegada delante', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  const imagen = `![img](data:image/png;base64,${'A'.repeat(400)})`;
  await page.evaluate(md => markdownEditor.setValue(md), `${imagen}\n\nhola mundo\n`);
  // El panel avisa de la imagen plegada; la lista en sí viene recogida.
  await page.locator('#base64-hidden-container').waitFor({ state: 'visible' });

  await page.locator('#open-search-btn').click();
  await page.locator('#search-regex-toggle-btn').click();
  await page.locator('#toggle-replace-btn').click();
  await page.locator('#search-input').fill('(mundo)');
  await page.locator('#replace-input').fill('[$1]');
  await page.locator('#search-matches-info').getByText('1 / 1', { exact: true }).waitFor();
  await page.locator('#replace-one-btn').click();

  await page.waitForFunction(() => markdownEditor.getValue().includes('hola [mundo]'));
  // La imagen tiene que seguir entera tras el reemplazo.
  assert.match(await page.evaluate(() => markdownEditor.getValue()), /!\[img\]\(data:image\/png;base64,A{400}\)/);
});

/*
  Presupuesto de imágenes incrustadas. Pandoc paga cada imagen muy caro dentro
  del WASM —un GIF de 3 MB tarda unos 40 s en llegar al ODT— así que exportar el
  manual, con 25 MB de GIF, dejaba el navegador colgado. Por encima del
  presupuesto la imagen se omite y queda su texto alternativo.
*/
async function exportarConImagen(t, { bytes, nombre }) {
  const context = await browser.newContext({ locale: 'es-ES' });
  t.after(() => context.close());
  await context.route(/pandoc\.b64(?:\.gz)?(?:\?.*)?$/, route => (
    route.fulfill({ status: 200, contentType: 'text/plain', body: '' })
  ));
  const cuerpo = Buffer.alloc(bytes, 0x41);
  await context.route(new RegExp(`${nombre}$`), route => route.fulfill({
    status: 200,
    contentType: 'image/gif',
    headers: { 'content-length': String(cuerpo.length) },
    body: cuerpo,
  }));

  const page = await context.newPage();
  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.locator('.tab-name').first().waitFor();

  // La exportación falla luego (pandoc.b64 está vacío), pero las imágenes se
  // resuelven antes de cargar el módulo.
  return page.evaluate(async (archivo) => {
    const avisos = [];
    await window.PandocExporter.exportDocument({
      format: 'odt',
      markdown: `# T\n\n![Diagrama](${archivo})\n`,
      onNotification: mensaje => avisos.push(mensaje),
    }).catch(() => {});
    return avisos;
  }, nombre);
}

test('una imagen enorme se omite en vez de colgar la exportación', async (t) => {
  const avisos = await exportarConImagen(t, { bytes: 3 * 1024 * 1024, nombre: 'gigante.gif' });
  assert.equal(avisos.length, 1, `avisos inesperados: ${JSON.stringify(avisos)}`);
  assert.match(avisos[0], /demasiado grandes/);
});

test('una imagen normal se incrusta sin avisar de nada', async (t) => {
  const avisos = await exportarConImagen(t, { bytes: 64 * 1024, nombre: 'pequena.gif' });
  assert.deepEqual(avisos, [], 'una imagen dentro del presupuesto no debe avisar');
});


/*
  Importar puede tardar bastante -la primera vez hay que cargar el modulo de
  Pandoc- y antes no se decia nada: el indicador de estado se crea dentro de
  window.onload, asi que la importacion, que es de nivel superior, comprobaba si
  existia, concluia que no y trabajaba en silencio.
*/
test('importar un archivo dice qué archivo y en qué paso va', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const toast = page.locator('#status-toast-message');
  await page.locator('#import-file-input').setInputFiles({
    name: 'apuntes de clase.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('PK contenido que no llega a convertirse'),
  });

  await toast.getByText('apuntes de clase.docx', { exact: false }).waitFor();
  // El paso concreto se añade al nombre, no lo sustituye.
  await page.waitForFunction(() => {
    const texto = document.getElementById('status-toast-message').textContent;
    return texto.includes('apuntes de clase.docx') && texto.includes('Pandoc');
  });
});

test('importar varios archivos indica por cuál va y resume al final', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const archivo = nombre => ({
    name: nombre,
    mimeType: 'application/vnd.oasis.opendocument.text',
    buffer: Buffer.from('PK contenido que no llega a convertirse'),
  });
  const toast = page.locator('#status-toast-message');
  await page.locator('#import-file-input').setInputFiles([archivo('uno.odt'), archivo('dos.odt')]);

  await toast.getByText('1 de 2', { exact: false }).waitFor();
  await toast.getByText('2 de 2', { exact: false }).waitFor();
  // Ninguno se convierte (pandoc.b64 está vacío en las pruebas), así que el
  // resumen tiene que reflejar el fracaso en vez de dar por buena la tanda.
  await toast.getByText('0 de 2 archivos importados.', { exact: true }).waitFor();
});

/*
  Ctrl+O se anunciaba en el menú y en el manual, pero no estaba conectado: la
  combinación se la quedaba el navegador. Ctrl+Mayús+O comparte letra con la
  lista numerada, así que la prueba vigila también que no se disparen las dos.
*/
test('Ctrl+O abre el selector de archivos sin pisar Ctrl+Mayús+O', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  /*
    El manual llega a la primera pestaña después de que la aplicación se
    declare lista, y pulsar mientras tanto perdía la tecla: la prueba se caía
    de tarde en tarde esperando el selector de archivos.
  */
  await page.waitForFunction(() => document.getElementById('markdown-input').value.length > 0);
  /*
    Y con el hilo libre. Abrir el selector de archivos exige una activación
    reciente del usuario, así que una pulsación que llega mientras la ventana
    está ocupada —montando la primera pestaña, repartiendo las páginas— se
    procesa tarde y el navegador ya no la acepta: así se caía esta prueba de
    tarde en tarde, aquí y en integración.
  */
  await page.evaluate(() => new Promise(listo => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(() => listo(), { timeout: 2000 });
      else setTimeout(listo, 100);
    }));
  }));
  const selector = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  assert.equal(await (await selector).element().getAttribute('id'), 'file-input');

  let seleccionesExtra = 0;
  page.on('filechooser', () => { seleccionesExtra += 1; });
  await page.locator('#new-tab-btn').click();
  const markdown = page.locator('#markdown-input');
  await markdown.fill('Punto');
  await markdown.selectText();
  await page.keyboard.press('Control+Shift+O');
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('1. Punto'));
  assert.equal(seleccionesExtra, 0, 'Ctrl+Mayús+O no debe abrir además el selector de archivos');
});

test('los nuevos atajos abren sus acciones y los iconos explican su función', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  assert.equal(await page.locator('#doc-format-toolbar-btn').getAttribute('title'), 'Opciones para todo el documento: idioma, autor, índice y formato.');
  assert.equal(await page.locator('#doc-format-toolbar-btn [data-lucide="sliders-horizontal"]').count(), 1);
  assert.equal(await page.locator('#doc-lang-btn').count(), 0);
  assert.equal(await page.locator('#toggle-replace-btn').getAttribute('title'), 'Mostrar opciones de reemplazo');

  await page.keyboard.press('Control+Alt+e');
  assert.equal(await page.locator('#export-menu').isVisible(), true);
  await page.keyboard.press('Escape');

  await page.keyboard.press('Control+,');
  assert.equal(await page.locator('#settings-menu').isVisible(), true);
  await page.keyboard.press('Escape');

  assert.equal(await page.locator('#focus-mode-toggle').getAttribute('aria-pressed'), 'false');
  await page.keyboard.press('Control+Shift+f');
  assert.equal(await page.locator('#focus-mode-toggle').getAttribute('aria-pressed'), 'true');
});

test('los tres botones cambian de disposición y dicen cuál está puesta', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  assert.equal(await page.locator('#new-tab-btn').evaluate(button => button.previousElementSibling?.id), 'tab-bar');
  // Las disposiciones viven en la barra de estado, con las lupas; en la fila de
  // las pestañas se quedan los botones que gobiernan la ventana.
  assert.equal(await page.locator('#layout-switch').evaluate(group => group.closest('#status-bar')?.id), 'status-bar');
  assert.equal(await page.locator('#layout-switch').evaluate(group => group.nextElementSibling?.id), 'layout-menu-container');
  assert.equal(await page.locator('#focus-mode-toggle').evaluate(button => button.nextElementSibling?.id), 'toggle-width-btn');

  // En pantalla ancha manda el grupo de botones; el menú se queda para el móvil.
  assert.equal(await page.locator('#layout-switch').isVisible(), true);
  assert.equal(await page.locator('#layout-menu-container').isVisible(), false);

  const boton = valor => page.locator(`#layout-switch [data-layout="${valor}"]`);
  assert.equal(await boton('dual').getAttribute('aria-pressed'), 'true');

  await boton('md').click();
  // El panel que se va se encoge antes de esconderse, así que la disposición no
  // está puesta del todo hasta que desaparece.
  await page.locator('#html-panel').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#markdown-panel').isVisible(), true);
  assert.equal(await boton('md').getAttribute('aria-pressed'), 'true');
  assert.equal(await boton('dual').getAttribute('aria-pressed'), 'false');
  // El menú, aunque no se vea, dice lo mismo que los botones.
  assert.equal(await page.locator('#layout-menu [data-layout="md"]').getAttribute('aria-checked'), 'true');

  await boton('html').click();
  await page.locator('#markdown-panel').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#html-panel').isVisible(), true);
  assert.equal(await boton('html').getAttribute('aria-pressed'), 'true');

  // Ctrl+L rota, y el resaltado lo sigue: es lo que hace visible el atajo.
  await page.keyboard.press('Control+l');
  assert.equal(await boton('dual').getAttribute('aria-pressed'), 'true');
  // El que vuelve crece desde cero: hasta que no tiene ancho no está a la vista.
  await page.locator('#markdown-panel').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#html-panel').isVisible(), true);
});

/*
  Cambiar de disposición no es aparecer y desaparecer: el panel que llega crece
  desde cero y el que se va se encoge hasta cero. Como van en fila, el editor
  visual entra siempre por la derecha —su borde derecho no se mueve— y el
  Markdown por la izquierda.
*/
test('los paneles entran creciendo por su lado', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const bordes = () => page.evaluate(() => {
    const caja = id => {
      const el = document.getElementById(id);
      if (getComputedStyle(el).display === 'none') return null;
      const { left, right } = el.getBoundingClientRect();
      return { left: Math.round(left), right: Math.round(right) };
    };
    return { md: caja('markdown-panel'), html: caja('html-panel') };
  });

  // Un clic y una lectura en la misma vuelta: durante el cambio los dos paneles
  // están a la vista, el que se va todavía sin esconder.
  const pulsar = destino => page.evaluate((valor) => {
    document.querySelector(`#layout-switch [data-layout="${valor}"]`).click();
    const md = document.getElementById('markdown-panel');
    const html = document.getElementById('html-panel');
    return {
      mdVisible: getComputedStyle(md).display !== 'none',
      htmlVisible: getComputedStyle(html).display !== 'none',
      encogiendo: [md, html]
        .filter(panel => panel.classList.contains('panel-sliding'))
        .map(panel => panel.id),
    };
  }, destino);

  await page.locator('#layout-switch [data-layout="md"]').click();
  await page.locator('#html-panel').waitFor({ state: 'hidden' });
  const inicio = await bordes();

  // Solo Markdown → solo el editor visual: entra por la derecha.
  const entrando = await pulsar('html');
  assert.equal(entrando.mdVisible, true, 'el Markdown se escondió de golpe');
  assert.equal(entrando.htmlVisible, true, 'el editor visual no había llegado aún');
  assert.deepEqual(entrando.encogiendo.sort(), ['html-panel', 'markdown-panel']);
  await page.locator('#markdown-panel').waitFor({ state: 'hidden' });
  const final = await bordes();
  assert.equal(final.html.right, inicio.md.right, 'el borde derecho se movió: no entró por la derecha');

  // Y de vuelta, el Markdown entra por la izquierda: su borde izquierdo se queda.
  await pulsar('md');
  await page.locator('#html-panel').waitFor({ state: 'hidden' });
  const vuelta = await bordes();
  assert.equal(vuelta.md.left, inicio.md.left, 'el borde izquierdo se movió: no entró por la izquierda');
});

test('en pantalla estrecha las disposiciones vuelven al menú', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.setViewportSize({ width: 640, height: 900 });
  assert.equal(await page.locator('#layout-switch').isVisible(), false);
  assert.equal(await page.locator('#layout-menu-container').isVisible(), true);

  await page.locator('#layout-menu-btn').click();
  await page.locator('#layout-menu [data-layout="html"]').click();
  assert.equal(await page.locator('#markdown-panel').isVisible(), false);
  assert.equal(await page.locator('#html-panel').isVisible(), true);
  assert.equal(await page.locator('#layout-menu [data-layout="html"]').getAttribute('aria-checked'), 'true');
});

test('el selector de imagen escribe la ruta del archivo, que es lo predeterminado', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.locator('button[data-format="image"]').click();
  await page.locator('#image-file-input').setInputFiles({
    name: 'microscopio.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71]),
  });
  assert.equal(await page.locator('#image-file-name').textContent(), 'microscopio.png');
  assert.equal(await page.locator('input[name="image-insert-mode"][value="relative"]').isChecked(), true);
  // En el navegador no se conoce la carpeta del archivo y hay que advertirlo.
  await page.waitForSelector('#image-insert-mode-warning:not(.hidden)');
  await page.locator('#image-alt-text').fill('Microscopio');
  await page.locator('#insert-image-btn').click();
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('microscopio.png'));
  assert.match(await page.locator('#markdown-input').inputValue(), /!\[Microscopio\]\(microscopio\.png\)/);
});

test('el selector de imagen incrusta el archivo cuando se elige dentro del documento', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.locator('button[data-format="image"]').click();
  await page.locator('#image-file-input').setInputFiles({
    name: 'microscopio.png',
    mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71]),
  });
  await page.locator('input[name="image-insert-mode"][value="embedded"]').check();
  await page.locator('#image-alt-text').fill('Microscopio');
  await page.locator('#insert-image-btn').click();
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('data:image/png;base64,'));
  assert.match(await page.locator('#markdown-input').inputValue(), /!\[Microscopio\]\(data:image\/png;base64,/);
});

/*
  Pandoc hace figura de una imagen sola en su párrafo y con texto, y ese texto
  es su pie. La hoja tiene que enseñar lo mismo, y el pie se edita en ella.
*/
test('figura con pie: la hoja la centra y el pie editado vuelve al Markdown', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  await page.locator('#new-tab-btn').click();
  await page.evaluate(() => markdownEditor.setValue(
    'Texto.\n\n![Pie inicial](logo_100px.png)\n\nEn línea ![alt](logo_100px.png) aquí.\n\n![](logo_100px.png)\n\nFinal.',
  ));
  await page.locator('#html-output figure.edimark-figure figcaption').waitFor();
  assert.equal(await page.locator('#html-output figure').count(), 1, 'solo la imagen sola y con texto es figura');
  assert.equal(await page.locator('#html-output figcaption').textContent(), 'Pie inicial');
  assert.equal(await page.locator('#html-output figure').evaluate(n => getComputedStyle(n).textAlign), 'center');

  await page.locator('#html-output figcaption').click();
  await page.evaluate(() => {
    const caption = document.querySelector('#html-output figcaption');
    const range = document.createRange();
    range.selectNodeContents(caption);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  });
  await page.keyboard.type('Pie nuevo');
  await page.waitForFunction(() => markdownEditor.getValue().includes('![Pie nuevo](logo_100px.png)'));
  const markdown = await page.evaluate(() => markdownEditor.getValue());
  assert.doesNotMatch(markdown, /^Pie nuevo$/m, 'el pie se ha duplicado como párrafo');
  assert.match(markdown, /En línea !\[alt\]\(logo_100px\.png\) aquí\./);
  assert.match(markdown, /^!\[\]\(logo_100px\.png\)$/m);
});

test('el cuadro de imagen: con pie inserta una figura, sin pie no inventa texto', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  await page.locator('#new-tab-btn').click();
  await page.evaluate(() => { markdownEditor.setValue('Antes de la imagen'); markdownEditor.focus(); markdownEditor.setCursor({ line: 0, ch: 5 }); });
  for (const pie of ['', 'Un microscopio']) {
    await page.locator('button[data-format="image"]').click();
    await page.locator('input[name="image-insert-mode"][value="url"]').check();
    await page.locator('#image-url').fill('https://example.org/microscopio.png');
    await page.locator('#image-alt-text').fill(pie);
    await page.locator('#insert-image-btn').click();
    await page.locator('#image-modal-overlay').waitFor({ state: 'hidden' });
  }
  const markdown = await page.evaluate(() => markdownEditor.getValue());
  assert.match(markdown, /!\[\]\(https:\/\/example\.org\/microscopio\.png\)/, 'sin pie no debe llevar texto');
  assert.match(markdown, /(^|\n\n)!\[Un microscopio\]\(https:\/\/example\.org\/microscopio\.png\)\n\n/, 'con pie debe ir en su propio párrafo');
  await page.locator('#html-output figcaption').getByText('Un microscopio').waitFor();
});

test('al imprimir en modo escritorio el documento no se recorta a una página', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  const parrafos = Array.from({ length: 40 }, (_, i) => `## Apartado ${i + 1}\n\n${'Texto de relleno para ocupar varias páginas. '.repeat(6)}`);
  await page.locator('#markdown-input').fill(`# Documento largo\n\n${parrafos.join('\n\n')}`);
  // La ventana independiente y la aplicación de escritorio reparten el alto con
  // flex; si eso sobrevive a la impresión, solo sale la primera página.
  await page.evaluate(() => document.body.classList.add('desktop-mode'));
  await page.emulateMedia({ media: 'print' });
  await page.waitForTimeout(300);

  const medidas = await page.evaluate(() => {
    const panel = document.getElementById('html-panel');
    const salida = document.getElementById('html-output');
    return {
      altoPanel: panel.getBoundingClientRect().height,
      altoContenido: salida.scrollHeight,
      recorta: getComputedStyle(panel).overflow !== 'visible',
    };
  });

  assert.equal(medidas.recorta, false, 'el panel no debe recortar al imprimir');
  assert.ok(
    medidas.altoPanel >= medidas.altoContenido - 1,
    `el panel (${medidas.altoPanel}px) debe crecer hasta el contenido (${medidas.altoContenido}px)`,
  );
});

test('una imagen relativa que el propio sitio sirve se deja en paz', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  // `logo_100px.png` existe junto a la página: el navegador la carga solo y no
  // hay que avisar de nada ni sustituir su ruta.
  await page.locator('#markdown-input').fill('![Logotipo](logo_100px.png)');
  await page.waitForFunction(() => {
    const img = document.querySelector('#html-output img');
    return Boolean(img && img.complete && img.naturalWidth > 0);
  });
  assert.equal(await page.locator('#html-output img').getAttribute('src'), 'logo_100px.png');
  assert.equal(await page.locator('#missing-assets-notice').evaluate(el => el.classList.contains('hidden')), true);
});

test('las imágenes con ruta relativa se ven al vincular su carpeta', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill('![Gráfico](imagenes/01-grafico.png)');

  // Sin carpeta vinculada no hay forma de encontrarla: se avisa y se marca.
  await page.waitForSelector('#missing-assets-notice:not(.hidden)');
  assert.equal(await page.locator('#html-output img.edimark-missing-asset').count(), 1);

  const carpeta = await crearCarpetaConImagen();
  t.after(() => rm(carpeta, { recursive: true, force: true }));
  await page.locator('#assets-folder-input').setInputFiles(carpeta);

  // El aviso desaparece en cuanto la imagen se encuentra.
  await page.waitForSelector('#missing-assets-notice.hidden', { state: 'attached' });
  const src = await page.locator('#html-output img').first().getAttribute('src');
  assert.match(src, /^blob:/);
  // El Markdown no se toca: la ruta original sigue siendo la del documento.
  assert.equal(await page.locator('#markdown-input').inputValue(), '![Gráfico](imagenes/01-grafico.png)');
});

test('las imágenes vinculadas reaparecen después de recargar la página', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  const docId = await page.evaluate(() => currentId);
  await page.locator('#markdown-input').fill('![Gráfico](imagenes/01-grafico.png)');
  const carpeta = await crearCarpetaConImagen();
  t.after(() => rm(carpeta, { recursive: true, force: true }));
  await page.locator('#assets-folder-input').setInputFiles(carpeta);
  await page.waitForFunction(() => {
    const img = document.querySelector('#html-output img');
    return Boolean(img && img.getAttribute('src')?.startsWith('blob:'));
  });

  await page.waitForFunction(async (id) => new Promise((resolve) => {
    const request = indexedDB.open('edimarkweb-assets', 1);
    request.onerror = () => resolve(false);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('document-assets', 'readonly');
      const count = transaction.objectStore('document-assets').index('docId').count(id);
      count.onsuccess = () => {
        database.close();
        resolve(count.result === 1);
      };
      count.onerror = () => {
        database.close();
        resolve(false);
      };
    };
  }), docId);
  await page.evaluate(() => autosaveCurrentDoc());

  const imageRequests = [];
  page.on('request', request => {
    if (request.url().includes('/imagenes/01-grafico.png')) imageRequests.push(request.url());
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const restoredTab = page.locator(`.tab[data-id="${docId}"]`);
  await restoredTab.waitFor();
  await restoredTab.click();
  await page.waitForFunction(() => {
    const img = document.querySelector('#html-output img');
    return Boolean(img
      && img.getAttribute('src')?.startsWith('blob:')
      && img.complete
      && img.naturalWidth > 0);
  });

  await page.evaluate(() => updateHtml());
  await page.waitForFunction(() => document.querySelector('#html-output img')?.naturalWidth > 0);
  assert.deepEqual(imageRequests, [], 'las imágenes guardadas no deben buscarse en el servidor');
  assert.equal(await page.locator('#markdown-input').inputValue(), '![Gráfico](imagenes/01-grafico.png)');
  assert.equal(
    await page.locator('#missing-assets-notice').evaluate(el => el.classList.contains('hidden')),
    true,
  );
});

test('lo que sale de la vista previa conserva la ruta relativa, no el blob', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill('![Gráfico](imagenes/01-grafico.png)');
  const carpeta = await crearCarpetaConImagen();
  t.after(() => rm(carpeta, { recursive: true, force: true }));
  await page.locator('#assets-folder-input').setInputFiles(carpeta);
  await page.waitForFunction(() => {
    const img = document.querySelector('#html-output img');
    return Boolean(img && img.getAttribute('src')?.startsWith('blob:'));
  });

  const exportedHtml = await page.evaluate(() => window.buildHtmlWithTex());
  assert.match(exportedHtml, /src="imagenes\/01-grafico\.png"/);
  assert.ok(!exportedHtml.includes('blob:'), 'el HTML exportado no debe llevar blobs de esta sesión');
});

test('en web Guardar escribe el Markdown y las imágenes vinculadas en la carpeta elegida', async (t) => {
  const { context, page } = await openApp({
    initStorage: () => {
      window.__webSaveCalls = [];
      const makeDirectory = (prefix = '') => ({
        getDirectoryHandle: async (name) => makeDirectory(`${prefix}${name}/`),
        getFileHandle: async (name) => ({
          createWritable: async () => ({
            write: async (contents) => {
              const value = contents instanceof Blob
                ? [...new Uint8Array(await contents.arrayBuffer())]
                : String(contents);
              window.__webSaveCalls.push(['write', `${prefix}${name}`, value]);
            },
            close: async () => {
              window.__webSaveCalls.push(['close', `${prefix}${name}`]);
            },
          }),
        }),
      });
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: async options => {
          window.__webSaveCalls.push(['picker', options.mode]);
          return makeDirectory();
        },
      });
    },
  });
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill('![Gráfico](imagenes/01-grafico.png)');
  const carpeta = await crearCarpetaConImagen();
  t.after(() => rm(carpeta, { recursive: true, force: true }));
  await page.locator('#assets-folder-input').setInputFiles(carpeta);
  await page.waitForSelector('#missing-assets-notice.hidden', { state: 'attached' });

  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.__webSaveCalls.filter(call => call[0] === 'close').length === 2);

  const calls = await page.evaluate(() => window.__webSaveCalls);
  assert.deepEqual(calls[0], ['picker', 'readwrite']);
  const markdownWrite = calls.find(call => call[0] === 'write' && call[1].endsWith('.md'));
  assert.equal(markdownWrite[2], '![Gráfico](imagenes/01-grafico.png)');
  const imageWrite = calls.find(call => call[0] === 'write' && call[1] === 'imagenes/01-grafico.png');
  assert.deepEqual(imageWrite[2], [...PNG_PIXEL]);
});

test('en escritorio Guardar como copia las imágenes relativas del documento original', async (t) => {
  const { context, page, requests } = await openApp({
    initStorage: () => {
      window.__desktopAssetSaveCalls = [];
      window.__EDIMARK_TAURI__ = {
        dialog: {
          open: async () => '/origen/tema.md',
          save: async () => '/destino/resumen.md',
        },
        fs: {
          readTextFile: async () => '# Tema\n\n![Gráfico](imagenes/grafico.png)',
          writeTextFile: async (path, contents) => {
            window.__desktopAssetSaveCalls.push(['text', path, contents]);
          },
          mkdir: async (path, options) => {
            window.__desktopAssetSaveCalls.push(['mkdir', path, options.recursive]);
          },
          writeFile: async (path, contents) => {
            window.__desktopAssetSaveCalls.push(['bytes', path, [...contents]]);
          },
        },
        app: {
          readDocumentAsset: async path => {
            window.__desktopAssetSaveCalls.push(['read-image', path]);
            return [1, 2, 3, 4];
          },
          writeDocumentAsset: async (documentPath, relativePath, contents) => {
            window.__desktopAssetSaveCalls.push([
              'write-image', documentPath, relativePath, [...contents],
            ]);
          },
        },
      };
    },
  });
  t.after(() => context.close());

  await page.keyboard.press('Control+o');
  await page.locator('.tab-name').getByText('tema.md', { exact: true }).waitFor();
  await page.keyboard.press('Control+Shift+s');
  await page.waitForFunction(() => window.__desktopAssetSaveCalls.some(call => call[0] === 'write-image'));

  assert.equal(requests.some(url => url.includes('/imagenes/grafico.png')), false, 'la imagen nativa se lee del disco, no del servidor');
  const calls = await page.evaluate(() => window.__desktopAssetSaveCalls);
  assert.ok(calls.some(call => call[0] === 'read-image' && call[1] === '/origen/imagenes/grafico.png'));
  assert.ok(calls.some(call => call[0] === 'text'
    && call[1] === '/destino/resumen.md'
    && call[2] === '# Tema\n\n![Gráfico](imagenes/grafico.png)'));
  assert.ok(calls.some(call => call[0] === 'write-image'
    && call[1] === '/destino/resumen.md'
    && call[2] === 'imagenes/grafico.png'
    && JSON.stringify(call[3]) === '[1,2,3,4]'));
});

test('en escritorio Guardar como renombra la carpeta propia de imágenes y bibliografía', async (t) => {
  const { context, page } = await openApp({
    initStorage: () => {
      window.__desktopOwnFolderSaveCalls = [];
      window.__EDIMARK_TAURI__ = {
        dialog: {
          open: async () => '/origen/tema.md',
          save: async () => '/destino/resumen.md',
        },
        fs: {
          readTextFile: async () => [
            '---',
            'bibliography: "tema/references.bib"',
            '---',
            '',
            '# Tema',
            '',
            '![Gráfico](tema/images/grafico.png)',
          ].join('\n'),
          writeTextFile: async (path, contents) => {
            window.__desktopOwnFolderSaveCalls.push(['text', path, contents]);
          },
          writeFile: async () => {},
        },
        app: {
          readDocumentAsset: async path => {
            window.__desktopOwnFolderSaveCalls.push(['read-image', path]);
            return [1, 2, 3, 4];
          },
          readDocumentResource: async (documentPath, relativePath) => {
            window.__desktopOwnFolderSaveCalls.push(['read-resource', documentPath, relativePath]);
            return '@book{demo, title={Demo}}';
          },
          writeDocumentAsset: async (documentPath, relativePath, contents) => {
            window.__desktopOwnFolderSaveCalls.push([
              'write-image', documentPath, relativePath, [...contents],
            ]);
          },
          writeDocumentResource: async (documentPath, relativePath, contents) => {
            window.__desktopOwnFolderSaveCalls.push([
              'write-resource', documentPath, relativePath, new TextDecoder().decode(contents),
            ]);
          },
        },
      };
    },
  });
  t.after(() => context.close());

  await page.keyboard.press('Control+o');
  await page.locator('.tab-name').getByText('tema.md', { exact: true }).waitFor();
  await page.waitForFunction(() => window.__desktopOwnFolderSaveCalls.some(call => call[0] === 'read-resource'));
  await page.keyboard.press('Control+Shift+s');
  await page.waitForFunction(() => window.__desktopOwnFolderSaveCalls.some(call => call[0] === 'write-resource'));

  const calls = await page.evaluate(() => window.__desktopOwnFolderSaveCalls);
  assert.ok(calls.some(call => call[0] === 'text'
    && call[1] === '/destino/resumen.md'
    && call[2].includes('bibliography: "resumen/references.bib"')
    && call[2].includes('![Gráfico](resumen/images/grafico.png)')));
  assert.ok(calls.some(call => call[0] === 'read-image' && call[1] === '/origen/tema/images/grafico.png'));
  assert.ok(calls.some(call => call[0] === 'write-image'
    && call[1] === '/destino/resumen.md'
    && call[2] === 'resumen/images/grafico.png'));
  assert.ok(calls.some(call => call[0] === 'write-resource'
    && call[1] === '/destino/resumen.md'
    && call[2] === 'resumen/references.bib'
    && call[3] === '@book{demo, title={Demo}}'));
  const savedMarkdown = await page.locator('#markdown-input').inputValue();
  assert.match(savedMarkdown, /bibliography: "resumen\/references\.bib"/);
  assert.match(savedMarkdown, /!\[Gráfico\]\(resumen\/images\/grafico\.png\)/);
});

test('pegar detecta imágenes publicadas solo en clipboardData.items', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').focus();
  await page.evaluate(() => {
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'clipboard.png', { type: 'image/png' });
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData: () => '',
        files: [],
        items: [{ kind: 'file', getAsFile: () => file }],
        types: ['image/png'],
      },
    });
    document.getElementById('markdown-input').dispatchEvent(event);
  });
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('data:image/png;base64,'));
  // Sin texto: el nombre del archivo acabaría como pie de figura.
  assert.match(await page.locator('#markdown-input').inputValue(), /^!\[\]\(data:image\/png;base64,/);
});

test('Guardar como siempre pide una ruta nueva y la convierte en la ruta activa', async (t) => {
  const { context, page } = await openApp({
    initStorage: () => {
      window.__platformTestCalls = [];
      window.__EDIMARK_TAURI__ = {
        dialog: {
          open: async () => '/tmp/original.md',
          save: async (options) => {
            window.__platformTestCalls.push(['dialog.save', options.defaultPath]);
            return '/tmp/copia.md';
          },
        },
        fs: {
          readTextFile: async () => '# Original',
          writeTextFile: async (path, content) => {
            window.__platformTestCalls.push(['write', path, content]);
          },
          writeFile: async () => {},
        },
      };
    },
  });
  t.after(() => context.close());

  await page.keyboard.press('Control+o');
  await page.locator('.tab-name').getByText('original.md', { exact: true }).waitFor();
  await page.locator('#markdown-input').fill('# Primera versión');
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.__platformTestCalls.some(call => call[0] === 'write'));

  await page.locator('#markdown-input').fill('# Copia nueva');
  await page.keyboard.press('Control+Shift+s');
  await page.waitForFunction(() => window.__platformTestCalls.some(call => call[0] === 'dialog.save'));
  const calls = await page.evaluate(() => window.__platformTestCalls);
  assert.deepEqual(calls[0], ['write', '/tmp/original.md', '# Primera versión']);
  // El nombre propuesto cuelga de la última carpeta usada en la sesión, que es
  // la del documento abierto: así no hay que volver a navegar hasta ella.
  assert.deepEqual(calls[1], ['dialog.save', '/tmp/original.md']);
  assert.deepEqual(calls[2], ['write', '/tmp/copia.md', '# Copia nueva']);
  assert.equal(await page.locator('.tab-name').getByText('copia', { exact: true }).count(), 1);
});

/*
  Al soltar una carpeta, dataTransfer.files solo trae una entrada por directorio
  que no supera el filtro de extensiones: sin recorrer las entradas, la carpeta
  se rechazaba con el aviso de formato no admitido.
*/
test('soltar una carpeta abre los archivos que contiene', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.evaluate(() => {
    const archivo = new File(['# Desde la carpeta'], 'apuntes.md', { type: 'text/markdown' });
    const entradaArchivo = { isFile: true, isDirectory: false, file: (cb) => cb(archivo) };
    let entregado = false;
    const entradaCarpeta = {
      isFile: false,
      isDirectory: true,
      createReader: () => ({
        readEntries: (cb) => {
          if (entregado) { cb([]); return; }
          entregado = true;
          cb([entradaArchivo]);
        },
      }),
    };
    const evento = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(evento, 'dataTransfer', {
      value: { items: [{ webkitGetAsEntry: () => entradaCarpeta }], files: [], types: ['Files'] },
    });
    document.dispatchEvent(evento);
  });

  await page.locator('.tab-name').getByText('apuntes.md', { exact: true }).waitFor();
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('# Desde la carpeta'));
});

/*
  Los ajustes solo sirven si sobreviven a la sesión: se guardan en el
  almacenamiento local y el exportador los recoge de window.
*/
test('los ajustes del documento se guardan y se recuperan al volver', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#settings-menu-btn').click();
  await page.locator('#latex-settings-btn').click();
  // Las opciones van por pestañas: cada campo vive en la suya.
  await page.locator('#doc-settings-tab-latex').click();
  await page.locator('#latex-documentclass').selectOption('report');
  await page.locator('#latex-classoption').fill('12pt, a4paper');
  await page.locator('#latex-preamble').fill('\\usepackage{amsthm}');
  await page.locator('#latex-settings-save-btn').click();

  assert.deepEqual(
    await page.evaluate(() => window.__edimarkLatexSettings),
    {
      documentLanguage: 'auto',
      documentAuthor: '',
      documentToc: false,
      documentTocDepth: 3,
      documentNumberSections: false,
      epubCover: 'auto',
      epubCoverImage: '',
      epubCoverName: '',
      bibliographyContent: '',
      bibliographyName: '',
      bibliographyTitle: '',
      bibliographyHeadingLevel: 2,
      citationStyle: 'apa',
      cslContent: '',
      cslName: '',
      documentClass: 'report',
      classOptions: '12pt, a4paper',
      preamble: '\\usepackage{amsthm}',
      /*
        Sin tocar el formato del texto, quedan sin fijar todos menos los tres
        que la vista previa necesita para enseñar la verdad —cuerpo, letra e
        interlineado—, que traen valor de partida y viajan a los cinco formatos.
      */
      documentFormat: {
        align: '',
        font: 'serif',
        fontSize: '12',
        lineHeight: '1.5',
        paperSize: 'a4',
        orientation: 'portrait',
        marginTop: '',
        marginRight: '',
        marginBottom: '',
        marginLeft: '',
        indent: '',
        hyphenate: '',
        pageBreakBeforeH1: 'no',
      },
    }
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tab-name').first().waitFor();
  await page.waitForFunction(() => window.__edimarkReady === true);
  await page.locator('#settings-menu-btn').click();
  await page.locator('#latex-settings-btn').click();
  // Las opciones van por pestañas: cada campo vive en la suya.
  await page.locator('#doc-settings-tab-latex').click();
  assert.equal(await page.locator('#latex-documentclass').inputValue(), 'report');
  assert.equal(await page.locator('#latex-preamble').inputValue(), '\\usepackage{amsthm}');

  // Cancelar descarta lo tecleado; restablecer solo vacía el formulario.
  await page.locator('#latex-preamble').fill('\\usepackage{tikz}');
  await page.locator('#latex-settings-cancel-btn').click();
  assert.equal(
    await page.evaluate(() => window.__edimarkLatexSettings.preamble),
    '\\usepackage{amsthm}'
  );
});

test('amplía la bibliografía con distintos tipos de referencia desde la interfaz', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#settings-menu-btn').click();
  await page.locator('#latex-settings-btn').click();
  await page.locator('#doc-settings-tab-bibliography').click();
  await page.locator('#bibliography-example-btn').click();
  await page.locator('#bibliography-add-article-btn').click();
  await page.locator('#bibliography-article-key').fill('deharo2026ia');
  await page.locator('#bibliography-article-year').fill('2026');
  await page.locator('#bibliography-article-author').fill('de Haro, Juan José; García, Ana');
  await page.locator('#bibliography-article-title').fill('Inteligencia artificial y aprendizaje');
  await page.locator('#bibliography-article-journal').fill('Educación Digital');
  await page.locator('#bibliography-article-doi').fill('10.1234/ed.2026.1');
  await page.locator('#bibliography-article-form button[type="submit"]').click();
  assert.match(await page.locator('#bibliography-summary').textContent(), /bibliografia-ejemplo\.bib.*8 referencias/);
  assert.equal(await page.locator('#bibliography-article-form').isHidden(), true);

  // La clave es el identificador estable de la cita y no se puede repetir.
  await page.locator('#bibliography-add-article-btn').click();
  await page.locator('#bibliography-article-key').fill('deharo2026ia');
  await page.locator('#bibliography-article-year').fill('2026');
  await page.locator('#bibliography-article-author').fill('de Haro, Juan José');
  await page.locator('#bibliography-article-title').fill('Otro título');
  await page.locator('#bibliography-article-journal').fill('Educación Digital');
  await page.locator('#bibliography-article-form button[type="submit"]').click();
  await page.locator('#bibliography-article-error').waitFor({ state: 'visible' });
  assert.match(await page.locator('#bibliography-article-error').textContent(), /Ya existe/);
  await page.locator('#bibliography-article-cancel-btn').click();

  // El tipo cambia los campos: un libro pide editorial, pero no revista.
  await page.locator('#bibliography-add-article-btn').click();
  await page.locator('#bibliography-reference-type').selectOption('book');
  assert.equal(await page.locator('#bibliography-article-journal').isDisabled(), true);
  assert.equal(await page.locator('#bibliography-reference-publisher').isVisible(), true);
  await page.locator('#bibliography-article-key').fill('deharo2026libro');
  await page.locator('#bibliography-article-year').fill('2026');
  await page.locator('#bibliography-article-author').fill('de Haro, Juan José');
  await page.locator('#bibliography-article-title').fill('Escribir y citar con Markdown');
  await page.locator('#bibliography-reference-publisher').fill('Editorial Educativa');
  await page.locator('#bibliography-reference-isbn').fill('978-84-0000-000-0');
  await page.locator('#bibliography-article-form button[type="submit"]').click();
  assert.match(await page.locator('#bibliography-summary').textContent(), /9 referencias/);
  await page.locator('#latex-settings-save-btn').click();

  assert.match(
    await page.evaluate(() => window.__edimarkLatexSettings.bibliographyContent),
    /@book\{deharo2026libro,[\s\S]*publisher = \{Editorial Educativa\}/,
  );

  await page.locator('#citation-btn').click();
  await page.locator('#citation-search').fill('escribir y citar');
  assert.equal(await page.locator('#citation-results input[value="deharo2026libro"]').count(), 1);
});

test('las opciones de la bibliografía devuelven al cuadro de la cita', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#markdown-input').fill('# Trabajo\n\nSegún los datos.\n');
  await page.locator('#citation-btn').click();
  await page.locator('#citation-modal-overlay').waitFor({ state: 'visible' });

  // Ir a elegir el estilo y volver con Cancelar.
  await page.locator('#citation-open-style-btn').click();
  await page.locator('#latex-settings-modal-overlay').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#citation-modal-overlay').isHidden(), true);
  await page.locator('#latex-settings-cancel-btn').click();
  await page.locator('#citation-modal-overlay').waitFor({ state: 'visible' });

  // Y volver guardando, con lo elegido ya aplicado al cuadro de la cita.
  await page.locator('#citation-open-style-btn').click();
  await page.locator('#latex-settings-modal-overlay').waitFor({ state: 'visible' });
  await page.locator('#doc-settings-tab-bibliography').click();
  await page.locator('#bibliography-example-btn').click();
  await page.locator('#citation-style-select').selectOption('ieee');
  await page.locator('#latex-settings-save-btn').click();
  await page.locator('#citation-modal-overlay').waitFor({ state: 'visible' });
  assert.match(await page.locator('#citation-style-summary').textContent(), /IEEE/);
  assert.equal(await page.locator('#citation-results input[value="mayer2009multimedia"]').count(), 1);

  // Desde el aviso de que no hay bibliografía, el camino es el mismo.
  await page.locator('#citation-cancel-btn').click();
  await page.locator('#citation-btn').click();
  await page.locator('#citation-results input[value="mayer2009multimedia"]').check();
  await page.locator('#citation-insert-btn').click();
  assert.match(await page.locator('#markdown-input').inputValue(), /\[@mayer2009multimedia\]/);

  // Y al cerrar las opciones abiertas desde el menú no reaparece el cuadro.
  await page.locator('#settings-menu-btn').click();
  await page.locator('#latex-settings-btn').click();
  await page.locator('#latex-settings-cancel-btn').click();
  assert.equal(await page.locator('#citation-modal-overlay').isHidden(), true);
});

test('crea una referencia sin salir del diálogo de citas', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  // Sin bibliografía cargada el diálogo ya ofrece escribir la referencia a mano.
  await page.locator('#citation-btn').click();
  assert.equal(await page.locator('#citation-library-empty').isVisible(), true);

  // Y dice con qué estilo se compondrán las citas, con el camino para cambiarlo.
  assert.match(await page.locator('#citation-style-summary').textContent(), /APA 7/);
  assert.equal(await page.locator('#citation-open-style-btn').isVisible(), true);
  await page.locator('#citation-add-reference-btn').click();
  // Sin clave: la compone el programa con el apellido, el año y el título.
  await page.locator('#bibliography-article-year').fill('2026');
  await page.locator('#bibliography-article-author').fill('de Haro, Juan José');
  await page.locator('#bibliography-article-title').fill('Citar sin salir del diálogo');
  await page.locator('#bibliography-article-journal').fill('Educación Digital');
  await page.locator('#bibliography-article-form button[type="submit"]').click();

  // La lista se actualiza en el sitio: ya se puede marcar e insertar la cita.
  await page.locator('#citation-results input[value="deharo2026citar"]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#citation-library-empty').isHidden(), true);
  assert.equal(await page.locator('#bibliography-article-form').isHidden(), true);
  await page.locator('#citation-results input[value="deharo2026citar"]').check();
  await page.locator('#citation-insert-btn').click();
  assert.match(await page.locator('#markdown-input').inputValue(), /\[@deharo2026citar\]/);

  // La lista se lee como una bibliografía: apellido delante y por orden.
  await page.locator('#citation-btn').click();
  await page.locator('#citation-results input[value="deharo2026citar"]').waitFor();
  await page.locator('#citation-cancel-btn').click();

  // Con referencias ya cargadas la opción sigue estando disponible.
  await page.locator('#citation-btn').click();
  assert.equal(await page.locator('#citation-add-reference-btn').isVisible(), true);
  assert.match(await page.locator('#citation-style-summary').textContent(), /APA 7/);
  await page.locator('#citation-add-reference-btn').click();
  assert.equal(await page.locator('#bibliography-article-form').isVisible(), true);
  await page.locator('#citation-cancel-btn').click();

  // El formulario vuelve a su sitio en las opciones del documento.
  await page.locator('#settings-menu-btn').click();
  await page.locator('#latex-settings-btn').click();
  await page.locator('#doc-settings-tab-bibliography').click();
  await page.locator('#bibliography-add-article-btn').click();
  assert.equal(await page.locator('#bibliography-article-form').isVisible(), true);
  assert.match(await page.locator('#bibliography-summary').textContent(), /1 referencia/);

  // El ejemplo se suma a lo que ya había en vez de sustituirlo, y la lista
  // queda ordenada por el apellido del primer autor.
  await page.locator('#bibliography-example-btn').click();
  assert.match(await page.locator('#bibliography-summary').textContent(), /8 referencias/);
  await page.locator('#citation-style-select').selectOption('ieee');
  await page.locator('#latex-settings-save-btn').click();
  await page.locator('#citation-btn').click();
  assert.equal(await page.locator('#citation-results input[value="deharo2026citar"]').count(), 1);
  // El resumen sigue al estilo elegido en las opciones generales.
  assert.match(await page.locator('#citation-style-summary').textContent(), /IEEE/);
  assert.deepEqual(
    await page.locator('#citation-results label span.block.text-xs').allTextContents(),
    [
      'de Haro, Juan José · 2009 · deharo2009redes',
      'de Haro, Juan José · 2026 · deharo2026citar',
      'Freeman, Scott; Sarah L. Eddy; Miles McDonough; Michelle K. Smith; Nnadozie Okoroafor; Hannah Jordt; Mary Pat Wenderoth · 2014 · freeman2014active',
      'Mayer, Richard E. · 2009 · mayer2009multimedia',
      'Redecker, Christine · 2017 · redecker2017digcompedu',
      'Roediger, Henry L.; Jeffrey D. Karpicke · 2006 · roediger2006testing',
      'Sweller, John · 1988 · sweller1988cognitive',
      'UNESCO · 2023 · unesco2023ia',
    ],
    'por apellido y, con el mismo autor, del trabajo más antiguo al más reciente',
  );
  await page.locator('#citation-cancel-btn').click();
});

test('carga una bibliografía, busca referencias e inserta una cita múltiple', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const bibliography = `
@article{garcia2024,
  author = {García López, Ana},
  title = {IA generativa en el aula},
  year = {2024}
}
@book{doe2023,
  author = {John Doe},
  title = {Teaching with Markdown},
  year = {2023}
}`;
  const csl = '<?xml version="1.0"?><style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"><info><title>Prueba</title><id>http://example.com/test</id></info><citation><layout><text variable="title"/></layout></citation><bibliography><layout><text variable="title"/></layout></bibliography></style>';

  await page.locator('#settings-menu-btn').click();
  await page.locator('#latex-settings-btn').click();
  await page.locator('#doc-settings-tab-bibliography').click();
  assert.equal(await page.locator('#citation-style-select').inputValue(), 'apa');
  await page.locator('#bibliography-example-btn').click();
  assert.match(await page.locator('#bibliography-summary').textContent(), /bibliografia-ejemplo\.bib.*7 referencias/);
  await page.locator('#bibliography-input').setInputFiles({
    name: 'fuentes.bib',
    mimeType: 'text/plain',
    buffer: Buffer.from(bibliography),
  });
  await page.waitForFunction(() => document.getElementById('bibliography-summary')?.textContent.includes('fuentes.bib'));
  await page.locator('#csl-input').setInputFiles({
    name: 'estilo.csl',
    mimeType: 'application/xml',
    buffer: Buffer.from(csl),
  });
  await page.waitForFunction(() => document.getElementById('csl-summary')?.textContent.includes('estilo.csl'));
  assert.equal(await page.locator('#citation-style-select').inputValue(), 'custom');
  await page.locator('#bibliography-title').fill('Fuentes consultadas');
  await page.locator('#bibliography-heading-level').selectOption('3');
  assert.match(await page.locator('#bibliography-summary').textContent(), /fuentes\.bib.*2 referencias/);
  assert.equal(await page.locator('#csl-summary').textContent(), 'Estilo: estilo.csl');
  await page.locator('#latex-settings-save-btn').click();

  await page.evaluate(() => {
    window.PandocExporter.generateHtml = async () => '<p><span class="citation">IA generativa en el aulaTeaching with Markdown</span></p><div id="refs"><div class="csl-entry">Bibliografía compuesta</div></div>';
  });
  await page.locator('#markdown-input').fill('# Trabajo\n\nSegún ');
  await page.locator('#citation-btn').click();
  await page.locator('#citation-search').fill('garcia');
  await page.locator('#citation-results input[value="garcia2024"]').check();
  await page.locator('#citation-search').fill('markdown');
  await page.locator('#citation-results input[value="doe2023"]').check();
  await page.locator('#citation-insert-btn').click();
  assert.equal(await page.locator('#markdown-input').inputValue(), '# Trabajo\n\nSegún [@garcia2024; @doe2023]');
  await page.locator('#html-output .edimark-preview-bibliography').waitFor();
  assert.equal(await page.locator('#html-output .edimark-preview-bibliography h3').textContent(), 'Fuentes consultadas');

  // El PDF compone las citas justo antes de imprimir y después devuelve la
  // vista editable, que conserva las claves Markdown.
  await page.evaluate(() => {
    window.PandocExporter.generateHtml = async () => '<h1>Trabajo</h1><p>Según <span class="citation">(García, 2024; Doe, 2023)</span></p><div id="refs">Bibliografía compuesta</div>';
    window.__printedHtml = '';
    window.print = () => { window.__printedHtml = document.getElementById('html-output').innerHTML; };
  });
  await page.locator('#export-menu-btn').click();
  await page.locator('#export-menu [data-export-format="pdf"]').click();
  await page.waitForFunction(() => window.__printedHtml.includes('Bibliografía compuesta'));
  assert.match(await page.evaluate(() => window.__printedHtml), /class="citation"/);
  await page.waitForFunction(() => document.querySelector('#html-output .edimark-preview-citation'));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__edimarkReady === true);
  assert.equal(await page.evaluate(() => window.__edimarkLatexSettings.bibliographyName), 'fuentes.bib');
  assert.equal(await page.evaluate(() => window.__edimarkLatexSettings.cslName), 'estilo.csl');
  assert.equal(await page.evaluate(() => window.__edimarkLatexSettings.bibliographyTitle), 'Fuentes consultadas');
  assert.equal(await page.evaluate(() => window.__edimarkLatexSettings.bibliographyHeadingLevel), 3);
});

/*
  Un estilo propio es tan del documento como sus referencias: si no viaja con
  él, quien lo abra en otro equipo verá las citas con el estilo de siempre.
*/
test('el estilo propio se guarda junto a las referencias y vuelve al abrir', async (t) => {
  const CSL = '<?xml version="1.0"?><style xmlns="http://purl.org/net/xbiblio/csl" version="1.0"><info><title>Mío</title><id>http://example.com/mio</id></info><citation><layout><text variable="title"/></layout></citation><bibliography><layout><text variable="title"/></layout></bibliography></style>';
  const { context, page } = await openApp({
    initStorage: () => {
      window.__cslSaveCalls = [];
      window.__EDIMARK_TAURI__ = {
        dialog: { save: async () => '/destino/trabajo.md' },
        fs: {
          writeTextFile: async (path, contents) => {
            window.__cslSaveCalls.push(['text', path, contents]);
          },
          writeFile: async () => {},
        },
        app: {
          writeDocumentResource: async (documentPath, relativePath, contents) => {
            window.__cslSaveCalls.push(['resource', relativePath, new TextDecoder().decode(contents)]);
          },
          readDocumentResource: async (documentPath, relativePath) => {
            const escrito = window.__cslSaveCalls.find(call => call[0] === 'resource' && call[1] === relativePath);
            return escrito ? escrito[2] : '';
          },
        },
      };
    },
  });
  t.after(() => context.close());

  await page.locator('#markdown-input').fill('Según [@mayer2009multimedia] el aprendizaje mejora.\n');
  await page.locator('#settings-menu-btn').click();
  await page.locator('#latex-settings-btn').click();
  await page.locator('#doc-settings-tab-bibliography').click();
  await page.locator('#bibliography-example-btn').click();
  await page.locator('#citation-style-select').selectOption('custom');
  await page.locator('#csl-input').setInputFiles({ name: 'mi-estilo.csl', mimeType: 'application/xml', buffer: Buffer.from(CSL) });
  await page.locator('#csl-summary').getByText('mi-estilo.csl', { exact: false }).waitFor();
  await page.locator('#latex-settings-save-btn').click();

  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.__cslSaveCalls.some(call => call[0] === 'resource' && call[1].endsWith('.csl')));

  const calls = await page.evaluate(() => window.__cslSaveCalls);
  // El estilo se copia en la misma carpeta que las referencias.
  assert.ok(calls.some(call => call[0] === 'resource' && call[1] === 'trabajo/references.bib'));
  const estilo = calls.find(call => call[0] === 'resource' && call[1] === 'trabajo/style.csl');
  assert.ok(estilo, 'el estilo propio debe guardarse junto a las referencias');
  assert.match(estilo[2], /purl\.org\/net\/xbiblio\/csl/);

  // Y el documento lo declara, como hace con la bibliografía.
  const guardado = calls.find(call => call[0] === 'text');
  assert.match(guardado[2], /bibliography: "trabajo\/references\.bib"/);
  assert.match(guardado[2], /csl: "trabajo\/style\.csl"/);
  assert.match(await page.locator('#markdown-input').inputValue(), /csl: "trabajo\/style\.csl"/);

  // Al abrirlo de nuevo, el estilo del documento vuelve a mandar.
  await page.evaluate(async () => {
    const doc = docs.find(d => d.id === currentId);
    doc.cslContent = '';
    doc.cslName = '';
    window.__cslHydrated = await hydrateDocumentCsl(doc);
  });
  assert.equal(await page.evaluate(() => window.__cslHydrated), true);
  assert.equal(await page.evaluate(() => window.__edimarkLatexSettings.citationStyle), 'custom');
  assert.match(await page.evaluate(() => window.__edimarkLatexSettings.cslContent), /purl\.org\/net\/xbiblio\/csl/);
});

test('la bibliografía de ejemplo se carga desde el selector de citas sin archivos', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#markdown-input').fill('Fuente: ');
  await page.evaluate(() => {
    window.PandocExporter.generateHtml = async ({ markdown }) => {
      const mayer = markdown.includes('mayer2009multimedia');
      const label = mayer ? '(Mayer, 2009)' : '(UNESCO, 2023)';
      const reference = mayer ? 'Mayer, R. E. (2009). Multimedia learning.' : 'UNESCO. (2023). Guidance for generative AI.';
      return `<p><span class="citation">${label}</span></p><div id="refs" class="references csl-bib-body"><div class="csl-entry">${reference}</div></div>`;
    };
  });
  await page.locator('#citation-btn').click();
  await page.locator('#citation-library-empty').waitFor({ state: 'visible' });
  await page.locator('#citation-load-example-btn').click();
  await page.locator('#citation-library-ready').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#citation-result-count').textContent(), '7 referencias');
  await page.locator('#citation-search').fill('UNESCO');
  await page.locator('#citation-results input[value="unesco2023ia"]').check();
  await page.locator('#citation-insert-btn').click();

  assert.match(
    await page.locator('#markdown-input').inputValue(),
    /^---\nbibliography: "Manual\/references\.bib"\n---\n\nFuente: \[@unesco2023ia\]$/,
  );
  const previewCitation = page.locator('#html-output .edimark-preview-citation');
  await previewCitation.waitFor();
  assert.equal(await previewCitation.textContent(), '(UNESCO, 2023)');
  assert.equal(await previewCitation.getAttribute('contenteditable'), 'false');
  await page.locator('#html-output .edimark-preview-bibliography').waitFor();
  assert.equal(await page.locator('#html-output .edimark-preview-bibliography h2').textContent(), 'Referencias');
  assert.match(await page.locator('#html-output .edimark-preview-bibliography').textContent(), /Guidance for generative AI/);
  assert.doesNotMatch(await page.evaluate(() => window.buildHtmlWithTex()), /edimark-preview-bibliography|Guidance for generative AI/);

  // La ficha es indivisible, pero al pulsarla se edita con el mismo selector.
  await previewCitation.click();
  assert.equal(await page.locator('#citation-modal-title').textContent(), 'Editar cita bibliográfica');
  assert.equal(await page.locator('#citation-results input[value="unesco2023ia"]').isChecked(), true);
  await page.locator('#citation-results input[value="unesco2023ia"]').uncheck();
  await page.locator('#citation-search').fill('Mayer');
  await page.locator('#citation-results input[value="mayer2009multimedia"]').check();
  await page.locator('#citation-insert-btn').click();
  assert.match(
    await page.locator('#markdown-input').inputValue(),
    /Fuente: \[@mayer2009multimedia\]$/,
  );
  assert.equal(await page.locator('#html-output .edimark-preview-citation').textContent(), '(Mayer, 2009)');

  // En Markdown, el botón del libro reconoce la cita bajo el cursor.
  await page.locator('#markdown-input').focus();
  await page.locator('#markdown-input').evaluate((textarea) => {
    const position = textarea.value.indexOf('mayer2009') + 3;
    textarea.setSelectionRange(position, position);
  });
  await page.locator('#citation-btn').click();
  assert.equal(await page.locator('#citation-modal-title').textContent(), 'Editar cita bibliográfica');
  assert.equal(await page.locator('#citation-results input[value="mayer2009multimedia"]').isChecked(), true);
  await page.locator('#citation-cancel-btn').click();

  // También funciona si solo está seleccionada una parte de la clave.
  await page.locator('#markdown-input').evaluate((textarea) => {
    const start = textarea.value.indexOf('mayer2009') + 2;
    textarea.setSelectionRange(start, start + 5);
  });
  await page.locator('#citation-btn').click();
  assert.equal(await page.locator('#citation-modal-title').textContent(), 'Editar cita bibliográfica');
  assert.equal(await page.locator('#citation-results input[value="mayer2009multimedia"]').isChecked(), true);
  await page.locator('#citation-cancel-btn').click();
  assert.match(
    await page.evaluate(() => window.__edimarkLatexSettings.bibliographyName),
    /\/references\.bib$/,
  );
});

test('inserta y edita citas narrativas, sin autor y con localizador', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#markdown-input').fill('Tal como afirma ');
  await page.locator('#citation-btn').click();
  await page.locator('#citation-load-example-btn').click();
  await page.locator('#citation-search').fill('redes sociales');
  await page.locator('#citation-results input[value="deharo2009redes"]').check();
  await page.locator('#citation-mode').selectOption('narrative');
  await page.locator('#citation-locator').fill('p. 5');
  await page.locator('#citation-insert-btn').click();
  assert.match(await page.locator('#markdown-input').inputValue(), /Tal como afirma @deharo2009redes \[p\. 5\]$/);
  await page.locator('#html-output .edimark-preview-citation').waitFor();
  assert.equal(await page.locator('#html-output .edimark-preview-citation').textContent(), 'de Haro (2009, p. 5)');

  await page.locator('#markdown-input').focus();
  await page.locator('#markdown-input').evaluate((textarea) => {
    const position = textarea.value.indexOf('deharo2009') + 4;
    textarea.setSelectionRange(position, position);
  });
  await page.locator('#citation-btn').click();
  assert.equal(await page.locator('#citation-mode').inputValue(), 'narrative');
  assert.equal(await page.locator('#citation-locator').inputValue(), 'p. 5');
  await page.locator('#citation-mode').selectOption('suppress-author');
  await page.locator('#citation-insert-btn').click();
  assert.match(await page.locator('#markdown-input').inputValue(), /Tal como afirma \[-@deharo2009redes, p\. 5\]$/);

  // Con dos fuentes no hay una única voz narrativa ni un localizador común.
  await page.locator('#citation-btn').click();
  await page.locator('#citation-search').fill('Mayer');
  await page.locator('#citation-results input[value="mayer2009multimedia"]').check();
  assert.equal(await page.locator('#citation-mode').inputValue(), 'parenthetical');
  assert.equal(await page.locator('#citation-mode option[value="narrative"]').isDisabled(), true);
  assert.equal(await page.locator('#citation-locator').isDisabled(), true);
  await page.locator('#citation-cancel-btn').click();
});

test('al guardar, la bibliografía viaja en la carpeta propia y queda declarada en el Markdown', async (t) => {
  const { context, page } = await openApp({
    initStorage: () => {
      window.__portableBibliographyWrites = [];
      const directory = (prefix = '') => ({
        getDirectoryHandle: async name => directory(`${prefix}${name}/`),
        getFileHandle: async name => ({
          createWritable: async () => ({
            write: async contents => {
              window.__portableBibliographyWrites.push([
                `${prefix}${name}`,
                contents instanceof Blob ? await contents.text() : String(contents),
              ]);
            },
            close: async () => {},
          }),
        }),
      });
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: async () => directory(),
      });
    },
  });
  t.after(() => context.close());

  await page.evaluate(() => {
    const doc = newDoc('cosa.md', 'Texto [@unesco2023ia].');
    attachBibliographyToDocument(doc, {
      content: window.EdiMarkBibliography.EXAMPLE_BIBLIOGRAPHY,
      name: 'origen.bib',
    });
  });
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.__portableBibliographyWrites.length === 2);

  const writes = new Map(await page.evaluate(() => window.__portableBibliographyWrites));
  assert.match(writes.get('cosa.md'), /^---\nbibliography: "cosa\/references\.bib"\n---/);
  assert.match(writes.get('cosa.md'), /\[@unesco2023ia\]/);
  assert.match(writes.get('cosa/references.bib'), /@book\{unesco2023ia,/);
});

test('la carpeta de recursos recupera references.bib aunque no contenga imágenes', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'edimark-proyecto-'));
  const project = join(parent, 'cosa');
  await mkdir(project, { recursive: true });
  await writeFile(join(project, 'references.bib'), `
@book{mayer2009,
  author = {Mayer, Richard E.},
  title = {Multimedia Learning},
  year = {2009}
}`);
  t.after(() => rm(parent, { recursive: true, force: true }));

  const { context, page } = await openApp();
  t.after(() => context.close());
  await page.evaluate(() => newDoc(
    'cosa.md',
    '---\nbibliography: "cosa/references.bib"\n---\n\nTexto [@mayer2009].',
  ));
  await page.locator('#assets-folder-input').setInputFiles(project);
  await page.waitForFunction(() => window.__edimarkLatexSettings.bibliographyContent.includes('mayer2009'));
  await page.locator('#citation-btn').click();
  await page.locator('#citation-results input[value="mayer2009"]').waitFor();
});

test('en escritorio se carga automáticamente la bibliografía declarada junto al Markdown', async (t) => {
  const { context, page } = await openApp({
    initStorage: () => {
      window.__EDIMARK_TAURI__ = {
        dialog: { open: async () => '/docs/cosa.md' },
        fs: {
          readTextFile: async () => '---\nbibliography: "cosa/references.bib"\n---\n\nTexto [@mayer2009].',
        },
        app: {
          readDocumentResource: async (documentPath, relativePath) => {
            if (documentPath !== '/docs/cosa.md' || relativePath !== 'cosa/references.bib') throw new Error('ruta inesperada');
            return '@book{mayer2009, author={Mayer, Richard E.}, title={Multimedia Learning}, year={2009}}';
          },
        },
      };
    },
  });
  t.after(() => context.close());

  await page.keyboard.press('Control+o');
  await page.waitForFunction(() => window.__edimarkLatexSettings.bibliographyContent.includes('mayer2009'));
  await page.locator('#citation-btn').click();
  await page.locator('#citation-results input[value="mayer2009"]').waitFor();
});

/*
  El idioma por omisión sigue al de la interfaz en cada exportación: guardarlo
  resuelto dejaría los documentos en un idioma que el usuario ya no usa.
*/
test('el idioma del documento admite un código libre y por omisión sigue a la interfaz', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#settings-menu-btn').click();
  await page.locator('#latex-settings-btn').click();
  // El campo del código solo aparece al elegir «Otro…».
  await assert.doesNotReject(page.locator('#doc-language-code-field.hidden').waitFor({ state: 'attached' }));
  await page.locator('#doc-language').selectOption('other');
  await page.locator('#doc-language-code-field').waitFor({ state: 'visible' });
  await page.locator('#doc-language-code').fill('pt-BR');
  await page.locator('#latex-settings-save-btn').click();
  assert.equal(await page.evaluate(() => window.__edimarkLatexSettings.documentLanguage), 'pt-BR');

  // Al reabrir, un código no listado vuelve a presentarse como «Otro…».
  await page.locator('#settings-menu-btn').click();
  await page.locator('#latex-settings-btn').click();
  assert.equal(await page.locator('#doc-language').inputValue(), 'other');
  assert.equal(await page.locator('#doc-language-code').inputValue(), 'pt-BR');

  // «Otro…» sin código no significa nada y vuelve al automático.
  await page.locator('#doc-language-code').fill('   ');
  await page.locator('#latex-settings-save-btn').click();
  assert.equal(await page.evaluate(() => window.__edimarkLatexSettings.documentLanguage), 'auto');
});

/*
  Los metadatos son datos sobre el documento, no contenido. marked no los
  conoce y los pintaba como una raya horizontal y un encabezado falso con el
  texto crudo dentro.
*/
test('el bloque de metadatos no se ve en la vista previa y sobrevive a editarla', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill('---\nlang: "fr"\ntitle: "Mi documento"\n---\n\n# Encabezado\n\nTexto normal.\n');
  await page.locator('#html-output h1').getByText('Encabezado', { exact: true }).waitFor();

  const preview = page.locator('#html-output');
  assert.equal((await preview.innerText()).includes('lang:'), false, 'los metadatos no deben verse');
  assert.equal(await preview.locator('hr').count(), 0, 'el --- no debe salir como raya horizontal');
  // El editor de Markdown sí los muestra: es el código fuente.
  assert.match(await page.locator('#markdown-input').inputValue(), /^---\nlang: "fr"/);

  // Editar en la vista previa devuelve Markdown sin metadatos: hay que reponerlos.
  await page.evaluate(() => {
    const output = document.getElementById('html-output');
    output.focus();
    output.querySelector('p').textContent = 'Texto editado en la vista previa.';
    output.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('editado en la vista previa'));
  const markdown = await page.locator('#markdown-input').inputValue();
  assert.match(markdown, /^---\nlang: "fr"\ntitle: "Mi documento"\n---\n/, `metadatos perdidos:\n${markdown}`);
});

/*
  Marked no interpreta las notas de Pandoc por sí solo. La hoja debe numerarlas
  por orden de aparición, reunirlas al final y, sobre todo, devolver exactamente
  sus etiquetas y definiciones cuando se escribe en el editor visual.
*/
test('las notas al pie se leen en la hoja y sobreviven a editarla', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const source = [
    '# Texto con notas',
    '',
    'Primera referencia[^larga], repetida[^larga], y otra[^2].',
    '',
    '`Esto no es una referencia[^2]`',
    '',
    '[^2]: Segunda nota con **negrita**.',
    '[^larga]: Primera nota con *cursiva*.',
    '    Tiene una continuación.',
    '',
  ].join('\n');
  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill(source);
  await page.locator('#html-output .footnotes').waitFor();

  const render = await page.evaluate(() => ({
    referencias: [...document.querySelectorAll('#html-output .footnote-reference a')].map(link => ({
      texto: link.textContent,
      destino: link.getAttribute('href'),
    })),
    notas: [...document.querySelectorAll('#html-output .footnotes li')].map(item => item.textContent.trim()),
    cursivas: document.querySelectorAll('#html-output .footnotes em').length,
    negritas: document.querySelectorAll('#html-output .footnotes strong').length,
    codigo: document.querySelector('#html-output code')?.textContent || '',
  }));
  assert.deepEqual(render.referencias.map(ref => ref.texto), ['1', '1', '2']);
  assert.deepEqual(render.referencias.map(ref => ref.destino), ['#footnote-1', '#footnote-1', '#footnote-2']);
  assert.match(render.notas[0], /Primera nota con cursiva\.\s+Tiene una continuación\./);
  assert.match(render.notas[1], /Segunda nota con negrita\./);
  assert.equal(render.cursivas, 1);
  assert.equal(render.negritas, 1);
  assert.equal(render.codigo, 'Esto no es una referencia[^2]');

  await page.evaluate(() => {
    const output = document.getElementById('html-output');
    output.focus();
    output.querySelector('p').firstChild.textContent = 'Referencia editada';
    output.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('Referencia editada'));
  const roundTrip = await page.locator('#markdown-input').inputValue();
  assert.match(roundTrip, /Referencia editada\[\^larga\], repetida\[\^larga\], y otra\[\^2\]\./);
  assert.match(roundTrip, /\[\^larga\]: Primera nota con \*cursiva\*\.\n {4}Tiene una continuación\./);
  assert.match(roundTrip, /\[\^2\]: Segunda nota con \*\*negrita\*\*\./);
});

test('el botón inserta notas al pie desde los dos editores', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  const markdown = page.locator('#markdown-input');
  await markdown.fill('# Documento\n\nTexto');
  await markdown.focus();
  await page.evaluate(() => {
    const editor = document.getElementById('markdown-input');
    editor.setSelectionRange(editor.value.length, editor.value.length);
  });

  await page.locator('#footnote-btn').click();
  await page.locator('#footnote-modal-overlay').waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.activeElement?.id === 'footnote-text');
  assert.equal(await page.locator('#footnote-text').evaluate(field => field.selectionStart), 0);
  assert.equal(await page.locator('#insert-footnote-btn').isDisabled(), true);
  await page.locator('#footnote-text').fill('Nota con **formato**.');
  assert.equal(await page.locator('#insert-footnote-btn').isEnabled(), true);
  await page.locator('#insert-footnote-btn').click();
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('Texto[^1]'));
  assert.match(await markdown.inputValue(), /\[\^1\]: Nota con \*\*formato\*\*\./);
  // La hoja se repinta aparte del Markdown: contar sin esperarla fallaba en el
  // Chromium de CI, que llega al recuento antes que el repintado.
  await page.locator('#html-output .footnote-reference').first().waitFor();
  assert.equal(await page.locator('#html-output .footnote-reference').count(), 1);

  await page.locator('#html-output > p').click();
  await page.keyboard.press('End');
  await page.locator('#footnote-btn').click();
  await page.locator('#footnote-text').fill('Añadida desde la hoja.');
  await page.locator('#insert-footnote-btn').click();
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('[^2]: Añadida desde la hoja.'));
  const finalMarkdown = await markdown.inputValue();
  assert.match(finalMarkdown, /Texto\[\^1\]\[\^2\]/);
  await page.waitForFunction(() => document.querySelectorAll('#html-output .footnote-reference').length === 2);
  assert.equal(await page.locator('#html-output .footnote-reference').count(), 2);
  assert.equal(await page.locator('#html-output .footnotes li').count(), 2);
  assert.equal(await page.locator('#footnote-btn .lucide-notebook-pen').count(), 1);
});

/*
  El idioma de un documento concreto vive en su propio bloque de metadatos, no
  en los ajustes de la aplicación: así viaja con el archivo.
*/
test('el idioma del documento se elige desde el panel y se guarda en el archivo', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill('# Notas\n\nTexto.\n');
  await page.locator('#html-output h1').getByText('Notas', { exact: true }).waitFor();

  // Sin idioma propio: hereda el general.
  const boton = page.locator('#doc-format-toolbar-btn');
  assert.equal(await page.locator('#markdown-input').evaluate(editor => editor.spellcheck), true);
  assert.equal(await page.locator('#markdown-input').getAttribute('lang'), 'es');

  await boton.click();
  await page.locator('#doc-format-modal-overlay').waitFor({ state: 'visible' });
  await page.locator('#doc-own-language').selectOption('ca');
  await page.locator('#doc-format-save-btn').click();
  assert.equal(await page.locator('#markdown-input').getAttribute('lang'), 'ca');

  // Queda escrito en el documento, y sin ensuciar la vista previa.
  assert.equal(await page.locator('#markdown-input').inputValue(), '---\nlang: "ca"\n---\n\n# Notas\n\nTexto.\n');
  assert.equal((await page.locator('#html-output').innerText()).includes('lang'), false);

  // Volver al idioma general retira la línea y el bloque, que se queda vacío.
  await boton.click();
  await page.locator('#doc-own-language').selectOption('');
  await page.locator('#doc-format-save-btn').click();
  assert.equal(await page.locator('#markdown-input').inputValue(), '# Notas\n\nTexto.\n');
  assert.equal(await page.locator('#markdown-input').getAttribute('lang'), 'es');
});

test('un documento sin idioma propio sigue al ajuste general', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill('Texto suelto\n');
  assert.equal(await page.locator('#markdown-input').getAttribute('lang'), 'es');

  await page.locator('#settings-menu-btn').click();
  await page.locator('#latex-settings-btn').click();
  await page.locator('#doc-language').selectOption('eu');
  await page.locator('#latex-settings-save-btn').click();

  assert.equal(await page.locator('#markdown-input').getAttribute('lang'), 'eu');
  // El documento sigue limpio: el idioma general no se escribe en el archivo.
  assert.equal(await page.locator('#markdown-input').inputValue(), 'Texto suelto\n');
});

test('el autor se guarda como ajuste general y por documento', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#settings-menu-btn').click();
  await page.locator('#latex-settings-btn').click();
  await page.locator('#doc-author').fill('Juan José');
  await page.locator('#latex-settings-save-btn').click();
  assert.equal(await page.evaluate(() => window.__edimarkLatexSettings.documentAuthor), 'Juan José');

  // El autor general no se escribe en el documento: solo el propio.
  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill('# Notas\n\nTexto.\n');
  await page.locator('#html-output h1').getByText('Notas', { exact: true }).waitFor();
  assert.equal(await page.locator('#markdown-input').inputValue(), '# Notas\n\nTexto.\n');

  // El autor propio se escribe desde el cuadro del documento.
  await page.locator('#doc-format-toolbar-btn').click();
  await page.locator('#doc-format-modal-overlay').waitFor({ state: 'visible' });
  await page.locator('#doc-own-author').fill('Ana Ruiz');
  await page.locator('#doc-format-save-btn').click();
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('author:'));
  assert.equal(await page.locator('#markdown-input').inputValue(), '---\nauthor: "Ana Ruiz"\n---\n\n# Notas\n\nTexto.\n');
  // Y sigue sin verse en la vista previa.
  assert.equal((await page.locator('#html-output').innerText()).includes('Ana Ruiz'), false);

  // Al reabrirlo el cuadro trae lo que el documento declara.
  await page.locator('#doc-format-toolbar-btn').click();
  assert.equal(await page.locator('#doc-own-author').inputValue(), 'Ana Ruiz');

  // Vaciarlo retira la línea y el bloque vacío.
  await page.locator('#doc-own-author').fill('   ');
  await page.locator('#doc-format-save-btn').click();
  await page.waitForFunction(() => !document.getElementById('markdown-input').value.includes('author:'));
  assert.equal(await page.locator('#markdown-input').inputValue(), '# Notas\n\nTexto.\n');
});

test('un perfil de formato se guarda una vez y se aplica a otros documentos', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#markdown-input').fill('# Trabajo\n\nTexto.\n');
  await page.locator('#doc-format-toolbar-btn').click();
  await page.locator('#doc-format-modal-overlay').waitFor({ state: 'visible' });

  // Sin perfiles guardados no hay nada que aplicar ni que borrar.
  assert.equal(await page.locator('#doc-format-profile-apply').isDisabled(), true);
  assert.equal(await page.locator('#doc-format-profile-delete').isDisabled(), true);

  // Se guarda lo que digan los campos, sin escribirlo dos veces.
  await page.locator('#doc-format-tab-format').click();
  await page.locator('#doc-format-fields-fontsize').fill('13');
  await page.locator('#doc-format-fields-margin-left').fill('2,5');
  await page.locator('#doc-format-tab-document').click();
  await page.locator('#doc-own-numbersections').selectOption('yes');
  await page.locator('#doc-format-profile-save').click();
  await page.locator('#doc-format-profile-name').fill('TFG');
  await page.locator('#doc-format-profile-form button[type="submit"]').click();
  await page.locator('#doc-format-profile-form').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#doc-format-profile').inputValue(), 'TFG');
  await page.locator('#doc-format-save-btn').click();

  // Otro documento: el perfil rellena los campos y no toca lo que no fija.
  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill('# Otro\n\nTexto.\n');
  await page.locator('#doc-format-toolbar-btn').click();
  await page.locator('#doc-format-tab-format').click();
  await page.locator('#doc-format-fields-align').selectOption('justify');
  await page.locator('#doc-format-profile').selectOption('TFG');
  await page.locator('#doc-format-profile-apply').click();
  assert.equal(await page.locator('#doc-format-fields-fontsize').inputValue(), '13');
  assert.equal(await page.locator('#doc-format-fields-margin-left').inputValue(), '2.5');
  assert.equal(await page.locator('#doc-format-fields-align').inputValue(), 'justify', 'el perfil no fija la alineación');

  // Aplicar el perfil no escribe nada por su cuenta: cancelar descarta.
  await page.locator('#doc-format-cancel-btn').click();
  assert.equal(await page.locator('#markdown-input').inputValue(), '# Otro\n\nTexto.\n');

  // Es el botón de siempre el que lo lleva al documento.
  await page.locator('#doc-format-toolbar-btn').click();
  await page.locator('#doc-format-profile').selectOption('TFG');
  await page.locator('#doc-format-profile-apply').click();
  await page.locator('#doc-format-save-btn').click();
  await page.locator('#doc-format-modal-overlay').waitFor({ state: 'hidden' });
  const markdown = await page.locator('#markdown-input').inputValue();
  assert.match(markdown, /fontsize: "13pt"/);
  assert.match(markdown, /margin-left: "2.5cm"/);
  assert.match(markdown, /numbersections: true/);

  // Guardar con un nombre que ya existe actualiza ese perfil, no crea otro.
  await page.locator('#doc-format-toolbar-btn').click();
  await page.locator('#doc-format-tab-format').click();
  await page.locator('#doc-format-fields-fontsize').fill('11');
  await page.locator('#doc-format-profile').selectOption('TFG');
  await page.locator('#doc-format-profile-save').click();
  assert.equal(await page.locator('#doc-format-profile-name').inputValue(), 'TFG', 'propone el perfil elegido');
  await page.locator('#doc-format-profile-form button[type="submit"]').click();
  await page.locator('#doc-format-profile-form').waitFor({ state: 'hidden' });
  assert.deepEqual(await page.locator('#doc-format-profile option').allTextContents(), ['Ninguno', 'TFG']);

  // Un perfil sin nombre no se guarda.
  await page.locator('#doc-format-profile-save').click();
  await page.locator('#doc-format-profile-name').fill('   ');
  await page.locator('#doc-format-profile-form button[type="submit"]').click();
  await page.locator('#doc-format-profile-error').waitFor({ state: 'visible' });
  assert.match(await page.locator('#doc-format-profile-error').textContent(), /nombre/);
  await page.locator('#doc-format-profile-cancel').click();

  // Borrar pregunta antes y deja el documento como estaba.
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#doc-format-profile').selectOption('TFG');
  await page.locator('#doc-format-profile-delete').click();
  await page.waitForFunction(() => document.querySelectorAll('#doc-format-profile option').length === 1);
  assert.equal(await page.locator('#doc-format-profile-apply').isDisabled(), true);
  await page.locator('#doc-format-cancel-btn').click();
  assert.match(await page.locator('#markdown-input').inputValue(), /fontsize: "13pt"/);
});

test('el índice y la numeración se recuerdan como ajuste', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#settings-menu-btn').click();
  await page.locator('#latex-settings-btn').click();
  assert.equal(await page.locator('#doc-toc').isChecked(), false, 'apagados de fábrica');
  assert.equal(await page.locator('#doc-number-sections').isChecked(), false);

  await page.locator('#doc-toc').check();
  await page.locator('#doc-number-sections').check();
  await page.locator('#latex-settings-save-btn').click();
  assert.deepEqual(
    await page.evaluate(() => [window.__edimarkLatexSettings.documentToc, window.__edimarkLatexSettings.documentNumberSections]),
    [true, true],
  );

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tab-name').first().waitFor();
  await page.waitForFunction(() => window.__edimarkReady === true);
  await page.locator('#settings-menu-btn').click();
  await page.locator('#latex-settings-btn').click();
  assert.equal(await page.locator('#doc-toc').isChecked(), true);
  assert.equal(await page.locator('#doc-number-sections').isChecked(), true);
});

/*
  La imagen elegida se guarda en el almacenamiento del navegador, el mismo del
  autoguardado de los documentos: por eso hay un tope de tamaño.
*/
test('la portada del EPUB ofrece los tres modos y limita el peso de la imagen', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#settings-menu-btn').click();
  await page.locator('#latex-settings-btn').click();
  // Las opciones van por pestañas: cada campo vive en la suya.
  await page.locator('#doc-settings-tab-epub').click();

  // De fábrica, la generada; el selector de archivo solo aparece con «una imagen mía».
  assert.equal(await page.locator('input[name="epub-cover"][value="auto"]').isChecked(), true);
  await assert.doesNotReject(page.locator('#epub-cover-picker.hidden').waitFor({ state: 'attached' }));

  await page.locator('input[name="epub-cover"][value="custom"]').check();
  await page.locator('#epub-cover-picker').waitFor({ state: 'visible' });

  // Una imagen de más de 1 MB se rechaza con un aviso y no se guarda.
  const avisos = [];
  page.on('dialog', dialog => { avisos.push(dialog.message()); dialog.accept(); });
  await page.locator('#epub-cover-input').setInputFiles({
    name: 'enorme.png', mimeType: 'image/png', buffer: Buffer.alloc(1024 * 1024 + 10, 1),
  });
  await page.waitForFunction(() => document.getElementById('epub-cover-name').textContent === '');
  assert.equal(avisos.length, 1, `se esperaba un aviso: ${JSON.stringify(avisos)}`);
  assert.match(avisos[0], /1 MB/);

  // Una pequeña sí entra y se recuerda tras recargar.
  await page.locator('#epub-cover-input').setInputFiles({
    name: 'portada.png', mimeType: 'image/png', buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await page.locator('#epub-cover-name').getByText('portada.png').waitFor();
  await page.locator('#latex-settings-save-btn').click();
  assert.equal(await page.evaluate(() => window.__edimarkLatexSettings.epubCover), 'custom');
  assert.match(await page.evaluate(() => window.__edimarkLatexSettings.epubCoverImage), /^data:image\/png;base64,/);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.tab-name').first().waitFor();
  await page.waitForFunction(() => window.__edimarkReady === true);
  await page.locator('#settings-menu-btn').click();
  await page.locator('#latex-settings-btn').click();
  // Las opciones van por pestañas: cada campo vive en la suya.
  await page.locator('#doc-settings-tab-epub').click();
  assert.equal(await page.locator('input[name="epub-cover"][value="custom"]').isChecked(), true);
  assert.equal(await page.locator('#epub-cover-name').textContent(), 'portada.png');

  // Al volver a «sin portada», la imagen deja de ocupar espacio guardado.
  await page.locator('input[name="epub-cover"][value="none"]').check();
  await page.locator('#latex-settings-save-btn').click();
  assert.deepEqual(
    await page.evaluate(() => [window.__edimarkLatexSettings.epubCover, window.__edimarkLatexSettings.epubCoverImage]),
    ['none', ''],
  );
});

test('el aviso de escritorio reaparece con cada versión y no acumula claves', async (t) => {
  const { context, page } = await openApp({
    initStorage: () => {
      // Preferencias de versiones ya descartadas, que deben desaparecer.
      localStorage.setItem('edimarkweb-hide-desktop-release-2.16.0', '1');
      localStorage.setItem('edimarkweb-hide-desktop-release-2.17.0', '1');
    },
  });
  t.after(() => context.close());

  // La versión en marcha no está descartada, así que el aviso sale...
  await page.locator('#desktop-release-banner').waitFor({ state: 'visible' });
  // ...y las claves de las versiones anteriores ya no están.
  const restantes = await page.evaluate(() => Object.keys(localStorage)
    .filter(key => key.startsWith('edimarkweb-hide-desktop-release-')));
  assert.deepEqual(restantes, []);

  await page.locator('#desktop-banner-never-show').check();
  await page.reload();
  await page.locator('.tab-name').first().waitFor();
  await assert.doesNotReject(
    page.locator('#desktop-release-banner').waitFor({ state: 'hidden' }),
    'el aviso debía seguir oculto para la misma versión',
  );

  // Con una versión nueva publicada, la clave guardada pasa a ser antigua.
  await page.evaluate(() => {
    const stored = Object.keys(localStorage)
      .filter(key => key.startsWith('edimarkweb-hide-desktop-release-'));
    stored.forEach(key => localStorage.removeItem(key));
    localStorage.setItem('edimarkweb-hide-desktop-release-0.0.1', '1');
  });
  await page.reload();
  await page.locator('#desktop-release-banner').waitFor({ state: 'visible' });
  const trasLaPurga = await page.evaluate(() => Object.keys(localStorage)
    .filter(key => key.startsWith('edimarkweb-hide-desktop-release-')));
  assert.deepEqual(trasLaPurga, []);
});

/*
  El formato de un documento se guarda en su propio bloque de metadatos, no en
  este navegador: al abrir el archivo en otro sitio tiene que seguir ahí.
*/
test('el formato del documento se escribe en el archivo y se ve en la vista previa', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  await conLaHojaATamanoReal(page);

  await page.locator('#markdown-input').fill('# Prueba\n\nUn párrafo cualquiera.\n\n# Segundo tema\n\nMás texto.');

  // El botón Aa de la barra abre el mismo cuadro que el menú del documento.
  await page.locator('#doc-format-toolbar-btn').click();
  await page.locator('#doc-format-modal-overlay').waitFor({ state: 'visible' });
  // El formato del texto vive en su propia pestaña.
  await page.locator('#doc-format-tab-format').click();
  assert.deepEqual(
    await page.locator('#doc-format-fields .document-format-group-title').allTextContents(),
    ['Texto', 'Página'],
    'texto y página deben poder recorrerse como dos grupos distintos',
  );
  assert.deepEqual(
    await page.locator('#doc-format-fields .document-format-group').first().locator('label').allTextContents(),
    ['Tipo de letra', 'Nombre de la tipografía', 'Tamaño (pt)', 'Interlineado', 'Alineación', 'Sangría de primera línea', 'Partir palabras con guion'],
    'los ajustes de texto deben seguir el orden habitual de un procesador',
  );
  assert.deepEqual(
    await page.locator('#doc-format-fields .document-format-group').nth(1).locator('label').allTextContents(),
    ['Tamaño de papel', 'Orientación', 'Cada H1 empieza en página nueva', 'Superior', 'Derecho', 'Inferior', 'Izquierdo'],
    'papel, orientación, salto y márgenes deben quedar juntos',
  );
  await page.locator('#doc-format-fields-align').selectOption('justify');
  await page.locator('#doc-format-fields-font').selectOption('serif');
  await page.locator('#doc-format-fields-fontsize').fill('13');
  await page.locator('#doc-format-fields-margin-left').fill('2,5');
  await page.locator('#doc-format-fields-hyphenate').selectOption('yes');
  await page.locator('#doc-format-fields-orientation').selectOption('landscape');
  await page.locator('#doc-format-fields-pagebreak-h1').selectOption('yes');
  await page.locator('#doc-format-save-btn').click();
  await page.locator('#doc-format-modal-overlay').waitFor({ state: 'hidden' });

  const markdown = await page.locator('#markdown-input').inputValue();
  assert.match(markdown, /^---\n/);
  assert.match(markdown, /align: "justify"/);
  assert.match(markdown, /fontsize: "13pt"/);
  // La coma decimal es la que se teclea en español.
  assert.match(markdown, /margin-left: "2.5cm"/);
  assert.match(markdown, /hyphenate: true/);
  assert.match(markdown, /orientation: "landscape"/);
  assert.match(markdown, /pagebreak-before-h1: true/);
  assert.match(markdown, /# Prueba/);

  const styles = await page.locator('#html-output').evaluate(preview => ({
    align: preview.style.textAlign,
    size: preview.style.fontSize,
    padding: preview.style.paddingLeft,
    hyphens: preview.style.hyphens,
    paperWidth: preview.style.getPropertyValue('--paper-width'),
    paperHeight: preview.style.getPropertyValue('--paper-height'),
  }));
  // El tamaño y el margen llevan dentro la lupa de la vista previa, que vale 1
  // mientras nadie la toque: lo que se comprueba es que llegan los 13 pt.
  assert.deepEqual(styles, {
    align: 'justify',
    size: 'calc(13pt * var(--preview-zoom, 1))',
    padding: 'calc(2.5cm * var(--preview-zoom, 1))',
    hyphens: 'auto',
    paperWidth: '29.7cm',
    paperHeight: '21cm',
  });
  const tamañoUsado = await page.locator('#html-output')
    .evaluate(preview => parseFloat(getComputedStyle(preview).fontSize));
  assert.ok(
    Math.abs(tamañoUsado - (13 * 96) / 72) < 0.01,
    `13 pt deberían ser 17,33 px y la vista previa usa ${tamañoUsado}`,
  );

  // Al reabrirlo, el cuadro muestra lo que el documento declara.
  await page.locator('#doc-format-toolbar-btn').click();
  await page.locator('#doc-format-tab-format').click();
  assert.equal(await page.locator('#doc-format-fields-align').inputValue(), 'justify');
  assert.equal(await page.locator('#doc-format-fields-fontsize').inputValue(), '13');
  assert.equal(await page.locator('#doc-format-fields-orientation').inputValue(), 'landscape');
  assert.equal(await page.locator('#doc-format-fields-pagebreak-h1').inputValue(), 'yes');

  // Y quitarlo del documento devuelve el Markdown a lo que era.
  await page.locator('#doc-format-reset-btn').click();
  await page.locator('#doc-format-save-btn').click();
  const limpio = await page.locator('#markdown-input').inputValue();
  assert.equal(/align:|fontsize:|margin-left:|hyphenate:|orientation:|pagebreak-before-h1:/.test(limpio), false);
  assert.match(limpio, /# Prueba/);
  assert.equal(await page.locator('#html-output').evaluate(preview => preview.style.textAlign), '');
});

/*
  Copiar moría con un TypeError donde no hay contexto seguro —un http:// que no
  sea localhost, o el archivo abierto a pelo—, porque ahí navigator.clipboard
  sencillamente no existe y las dos funciones de copia lo daban por hecho. El
  respaldo con execCommand ya estaba escrito; solo que nadie lo llamaba.
*/
test('copiar funciona sin navigator.clipboard', async (t) => {
  const { context, page } = await openApp({
    initStorage: () => {
      Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
      delete window.ClipboardItem;
    },
  });
  t.after(() => context.close());

  assert.equal(await page.evaluate(() => navigator.clipboard === undefined), true);
  await page.locator('#markdown-input').fill('# Hola\n\nUn *párrafo*.');
  await page.waitForFunction(() => document.querySelector('#html-output')?.innerHTML.includes('Hola'));

  const marca = async (selector) => {
    await page.locator(selector).click();
    // La confirmación es el icono: la marca verde solo aparece si no hubo error.
    return page.locator(`${selector} [data-lucide]`).first().getAttribute('data-lucide');
  };
  assert.equal(await marca('#copy-html-btn'), 'check');
});

/*
  La cabecera tenía todo apilado en el borde derecho y el centro desierto, con
  la carpeta de «Archivo» repitiendo el icono de su propia primera opción y dos
  circulitos idénticos —la interrogación y la i— al final. Ahora los menús se
  leen escritos junto al logotipo y a la derecha quedan las acciones del día a
  día, cada una con un icono distinto.
*/
test('la cabecera separa los menús de las acciones del documento', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  const packageVersion = JSON.parse(await readFile(resolve(repoRoot, 'package.json'), 'utf8')).version;

  // Los menús, con su nombre y sin icono, junto a la marca.
  const menus = page.locator('#header-menus');
  const marca = await page.evaluate(() => {
    const cabecera = document.querySelector('#main-container > header');
    const logo = cabecera.querySelector(':scope > div:first-child img');
    const texto = cabecera.querySelector('.app-brand-label');
    return {
      version: texto.querySelector('.app-brand-version').textContent,
      altoTexto: texto.getBoundingClientRect().height,
      altoLogo: logo.getBoundingClientRect().height,
      altoCabecera: cabecera.getBoundingClientRect().height,
      altoContenido: Math.max(...[...cabecera.children].map(elemento => elemento.getBoundingClientRect().height)),
    };
  });
  assert.equal(marca.version, `v${packageVersion}`);
  assert.ok(marca.altoTexto <= marca.altoLogo, `la versión hizo crecer la marca: ${JSON.stringify(marca)}`);
  // El hijo más alto, 8 px de relleno arriba y abajo y el borde inferior.
  assert.equal(marca.altoCabecera, marca.altoContenido + 17, `la versión hizo crecer la cabecera: ${JSON.stringify(marca)}`);

  assert.equal(await menus.locator('#actions-menu-btn').count(), 1);
  assert.equal(await menus.locator('#settings-menu-btn').count(), 1);
  assert.equal(await menus.locator('[data-lucide="folder"], [data-lucide="settings"]').count(), 0);
  assert.equal((await menus.locator('#actions-menu-btn').innerText()).trim(), 'Archivo');

  // Exportar es un menú más, entre Archivo y Configuración: son seis formatos
  // con su descripción, no una acción de un clic.
  assert.equal(await menus.locator('#export-menu-btn').count(), 1);
  assert.deepEqual(
    await menus.locator(':scope > div > button[aria-haspopup="true"]').allInnerTexts(),
    ['Archivo', 'Exportar', 'Configuración'],
  );

  // Abrir, Importar y Guardar salen a la barra como iconos, que son la vía
  // rápida, y siguen además en el menú, donde se explican y muestran su atajo.
  const acciones = page.locator('#document-actions-group');
  assert.deepEqual(
    await acciones.locator(':scope > button').evaluateAll(buttons => buttons.map(button => button.id)),
    ['open-quick-btn', 'import-quick-btn', 'save-btn', 'print-btn', 'open-search-btn'],
  );
  assert.equal(await acciones.locator('#open-quick-btn').getAttribute('title'), 'Abrir archivo (Ctrl+O)');
  assert.equal(await acciones.locator('#import-quick-btn').getAttribute('title'), 'Importar archivo (Ctrl+Alt+O)');
  assert.equal(await acciones.locator('#save-btn').count(), 1);
  await page.evaluate(() => {
    window.__selectoresRapidos = [];
    for (const id of ['file-input', 'import-file-input']) {
      document.getElementById(id).addEventListener('click', (event) => {
        event.preventDefault();
        window.__selectoresRapidos.push(id);
      });
    }
  });
  await acciones.locator('#open-quick-btn').click();
  await acciones.locator('#import-quick-btn').click();
  assert.deepEqual(await page.evaluate(() => window.__selectoresRapidos), ['file-input', 'import-file-input']);
  assert.equal(await page.locator('#actions-menu #save-btn').count(), 0);
  assert.equal(await page.locator('#actions-menu #save-menu-btn').count(), 1);
  assert.equal(await page.locator('#actions-menu #save-as-btn').count(), 1);

  // Y en el orden de cualquier menú de archivo: primero lo que trae contenido,
  // después Guardar y Guardar como…
  await page.locator('#actions-menu-btn').click();
  await page.locator('#actions-menu').waitFor({ state: 'visible' });
  // El nombre vive en la primera fila; debajo va su explicación.
  assert.deepEqual(
    await page.locator('#actions-menu [role="menuitem"]:visible > span:first-child > span:not([data-shortcut])').allInnerTexts(),
    ['Abrir', 'Importar', 'Pegar LaTeX', 'Guardar', 'Guardar como…'],
  );
  assert.equal(await page.locator('#actions-menu #save-menu-btn [data-shortcut]').innerText(), 'Ctrl+S');
  await page.keyboard.press('Escape');

  // Exportar ya no es un submenú de Archivo: se abre por su cuenta.
  await page.locator('#export-menu-btn').click();
  await page.locator('#export-menu').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#actions-menu').isVisible(), false);
  await page.keyboard.press('Escape');

  // Un solo botón de ayuda para el manual y el «Acerca de».
  assert.equal(await page.locator('#help-controls-group').count(), 0);
  await page.locator('#help-menu-btn').click();
  await page.locator('#help-menu').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#help-menu #help-btn').isVisible(), true);
  assert.equal(await page.locator('#help-menu #about-btn').isVisible(), true);
  await page.keyboard.press('Escape');

  // Y el punto dice que al documento abierto le falta guardar.
  assert.equal(await page.locator('#save-dirty-dot').isVisible(), false);
  await page.locator('#markdown-input').fill('# Con cambios');
  await page.waitForFunction(() => !document.getElementById('save-dirty-dot').classList.contains('hidden'));
});

/*
  Los menús explicaban el formato con un paréntesis pegado al nombre —«DOCX
  (Microsoft Word)», «$...$ (en línea)»—, que alarga la etiqueta y obliga a
  leerla entera para distinguir una opción de otra. El nombre va solo y la
  explicación, debajo y en gris.
*/
test('cada opción de formato se explica debajo, no entre paréntesis', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const revisar = async (boton, menu, esperadas) => {
    await page.locator(boton).click();
    await page.locator(menu).waitFor({ state: 'visible' });
    const etiquetas = await page.locator(`${menu} [role="menuitem"] > span > span:not([data-shortcut]), ${menu} [role="menuitemradio"] > span > span:not([data-shortcut])`)
      .allTextContents();
    assert.deepEqual(etiquetas, esperadas, `etiquetas de ${menu}`);
    // Una descripción por opción, y ningún paréntesis en el nombre.
    const descripciones = await page.locator(`${menu} [role="menuitem"] > span:not(:first-child), ${menu} [role="menuitemradio"] > span:not(:first-child)`)
      .allTextContents();
    assert.equal(descripciones.length, esperadas.length, `descripciones de ${menu}`);
    assert.ok(descripciones.every(texto => texto.trim().length > 0), `alguna descripción vacía en ${menu}`);
    await page.keyboard.press('Escape');
  };

  await revisar('#export-menu-btn', '#export-menu', ['DOCX', 'ODT', 'EPUB', 'HTML', 'TEX', 'PDF']);
  await revisar('#formula-btn', '#formula-options', ['\\(...\\)', '\\[...\\]', '$...$', '$$...$$']);
  await revisar('#copy-html-menu-toggle', '#preview-copy-menu', ['Markdown', 'HTML', 'LaTeX', 'LaTeX completo']);
});

/*
  Copiar dejó de ser cosa de cada panel: los dos botones —el del Markdown y el
  de la previsualización— eran la misma acción con distinto formato, así que se
  funden en uno junto a Exportar, con su acorde y con un rótulo que dice qué
  copia el clic.
*/
test('un solo botón copia en los cuatro formatos', async (t) => {
  const { context, page } = await openApp({ permissions: ['clipboard-read', 'clipboard-write'] });
  t.after(() => context.close());

  // El de cada panel ya no existe: el de la cabecera hace los cuatro formatos.
  assert.equal(await page.locator('#copy-md-btn').count(), 0);
  assert.equal(await page.locator('#document-actions-group #copy-html-btn').count(), 1);

  await page.locator('#markdown-input').fill('# Hola\n\nUn *párrafo*.');
  await page.waitForFunction(() => document.querySelector('#html-output')?.innerHTML.includes('Hola'));

  // El rótulo dice qué copia el clic. Se mira antes de copiar: la marca verde
  // de «copiado» ocupa el botón entero durante dos segundos.
  assert.equal(await page.locator('.copy-html-btn-label').innerText(), 'HTML');

  const portapapeles = () => page.evaluate(() => navigator.clipboard.readText());
  const acorde = async (tecla) => {
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await page.locator('#markdown-input').click();
    await page.keyboard.press('Control+Alt+KeyC');
    await page.keyboard.press(tecla);
    await page.waitForFunction(() => navigator.clipboard.readText().then(t => t.length > 0));
    return portapapeles();
  };

  // Lo que sale al portapapeles solo se puede leer donde hay permiso para
  // leerlo; el resto de la prueba —los rótulos, los acordes y su alineación—
  // no lo necesita y se comprueba en los dos navegadores.
  if (HAY_PORTAPAPELES) {
    assert.match(await acorde('Digit1'), /^# Hola/);
    assert.match(await acorde('Digit2'), /<h1[^>]*>Hola<\/h1>/);
  }

  // Y sigue al último formato elegido.
  await page.locator('#copy-html-menu-toggle').click();
  await page.locator('[data-copy-action="markdown"]').click();
  await page.waitForFunction(() => document.querySelector('.copy-html-btn-label')?.textContent === 'Markdown');

  // Y el menú enseña los cuatro acordes.
  await page.locator('#copy-html-menu-toggle').click();
  const atajos = await page.locator('#preview-copy-menu [data-shortcut]').allTextContents();
  assert.deepEqual(atajos, ['Ctrl+Alt+C 1', 'Ctrl+Alt+C 2', 'Ctrl+Alt+C 3', 'Ctrl+Alt+C 4']);
  // Sin la palabra «Copiar» repetida cuatro veces: la dice el encabezado, que
  // además aclara que va el documento entero y no lo que haya seleccionado.
  assert.match(await page.locator('[data-i18n-key="copy_menu_heading"]').innerText(), /todo el documento/i);
  assert.deepEqual(
    await page.locator('#preview-copy-menu [data-copy-action] > span > span:not([data-shortcut])').allTextContents(),
    ['Markdown', 'HTML', 'LaTeX', 'LaTeX completo'],
  );
  // Cada formato dice para qué sirve, y el HTML dice lo que nadie adivina:
  // que es el que se pega con formato en un procesador de textos.
  const descripciones = await page.locator('#preview-copy-menu [data-copy-action] > span:not(:first-child)').allTextContents();
  assert.equal(descripciones.length, 4);
  assert.match(descripciones[1], /procesadores y editores/i);

  // Y los atajos quedan alineados: la marca del activo no los desplaza.
  const izquierdas = await page.locator('#preview-copy-menu [data-shortcut]')
    .evaluateAll(spans => spans.map(span => Math.round(span.getBoundingClientRect().left)));
  assert.equal(new Set(izquierdas).size, 1, `los atajos no están alineados: ${izquierdas}`);
});

/*
  Una tabla más ancha que la hoja se desplaza dentro de su propia caja: si se
  saliera, arrastraría a la mesa entera y el documento acabaría moviéndose a lo
  ancho por culpa de una tabla.
*/
test('una tabla ancha se desplaza dentro de la hoja, sin mover la página', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  /*
    Con la hoja a tamaño de papel, la mesa se desplaza a lo ancho en cuanto el
    panel es más estrecho que una página: para mirar lo que hace la tabla hace
    falta una ventana donde la hoja quepa entera.
  */
  await page.setViewportSize({ width: 1400, height: 900 });
  const columnas = Array.from({ length: 12 }, (_, i) => `Columna bastante larga ${i + 1}`);
  await page.locator('#markdown-input').fill([
    '# Con tabla',
    '',
    `| ${columnas.join(' | ')} |`,
    `| ${columnas.map(() => '---').join(' | ')} |`,
    `| ${columnas.map((_, i) => `dato ${i + 1}`).join(' | ')} |`,
    '',
  ].join('\n'));
  await page.locator('#layout-switch [data-layout="html"]').click();
  // Y con la disposición ya asentada: durante el cambio los paneles todavía se
  // están repartiendo el ancho.
  await page.locator('#markdown-panel').waitFor({ state: 'hidden' });
  await page.waitForSelector('#html-output table');
  // El ancho de la tabla depende de la tipografía: medir antes de que cargue
  // da números de otra fuente y la prueba se vuelve caprichosa.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const tabla = document.querySelector('#html-output table');
    return !!tabla && tabla.scrollWidth > tabla.clientWidth;
  });

  const medidas = await page.evaluate(() => {
    const mesa = document.getElementById('preview-desk');
    const hoja = document.getElementById('html-output');
    const tabla = hoja.querySelector('table');
    return {
      tablaSeDesplaza: tabla.scrollWidth > tabla.clientWidth,
      tablaCabeEnLaHoja: Math.round(tabla.getBoundingClientRect().width)
        <= Math.round(hoja.getBoundingClientRect().width),
      mesaQuieta: mesa.scrollWidth <= mesa.clientWidth,
    };
  });

  assert.equal(medidas.tablaSeDesplaza, true, 'la tabla debería poder desplazarse por dentro');
  assert.equal(medidas.tablaCabeEnLaHoja, true, 'la tabla no debería salirse de la hoja');
  assert.equal(medidas.mesaQuieta, true, 'la mesa no debería desplazarse a lo ancho');
});

/*
  Los cuatro delimitadores en un acorde: Ctrl+M abre la espera y la segunda
  tecla elige. Cada combinación nueva chocaba con algo —Ctrl+Mayús+J es la
  consola del navegador y Ctrl+Mayús+M, la lupa del sistema—, así que solo se
  expone una y las segundas teclas son teclas normales.
*/
test('Ctrl+M abre la espera y la segunda tecla elige el delimitador', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const editor = page.locator('#markdown-input');
  const acorde = async (segunda) => {
    await editor.fill('');
    await editor.click();
    await page.keyboard.press('Control+KeyM');
    if (segunda) await page.keyboard.press(segunda);
    return editor.inputValue();
  };

  assert.equal(await acorde('Digit1'), '\\(\\)');
  assert.equal(await acorde('Digit2'), '\n\\[\n\n\\]\n');
  assert.equal(await acorde('Digit3'), '$$');
  assert.equal(await acorde('Digit4'), '\n$$\n\n$$\n');
  // Escape cancela sin escribir.
  assert.equal(await acorde('Escape'), '');

  // Una tecla ajena se escribe pero no cierra la ayuda, ni esta caduca por el
  // temporizador normal de los avisos.
  await editor.click();
  await page.keyboard.press('Control+KeyM');
  await page.keyboard.press('KeyA');
  assert.equal(await page.evaluate(() => window.__chordPending()), true);
  assert.equal(await editor.inputValue(), 'a');
  await page.waitForTimeout(3400);
  assert.equal(await page.locator('#status-toast').getAttribute('aria-hidden'), 'false');

  // También se puede elegir con el ratón. El clic solo aplica la opción
  // pulsada y entonces sí retira la tarjeta.
  const choices = page.locator('.chord-prompt-choice');
  assert.deepEqual(await choices.allTextContents(), [
    '1LaTeX en línea\\(…\\)',
    '2LaTeX en bloque\\[…\\]',
    '3Markdown en línea$…$',
    '4Markdown en bloque$$…$$',
  ]);
  await choices.nth(2).click();
  assert.equal(await page.evaluate(() => window.__chordPending()), false);
  assert.equal(await editor.inputValue(), 'a$$');
  assert.equal(await page.locator('#status-toast-message').textContent(), '');

  // La equis permite cancelar también con el ratón, sin insertar nada.
  await editor.fill('');
  await editor.click();
  await page.keyboard.press('Control+KeyM');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  assert.equal(await page.evaluate(() => window.__chordPending()), false);
  assert.equal(await editor.inputValue(), '');

  // Y el menú enseña el acorde, para aprenderlo sin abrir el manual.
  await page.locator('#formula-btn').click();
  await page.locator('#formula-options').waitFor({ state: 'visible' });
  const atajos = await page.locator('#formula-options [data-shortcut]').allTextContents();
  assert.deepEqual(atajos, ['Ctrl+M 1', 'Ctrl+M 2', 'Ctrl+M 3', 'Ctrl+M 4']);
});

/*
  El HTML que Markdown no sabe escribir sobrevive a la ida y vuelta por la
  hoja. Escribir una letra en el editor visual convertía el pódcast de un
  artículo en el texto de su pie y se llevaba el vídeo por delante, sin que en
  pantalla se notara nada: la hoja conserva lo que ya estaba pintado, así que
  la pérdida solo aparecía en el Markdown, o al guardar.
*/
test('el audio y el vídeo escritos a mano sobreviven a escribir en la hoja', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const audio = '<figure class="wp-block-audio"><audio controls src="https://example.org/podcast.mp3">'
    + '</audio><figcaption>Pódcast</figcaption></figure>';
  const video = '<figure><iframe width="560" height="315" '
    + 'src="https://www.youtube.com/embed/MQftUe8Y2ds" title="Vídeo"></iframe></figure>';
  await page.locator('#markdown-input').fill(`# Prueba\n\n${audio}\n\nEntre los dos.\n\n${video}\n\nFinal.\n`);
  await page.waitForTimeout(400);

  // Escribir en el editor visual rehace el Markdown a partir de la hoja.
  await page.locator('#html-output p:last-of-type').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' X');
  await page.waitForFunction(() => document.querySelector('#markdown-input').value.includes('Final. X'));

  const markdown = await page.locator('#markdown-input').inputValue();
  assert.match(markdown, /<audio[^>]*example\.org\/podcast\.mp3/, 'el reproductor de audio se ha perdido');
  assert.match(markdown, /<figcaption>Pódcast<\/figcaption>/, 'el pie del audio se ha perdido');
  assert.match(markdown, /<iframe[^>]*youtube\.com\/embed\/MQftUe8Y2ds/, 'el vídeo se ha perdido');
});

/*
  El vídeo incrustado en la aplicación de escritorio. La ventana no se sirve
  por http, así que el reproductor de YouTube se planta con su error 153: en
  su lugar va una tarjeta con la miniatura que abre el vídeo en el navegador.
  Lo que no puede pasar es que esa tarjeta llegue al documento: el iframe
  vuelve a su sitio antes de convertir la hoja.
*/
test('en el escritorio el vídeo de YouTube se ve como tarjeta, y el documento conserva el iframe', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.evaluate(() => {
    window.EdiMarkPlatform = { ...(window.EdiMarkPlatform || {}), isDesktop: true };
  });
  const marco = '<figure><iframe width="560" height="315" '
    + 'src="https://www.youtube.com/embed/MQftUe8Y2ds" title="Vídeo" '
    + 'frameborder="0" allowfullscreen></iframe></figure>';
  await page.locator('#markdown-input').fill(`# Prueba\n\n${marco}\n`);
  await page.locator('#html-output .embed-card').waitFor();

  assert.equal(await page.locator('#html-output iframe').count(), 0, 'el marco no debe quedar en pantalla');
  const tarjeta = page.locator('#html-output .embed-card');
  assert.equal(await tarjeta.getAttribute('href'), 'https://www.youtube.com/watch?v=MQftUe8Y2ds');
  // El gestor de enlaces externos abre en el navegador lo que lleve target.
  assert.equal(await tarjeta.getAttribute('target'), '_blank');
  assert.match(await page.locator('#html-output .embed-card img').getAttribute('src'), /MQftUe8Y2ds/);

  // Lo que sale de la hoja es el marco original, no la tarjeta.
  const html = await page.evaluate(() => buildHtmlWithTex());
  assert.match(html, /youtube\.com\/embed\/MQftUe8Y2ds/);
  assert.doesNotMatch(html, /embed-card/);
});

/*
  El índice y la numeración eran de la aplicación entera: activarlos para un
  manual se los ponía también a la nota de dos líneas del día siguiente. Ahora
  cada documento puede decir lo suyo, y decirlo también para quitárselos.
*/
test('el índice y la numeración de este documento viajan en sus metadatos', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#markdown-input').fill('# Manual\n\n## Parte\n\n### Detalle\n\nUn párrafo cualquiera.');

  await page.locator('#doc-format-toolbar-btn').click();
  await page.locator('#doc-format-modal-overlay').waitFor({ state: 'visible' });
  await page.locator('#doc-own-toc').selectOption('yes');
  await page.locator('#doc-own-toc-depth').selectOption('2');
  await page.locator('#doc-own-numbersections').selectOption('no');
  await page.locator('#doc-format-save-btn').click();
  await page.locator('#doc-format-modal-overlay').waitFor({ state: 'hidden' });

  const markdown = await page.locator('#markdown-input').inputValue();
  assert.match(markdown, /toc: true/);
  assert.match(markdown, /toc-depth: 2/);
  assert.match(markdown, /numbersections: false/);
  assert.match(markdown, /# Manual/);
  await page.waitForFunction(() => document.querySelectorAll('#html-output .doc-toc-entry').length === 2);

  // Al reabrirlo, el cuadro muestra lo que el documento declara.
  await page.locator('#doc-format-toolbar-btn').click();
  await page.locator('#doc-format-modal-overlay').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#doc-own-toc').inputValue(), 'yes');
  assert.equal(await page.locator('#doc-own-toc-depth').inputValue(), '2');
  assert.equal(await page.locator('#doc-own-numbersections').inputValue(), 'no');

  // Y volver a «Heredado» deja el documento sin decir nada.
  await page.locator('#doc-own-toc').selectOption('');
  await page.locator('#doc-own-toc-depth').selectOption('');
  await page.locator('#doc-own-numbersections').selectOption('');
  await page.locator('#doc-format-save-btn').click();
  await page.locator('#doc-format-modal-overlay').waitFor({ state: 'hidden' });
  const limpio = await page.locator('#markdown-input').inputValue();
  assert.equal(/toc:|toc-depth:|numbersections:/.test(limpio), false);
  assert.match(limpio, /# Manual/);
});

/*
  Al imprimir solo debe salir el documento. La hoja de impresión esconde el
  panel Markdown, pero una regla posterior devolvía el alto natural a todo
  `.panel` con más peso, y la cabecera del panel —el contador de caracteres y
  el botón Copiar— reaparecía en la primera página.
*/
test('al imprimir no sale nada de la interfaz, solo el documento', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#markdown-input').fill('# Para imprimir\n\nUn párrafo.');
  await page.emulateMedia({ media: 'print' });

  for (const selector of ['#markdown-panel', '#markdown-char-counter', '#copy-html-btn', '#toolbar', '#tab-bar', '#desktop-release-banner']) {
    assert.equal(await page.locator(selector).isVisible(), false, `${selector} no debe imprimirse`);
  }
  await page.locator('#html-output').waitFor({ state: 'visible' });
  assert.match(await page.locator('#html-output').innerText(), /Para imprimir/);

  await page.emulateMedia({ media: 'screen' });
});

test('el contador compacto muestra caracteres y palabras con detalle accesible', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const counter = page.locator('#markdown-char-counter');
  await page.locator('#markdown-input').fill('# Hola, mundo\n\nDos palabras.');
  await page.waitForFunction(() => document.getElementById('markdown-char-counter').textContent === '28 c · 4 p');
  assert.equal(await counter.getAttribute('title'), '28 caracteres · 4 palabras');
  assert.equal(await counter.getAttribute('aria-label'), '28 caracteres · 4 palabras');

  await page.locator('#markdown-input').fill('A');
  await page.waitForFunction(() => document.getElementById('markdown-char-counter').textContent === '1 c · 1 p');
  assert.equal(await counter.getAttribute('title'), '1 carácter · 1 palabra');
});

/*
  La marca del corrector se quedaba puesta aunque el corrector se apagara: el
  SVG que escribe Lucide conserva su `data-lucide`, la siguiente pasada de
  `createIcons()` lo sustituye y la referencia guardada apuntaba a un nodo que
  ya no estaba en la página.
*/
test('la marca del corrector ortográfico sigue al estado real', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const boton = page.locator('#spellcheck-toggle-btn');
  const marca = page.locator('#spellcheck-toggle-btn .submenu-check');
  const marcaVisible = () => marca.evaluate(check => getComputedStyle(check).display !== 'none');

  assert.equal(await boton.getAttribute('aria-checked'), 'true');
  assert.equal(await marcaVisible(), true, 'de fábrica está encendido y marcado');

  await boton.evaluate(btn => btn.click());
  assert.equal(await boton.getAttribute('aria-checked'), 'false');
  assert.equal(await marcaVisible(), false, 'al apagarlo la marca se quita');
  assert.equal(await page.locator('#markdown-input').getAttribute('spellcheck'), 'false');

  await boton.evaluate(btn => btn.click());
  assert.equal(await marcaVisible(), true, 'y vuelve al encenderlo');
  assert.equal(await page.locator('#markdown-input').getAttribute('spellcheck'), 'true');
});

/*
  La lista de imágenes incrustadas crecía con cada imagen pegada hasta empujar
  al editor fuera de la pantalla, y las líneas no decían qué imagen era cada
  una: un nombre del portapapeles y su tamaño.
*/
test('la lista de imágenes se pliega y muestra miniaturas', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  await page.locator('#new-tab-btn').click();
  await page.evaluate((png) => markdownEditor.setValue(
    `![uno](data:image/png;base64,${png})\n\n![dos](data:image/png;base64,${png})`,
  ), PNG);

  const lista = page.locator('#base64-hidden-list');
  await page.locator('#base64-hidden-count').getByText('2 imágenes', { exact: true }).waitFor();
  assert.equal(await lista.isVisible(), false, 'de partida la lista viene plegada');
  const altoPlegado = await page.locator('#base64-hidden-container').evaluate(el => el.getBoundingClientRect().height);
  assert.ok(altoPlegado < 45, `la cabecera plegada ocupa demasiado alto (${altoPlegado}px)`);

  await page.locator('#base64-hidden-toggle').click();
  await lista.waitFor({ state: 'visible' });
  assert.equal(await page.locator('#base64-hidden-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(await lista.locator('.base64-hidden-thumb img').count(), 2, 'cada línea lleva su miniatura');
  // Y por muchas que haya, la lista se queda con su alto y su barra propia.
  assert.equal(await lista.evaluate(el => getComputedStyle(el).overflowY), 'auto');
  assert.ok(await lista.evaluate(el => el.getBoundingClientRect().height) <= 13 * 16 + 1);

  await lista.locator('.base64-hidden-thumb').first().click();
  await page.locator('#base64-preview-overlay').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#base64-preview-title').textContent(), 'uno');
  assert.match(await page.locator('#base64-preview-image').getAttribute('src'), /^data:image\/png;base64,/);
  await page.keyboard.press('Escape');
  await page.locator('#base64-preview-overlay').waitFor({ state: 'hidden' });

  // Plegar deja el panel como estaba: una sola línea.
  await page.locator('#base64-hidden-toggle').click();
  await lista.waitFor({ state: 'hidden' });
  assert.equal(
    await page.locator('#base64-hidden-container').evaluate(el => el.getBoundingClientRect().height),
    altoPlegado,
  );
});

/*
  Quitar una imagen incrustada tiene que llevarse su código entero: en el
  editor solo se ve un marcador, y borrarlo a mano deja un `![alt]()` vacío.
*/
test('una imagen incrustada se puede quitar del documento desde la lista', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#new-tab-btn').click();
  await page.evaluate((png) => markdownEditor.setValue(
    `# Título\n\n![sola](data:image/png;base64,${png})\n\nTexto con ![dentro](data:image/png;base64,${png}) en medio.`,
  ), PNG);
  await page.locator('#base64-hidden-toggle').click();
  await page.locator('.base64-hidden-item').first().waitFor();

  // La que ocupaba su propia línea se lleva la línea, sin dejar hueco.
  await page.locator('.base64-hidden-item').first().locator('.base64-hidden-btn-danger').click();
  await page.waitForFunction(() => !markdownEditor.getValue().includes('![sola]'));
  assert.equal(await page.evaluate(() => markdownEditor.getValue()).then(md => md.includes('\n\n\n')), false);
  assert.equal(await page.locator('.base64-hidden-item').count(), 1);

  // La de dentro de un párrafo deja el texto que la rodeaba con un solo espacio.
  await page.locator('.base64-hidden-item').first().locator('.base64-hidden-btn-danger').click();
  await page.waitForFunction(() => !markdownEditor.getValue().includes('data:image'));
  const markdown = await page.evaluate(() => markdownEditor.getValue());
  assert.match(markdown, /Texto con en medio\./);
  assert.match(markdown, /# Título/);
  assert.equal(await page.locator('#base64-hidden-container').isVisible(), false);
});

test('las imágenes enlazadas desde disco se pueden ver, incrustar y quitar', async (t) => {
  const { context, page } = await openApp({
    initStorage: () => {
      const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
      const bytes = Array.from(atob(png), character => character.charCodeAt(0));
      window.__EDIMARK_TAURI__ = {
        dialog: { open: async () => '/documentos/tema.md' },
        fs: {
          readTextFile: async () => [
            '`![ejemplo](imagenes/no-es-una-imagen.png)`',
            '',
            '![una](imagenes/una.png)',
            '',
            '![dos](imagenes/dos.png)',
          ].join('\n'),
        },
        app: { readDocumentAsset: async () => bytes },
      };
    },
  });
  t.after(() => context.close());
  page.on('dialog', dialog => dialog.accept());

  await page.keyboard.press('Control+o');
  await page.locator('.tab-name').getByText('tema.md', { exact: true }).waitFor();
  await page.locator('#base64-hidden-count').getByText('2 imágenes', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => currentBase64State.placeholders.size), 0);
  assert.equal(await page.locator('#base64-extract-btn').getAttribute('hidden'), '');
  assert.equal(await page.locator('#base64-extract-btn').isVisible(), false, 'sin Base64 no aparece la acción de extraer');

  await page.locator('#base64-hidden-toggle').click();
  const items = page.locator('.base64-hidden-item');
  await items.first().locator('.base64-hidden-thumb img').waitFor();
  await page.waitForFunction(() => document.querySelector('.base64-hidden-thumb img')?.src.startsWith('blob:'));
  assert.equal(await items.count(), 2, 'el ejemplo escrito como código no entra en la lista');

  // En dos paneles estrechos, las acciones pasan debajo: antes reducían el
  // nombre y la ruta a una columna de cero píxeles y el texto se desmontaba.
  await page.setViewportSize({ width: 800, height: 800 });
  const cardLayout = await items.first().evaluate(item => {
    const itemRect = item.getBoundingClientRect();
    const detailsRect = item.querySelector('.base64-hidden-details').getBoundingClientRect();
    const actionsRect = item.querySelector('.base64-hidden-actions').getBoundingClientRect();
    return {
      itemRight: itemRect.right,
      detailsWidth: detailsRect.width,
      detailsBottom: detailsRect.bottom,
      actionsTop: actionsRect.top,
      actionsRight: actionsRect.right,
    };
  });
  assert.ok(cardLayout.detailsWidth >= 100, `el texto solo conserva ${cardLayout.detailsWidth}px`);
  assert.ok(cardLayout.actionsTop >= cardLayout.detailsBottom, 'los botones no pasaron debajo del texto');
  assert.ok(cardLayout.actionsRight <= cardLayout.itemRight + 1, 'los botones salen de la ficha');

  await items.first().locator('.base64-hidden-thumb').click();
  await page.locator('#base64-preview-overlay').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#base64-preview-title').textContent(), 'una');
  assert.equal(await page.locator('#base64-preview-meta').textContent(), 'Archivo · imagenes/una.png');
  await page.keyboard.press('Escape');

  await items.filter({ hasText: 'una' }).getByRole('button', { name: 'Incrustar' }).click();
  await page.waitForFunction(() => markdownEditor.getValue().includes('data:image/png;base64,'));
  let markdown = await page.evaluate(() => markdownEditor.getValue());
  assert.equal(markdown.includes('imagenes/una.png'), false);
  assert.equal(markdown.includes('imagenes/dos.png'), true);

  const linkedItem = page.locator('.base64-hidden-item').filter({ hasText: 'dos' });
  await linkedItem.getByRole('button', { name: 'Eliminar' }).click();
  await page.waitForFunction(() => !markdownEditor.getValue().includes('imagenes/dos.png'));
  markdown = await page.evaluate(() => markdownEditor.getValue());
  assert.match(markdown, /data:image\/png;base64,/);
  await page.locator('#base64-hidden-count').getByText('1 imagen', { exact: true }).waitFor();
});

test('las imágenes en línea se pueden ver, incrustar y quitar', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  page.on('dialog', dialog => dialog.accept());
  await context.route(/^https:\/\/images\.example\.test\//, route => route.fulfill({
    status: 200,
    contentType: 'image/png',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: PNG_PIXEL,
  }));

  const firstUrl = 'https://images.example.test/render?id=primera';
  const secondUrl = 'https://images.example.test/segunda.png';
  await page.locator('#new-tab-btn').click();
  await page.evaluate(([first, second]) => markdownEditor.setValue([
    `![remota](${first})`,
    '',
    `![otra](${second})`,
  ].join('\n')), [firstUrl, secondUrl]);

  await page.locator('#base64-hidden-count').getByText('2 imágenes', { exact: true }).waitFor();
  await page.locator('#base64-hidden-toggle').click();
  const items = page.locator('.base64-hidden-item');
  await items.first().locator('.base64-hidden-thumb img').waitFor();
  assert.equal(await items.count(), 2, 'también se admite una URL sin extensión de imagen');
  const remoteItem = items.filter({ hasText: 'remota' });
  assert.equal(await remoteItem.locator('.base64-hidden-details p').textContent(), 'En línea');
  assert.doesNotMatch(await remoteItem.innerText(), /https:\/\//);

  await remoteItem.locator('.base64-hidden-thumb').click();
  await page.locator('#base64-preview-overlay').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#base64-preview-meta').textContent(), 'En línea');
  assert.equal(await page.locator('#base64-preview-image').getAttribute('src'), firstUrl);
  await page.keyboard.press('Escape');

  await items.filter({ hasText: 'remota' }).getByRole('button', { name: 'Incrustar' }).click();
  await page.waitForFunction(() => markdownEditor.getValue().includes('data:image/png;base64,'));
  let markdown = await page.evaluate(() => markdownEditor.getValue());
  assert.equal(markdown.includes(firstUrl), false);
  assert.equal(markdown.includes(secondUrl), true);

  await page.locator('.base64-hidden-item').filter({ hasText: 'otra' })
    .getByRole('button', { name: 'Eliminar' }).click();
  await page.waitForFunction(url => !markdownEditor.getValue().includes(url), secondUrl);
  markdown = await page.evaluate(() => markdownEditor.getValue());
  assert.match(markdown, /data:image\/png;base64,/);
  await page.locator('#base64-hidden-count').getByText('1 imagen', { exact: true }).waitFor();
});

test('cualquier imagen se puede reemplazar desde internet, disco o portapapeles', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  const png = PNG_PIXEL.toString('base64');
  await page.locator('#new-tab-btn').click();
  await page.evaluate(base64 => markdownEditor.setValue([
    `![base](data:image/png;base64,${base64})`,
    '',
    '![local](imagenes/original.png)',
    '',
    '![web](https://images.example.test/original.png)',
  ].join('\n')), png);
  await page.locator('#base64-hidden-count').getByText('3 imágenes', { exact: true }).waitFor();
  await page.locator('#base64-hidden-toggle').click();

  // Una Base64 se sustituye por una dirección web sin cambiar su texto alternativo.
  await page.locator('.base64-hidden-item').filter({ hasText: 'base' })
    .getByRole('button', { name: 'Reemplazar' }).click();
  assert.equal(await page.locator('#image-modal-title').textContent(), 'Reemplazar imagen');
  assert.equal(await page.locator('#image-alt-text').inputValue(), 'base');
  await page.locator('input[name="image-insert-mode"][value="url"]').check();
  await page.locator('#image-url').fill('https://replacement.example.test/render?id=1');
  await page.locator('#insert-image-btn').getByText('Reemplazar', { exact: true }).click();
  await page.waitForFunction(() => markdownEditor.getValue().includes('![base](https://replacement.example.test/render?id=1)'));

  // Una imagen local se cambia por otro archivo y conserva el modo de ruta relativa.
  await page.locator('.base64-hidden-item').filter({ hasText: 'local' })
    .getByRole('button', { name: 'Reemplazar' }).click();
  assert.equal(await page.locator('#image-alt-text').inputValue(), 'local');
  await page.locator('#image-file-input').setInputFiles({
    name: 'nueva local.png',
    mimeType: 'image/png',
    buffer: PNG_PIXEL,
  });
  await page.locator('#insert-image-btn').getByText('Reemplazar', { exact: true }).click();
  await page.waitForFunction(() => markdownEditor.getValue().includes('![local](nueva%20local.png)'));

  // Una imagen en línea se reemplaza por la imagen del portapapeles, que se
  // incrusta porque una imagen pegada no tiene una ruta propia en el disco.
  await page.evaluate(base64 => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        read: async () => [{
          types: ['image/png'],
          getType: async () => new Blob([bytes], { type: 'image/png' }),
        }],
      },
    });
  }, png);
  await page.locator('.base64-hidden-item').filter({ hasText: 'web' })
    .getByRole('button', { name: 'Reemplazar' }).click();
  await page.locator('#image-paste-btn').click();
  await page.locator('#image-file-name').getByText('Imagen pegada', { exact: true }).waitFor();
  assert.equal(await page.locator('input[name="image-insert-mode"][value="embedded"]').isChecked(), true);
  assert.equal(await page.locator('input[name="image-insert-mode"][value="relative"]').isDisabled(), true);
  await page.locator('#insert-image-btn').getByText('Reemplazar', { exact: true }).click();
  await page.waitForFunction(() => {
    const markdown = markdownEditor.getValue();
    return markdown.includes('![web](data:image/png;base64,')
      && !markdown.includes('images.example.test/original.png');
  });

  const markdown = await page.evaluate(() => markdownEditor.getValue());
  assert.equal(markdown.includes('imagenes/original.png'), false);
  assert.equal(markdown.match(/!\[base\]\(/)?.length, 1);
  assert.equal(markdown.match(/!\[local\]\(/)?.length, 1);
  assert.equal(markdown.match(/!\[web\]\(/)?.length, 1);
});


/*
  Cada panel tiene su lupa y escala solo lo suyo: la del Markdown no puede
  mover la hoja, porque lo que la hoja enseña es lo que va a exportarse y sería
  una promesa falsa; y la de la hoja no puede mover al editor.
*/
test('la lupa de cada panel escala su panel y deja quieto al otro', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  await conLaHojaATamanoReal(page);

  await page.locator('#markdown-input').fill('# Hola\n\nUn párrafo de prueba.');
  await page.waitForFunction(() => document.querySelector('#html-output p'));

  const medir = () => page.evaluate(() => ({
    // El editor de Markdown es el textarea; el único CodeMirror es el del código HTML.
    editor: getComputedStyle(document.getElementById('markdown-input')).fontSize,
    hoja: getComputedStyle(document.getElementById('html-output')).fontSize,
    anchoHoja: Math.round(document.getElementById('html-output').getBoundingClientRect().width),
  }));

  const inicio = await medir();
  assert.equal(await page.locator('#markdown-zoom-value').innerText(), '100 %');

  await page.locator('#markdown-zoom-in').click();
  const trasAmpliarElEditor = await medir();
  assert.notEqual(trasAmpliarElEditor.editor, inicio.editor, 'el editor no siguió a su lupa');
  assert.equal(trasAmpliarElEditor.hoja, inicio.hoja, 'la hoja siguió a la lupa del editor');
  assert.equal(await page.locator('#markdown-zoom-value').innerText(), '110 %');

  /*
    Las dos lupas comparten sitio en la barra de estado: se enseña la del panel
    en el que se trabaja, así que hay que ir a la hoja para llegar a la suya.
  */
  await page.locator('#html-output').click();
  await page.locator('#preview-zoom-in').click();
  const trasAmpliarLaHoja = await medir();
  assert.notEqual(trasAmpliarLaHoja.hoja, inicio.hoja, 'la hoja no siguió a su lupa');
  assert.equal(trasAmpliarLaHoja.editor, trasAmpliarElEditor.editor, 'el editor siguió a la lupa de la hoja');

  // Y el porcentaje devuelve cada uno a su sitio.
  await page.locator('#preview-zoom-reset').click();
  await page.locator('#markdown-input').click();
  await page.locator('#markdown-zoom-reset').click();
  assert.deepEqual(await medir(), inicio);
});

/*
  Con los dos paneles a la vista, el activo se ve marcado aunque el foco se haya
  ido a un botón: es el panel sobre el que trabajan las herramientas, y sin
  marca no había manera de saber cuál era.
*/
test('el panel activo queda marcado aunque el foco salga de él', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const activo = () => page.locator('#editor-container').getAttribute('data-panel-activo');
  const filoDeLaHoja = () => page.locator('#preview-desk').evaluate(desk => getComputedStyle(desk).borderColor);

  await page.locator('#markdown-input').click();
  assert.equal(await activo(), 'markdown');

  await page.locator('#html-output').click();
  assert.equal(await activo(), 'preview');
  const marcado = await filoDeLaHoja();

  // El foco se va a un botón de fuera y el panel activo se queda donde estaba.
  await page.locator('#help-menu-btn').focus();
  assert.equal(await activo(), 'preview');
  assert.equal(await filoDeLaHoja(), marcado, 'la hoja perdió la marca al salir el foco');

  await page.locator('#markdown-input').click();
  assert.equal(await activo(), 'markdown');
  assert.notEqual(await filoDeLaHoja(), marcado, 'la hoja se quedó marcada sin ser el panel activo');
});

/*
  La lupa de la vista previa es de la pantalla: agranda la hoja para leerla, no
  el documento. Al imprimir se colaba —la hoja salía más ancha que la página— y
  el navegador cortaba por la derecha el texto y las imágenes.
*/
test('la lupa de la vista previa no llega al papel', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  // Un ancho parecido al imprimible de un A4 con sus márgenes.
  await page.setViewportSize({ width: 658, height: 900 });
  await page.emulateMedia({ media: 'print' });
  const enPapel = zoom => page.evaluate((valor) => {
    document.documentElement.style.setProperty('--preview-zoom', valor);
    const hoja = document.getElementById('html-output');
    return {
      cabe: Math.round(hoja.getBoundingClientRect().width) <= document.documentElement.clientWidth,
      cuerpo: getComputedStyle(hoja).fontSize,
      desborda: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    };
  }, zoom);

  const normal = await enPapel('1');
  assert.deepEqual(normal, { cabe: true, cuerpo: '16px', desborda: false });
  for (const zoom of ['1.25', '2']) {
    assert.deepEqual(await enPapel(zoom), normal, `la lupa al ${zoom} cambió el papel`);
  }
  await page.emulateMedia({ media: 'screen' });
});

/*
  Y los márgenes del documento sí llegan: la hoja los enseña como relleno, pero
  al imprimir el relleno se quita y hace falta escribirlos en `@page`.
*/
test('los márgenes del documento se escriben para el papel', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const regla = () => page.evaluate(
    () => document.getElementById('doc-print-page-style')?.textContent ?? '',
  );
  /*
    El papel va siempre, tenga el documento márgenes propios o no: sin él, un
    documento en Carta se imprimía en el papel que tuviera puesto la impresora
    y el reparto en páginas de la pantalla dejaba de valer. De los márgenes,
    mientras no se fijen, se ocupa el de partida del CSS de impresión.
  */
  assert.equal(await regla(), '@media print { @page { size: A4 portrait; } }');

  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill('---\npapersize: "letter"\nmargin-left: "3"\nmargin-right: "2.5"\n---\n\nTexto\n');
  await page.waitForFunction(
    () => (document.getElementById('doc-print-page-style')?.textContent || '').includes('margin-left'),
  );
  const escrita = await regla();
  assert.match(escrita, /@media print \{ @page \{/);
  assert.match(escrita, /size: Letter portrait;/);
  assert.match(escrita, /margin-left: 3cm;/);
  assert.match(escrita, /margin-right: 2\.5cm;/);
});

/*
  Lo que no fija nadie también se cuenta: sin decirlo, un campo sin pista no se
  distingue de uno cuya pista se ha perdido, y el rótulo del resumen dejaba
  fuera justo los ajustes por los que se pregunta.
*/
test('lo que no hereda nada lo dice, en el cuadro y en el resumen', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  // El rótulo del resumen nombra los siete ajustes, con guion los no fijados.
  const rotulo = await page.locator('#doc-format-status').getAttribute('title');
  const etiquetas = ['Alineación', 'Tipo de letra', 'Tamaño', 'Interlineado',
    'Márgenes', 'Sangría de primera línea', 'Partir palabras'];
  etiquetas.forEach(etiqueta => assert.ok(
    rotulo.includes(etiqueta), `el rótulo no nombra «${etiqueta}»: ${rotulo}`,
  ));
  assert.ok(rotulo.includes('Sangría de primera línea: —'));
  assert.ok(rotulo.includes('Márgenes de página (cm): — / — / — / —'));
  // Y explica el guion, que si no se lee como un fallo.
  assert.match(rotulo, /—\s*:\s*sin fijar/);

  // En el cuadro, cada campo sin valor general lo dice bajo su casilla.
  await page.locator('#doc-format-status').click();
  await page.locator('#doc-format-modal-overlay').waitFor({ state: 'visible' });
  const pista = id => page.evaluate((campo) => {
    const hint = document.getElementById(campo)?.nextElementSibling;
    return hint && hint.dataset.inheritedHint && !hint.classList.contains('hidden')
      ? hint.textContent
      : '';
  }, id);
  assert.match(await pista('doc-format-fields-indent'), /Sin fijar/);
  assert.match(await pista('doc-format-fields-align'), /Sin fijar/);
  // Y el que sí hereda sigue diciendo de qué.
  assert.match(await pista('doc-format-fields-font'), /Hereda: Con remates/);
  const margen = await page.locator('#doc-format-fields-margin-top').getAttribute('title');
  assert.match(margen, /Sin fijar/);
});

/*
  De lo de este documento a lo de todos: el cuadro dice que lo heredado sale de
  las opciones generales, y lleva a ellas por la misma pestaña, que es lo
  que se busca cuando uno se pregunta de dónde viene un valor.
*/
test('el cuadro del documento lleva a las opciones generales por su misma pestaña', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  // Desde la pestaña del formato, a la del formato.
  await page.locator('#doc-format-status').click();
  await page.locator('#doc-format-modal-overlay').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#doc-format-modal-title').textContent(), 'Opciones de este documento');
  assert.deepEqual(
    await page.locator('#doc-format-tablist [role="tab"]').allTextContents(),
    ['Datos e índice', 'Texto y página'],
  );
  await page.locator('#doc-format-open-general').click();
  await page.locator('#doc-format-modal-overlay').waitFor({ state: 'hidden' });
  assert.equal(
    await page.locator('#latex-settings-modal-title').textContent(),
    'Opciones generales de los documentos',
  );
  assert.deepEqual(
    await page.locator('#doc-settings-tablist [role="tab"]').allTextContents(),
    ['Datos e índice', 'Citas', 'Texto y página', 'EPUB', 'LaTeX'],
  );
  assert.equal(await page.locator('#doc-settings-tab-format').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#doc-settings-panel-format').isVisible(), true);
  await page.locator('#latex-settings-cancel-btn').click();

  // Y desde la del documento, a la del documento.
  await page.locator('#doc-language-status').click();
  await page.locator('#doc-format-modal-overlay').waitFor({ state: 'visible' });
  await page.locator('#doc-format-open-general').click();
  await page.locator('#doc-format-modal-overlay').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#doc-settings-tab-document').getAttribute('aria-selected'), 'true');
});

/*
  El documento se reparte en páginas: la hoja mide lo que mide el papel y el
  texto salta a la siguiente cuando se acaba la caja. El corte cae entre dos
  bloques y nunca a media línea, y las hojas se dibujan fuera del contenido
  editable: dentro acabarían escritas en el Markdown, que se regenera de él.
*/
test('el editor visual reparte el documento en páginas del tamaño del papel', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  await conLaHojaATamanoReal(page);

  /*
    El reparto se rehace cada vez que la hoja o la mesa cambian de tamaño, así
    que hay que dejar que la disposición se asiente antes de medir: a mitad del
    cambio de paneles las cuentas son las del ancho de hace un instante.
  */
  const soloVisual = async () => {
    await page.locator('#layout-switch [data-layout="html"]').click();
    await page.locator('#markdown-panel').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelectorAll('.page-sheet').length > 1);
    /*
      Y a que el reparto deje de moverse: las fórmulas, las imágenes y los
      diagramas cambian de alto al terminar de pintarse, y cada cambio lo rehace
      un fotograma después. El manual lleva un diagrama, que se dibuja cuando
      llega Mermaid.
    */
    await page.evaluate(() => window.EdiMarkMermaid?.ready());
    await page.waitForFunction(() => new Promise((resolve) => {
      const foto = () => [...document.querySelectorAll('#html-output > [data-page-start]')]
        .map(bloque => bloque.style.getPropertyValue('--page-jump')).join('|');
      const antes = foto();
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(antes === foto())));
    }));
  };

  await page.setViewportSize({ width: 1400, height: 900 });
  await soloVisual();

  const escribir = async (md) => {
    await page.locator('#layout-switch [data-layout="dual"]').click();
    await page.locator('#markdown-input').waitFor({ state: 'visible' });
    await page.locator('#markdown-input').fill(md);
    await soloVisual();
  };

  const medidas = () => page.evaluate(() => {
    const hoja = document.getElementById('html-output');
    const hojas = [...document.querySelectorAll('.page-sheet')];
    const inicios = [...document.querySelectorAll('#html-output > [data-page-start]')];
    const margen = Number.parseFloat(getComputedStyle(hoja).paddingTop);
    const paso = Number.parseFloat(hojas[0].style.height) + 24;
    const origen = hoja.getBoundingClientRect().top - hoja.offsetTop;
    // Cuánto se aparta cada inicio de página del sitio donde empieza la caja
    // de texto de su hoja.
    const desviaciones = inicios.map((bloque) => {
      const arriba = bloque.getBoundingClientRect().top - origen;
      const pagina = Math.round((arriba - hoja.offsetTop - margen) / paso);
      return {
        bloque: `${bloque.tagName} ${(bloque.textContent || '').slice(0, 30)}`,
        desvio: Math.abs(arriba - (hoja.offsetTop + pagina * paso + margen)),
      };
    });
    const peor = desviaciones.sort((a, b) => b.desvio - a.desvio)[0];
    return {
      ancho: Math.round(hoja.getBoundingClientRect().width),
      altoHoja: Math.round(Number.parseFloat(hojas[0].style.height)),
      paginas: hojas.length,
      saltos: inicios.length,
      desviacion: peor ? peor.desvio : 0,
      peorBloque: peor ? peor.bloque : '',
      etiqueta: hojas[0].textContent,
      dentroDelTexto: hojas.some(hoja2 => document.getElementById('html-output').contains(hoja2)),
    };
  });

  const PX_CM = 96 / 2.54;
  const a4 = await medidas();
  assert.equal(a4.ancho, Math.round(21 * PX_CM), 'la hoja no mide un A4 de ancho');
  assert.equal(a4.altoHoja, Math.round(29.7 * PX_CM), 'la hoja no mide un A4 de alto');
  assert.match(a4.etiqueta, /Página 1/);
  assert.equal(a4.dentroDelTexto, false, 'una hoja acabó dentro del contenido editable');
  assert.ok(a4.saltos >= 1, 'no se repartió en páginas');
  assert.ok(a4.desviacion < 1, `A4: «${a4.peorBloque}» se desvía ${a4.desviacion}px de su página`);

  // Carta cambia las dos medidas.
  await escribir('---\npapersize: "letter"\n---\n\n' + 'Texto de relleno. '.repeat(2000));
  const carta = await medidas();
  assert.equal(carta.ancho, Math.round(21.59 * PX_CM));
  assert.equal(carta.altoHoja, Math.round(27.94 * PX_CM));
  assert.ok(carta.desviacion < 1, `Carta: los saltos se desvían ${carta.desviacion}px`);

  // Y unos márgenes grandes dejan menos caja, así que hacen falta más páginas.
  await escribir('---\npapersize: "a4"\nmargin-top: "5"\nmargin-bottom: "5"\n---\n\n' + 'Texto de relleno. '.repeat(2000));
  const conMargenes = await medidas();
  assert.ok(
    conMargenes.paginas > carta.paginas,
    `con márgenes de 5 cm deberían salir más páginas: ${conMargenes.paginas} frente a ${carta.paginas}`,
  );
  assert.ok(conMargenes.desviacion < 1, `con márgenes: los saltos se desvían ${conMargenes.desviacion}px`);
});

/*
  El índice, cuando el documento lo pide. Hasta ahora marcar «Índice automático»
  no cambiaba nada hasta exportar, así que era un ajuste fácil de olvidar en las
  dos direcciones. Ahora se ve el que va a salir, con sus números de página, y
  sigue sin ser contenido: no se puede editar y no llega al Markdown.
*/
test('el editor visual enseña el índice del documento con sus páginas', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.locator('#new-tab-btn').click();
  const cuerpo = [
    '# Primero',
    '',
    'Texto del primer apartado. '.repeat(120),
    '',
    '## Sub A',
    '',
    'Más texto. '.repeat(150),
    '',
    '# Segundo',
    '',
    'Y más. '.repeat(200),
    '',
  ].join('\n');

  // Sin pedirlo, no hay índice que valga.
  await page.locator('#markdown-input').fill(cuerpo);
  await page.locator('#layout-switch [data-layout="html"]').click();
  await page.locator('#markdown-panel').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelectorAll('.page-sheet').length > 1);
  assert.equal(await page.locator('#html-output [data-edimark-toc]').count(), 0);

  // Y pedido en los metadatos, aparece con los apartados y sus páginas.
  await page.locator('#layout-switch [data-layout="dual"]').click();
  await page.locator('#markdown-input').fill(`---\ntoc: true\n---\n\n${cuerpo}`);
  await page.locator('#layout-switch [data-layout="html"]').click();
  await page.locator('#markdown-panel').waitFor({ state: 'hidden' });
  await page.waitForFunction(
    () => document.querySelectorAll('#html-output [data-edimark-toc] .doc-toc-page')?.[2]?.textContent,
  );

  const indice = await page.evaluate(() => {
    const nav = document.querySelector('#html-output > [data-edimark-toc]');
    return {
      titulo: nav.querySelector('.doc-toc-title').textContent,
      editable: nav.getAttribute('contenteditable'),
      entradas: [...nav.querySelectorAll('.doc-toc-entry')].map(entrada => [
        entrada.querySelector('.doc-toc-text').textContent,
        entrada.querySelector('.doc-toc-page').textContent,
      ]),
    };
  });
  assert.equal(indice.titulo, 'Índice');
  assert.equal(indice.editable, 'false', 'el índice no debería poder editarse');
  assert.deepEqual(indice.entradas.map(([texto]) => texto), ['Primero', 'Sub A', 'Segundo']);
  /*
    El índice se queda solo en la primera página: el texto de «Primero» no cabe
    ya detrás de él y, como un título no se queda suelto al pie de la página, el
    encabezado baja con su texto a la segunda. El índice cuenta eso mismo.
  */
  assert.equal(indice.entradas[0][1], '2');
  assert.ok(Number(indice.entradas[2][1]) > 2, `«Segundo» debería caer más adelante: ${indice.entradas[2][1]}`);

  // No es contenido: ni en el Markdown ni en lo que se copia de la hoja.
  const markdown = await page.locator('#markdown-input').inputValue();
  assert.equal(markdown.includes('Índice'), false, 'el índice acabó en el Markdown');
  assert.equal(markdown.includes('doc-toc'), false);

  // Y al quitarlo del documento, desaparece.
  await page.locator('#layout-switch [data-layout="dual"]').click();
  await page.locator('#markdown-input').fill(cuerpo);
  await page.waitForFunction(() => document.querySelectorAll('#html-output [data-edimark-toc]').length === 0);
});

/*
  Y el reparto es solo mirada: lo que se guarda tiene que seguir siendo el mismo
  Markdown, sin rastro de las páginas.
*/
test('las páginas no dejan nada escrito en el documento', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.locator('#new-tab-btn').click();
  // Varios párrafos, y bastantes: el reparto necesita más de una página, y el
  // corte tiene que caer entre dos de ellos.
  const original = `# Título\n\n${Array.from({ length: 12 }, (_, i) => `Párrafo ${i + 1}. ${'Con su texto y su fondo. '.repeat(30)}`).join('\n\n')}\n`;
  await page.locator('#markdown-input').fill(original);
  await page.locator('#layout-switch [data-layout="html"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.page-sheet').length > 1);

  // Se escribe sobre la hoja, que es lo que regenera el Markdown.
  await page.locator('#html-output p').first().click();
  await page.keyboard.type('Añadido. ');
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('Añadido.'));

  const markdown = await page.locator('#markdown-input').inputValue();
  assert.equal(markdown.includes('page-jump'), false, 'el salto de página acabó en el Markdown');
  assert.equal(markdown.includes('page-start'), false, 'la marca de página acabó en el Markdown');
  assert.equal(markdown.includes('Página'), false, 'el número de página acabó en el Markdown');
});

/*
  En el papel no hay huecos que dibujar: el salto de pantalla se cambia por uno
  de verdad, de modo que el PDF corta por donde cortaba la hoja.
*/
test('lo que en pantalla salta de página, en el papel también', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.locator('#layout-switch [data-layout="html"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.page-sheet').length > 1);

  await page.emulateMedia({ media: 'print' });
  const enPapel = await page.evaluate(() => {
    const inicio = document.querySelector('#html-output > [data-page-start]');
    const estilos = getComputedStyle(inicio);
    return {
      salto: estilos.breakBefore,
      hueco: estilos.marginTop,
      hojasVisibles: getComputedStyle(document.getElementById('page-sheets')).display,
      bloquesEnteros: getComputedStyle(document.querySelector('#html-output > p')).breakInside,
    };
  });
  await page.emulateMedia({ media: 'screen' });

  assert.equal(enPapel.salto, 'page', 'el bloque que estrena página no la estrena al imprimir');
  assert.equal(enPapel.hueco, '0px', 'el hueco de pantalla se imprimiría');
  assert.equal(enPapel.hojasVisibles, 'none');
  assert.equal(enPapel.bloquesEnteros, 'avoid', 'el papel podría partir un párrafo que la pantalla no parte');
});

/*
  Un título al pie de la página, con lo suyo en la página siguiente, es el hueco
  que dejaba el reparto antes: el bloque que no cabía bajaba solo. Ahora baja el
  encabezado con él.
*/
test('un título no se queda solo al pie de la página', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.locator('#new-tab-btn').click();

  /*
    El relleno se busca a tientas: el corte tiene que caer justo entre el título
    y su lista, y cuántos párrafos hacen falta depende de la tipografía. Se
    prueban unos cuantos y vale el primero que deje la lista estrenando página.
  */
  const lista = '1. uno\n2. dos\n3. tres\n4. cuatro\n5. cinco';
  let hueco = null;
  for (let relleno = 20; relleno <= 70 && !hueco; relleno += 1) {
    const cuerpo = [
      '# Documento',
      ...Array.from({ length: relleno }, (_, i) => `Párrafo de relleno número ${i + 1}.`),
      '## Añadir idiomas',
      lista,
      'Cola final.',
    ].join('\n\n');
    await page.locator('#markdown-input').fill(cuerpo);
    // La vista previa y el reparto van por detrás del tecleo: sin esperar a que
    // el documento entero esté puesto se leería el reparto de la vuelta pasada.
    await page.waitForFunction(
      esperados => document.querySelectorAll('#html-output > p').length === esperados
        && document.querySelectorAll('.page-sheet').length > 1,
      relleno + 1,
    );
    await page.waitForTimeout(150);
    hueco = await page.evaluate(() => {
      const hoja = document.getElementById('html-output');
      const bloques = [...hoja.children];
      const titulo = bloques.find(bloque => bloque.tagName === 'H2');
      const siguiente = bloques[bloques.indexOf(titulo) + 1];
      // Solo interesa la vuelta en la que el corte cae en ese título o detrás.
      if (!titulo.hasAttribute('data-page-start') && !siguiente.hasAttribute('data-page-start')) {
        return null;
      }
      const arriba = titulo.getBoundingClientRect();
      return {
        separacion: siguiente.getBoundingClientRect().top - (arriba.top + arriba.height),
        tituloEstrena: titulo.hasAttribute('data-page-start'),
        listaEstrena: siguiente.hasAttribute('data-page-start'),
      };
    });
  }

  assert.ok(hueco, 'no se dio con un reparto que cortara junto al título');
  assert.equal(hueco.listaEstrena, false, 'la lista bajó de página y dejó el título solo arriba');
  assert.ok(hueco.separacion < 60, `el título quedó con un hueco detrás: ${hueco.separacion}px`);
});

/*
  Las hojas se dibujan debajo del texto y el hueco entre ellas es lo que enseña
  el salto de página: si la hoja del texto vuelve a pintar su fondo por encima
  —como hacía el modo oscuro—, el salto desaparece y solo se ve un vacío.
*/
test('el salto de página también se ve en el modo oscuro', async (t) => {
  const { context, page } = await openApp({ colorScheme: 'dark' });
  t.after(() => context.close());

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.locator('#layout-switch [data-layout="html"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.page-sheet').length > 1);

  const fondo = await page.evaluate(() => ({
    oscuro: document.documentElement.classList.contains('dark'),
    hoja: getComputedStyle(document.getElementById('html-output')).backgroundColor,
    sombra: getComputedStyle(document.getElementById('html-output')).boxShadow,
  }));

  assert.equal(fondo.oscuro, true, 'la prueba no llegó a estar en modo oscuro');
  assert.equal(fondo.hoja, 'rgba(0, 0, 0, 0)', 'el fondo de la hoja tapa los huecos entre páginas');
  assert.equal(fondo.sombra, 'none', 'la sombra de la hoja se dibuja sobre las páginas');
});

/*
  Con la hoja estrechada el texto ya no rompe donde rompería en el papel, así
  que el reparto mentiría y se retira hasta que vuelva a caber. Estrechar la
  ventana ya no basta para llegar a ese caso: la lupa ajustada al ancho encoge
  la hoja entera y el reparto sigue siendo fiel; hace falta fijar un aumento
  con el que no quepa.
*/
test('el reparto en páginas se retira cuando la hoja no cabe entera', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.locator('#layout-switch [data-layout="html"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.page-sheet').length > 1);

  /*
    En una pantalla de móvil los paneles se apilan y la atadura no rige, así que
    la hoja se estrecha para caber en la ventana: el texto ya no rompe donde
    rompería en el papel y el reparto se retira.
  */
  await page.setViewportSize({ width: 700, height: 900 });
  await page.waitForFunction(() => document.querySelectorAll('.page-sheet').length === 0);
  assert.equal(
    await page.locator('#html-output [data-page-start], #html-output [data-page-split]').count(),
    0,
    'quedaron saltos aplicados sin páginas que los sostengan',
  );

  // Y con la lupa más baja la hoja vuelve a caber entera, en proporción.
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--preview-zoom', '0.67');
    window.__refreshPageBreaks();
  });
  await page.waitForFunction(() => document.querySelectorAll('.page-sheet').length > 1);
});

/*
  El reparto trabaja sobre los hijos de la hoja, y una lista, una cita o la
  sección de notas son un solo hijo por largas que sean. Cuando uno de ellos
  medía más que la página caía en el caso del bloque que no cabe en ninguna
  parte: se contaban las páginas y el hueco entre hojas atravesaba el texto a
  media línea. Pasaba con las notas de cualquier PDF oficial importado, y con
  cualquier lista larga escrita a mano. Ahora el contenedor se reparte por sus
  hijos, y ningún punto, párrafo de cita ni nota queda partido por un corte.
*/
test('una lista, una cita o las notas más largas que la página se reparten por dentro', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.locator('#new-tab-btn').click();
  const documento = [
    Array.from({ length: 60 }, (_, i) => `- Punto ${i + 1} de una lista larga, con texto de sobra para ocupar su línea entera.`).join('\n'),
    Array.from({ length: 40 }, (_, i) => `> Párrafo ${i + 1} de una cita larga que ocupa más de una página.`).join('\n>\n'),
    Array.from({ length: 20 }, (_, i) => `Párrafo ${i + 1} con su llamada[^${i + 1}].`).join('\n\n'),
    Array.from({ length: 20 }, (_, i) => `[^${i + 1}]: Nota ${i + 1}, bastante larga para que la sección de notas mida más que una página de la hoja.`).join('\n\n'),
  ].join('\n\n');
  await page.locator('#markdown-input').fill(documento);
  await page.locator('#layout-switch [data-layout="html"]').click();
  await page.waitForFunction(() => document.querySelectorAll('.page-sheet').length > 3);
  await page.locator('#html-output .footnotes li').last().waitFor();
  // El reparto se rehace al asentarse la hoja: se mide cuando ya no cambia.
  await page.waitForFunction(() => {
    const huella = [...document.querySelectorAll('#html-output [data-page-start]')]
      .map(bloque => bloque.style.getPropertyValue('--page-jump')).join('|');
    const anterior = window.__huellaDelReparto;
    window.__huellaDelReparto = huella;
    return anterior === huella;
  }, null, { polling: 400 });

  const medida = await page.evaluate(() => {
    const cortes = [...document.querySelectorAll('.page-sheet')].slice(0, -1)
      .map(hoja => hoja.getBoundingClientRect().bottom);
    const partidos = [...document.querySelectorAll('#html-output li, #html-output blockquote p')]
      .filter((bloque) => {
        const caja = bloque.getBoundingClientRect();
        return cortes.some(corte => caja.top < corte - 2 && caja.bottom > corte + 2);
      })
      .map(bloque => bloque.textContent.trim().slice(0, 40));
    return {
      partidos,
      saltosDentro: document.querySelectorAll('#html-output [data-page-split] [data-page-start]').length,
    };
  });
  assert.deepEqual(medida.partidos, [], 'hay puntos, párrafos o notas partidos por un corte de página');
  assert.ok(medida.saltosDentro >= 2, `el reparto no bajó dentro de los contenedores (${medida.saltosDentro})`);
});

/*
  Un bloque a varias columnas no se reparte como una lista: empujar uno de sus
  puntos lo descoloca dentro de su columna, y al imprimir cada empujón era una
  página nueva con media hoja en blanco. Pasaba con una lista de comprobación a
  cuatro columnas más larga que la página. Ahora se reparte como en el papel:
  las columnas de cada página se llenan y el juego se cierra al final de la
  hoja, de modo que ningún punto queda atravesado por el hueco entre hojas.
*/
test('un bloque en columnas más largo que la página se reparte por páginas', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.locator('#new-tab-btn').click();
  const listas = ['Una', 'Dos', 'Tres'].map(nombre => [
    `## ${nombre}`,
    Array.from({ length: 150 }, (_, i) => `- [ ] ${i + 1}`).join('\n'),
  ].join('\n\n'));
  const documento = ['# Lista', '<div style="column-count:4">', ...listas, '</div>'].join('\n\n');
  await page.locator('#markdown-input').fill(documento);
  await page.locator('#layout-switch [data-layout="html"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#html-output [data-column-end]').length > 1);

  const reparto = await page.evaluate(() => {
    const columnas = document.querySelector('#html-output > div');
    const cortes = [...document.querySelectorAll('.page-sheet')].slice(0, -1)
      .map(hoja => hoja.getBoundingClientRect().bottom);
    const partidos = [...columnas.querySelectorAll('li, h2')]
      .filter((pieza) => {
        const caja = pieza.getBoundingClientRect();
        return cortes.some(corte => caja.top < corte - 2 && caja.bottom > corte + 2);
      })
      .map(pieza => pieza.textContent.trim());
    return {
      marcado: columnas.hasAttribute('data-page-flow'),
      abierto: columnas.hasAttribute('data-page-split'),
      bajado: columnas.hasAttribute('data-page-start'),
      saltosDentro: columnas.querySelectorAll('[data-page-start], [data-page-split]').length,
      partidos,
    };
  });
  assert.deepEqual(reparto, { marcado: true, abierto: false, bajado: false, saltosDentro: 0, partidos: [] });
});

/*
  Y la hoja sigue siendo editable: escribir en un punto de la lista devuelve el
  mismo Markdown, con su `div` de columnas. Turndown tira los `div`, y una sola
  letra escrita en la hoja dejaba la lista en una columna. Las marcas del
  reparto tampoco pasan al documento.
*/
test('escribir en la hoja conserva el bloque en columnas', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.locator('#new-tab-btn').click();
  const lista = Array.from({ length: 200 }, (_, i) => `- [ ] ${i + 1}`).join('\n');
  const documento = `# Lista\n\n<div style="column-count:4; column-gap:10px;">\n\n## Una\n\n${lista}\n\n</div>\n`;
  await page.locator('#markdown-input').fill(documento);
  await page.locator('#layout-switch [data-layout="html"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#html-output [data-column-end]').length > 0);

  await page.locator('#html-output [data-column-end]').first().click();
  await page.keyboard.press('End');
  await page.keyboard.type(' hecho');
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes(' hecho'));

  const markdown = await page.locator('#markdown-input').inputValue();
  const punto = await page.locator('#html-output li', { hasText: 'hecho' }).textContent();
  assert.equal(markdown.trim(), documento.replace(`- [ ] ${punto.replace(' hecho', '').trim()}\n`, `- [ ] ${punto.trim()}\n`).trim());
});

/*
  El hueco entre dos hojas, dentro de un bloque en columnas, lo ocupa un
  pseudoelemento. Pulsar ahí dejaba en Firefox el cursor al principio del
  documento, y lo que se escribiera iba al título.
*/
test('pulsar en el hueco entre hojas deja el cursor en el bloque en columnas', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.locator('#new-tab-btn').click();
  const lista = Array.from({ length: 300 }, (_, i) => `- [ ] ${i + 1}`).join('\n');
  await page.locator('#markdown-input').fill(`# Lista\n\n<div style="column-count:4">\n\n${lista}\n\n</div>\n`);
  await page.locator('#layout-switch [data-layout="html"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#html-output [data-column-end]').length > 0);

  const punto = await page.evaluate(() => {
    const primera = document.querySelector('.page-sheet');
    document.getElementById('preview-desk').scrollBy(0, primera.getBoundingClientRect().bottom - 400);
    const hoja = primera.getBoundingClientRect();
    const bloque = document.querySelector('#html-output > div').getBoundingClientRect();
    return { x: bloque.left + bloque.width * 0.4, y: hoja.bottom + 10 };
  });
  await page.mouse.click(punto.x, punto.y);
  const donde = await page.evaluate(() => {
    const nodo = getSelection().anchorNode;
    return nodo ? (nodo.nodeType === 3 ? nodo.parentElement : nodo).closest('li, h1')?.tagName : null;
  });
  assert.equal(donde, 'LI');
});

/*
  Una tabla más larga que la página se parte por filas, como en el papel. Antes
  pasaba entera y el hueco entre hojas atravesaba las filas del corte. La
  cabecera se repite arriba de cada página en la capa de las hojas, fuera del
  texto: la hoja no gana nada que editar y el Markdown no cambia.
*/
test('una tabla más larga que la página se parte por filas', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.locator('#new-tab-btn').click();
  const filas = Array.from({ length: 90 }, (_, i) => `| Fila ${i + 1} | Valor ${i + 1} |`).join('\n');
  const documento = `# Tabla\n\n| Acción | Atajo |\n| :-- | :-- |\n${filas}\n`;
  await page.locator('#markdown-input').fill(documento);
  await page.locator('#layout-switch [data-layout="html"]').click();
  await page.waitForFunction(() => document.querySelectorAll('#html-output tr[data-page-start]').length > 1);

  const reparto = await page.evaluate(() => {
    const hojas = [...document.querySelectorAll('.page-sheet')].map(hoja => hoja.getBoundingClientRect());
    const dentro = caja => hojas.some(hoja => caja.top >= hoja.top - 1 && caja.bottom <= hoja.bottom + 1);
    const texto = (celda) => {
      const rango = document.createRange();
      rango.selectNodeContents(celda);
      return rango.getBoundingClientRect();
    };
    const tabla = document.querySelector('#html-output table');
    const inicios = [...tabla.querySelectorAll('tr[data-page-start]')];
    const cabeceras = [...document.querySelectorAll('#page-sheets .repeated-table-header')];
    return {
      partida: tabla.hasAttribute('data-page-split'),
      atravesadas: [...tabla.rows].filter(fila => ![...fila.cells].every(celda => dentro(texto(celda))))
        .map(fila => fila.textContent.trim()),
      cabeceras: cabeceras.length === inicios.length,
      cabeceraEnSuSitio: cabeceras.every((cabecera, indice) => {
        const caja = cabecera.getBoundingClientRect();
        return dentro(caja) && caja.bottom <= texto(inicios[indice].cells[0]).top + 1
          && cabecera.textContent.includes('Acción');
      }),
      fueraDelTexto: !document.querySelector('#html-output .repeated-table-header'),
    };
  });
  assert.deepEqual(reparto, {
    partida: true, atravesadas: [], cabeceras: true, cabeceraEnSuSitio: true, fueraDelTexto: true,
  });

  // Escribir en la fila que estrena página devuelve el mismo Markdown.
  const primera = page.locator('#html-output tr[data-page-start] td').first();
  const nombre = (await primera.textContent()).trim();
  await primera.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' bis');
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes(' bis'));
  const markdown = await page.locator('#markdown-input').inputValue();
  assert.equal(markdown.trim(), documento.replace(`| ${nombre} |`, `| ${nombre} bis |`).trim());
});

/*
  Con el tema oscuro, el PDF salía con el fondo de la ventana en negro y con
  los títulos, el código y las tablas en tonos claros. El papel se imprime
  siempre en claro, y al terminar vuelve el tema de la pantalla.
*/
test('con el tema oscuro se imprime en claro', async (t) => {
  const { context, page } = await openApp({ colorScheme: 'dark' });
  t.after(() => context.close());

  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true);
  // El botón de imprimir: el tema ya es el claro cuando se llama a imprimir.
  const alImprimir = await page.evaluate(() => new Promise((resolve) => {
    window.print = () => resolve(document.documentElement.classList.contains('dark'));
    document.getElementById('print-btn').click();
  }));
  assert.equal(alImprimir, false);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true);

  // Y el Ctrl+P del navegador, que solo avisa con `beforeprint`.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  await page.emulateMedia({ media: 'print' });
  const colores = await page.evaluate(() => ({
    fondo: getComputedStyle(document.getElementById('main-container')).backgroundColor,
    titulo: getComputedStyle(document.querySelector('#html-output h1') || document.body).color,
  }));
  assert.equal(colores.fondo, 'rgb(255, 255, 255)');
  assert.notEqual(colores.titulo, 'rgb(241, 245, 249)');
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('dark')), true);
});

/*
  El resumen del formato enseña siempre los tres ajustes que se consultan a
  diario —tamaño, tipo de letra e interlineado—, con un guion donde no hay nada
  fijado: una píldora que cambia de contenido según lo que haya obliga a abrir
  el cuadro para saber si un ajuste está sin poner o es que no cabía.
*/
test('el resumen del formato enseña siempre los tres ajustes', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const pildora = page.locator('#doc-format-status');
  const texto = () => pildora.evaluate(el => el.innerText.replace(/\s+/g, ' ').trim());

  // Recién abierto, los tres valores de partida de las opciones generales.
  await pildora.waitFor({ state: 'visible' });
  assert.equal(await texto(), '12 pt · Serif · 1,5');

  // Y con los tres puestos en el documento, los tres con su valor.
  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill('---\nfontsize: "14pt"\nfont: "sans"\nlinestretch: "2"\n---\n\nHola\n');
  await page.waitForFunction(
    () => document.getElementById('doc-format-status').innerText.includes('14 pt'),
  );
  assert.equal(await texto(), '14 pt · Sans · 2');

  // Y lleva al cuadro por la pestaña del formato, que es lo que resume.
  await pildora.click();
  await page.locator('#doc-format-modal-overlay').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#doc-format-tab-format').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('#doc-format-panel-format').isVisible(), true);

  // La del idioma, en cambio, abre por la suya.
  await page.locator('#doc-format-cancel-btn').click();
  await page.locator('#doc-language-status').click();
  await page.locator('#doc-format-modal-overlay').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#doc-format-tab-document').getAttribute('aria-selected'), 'true');
});

/*
  El idioma con el que va a salir el documento se lee en la barra de estado sin
  abrir nada: es lo que decide en qué lengua corrigen Word y LibreOffice. Y dice
  de dónde sale —del documento o de las opciones generales— sin gastar palabras.
*/
test('la barra de estado enseña siempre el idioma del documento', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const pildora = page.locator('#doc-language-status');
  const heredado = () => pildora.evaluate(el => el.classList.contains('is-inherited'));

  // Sin idioma propio: el general, y atenuado.
  await pildora.waitFor({ state: 'visible' });
  assert.equal(await pildora.innerText(), 'ES');
  assert.equal(await heredado(), true);

  // Con el suyo escrito en los metadatos: encendido y con su código.
  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill('---\nlang: "pt-BR"\n---\n\nOlá\n');
  await page.waitForFunction(
    () => document.getElementById('doc-language-status').innerText.trim() === 'PT-BR',
  );
  assert.equal(await heredado(), false);

  // Al quitarlo vuelve a seguir al general.
  await page.locator('#markdown-input').fill('Sin idioma propio\n');
  await page.waitForFunction(
    () => document.getElementById('doc-language-status').innerText.trim() === 'ES',
  );
  assert.equal(await heredado(), true);

  // Y el heredado sigue al idioma de la interfaz cuando este cambia.
  await page.evaluate(() => {
    const select = document.getElementById('language-select');
    select.value = 'en';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(
    () => document.getElementById('doc-language-status').innerText.trim() === 'EN',
  );

  // Lleva al mismo cuadro donde se cambia.
  await pildora.click();
  await page.locator('#doc-format-modal-overlay').waitFor({ state: 'visible' });
});

/*
  En el tema oscuro los encabezados del documento tienen que aclararse los seis:
  los que se quedaban fuera de la regla heredaban el gris oscuro de Tailwind
  Typography y sobre la hoja oscura se leían negros.
*/
test('en el tema oscuro los seis niveles de encabezado se aclaran', async (t) => {
  const { context, page } = await openApp({
    initStorage: () => {
      try { localStorage.setItem('edimarkweb-theme', 'dark'); } catch (_error) {}
    },
  });
  t.after(() => context.close());

  await page.waitForFunction(() => document.documentElement.classList.contains('dark'));
  await page.locator('#markdown-input').fill('# Uno\n\n## Dos\n\n### Tres\n\n#### Cuatro\n\n##### Cinco\n\n###### Seis\n');
  await page.locator('#html-output h6').waitFor();
  const colores = await page.evaluate(() => (
    ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']
      .map(tag => getComputedStyle(document.querySelector(`#html-output ${tag}`)).color)
  ));
  assert.deepEqual(new Set(colores), new Set(['rgb(241, 245, 249)']), `encabezados sin aclarar: ${colores}`);
});

/*
  La misma marca, dicha con palabras: la barra de estado lleva el nombre del
  panel activo, y solo ese. El botón que alterna la hoja y su código es cosa del
  panel derecho, así que solo sale cuando ese es el activo.
*/
test('la barra de estado nombra el panel activo', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#markdown-input').click();
  assert.equal(await page.locator('#markdown-panel-title').isVisible(), true);
  assert.equal(await page.locator('#html-panel-title').isVisible(), false);
  assert.equal(await page.locator('#view-toggle-btn').isVisible(), false);

  await page.locator('#html-output').click();
  assert.equal(await page.locator('#html-panel-title').isVisible(), true);
  assert.equal(await page.locator('#markdown-panel-title').isVisible(), false);
  assert.equal(await page.locator('#view-toggle-btn').isVisible(), true);

  // Y ese rótulo nombra lo que se está mirando en el panel.
  assert.equal(await page.locator('#html-panel-title').innerText(), 'EDITOR VISUAL');
  await page.locator('#view-toggle-btn').click();
  assert.equal(await page.locator('#html-panel-title').innerText(), 'CÓDIGO HTML');
});

/*
  Las dos lupas comparten sitio en la barra de estado y solo se enseña la del
  panel en el que se trabaja: cada una escala una cosa distinta —el texto que se
  escribe o la hoja que se verá— y juntas invitaban a confundirlas.
*/
test('la barra de estado enseña la lupa del panel activo', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#markdown-input').click();
  assert.equal(await page.locator('#markdown-zoom').isVisible(), true);
  assert.equal(await page.locator('#preview-zoom').isVisible(), false);

  await page.locator('#html-output').click();
  assert.equal(await page.locator('#preview-zoom').isVisible(), true);
  assert.equal(await page.locator('#markdown-zoom').isVisible(), false);

  /*
    Pulsar la lupa lleva el foco al botón, que está fuera de los dos paneles: si
    eso contara como cambio de panel, la lupa se cambiaría sola a mitad de la
    faena.
  */
  // Suelto el interruptor: atado, la hoja ya llena el panel y la lupa no sube.
  await page.locator('#preview-link-toggle').click();
  await page.locator('#preview-zoom-in').click();
  assert.equal(await page.locator('#preview-zoom').isVisible(), true);
  assert.equal(await page.locator('#preview-zoom-value').innerText(), '110 %');

  // Con un solo panel a la vista, la lupa que se enseña es la suya.
  await page.locator('#layout-switch [data-layout="md"]').click();
  assert.equal(await page.locator('#markdown-zoom').isVisible(), true);
  assert.equal(await page.locator('#preview-zoom').isVisible(), false);
});

/*
  Las teclas mueven la lupa del panel en el que se está trabajando: con los dos
  paneles a la vista, el que tenga el foco.
*/
test('Ctrl y las teclas de más y menos mueven la lupa del panel activo', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await conLaHojaATamanoReal(page);
  await page.locator('#markdown-input').click();
  await page.keyboard.press('Control+Equal');
  assert.equal(await page.locator('#markdown-zoom-value').innerText(), '110 %');
  assert.equal(await page.locator('#preview-zoom-value').innerText(), '100 %');

  await page.locator('#html-output').click();
  await page.keyboard.press('Control+Equal');
  assert.equal(await page.locator('#preview-zoom-value').innerText(), '110 %');
  assert.equal(await page.locator('#markdown-zoom-value').innerText(), '110 %');

  await page.keyboard.press('Control+Minus');
  assert.equal(await page.locator('#preview-zoom-value').innerText(), '100 %');
});

/*
  Desde que la vista previa dejó de seguir al tamaño de la interfaz, necesita
  un número propio: sin él se quedaba en el que le diera la hoja de estilos,
  que no es el que se exporta y convertía la previsualización en una promesa
  falsa. Las opciones generales lo traen puesto.
*/
test('el formato general trae un tamaño concreto que la vista previa aplica', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  await conLaHojaATamanoReal(page);

  await page.locator('#markdown-input').fill('# Hola\n\nUn párrafo.');
  await page.waitForFunction(() => document.querySelector('#html-output p'));

  // El ajuste general lo declara, no se queda vacío.
  assert.equal(
    await page.evaluate(() => (window.__edimarkLatexSettings || {}).documentFormat?.fontSize),
    '12',
  );
  // Y llega a la vista previa como estilo propio, en puntos y con la lupa
  // dentro, que en reposo vale 1: 12 pt son 16 px.
  assert.equal(
    await page.evaluate(() => document.getElementById('html-output').style.fontSize),
    'calc(12pt * var(--preview-zoom, 1))',
  );
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.getElementById('html-output')).fontSize),
    '16px',
  );
});

/*
  Una sola forma de explicar una opción, y visible.

  Antes convivían dos: unos menús escribían la explicación debajo del nombre y
  otros la escondían en el `title`, que no existe en una tableta, no sale al
  enfocar con el teclado y no obedece al tema. Ahora toda la información está
  escrita; el tooltip se queda para los botones de icono de la barra, donde no
  hay sitio para texto.
*/
test('ninguna opción de menú esconde su explicación en el ratón', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  assert.equal(
    await page.locator('[role="menu"] [role^="menuitem"][title]').count(),
    0,
    'queda alguna opción con la explicación solo en el tooltip',
  );
});

test('cada opción de menú lleva su explicación escrita debajo', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const leer = async (boton, menu) => {
    await page.locator(boton).click();
    await page.locator(menu).waitFor({ state: 'visible' });
    const filas = await page.locator(`${menu} > [role^="menuitem"]`).evaluateAll(items => items.map((item) => {
      const spans = Array.from(item.children).filter(child => child.tagName === 'SPAN');
      const descripcion = spans[spans.length - 1];
      return {
        nombre: item.innerText.split('\n')[0].trim(),
        descripcion: spans.length > 1 ? descripcion.textContent.trim() : '',
      };
    }));
    await page.keyboard.press('Escape');
    return filas;
  };

  for (const [boton, menu] of [
    ['#actions-menu-btn', '#actions-menu'],
    ['#export-menu-btn', '#export-menu'],
    ['#settings-menu-btn', '#settings-menu'],
    ['#help-menu-btn', '#help-menu'],
  ]) {
    for (const fila of await leer(boton, menu)) {
      assert.ok(fila.descripcion, `«${fila.nombre}» de ${menu} se quedó sin explicación`);
    }
  }
});

/*
  Los dos paneles se seguían por proporción, y en un documento largo esa
  proporción dejaba la línea del cursor fuera de la pantalla del otro panel.
  La prueba usa un documento donde la proporción falla —cuarenta apartados con
  un párrafo largo cada uno— y comprueba lo único que importa: que el trozo
  correspondiente se vea de verdad, ida y vuelta.
*/
test('los dos paneles se siguen por la línea, no por la proporción', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  const apartados = [];
  for (let i = 1; i <= 40; i += 1) {
    apartados.push(`## Apartado ${i}`, '', `Texto del apartado ${i}. `.repeat(12), '');
  }
  await page.locator('#markdown-input').fill(apartados.join('\n'));
  await page.waitForFunction(() => document.querySelectorAll('#html-output h2').length === 40);

  // El cursor en un encabezado del final: la vista previa tiene que enseñarlo.
  await page.evaluate(() => {
    const textarea = document.getElementById('markdown-input');
    const posicion = textarea.value.indexOf('## Apartado 33');
    textarea.focus();
    textarea.setSelectionRange(posicion, posicion);
    textarea.click();
  });
  // La sincronía se resuelve en el fotograma siguiente.
  await page.waitForTimeout(200);
  const visible = await page.evaluate(() => {
    const scroller = document.getElementById('preview-desk');
    const encabezado = Array.from(document.querySelectorAll('#html-output h2'))
      .find(titulo => titulo.textContent.trim() === 'Apartado 33');
    const caja = encabezado.getBoundingClientRect();
    const mesa = scroller.getBoundingClientRect();
    return caja.top >= mesa.top - 2 && caja.bottom <= mesa.bottom + 2;
  });
  assert.ok(visible, 'la vista previa no llegó al apartado del cursor');

  // Y al pinchar en la hoja, el Markdown enseña esa misma línea.
  await page.evaluate(() => {
    const encabezado = Array.from(document.querySelectorAll('#html-output h2'))
      .find(titulo => titulo.textContent.trim() === 'Apartado 7');
    encabezado.scrollIntoView();
    const caja = encabezado.getBoundingClientRect();
    encabezado.dispatchEvent(new MouseEvent('click', {
      bubbles: true, clientX: caja.left + 4, clientY: caja.top + 4,
    }));
  });
  await page.waitForTimeout(200);
  const lineaVisible = await page.evaluate(() => {
    const textarea = document.getElementById('markdown-input');
    const linea = textarea.value.split('\n').indexOf('## Apartado 7');
    const medida = markdownEditor.lineMetrics(linea);
    return {
      visible: medida.top >= textarea.scrollTop && medida.top <= textarea.scrollTop + textarea.clientHeight,
      linea,
      top: medida.top,
      scrollTop: textarea.scrollTop,
      alto: textarea.clientHeight,
    };
  });
  assert.ok(lineaVisible.visible, `el Markdown no llegó a la línea del bloque pinchado: ${JSON.stringify(lineaVisible)}`);
});

test('las barras verticales mantienen sincronizados los dos paneles', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  const apartados = [];
  for (let i = 1; i <= 50; i += 1) {
    apartados.push(`## Tramo ${i}`, '', `Contenido visible del tramo ${i}. `.repeat(16), '');
  }
  await page.locator('#markdown-input').fill(apartados.join('\n'));
  await page.waitForFunction(() => document.querySelectorAll('#html-output h2').length === 50);

  // El cursor se queda arriba mientras solo se arrastra la barra. Firefox
  // puede desplazar el textarea para enseñar una selección recién cambiada,
  // así que se deja terminar ese gesto antes de probar la barra por separado.
  await page.evaluate(() => {
    const textarea = document.getElementById('markdown-input');
    textarea.setSelectionRange(0, 0);
    textarea.dispatchEvent(new Event('select'));
  });
  await page.waitForTimeout(100);

  // Simula arrastrar la barra izquierda hasta que el tramo 36 cruza el punto
  // de referencia. No se mueve el cursor: el único origen es el scroll.
  await page.evaluate(() => {
    const textarea = document.getElementById('markdown-input');
    const linea = textarea.value.split('\n').indexOf('## Tramo 36');
    const medida = markdownEditor.lineMetrics(linea);
    textarea.scrollTop = medida.top - textarea.clientHeight * 0.25;
    textarea.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(200);
  const izquierdaADerecha = await page.evaluate(() => {
    const mesa = document.getElementById('preview-desk');
    const titulo = Array.from(document.querySelectorAll('#html-output h2'))
      .find(elemento => elemento.textContent.trim() === 'Tramo 36');
    const esperado = mesa.getBoundingClientRect().top + mesa.clientHeight * 0.25;
    return Math.abs(titulo.getBoundingClientRect().top - esperado);
  });
  assert.ok(izquierdaADerecha < 30, `la barra Markdown dejó una diferencia de ${izquierdaADerecha}px`);

  // En un textarea real, soltar su barra también genera mouseup. No debe
  // confundirse con un clic en el texto ni devolver la hoja al cursor antiguo.
  await page.locator('#markdown-input').dispatchEvent('mouseup');
  await page.waitForTimeout(200);
  const trasSoltar = await page.evaluate(() => {
    const mesa = document.getElementById('preview-desk');
    const titulo = Array.from(document.querySelectorAll('#html-output h2'))
      .find(elemento => elemento.textContent.trim() === 'Tramo 36');
    const esperado = mesa.getBoundingClientRect().top + mesa.clientHeight * 0.25;
    return Math.abs(titulo.getBoundingClientRect().top - esperado);
  });
  assert.ok(trasSoltar < 30, `al soltar la barra Markdown la hoja retrocedió ${trasSoltar}px`);

  // Ahora la barra derecha manda y lleva el tramo 12 al mismo punto del
  // editor Markdown, de nuevo sin clic ni cambio de selección.
  await page.evaluate(() => {
    const mesa = document.getElementById('preview-desk');
    const titulo = Array.from(document.querySelectorAll('#html-output h2'))
      .find(elemento => elemento.textContent.trim() === 'Tramo 12');
    const caja = titulo.getBoundingClientRect();
    const cajaMesa = mesa.getBoundingClientRect();
    const top = caja.top - cajaMesa.top + mesa.scrollTop;
    mesa.scrollTop = top - mesa.clientHeight * 0.25;
    mesa.dispatchEvent(new Event('scroll'));
  });
  await page.waitForTimeout(200);
  const derechaAIzquierda = await page.evaluate(() => {
    const textarea = document.getElementById('markdown-input');
    const linea = textarea.value.split('\n').indexOf('## Tramo 12');
    const medida = markdownEditor.lineMetrics(linea);
    const esperado = textarea.scrollTop + textarea.clientHeight * 0.25;
    return Math.abs(medida.top - esperado);
  });
  assert.ok(derechaAIzquierda < 30, `la barra de la hoja dejó una diferencia de ${derechaAIzquierda}px`);
});

/*
  La barra de formato escribía siempre en el Markdown y se apagaba al pasar a
  la hoja. Ahora trabaja en los dos lados: en la hoja cambia el HTML y el
  Markdown se escribe solo por el camino de siempre. Lo que se comprueba es el
  Markdown resultante, que es lo que se guarda y se exporta.
*/
async function seleccionarEnLaHoja(page, texto) {
  await page.evaluate((buscado) => {
    const salida = document.getElementById('html-output');
    salida.focus();
    const buscar = (nodo) => {
      for (const hijo of nodo.childNodes) {
        if (hijo.nodeType === 3 && hijo.data.includes(buscado)) return hijo;
        if (hijo.nodeType === 1) {
          const encontrado = buscar(hijo);
          if (encontrado) return encontrado;
        }
      }
      return null;
    };
    const nodo = buscar(salida);
    if (!nodo) throw new Error(`No se encontró «${buscado}» en la vista previa`);
    const inicio = nodo.data.indexOf(buscado);
    const rango = document.createRange();
    rango.setStart(nodo, inicio);
    rango.setEnd(nodo, inicio + buscado.length);
    const seleccion = window.getSelection();
    seleccion.removeAllRanges();
    seleccion.addRange(rango);
    // El guardado de la selección escucha este evento, que no se dispara solo
    // cuando la selección se pone desde un script.
    document.dispatchEvent(new Event('selectionchange'));
  }, texto);
}

/*
  La vista previa se repinta agrupando las pulsaciones, así que un documento
  nuevo con el mismo texto que el anterior no se distingue del que ya estaba en
  pantalla: hay que escribir algo distinto cada vez y esperar a verlo.
*/
async function documentoDePrueba(page, palabra) {
  await page.locator('#markdown-input').fill(`Un párrafo de prueba para ${palabra}.\n`);
  await page.locator('#html-output p').getByText(palabra).waitFor();
}

test('el formato de la barra se aplica también sobre la vista previa', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();

  for (const [formato, palabra, esperado] of [
    ['bold', 'negrita', 'Un párrafo de prueba para **negrita**.'],
    ['italic', 'cursiva', 'Un párrafo de prueba para *cursiva*.'],
    ['strikethrough', 'tachado', 'Un párrafo de prueba para ~~tachado~~.'],
    ['code', 'código', 'Un párrafo de prueba para `código`.'],
    ['quote', 'cita', '> Un párrafo de prueba para cita.'],
    ['list-ul', 'lista', '- Un párrafo de prueba para lista.'],
    ['list-ol', 'numerada', '1. Un párrafo de prueba para numerada.'],
  ]) {
    await documentoDePrueba(page, palabra);
    await seleccionarEnLaHoja(page, palabra);
    if (formato.startsWith('list-')) await page.locator('#list-menu-btn').click();
    await page.locator(`[data-format="${formato}"]`).click();
    await page.waitForFunction(
      (texto) => document.getElementById('markdown-input').value.trim() === texto,
      esperado,
    );
    assert.equal(
      (await page.locator('#markdown-input').inputValue()).trim(),
      esperado,
      `«${formato}» desde la vista previa`,
    );
  }

  // El mismo botón quita lo que puso.
  await documentoDePrueba(page, 'alternancia');
  await seleccionarEnLaHoja(page, 'alternancia');
  await page.locator('[data-format="bold"]').click();
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('**'));
  await seleccionarEnLaHoja(page, 'alternancia');
  await page.locator('[data-format="bold"]').click();
  await page.waitForFunction(() => !document.getElementById('markdown-input').value.includes('**'));

  // Y el atajo hace lo mismo que el botón.
  await documentoDePrueba(page, 'atajo');
  await seleccionarEnLaHoja(page, 'atajo');
  await page.keyboard.press('Control+b');
  await page.waitForFunction(
    () => document.getElementById('markdown-input').value.trim() === 'Un párrafo de prueba para **atajo**.',
  );

  // Una línea horizontal es un bloque nuevo y no borra el párrafo en el que
  // estaba el cursor de la hoja.
  await documentoDePrueba(page, 'separador');
  await seleccionarEnLaHoja(page, 'separador');
  await page.locator('[data-format="horizontal-rule"]').click();
  await page.waitForFunction(() => document.getElementById('html-output').querySelectorAll('hr').length === 1);
  // La vuelta al Markdown va en un requestAnimationFrame: sin esperarla, esto
  // fallaba de vez en cuando con la suite entera por delante.
  await page.waitForFunction(() => /separador\.\n+---/.test(document.getElementById('markdown-input').value));
  assert.match(await page.locator('#markdown-input').inputValue(), /separador\.\n+---/);
});

test('tachado y línea horizontal se insertan desde el panel Markdown', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.locator('#layout-switch [data-layout="md"]').click();
  await page.locator('#html-panel').waitFor({ state: 'hidden' });
  await page.evaluate(() => {
    markdownEditor.setValue('Texto tachado');
    markdownEditor.focus();
    document.getElementById('markdown-input').setSelectionRange(0, 13);
  });
  await page.locator('[data-format="strikethrough"]').click();
  assert.equal(await page.locator('#markdown-input').inputValue(), '~~Texto tachado~~');

  await page.evaluate(() => {
    markdownEditor.focus();
    document.getElementById('markdown-input').setSelectionRange(0, markdownEditor.getValue().length);
  });
  await page.locator('[data-format="horizontal-rule"]').click();
  assert.equal(await page.locator('#markdown-input').inputValue(), '~~Texto tachado~~\n\n---\n\n');
});

test('desde la vista previa se insertan títulos, enlaces, imágenes y tablas', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();

  // Título: el desplegable lo pone y, repetido, lo quita.
  await documentoDePrueba(page, 'encabezado');
  await seleccionarEnLaHoja(page, 'encabezado');
  await page.locator('#heading-btn').click();
  await page.locator('[data-format="heading-2"]').click();
  await page.waitForFunction(() => document.getElementById('markdown-input').value.startsWith('## '));
  await seleccionarEnLaHoja(page, 'encabezado');
  await page.locator('#heading-btn').click();
  await page.locator('[data-format="heading-2"]').click();
  await page.waitForFunction(() => !document.getElementById('markdown-input').value.startsWith('## '));

  /*
    Enlace: la ventana de siempre, con el texto seleccionado ya escrito —solo
    queda poner la dirección, igual que pidiéndolo desde el Markdown— y puesto
    donde estaba la selección.
  */
  await documentoDePrueba(page, 'enlace');
  await seleccionarEnLaHoja(page, 'enlace');
  await page.locator('[data-format="link"]').click();
  await page.locator('#link-modal-overlay').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#link-text').inputValue(), 'enlace');
  await page.locator('#link-url').fill('https://ejemplo.org');
  await page.locator('#insert-link-btn').click();
  await page.waitForFunction(
    () => document.getElementById('markdown-input').value.includes('[enlace](https://ejemplo.org)'),
  );

  // La imagen hace lo mismo con el texto alternativo.
  await documentoDePrueba(page, 'ilustración');
  await seleccionarEnLaHoja(page, 'ilustración');
  await page.locator('[data-format="image"]').click();
  await page.locator('#image-modal-overlay').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#image-alt-text').inputValue(), 'ilustración');
  await page.locator('#cancel-image-btn').click();

  // Tabla: bloque nuevo detrás del párrafo, no dentro de él.
  await documentoDePrueba(page, 'tabla');
  await seleccionarEnLaHoja(page, 'tabla');
  await page.locator('[data-format="table"]').click();
  await page.locator('#table-modal-overlay').waitFor({ state: 'visible' });
  await page.locator('#create-table-btn').click();
  await page.waitForFunction(() => /\n\|.+\|\n/.test(document.getElementById('markdown-input').value));
  assert.equal(await page.locator('#html-output table').count(), 1);

});

/*
  Sobre la hoja no hay dónde escribir dentro de un par de delimitadores: en
  cuanto se repinta, KaTeX convierte el hueco en fórmula. Por eso el menú de
  fórmulas abre una ventana donde se escribe el código con el resultado
  delante, y solo entra en el documento lo que ya está montado. En el panel
  Markdown no cambia nada: allí los delimitadores se escriben en el texto.
*/
test('sobre la vista previa las fórmulas se escriben en su propia ventana', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await documentoDePrueba(page, 'x^2');
  await seleccionarEnLaHoja(page, 'x^2');

  // Sobre la hoja el botón abre la ventana de una vez: no hay menú detrás, y
  // la flecha que lo anunciaba se retira.
  assert.equal(await page.locator('#formula-btn-caret').isVisible(), false);
  assert.equal(await page.locator('#formula-btn').getAttribute('aria-haspopup'), 'dialog');
  await page.locator('#formula-btn').click();
  await page.locator('#math-modal-overlay').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#formula-options').isVisible(), false);

  // De partida, en línea y con \(...\).
  assert.equal(await page.locator('input[name="math-placement"]:checked').inputValue(), 'inline');
  assert.equal(await page.locator('input[name="math-delimiter"]:checked').inputValue(), 'bracket');

  // Lo seleccionado llega escrito y se ve renderizado antes de aceptar.
  assert.equal(await page.locator('#math-code').inputValue(), 'x^2');
  await page.locator('#math-preview .katex').waitFor();

  // Un error se explica en vez de colarse en el documento.
  await page.locator('#math-code').fill('\\frac{a}');
  await page.locator('#math-error').waitFor({ state: 'visible' });

  await page.locator('#math-code').fill('\\frac{a}{b}');
  await page.locator('#math-error').waitFor({ state: 'hidden' });
  await page.locator('#insert-math-btn').click();
  await page.waitForFunction(
    () => /\\\(\\frac\{a\}\{b\}\\\)/.test(document.getElementById('markdown-input').value),
  );
  await page.locator('#html-output .katex').first().waitFor();

  /*
    Los dos ejes se eligen en la ventana, y el par ofrecido es el de la
    presentación puesta: en bloque, `\[...\]` y `$$...$$`.
  */
  await documentoDePrueba(page, 'aparte');
  await seleccionarEnLaHoja(page, 'aparte');
  await page.locator('#formula-btn').click();
  await page.locator('#math-modal-overlay').waitFor({ state: 'visible' });
  await page.locator('#math-code').fill('\\frac{a}{b}');
  await page.locator('input[name="math-placement"][value="block"]').check();
  assert.equal(await page.locator('#math-delimiter-bracket-label').textContent(), '\\[...\\]');
  assert.equal(await page.locator('#math-delimiter-dollar-label').textContent(), '$$...$$');
  await page.locator('input[name="math-delimiter"][value="dollar"]').check();
  await page.locator('#math-preview .katex-display').waitFor();
  await page.locator('#insert-math-btn').click();
  await page.waitForFunction(
    () => document.getElementById('markdown-input').value.includes('$$\\frac{a}{b}$$'),
  );
  await page.locator('#html-output .katex-display').waitFor();

  // Desde el panel Markdown, el menú de siempre y sin ventana.
  await page.locator('#markdown-input').fill('Texto.\n');
  await page.locator('#markdown-input').focus();
  assert.equal(await page.locator('#formula-btn-caret').isVisible(), true);
  await page.locator('#formula-btn').click();
  await page.locator('#formula-options').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#math-modal-overlay').isVisible(), false);
  await page.locator('[data-format="latex-inline-dollar"]').click();
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('$$'));
});

/*
  Ctrl+M hace lo mismo que el botón, y el botón hace dos cosas distintas: sobre
  la hoja no hay delimitadores que elegir, así que la espera de las cuatro
  teclas no pinta nada y el atajo abre la ventana de una vez.
*/
test('sobre la vista previa Ctrl+M abre la ventana en lugar de la espera', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await documentoDePrueba(page, 'x^2');
  await seleccionarEnLaHoja(page, 'x^2');

  await page.keyboard.press('Control+KeyM');
  await page.locator('#math-modal-overlay').waitFor({ state: 'visible' });
  // La espera no llegó a abrirse: la barra de estado no anuncia las teclas.
  assert.equal(await page.locator('#status-toast-message').textContent(), '');
  // Y lo seleccionado en la hoja llega escrito, como con el botón.
  assert.equal(await page.locator('#math-code').inputValue(), 'x^2');
  await page.locator('#cancel-math-btn').click();
});

/*
  Quien abre una ventana suele escribir a continuación sin tocar el ratón. Con
  el foco puesto un fotograma más tarde, la primera letra se perdía —y se
  colaba en el documento—, así que se comprueba escribiendo a ciegas.
*/
test('las ventanas de la barra reciben el cursor en su primer campo', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await documentoDePrueba(page, 'ventanas');
  await seleccionarEnLaHoja(page, 'ventanas');
  await page.locator('#formula-btn').click();
  await page.locator('#math-modal-overlay').waitFor({ state: 'visible' });
  await page.keyboard.type('x^2');
  assert.equal(await page.locator('#math-code').inputValue(), 'x^2');
  await page.locator('#cancel-math-btn').click();

  /*
    Y el cursor tiene que verse, que es otra cosa: el reset de Tailwind deja
    los `textarea` sin relleno, así que el caret se dibujaba en la posición
    cero, tapado por el borde del campo. Con el campo vacío no se veía nada y
    parecía que la ventana no daba el foco.
  */
  for (const campo of ['#math-code', '#latex-import-input']) {
    const relleno = await page.locator(campo).evaluate((el) => {
      const estilo = window.getComputedStyle(el);
      return { izquierda: parseFloat(estilo.paddingLeft), arriba: parseFloat(estilo.paddingTop) };
    });
    assert.ok(relleno.izquierda > 0, `${campo} pega el cursor al borde izquierdo`);
    assert.ok(relleno.arriba > 0, `${campo} pega el cursor al borde superior`);
  }

  for (const [boton, ventana, campo] of [
    // Con texto seleccionado, el enlace da por sabido el texto y pide la
    // dirección; sin él, empieza por el texto.
    ['[data-format="link"]', '#link-modal-overlay', 'link-url'],
    ['[data-format="image"]', '#image-modal-overlay', 'image-file-input'],
    ['[data-format="table"]', '#table-modal-overlay', 'table-cols'],
  ]) {
    await documentoDePrueba(page, `campo ${campo}`);
    await seleccionarEnLaHoja(page, 'campo');
    await page.locator(boton).click();
    await page.locator(ventana).waitFor({ state: 'visible' });
    assert.equal(
      await page.evaluate(() => document.activeElement.id),
      campo,
      `la ventana de ${boton} no dio el cursor a ${campo}`,
    );
    await page.evaluate((selector) => { document.querySelector(selector).style.display = 'none'; }, ventana);
  }
});

/*
  EdiCuaTeX devuelve la fórmula ya escrita en Markdown, y eso no se puede
  volver a interpretar: `\(` es un paréntesis escapado, así que pasarla por el
  conversor le comía las barras y la fórmula llegaba como texto suelto.
*/
test('la fórmula de EdiCuaTeX entra intacta en la vista previa', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await documentoDePrueba(page, 'hueco');
  await seleccionarEnLaHoja(page, 'hueco');
  await page.evaluate(() => window.postMessage({
    type: 'edicuatex:result',
    latex: 'x^2',
    delimiter: 'parentheses',
    wrapped: '\\(x^2\\)',
  }, '*'));
  await page.waitForFunction(
    () => document.getElementById('markdown-input').value.includes('\\(x^2\\)'),
  );
  await page.locator('#html-output .katex').first().waitFor();
});

/*
  Tocar la hoja rehace el Markdown entero, así que lo que no se ha tocado tiene
  que volver tal cual: es la diferencia entre una ayuda y un editor en el que
  se pueda confiar.
*/
test('formatear en la vista previa no reescribe el resto del documento', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  const documento = [
    '# Título',
    '',
    'Un párrafo con **negrita**, *cursiva*, `código` y un [enlace](https://ejemplo.org).',
    '',
    '- uno',
    '  - anidado',
    '- dos',
    '',
    '1. primero',
    '2. segundo',
    '',
    '- [ ] tarea',
    '- [x] hecha',
    '',
    '> una cita',
    '',
    'Fórmula $E=mc^2$ en línea.',
    '',
    'Final.',
    '',
  ].join('\n');
  await page.locator('#markdown-input').fill(documento);
  await page.locator('#html-output blockquote').waitFor();

  await seleccionarEnLaHoja(page, 'Final');
  await page.locator('[data-format="bold"]').click();
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('**Final**'));

  const resultado = await page.locator('#markdown-input').inputValue();
  assert.equal(resultado.trim(), documento.replace('Final.', '**Final**.').trim());
});

/*
  Cambiar de pestaña devolvía las dos vistas al principio del documento, así
  que volver a un texto largo obligaba a buscar otra vez por dónde se iba.
*/
test('cada pestaña vuelve por donde se quedó', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  const documento = Array.from({ length: 60 }, (_, i) => `Línea ${i + 1} de un documento largo de prueba.`).join('\n\n');
  await page.locator('#markdown-input').fill(documento);
  await page.locator('#html-output p').getByText('Línea 60', { exact: false }).waitFor();

  // El cursor, bien entrado el documento.
  await page.evaluate(() => {
    const editor = document.getElementById('markdown-input');
    const posicion = editor.value.indexOf('Línea 40');
    editor.focus();
    editor.setSelectionRange(posicion + 4, posicion + 4);
    editor.dispatchEvent(new Event('select'));
  });
  /*
    La hoja sigue moviéndose un poco mientras se renderizan las fórmulas y las
    imágenes; se mide cuando se ha quedado quieta, que es lo que guarda la
    pestaña al salir.
  */
  await page.waitForFunction(() => {
    const mesa = document.getElementById('preview-desk');
    if (!mesa.scrollTop) return false;
    const anterior = window.__ultimoScroll;
    window.__ultimoScroll = mesa.scrollTop;
    return anterior === mesa.scrollTop;
  }, null, { polling: 250 });
  const antes = await page.evaluate(() => ({
    cursor: document.getElementById('markdown-input').selectionStart,
    markdown: Math.round(document.getElementById('markdown-input').scrollTop),
    vista: Math.round(document.getElementById('preview-desk').scrollTop),
  }));
  assert.ok(antes.markdown > 0, 'la prueba necesita el editor desplazado');

  await page.locator('#new-tab-btn').click();
  await page.locator('.tab').nth(1).click();
  await page.waitForFunction(
    (esperado) => document.getElementById('markdown-input').selectionStart === esperado,
    antes.cursor,
  );
  const despues = await page.evaluate(() => ({
    cursor: document.getElementById('markdown-input').selectionStart,
    markdown: Math.round(document.getElementById('markdown-input').scrollTop),
    vista: Math.round(document.getElementById('preview-desk').scrollTop),
  }));
  assert.equal(despues.cursor, antes.cursor);
  assert.ok(Math.abs(despues.markdown - antes.markdown) <= 4, `el editor volvió a ${despues.markdown} en vez de ${antes.markdown}`);
  assert.ok(Math.abs(despues.vista - antes.vista) <= 4, `la hoja volvió a ${despues.vista} en vez de ${antes.vista}`);
});

/*
  Listas de varios niveles con el tabulador, en los dos paneles. En la hoja se
  mueve el elemento a mano: el `outdent` de `execCommand` deshacía el punto en
  Firefox en vez de subirlo de nivel.
*/
test('el tabulador anida y desanida los puntos de una lista', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();

  // En el panel Markdown, sobre la línea del punto y no donde esté el cursor.
  await page.locator('#markdown-input').fill('- uno\n- dos\n- tres\n');
  await page.locator('#html-output li').getByText('dos', { exact: true }).waitFor();
  await page.evaluate(() => {
    const editor = document.getElementById('markdown-input');
    const posicion = editor.value.indexOf('dos') + 3;
    editor.focus();
    editor.setSelectionRange(posicion, posicion);
  });
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.getElementById('markdown-input').value.startsWith('- uno\n  - dos'));
  await page.keyboard.press('Shift+Tab');
  await page.waitForFunction(() => document.getElementById('markdown-input').value.startsWith('- uno\n- dos'));

  // Y en la hoja, con el cursor dentro del punto.
  const caretEnElPunto = async (texto) => {
    await page.evaluate((buscado) => {
      const salida = document.getElementById('html-output');
      salida.focus();
      const punto = Array.from(salida.querySelectorAll('li'))
        .find(li => li.firstChild && li.firstChild.nodeType === 3 && li.firstChild.data.trim() === buscado);
      const rango = document.createRange();
      rango.setStart(punto.firstChild, punto.firstChild.data.length);
      rango.collapse(true);
      const seleccion = window.getSelection();
      seleccion.removeAllRanges();
      seleccion.addRange(rango);
      document.dispatchEvent(new Event('selectionchange'));
    }, texto);
  };

  await page.locator('#markdown-input').fill('- alfa\n- beta\n- gamma\n');
  await page.locator('#html-output li').getByText('beta', { exact: true }).waitFor();
  await caretEnElPunto('beta');
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('\n  - beta'));
  assert.equal(await page.locator('#html-output ul ul li').count(), 1);

  // El cursor se queda donde se estaba escribiendo, no salta al punto siguiente.
  assert.equal(
    await page.evaluate(() => {
      const nodo = window.getSelection().anchorNode;
      return nodo && nodo.nodeType === 3 ? nodo.data.trim() : '';
    }),
    'beta',
  );

  await page.keyboard.press('Shift+Tab');
  await page.waitForFunction(
    () => document.getElementById('markdown-input').value.trim() === '- alfa\n- beta\n- gamma',
  );

  // El primer punto no tiene bajo qué anidarse y se queda como está.
  await page.locator('#markdown-input').fill('- uno\n- dos\n');
  await page.locator('#html-output li').getByText('uno', { exact: true }).waitFor();
  await caretEnElPunto('uno');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  assert.equal((await page.locator('#markdown-input').inputValue()).trim(), '- uno\n- dos');
});

/*
  Una lista numerada sangra tres espacios, que es lo que ocupa `1. `; con los
  dos de las viñetas el punto se quedaba en el mismo nivel, solo que con otro
  número, y en la hoja no aparecía anidado.
*/
test('las listas numeradas se anidan como las de viñetas', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill('1. uno\n2. dos\n3. tres\n');
  await page.locator('#html-output li').getByText('dos', { exact: true }).waitFor();
  await page.evaluate(() => {
    const editor = document.getElementById('markdown-input');
    const posicion = editor.value.indexOf('2. dos') + 6;
    editor.focus();
    editor.setSelectionRange(posicion, posicion);
  });
  await page.keyboard.press('Tab');
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('\n   1. dos'));
  await page.locator('#html-output ol ol li').waitFor();

  // Y vuelve a su nivel con la numeración que le toca allí.
  await page.keyboard.press('Shift+Tab');
  await page.waitForFunction(
    () => document.getElementById('markdown-input').value.startsWith('1. uno\n2. dos'),
  );
  // La hoja se repinta un poco después: se espera a que la anidada desaparezca.
  await page.waitForFunction(() => document.querySelectorAll('#html-output ol ol li').length === 0);
});

/*
  Un punto vacío cierra la lista, pero solo la del primer nivel: dentro de una
  anidada, dos intros seguidos acababan con todo en vez de sacar el punto al
  nivel de arriba, que es donde se seguía escribiendo.
*/
test('un punto vacío de una lista anidada sube de nivel', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();

  // En el panel Markdown, con tres niveles: se sube de uno en uno.
  await page.locator('#markdown-input').fill('- uno\n  - dos\n    - tres\n');
  await page.locator('#html-output ul ul ul li').waitFor();
  await page.evaluate(() => {
    const editor = document.getElementById('markdown-input');
    const posicion = editor.value.indexOf('- tres') + 6;
    editor.focus();
    editor.setSelectionRange(posicion, posicion);
  });
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('markdown-input').value.endsWith('  - \n'));
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('markdown-input').value.endsWith('\n- \n'));
  // Ya en el primer nivel, el siguiente intro sí cierra la lista.
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => !document.getElementById('markdown-input').value.endsWith('- \n'));

  // Y una numerada recupera el número que le toca en el nivel de arriba.
  await page.locator('#markdown-input').fill('1. uno\n   1. dos\n');
  await page.locator('#html-output ol ol li').waitFor();
  await page.evaluate(() => {
    const editor = document.getElementById('markdown-input');
    const posicion = editor.value.indexOf('1. dos') + 6;
    editor.focus();
    editor.setSelectionRange(posicion, posicion);
  });
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('\n2. '));

  // En la hoja, lo mismo.
  await page.locator('#markdown-input').fill('- alfa\n  - beta\n');
  await page.locator('#html-output ul ul li').waitFor();
  await page.evaluate(() => {
    const salida = document.getElementById('html-output');
    salida.focus();
    const punto = Array.from(salida.querySelectorAll('li')).find(li => li.textContent.trim() === 'beta');
    const rango = document.createRange();
    rango.setStart(punto.firstChild, punto.firstChild.data.length);
    rango.collapse(true);
    const seleccion = window.getSelection();
    seleccion.removeAllRanges();
    seleccion.addRange(rango);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#html-output ul ul li').length === 2);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('#html-output ul ul li').length === 1);
  assert.equal(await page.locator('#html-output > ul > li').count(), 2);
});

/*
  Abrir la aplicación en su propia ventana es cosa de cómo se ve, así que está
  con los botones de la vista y no solo enterrado en Configuración. No es un
  modo que se quede puesto, sino algo que pasa una vez: va al final y detrás de
  una raya. En la aplicación de escritorio no pinta nada.
*/
test('la ventana independiente se pide desde la fila de la vista', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const boton = page.locator('#desktop-window-toolbar-btn');
  await boton.waitFor();
  assert.equal(await page.locator('#desktop-window-separator').isVisible(), true);

  // Al final de la fila, detrás del que cambia el ancho de trabajo.
  const ancho = await page.locator('#toggle-width-btn').boundingBox();
  const ventana = await boton.boundingBox();
  assert.ok(ventana.x > ancho.x + ancho.width, 'debería quedar a la derecha de todo');

  // Y hace lo mismo que la opción de Configuración.
  const emergente = page.waitForEvent('popup');
  await boton.click();
  const nueva = await emergente;
  assert.match(nueva.url(), /desktop=1/);
});

test('en la aplicación de escritorio no se ofrece la ventana independiente', async (t) => {
  const { context, page } = await openApp({
    initStorage: () => {
      window.__EDIMARK_TAURI__ = { dialog: {}, fs: {}, opener: { openUrl: async () => {} } };
    },
  });
  t.after(() => context.close());

  await page.waitForFunction(() => document.body.classList.contains('desktop-mode'));
  for (const selector of ['#desktop-window-toolbar-btn', '#desktop-window-separator', '#desktop-window-btn']) {
    assert.equal(await page.locator(selector).isVisible(), false, `${selector} no debería verse en el escritorio`);
  }
});

/*
  Una imagen pegada entra como `data:image/png;base64,…`: viaja con el texto,
  pero engorda el `.md` y lo vuelve incómodo de leer. El camino de vuelta la
  saca a un archivo en `imagenes/` y deja su ruta en el texto; los archivos se
  escriben al guardar, por donde ya pasan las imágenes de ruta relativa.
*/
const PNG_BASE64 = PNG_PIXEL.toString('base64');

/*
  Las imágenes salen a una carpeta con el nombre del documento, así que los
  documentos de estas pruebas se llaman como se llamarían en el disco.
*/
async function nombrarDocumento(page, nombre) {
  await page.evaluate((valor) => {
    const doc = docs.find(d => d.id === currentId);
    if (doc) doc.name = valor;
  }, nombre);
}

async function documentoConImagenIncrustada(page, extra = '') {
  await page.evaluate(([datos, cola]) => {
    markdownEditor.setValue(`# Con una imagen\n\n![Un gráfico](data:image/png;base64,${datos})\n${cola}`);
  }, [PNG_BASE64, extra]);
  await page.locator('#base64-hidden-container').waitFor({ state: 'visible' });
  // La acción de extraer vive dentro de la lista, que arranca plegada.
  if (await page.locator('#base64-hidden-toggle').getAttribute('aria-expanded') !== 'true') {
    await page.locator('#base64-hidden-toggle').click();
    await page.locator('#base64-hidden-list').waitFor({ state: 'visible' });
  }
}

async function pasarPrimeraImagenIncrustadaALaCarpeta(page) {
  await page.locator('.base64-hidden-item').first()
    .getByRole('button', { name: 'Pasar a la carpeta' }).click();
}

test('las imágenes incrustadas se pueden pasar a la carpeta del documento', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await nombrarDocumento(page, 'Mi archivo');
  // La segunda imagen comprueba que no se pisa una ruta ya usada.
  await documentoConImagenIncrustada(page, '\n![Ya suelta](Mi-archivo/01.png)\n');
  assert.equal(await page.locator('#base64-extract-btn').isVisible(), false, 'con una sola incrustada no se repite la acción general');
  assert.equal(await page.getByRole('button', { name: 'Ver código' }).count(), 0);
  await pasarPrimeraImagenIncrustadaALaCarpeta(page);

  await page.waitForFunction(() => !document.getElementById('markdown-input').value.includes('base64,'));
  const markdown = await page.locator('#markdown-input').inputValue();
  /*
    La carpeta lleva el nombre del documento —con los espacios en guiones, que
    en un `![](...)` cortarían el enlace—, para que dos `.md` vecinos no se
    pisen las imágenes.
  */
  assert.match(markdown, /!\[Un gráfico\]\(Mi-archivo\/images\/01\.png\)/);
  assert.match(markdown, /!\[Ya suelta\]\(Mi-archivo\/01\.png\)/);

  // Ya no quedan Base64: el gestor conserva las dos imágenes, ahora como
  // archivos enlazados, y retira la acción de extraerlas otra vez.
  await page.locator('#base64-hidden-count').getByText('2 imágenes', { exact: true }).waitFor();
  assert.equal(await page.locator('#base64-extract-btn').isVisible(), false);
  const imagenes = await page.locator('#html-output img').evaluateAll(nodes => nodes.map(img => ({
    src: img.getAttribute('src'),
    original: img.dataset.edimarkSrc || '',
  })));
  const extraida = imagenes.find(imagen => imagen.original === 'Mi-archivo/images/01.png');
  assert.ok(extraida, 'la imagen extraída debería seguir en la vista previa');
  assert.match(extraida.src, /^blob:/);
});

test('en escritorio una imagen pendiente sobrevive al reinicio sin guardar el documento', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await nombrarDocumento(page, 'cosa');
  await documentoConImagenIncrustada(page);
  const docId = await page.evaluate(() => {
    window.EdiMarkPlatform = { ...(window.EdiMarkPlatform || {}), isDesktop: true };
    return currentId;
  });
  await pasarPrimeraImagenIncrustadaALaCarpeta(page);
  await page.waitForFunction(async (id) => (await readPersistedDocumentAssets(id)).length === 1, docId);
  await page.evaluate(() => autosaveCurrentDoc());

  // En el siguiente arranque se comporta como Tauri. Allí no se hace la
  // restauración anticipada de la web: la vista previa debe recuperar la
  // imagen de IndexedDB cuando intenta resolver su ruta.
  await context.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      window.EdiMarkPlatform = { ...(window.EdiMarkPlatform || {}), isDesktop: true };
    }, { once: true });
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__edimarkReady === true);
  await page.locator(`.tab[data-id="${docId}"]`).click();
  await page.waitForFunction(() => {
    const img = document.querySelector('#html-output img');
    return Boolean(img
      && img.getAttribute('src')?.startsWith('blob:')
      && img.complete
      && img.naturalWidth > 0);
  });

  assert.equal(
    await page.locator('#markdown-input').inputValue(),
    '# Con una imagen\n\n![Un gráfico](cosa/images/01.png)\n',
  );
  assert.equal(
    await page.locator('#missing-assets-notice').evaluate(el => el.classList.contains('hidden')),
    true,
  );
});

test('las imágenes pasadas a la carpeta se escriben al guardar', async (t) => {
  const { context, page } = await openApp({
    initStorage: () => {
      window.__webSaveCalls = [];
      const makeDirectory = (prefix = '') => ({
        getDirectoryHandle: async name => makeDirectory(`${prefix}${name}/`),
        getFileHandle: async name => ({
          createWritable: async () => ({
            write: async (contents) => {
              const value = contents instanceof Blob
                ? [...new Uint8Array(await contents.arrayBuffer())]
                : String(contents);
              window.__webSaveCalls.push(['write', `${prefix}${name}`, value]);
            },
            close: async () => {},
          }),
        }),
      });
      Object.defineProperty(window, 'showDirectoryPicker', {
        configurable: true,
        value: async () => makeDirectory(),
      });
    },
  });
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await documentoConImagenIncrustada(page);
  await nombrarDocumento(page, 'tema-3');
  await pasarPrimeraImagenIncrustadaALaCarpeta(page);
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('tema-3/images/01.png'));

  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.__webSaveCalls.some(call => call[1] === 'tema-3/images/01.png'));

  const llamadas = await page.evaluate(() => window.__webSaveCalls);
  const markdown = llamadas.find(call => String(call[1]).endsWith('.md'));
  assert.ok(!markdown[2].includes('base64,'), 'el Markdown guardado no debe llevar la imagen dentro');
  const imagen = llamadas.find(call => call[1] === 'tema-3/images/01.png');
  assert.deepEqual(imagen[2], [...PNG_PIXEL], 'la imagen escrita debe ser la original, byte a byte');
});

/*
  El primer guardado es justo donde el nombre siempre cambia: el documento llega
  al diálogo llamándose «Documento sin título» y sale con el que elija quien
  guarda. Su carpeta de imágenes tiene que seguirle en el mismo paso.
*/
test('al guardar por primera vez la carpeta propia toma el nombre elegido', async (t) => {
  const { context, page } = await openApp({
    initStorage: () => {
      window.__desktopFirstSaveCalls = [];
      window.__EDIMARK_TAURI__ = {
        dialog: { save: async () => '/destino/apuntes.md' },
        fs: {
          writeTextFile: async (path, contents) => {
            window.__desktopFirstSaveCalls.push(['text', path, contents]);
          },
          writeFile: async () => {},
        },
        app: {
          writeDocumentAsset: async (documentPath, relativePath, contents) => {
            window.__desktopFirstSaveCalls.push(['write-image', relativePath, [...contents]]);
          },
        },
      };
    },
  });
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await documentoConImagenIncrustada(page);
  await pasarPrimeraImagenIncrustadaALaCarpeta(page);
  // Sin nombre todavía: la carpeta se llama como la pestaña.
  await page.waitForFunction(() => document.getElementById('markdown-input').value.includes('/images/01.png'));
  assert.match(await page.locator('#markdown-input').inputValue(), /!\[Un gráfico\]\(Documento-sin-título\/images\/01\.png\)/);

  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.__desktopFirstSaveCalls.some(call => call[0] === 'write-image'));

  const calls = await page.evaluate(() => window.__desktopFirstSaveCalls);
  const escrito = calls.find(call => call[0] === 'text');
  assert.equal(escrito[1], '/destino/apuntes.md');
  assert.match(escrito[2], /!\[Un gráfico\]\(apuntes\/images\/01\.png\)/, 'la carpeta debe seguir al nombre elegido');
  assert.ok(calls.some(call => call[0] === 'write-image' && call[1] === 'apuntes/images/01.png'));
  // Y el editor se queda con lo que se ha guardado, no con el nombre viejo.
  assert.match(await page.locator('#markdown-input').inputValue(), /!\[Un gráfico\]\(apuntes\/images\/01\.png\)/);
});

/*
  El manual trae su propio logotipo, que no está en el disco de quien lo guarda
  sino junto a la aplicación: si no viaja con el `.md`, el archivo guardado
  enseña un hueco donde estaba la imagen.
*/
test('al guardar el manual se lleva consigo su imagen', async (t) => {
  const { context, page } = await openApp({
    initStorage: () => {
      window.__manualSaveCalls = [];
      window.__EDIMARK_TAURI__ = {
        dialog: { save: async () => '/destino/manual.md' },
        fs: {
          writeTextFile: async (path, contents) => {
            window.__manualSaveCalls.push(['text', path, contents]);
          },
          writeFile: async () => {},
        },
        app: {
          writeDocumentAsset: async (documentPath, relativePath, contents) => {
            window.__manualSaveCalls.push(['write-image', relativePath, contents.length]);
          },
        },
      };
    },
  });
  t.after(() => context.close());

  await page.keyboard.press('F1');
  await page.locator('#html-output h1').getByText('Manual de EdiMarkdown', { exact: true }).waitFor();
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => window.__manualSaveCalls.some(call => call[0] === 'write-image'));

  const calls = await page.evaluate(() => window.__manualSaveCalls);
  const imagen = calls.find(call => call[0] === 'write-image');
  assert.equal(imagen[1], 'logo_100px.png');
  assert.ok(imagen[2] > 0, 'la imagen guardada no puede ir vacía');
  const escrito = calls.find(call => call[0] === 'text');
  assert.match(escrito[2], /!\[Logotipo de EdiMarkdown\]\(logo_100px\.png\)/);
});

test('los esquemas preformateados se reducen para caber sin alterar el Markdown', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const linea = '┌' + '─'.repeat(92) + '┐';
  const markdown = `\`\`\`\n${linea}\n│ MAPA DEL ECOSISTEMA MARKDOWN${' '.repeat(63)}│\n${linea}\n\`\`\`\n`;
  await page.locator('#markdown-input').fill(markdown);
  const pre = page.locator('#html-output pre');
  await pre.waitFor();
  await page.waitForFunction(() => {
    const block = document.querySelector('#html-output pre');
    return block && Number.parseFloat(getComputedStyle(block).fontSize) < 14;
  });

  const medida = await pre.evaluate((block) => ({
    clientWidth: block.clientWidth,
    scrollWidth: block.scrollWidth,
    scale: Number.parseFloat(block.style.getPropertyValue('--edimark-pre-fit')),
  }));
  assert.ok(medida.scale < 1 && medida.scale >= 0.6);
  assert.ok(medida.scrollWidth <= medida.clientWidth + 1, 'el esquema todavía desborda la hoja');
  assert.equal(await page.locator('#markdown-input').inputValue(), markdown);
});

/*
  La hoja de la vista previa mide el papel de verdad, así que en un panel
  estrecho no cabía y la mesa se desplazaba a lo ancho. Con el panel atado a la
  lupa se encoge entera —y no estrechándola, que reordenaría el texto y
  perdería el reparto en páginas—, de modo que a cualquier anchura la página se
  ve completa y sin barra horizontal.
*/
test('la vista previa se ajusta al ancho del panel y no deja barra horizontal', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const medir = () => page.evaluate(() => {
    const desk = document.getElementById('preview-desk');
    const sheet = document.getElementById('html-output');
    return {
      barraHorizontal: desk.scrollWidth > desk.clientWidth,
      anchoMesa: desk.clientWidth,
      anchoContenidoMesa: desk.scrollWidth,
      zoom: Number(getComputedStyle(document.documentElement).getPropertyValue('--preview-zoom')) || 1,
      etiqueta: document.getElementById('preview-zoom-value').textContent,
      hoja: Math.round(sheet.getBoundingClientRect().width),
      paginas: document.querySelectorAll('#page-sheets .page-sheet').length,
    };
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  // El formato del documento es quien le da a la hoja el ancho del papel.
  await page.evaluate(() => window.__applyDocumentFormatToPreview());
  await page.waitForFunction(() => document.querySelectorAll('#page-sheets .page-sheet').length > 0);

  const ancha = await medir();
  assert.equal(ancha.barraHorizontal, false);
  assert.ok(ancha.zoom >= 1, 'con sitio de sobra la hoja llega al menos a tamaño real');
  assert.ok(ancha.paginas > 0, 'la hoja al ancho del papel va repartida en páginas');

  // Un portátil estrecho: la hoja ya no cabe a tamaño real y la lupa lo resuelve.
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.waitForFunction(() => (
    (Number(getComputedStyle(document.documentElement).getPropertyValue('--preview-zoom')) || 1) < 1
  ));
  const estrecha = await medir();
  assert.equal(estrecha.barraHorizontal, false);
  assert.ok(estrecha.zoom < 1, 'la hoja se encoge para caber');
  assert.ok(estrecha.paginas > 0, 'encogerla entera conserva el reparto en páginas');
  assert.match(estrecha.etiqueta, /^\d+ ?%$/);

  /*
    Soltar el interruptor devuelve la lupa a su tamaño real y con ella la
    barra: es la vía para ampliar más allá de lo que cabe. Los controles de la
    vista previa solo se enseñan mientras se trabaja en ella, así que antes hay
    que pasar a ese panel.
  */
  assert.equal(await page.locator('#preview-zoom-reset').getAttribute('data-ajuste'), 'true');
  await page.locator('#html-output').click();
  await page.locator('#preview-link-toggle').waitFor({ state: 'visible' });
  await page.locator('#preview-link-toggle').click();
  await page.locator('#preview-zoom-reset').click();
  const real = await medir();
  assert.equal(real.zoom, 1);
  assert.equal(real.barraHorizontal, true, 'a tamaño real la hoja no cabe: la barra vuelve');
  assert.equal(await page.locator('#preview-zoom-reset').getAttribute('data-ajuste'), 'false');

  // Y volver a atarlo la encaja otra vez, sin tocar nada más.
  await page.locator('#preview-link-toggle').click();
  await page.waitForFunction(() => (
    (Number(getComputedStyle(document.documentElement).getPropertyValue('--preview-zoom')) || 1) < 1
  ));
  // Firefox actualiza el ancho desplazable un fotograma después que la
  // variable de zoom; esperar solo esta última hacía intermitente la prueba.
  await page.waitForFunction(() => {
    const desk = document.getElementById('preview-desk');
    return desk && desk.scrollWidth <= desk.clientWidth;
  });
  const vueltaAtada = await medir();
  assert.equal(vueltaAtada.barraHorizontal, false, JSON.stringify(vueltaAtada));
  assert.equal(await page.locator('#preview-zoom-reset').getAttribute('data-ajuste'), 'true');

  /*
    Con la vista previa sola no hay nada que atar —ningún panel le disputa el
    ancho—, así que el interruptor se retira y la lupa se queda donde estaba;
    al volver a los dos paneles vuelve a mandar el ajuste.
  */
  const antesDeAislarla = (await medir()).zoom;
  await page.locator('#layout-switch [data-layout="html"]').click();
  await page.waitForTimeout(600);
  const aislada = await medir();
  assert.equal(aislada.zoom, antesDeAislarla, 'la lupa se movió sin que nadie se lo pidiera');
  assert.equal(aislada.barraHorizontal, false);
  assert.equal(await page.locator('#preview-link-toggle').isVisible(), false);

  await page.locator('#layout-switch [data-layout="dual"]').click();
  await page.waitForTimeout(600);
  assert.equal((await medir()).barraHorizontal, false);
  assert.equal(await page.locator('#preview-link-toggle').isVisible(), true);
});

/*
  La aplicación abre expandida: en la columna centrada de 1280 px no caben el
  editor y una hoja A4 a tamaño real, que es lo que se viene a ver. Quien
  prefiera la columna lo dice una vez con el botón y se recuerda.
*/
test('la aplicación abre expandida y recuerda si se contrae', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  const expandida = () => page.locator('#main-container').evaluate(el => el.classList.contains('is-expanded'));
  assert.equal(await expandida(), true);

  await page.locator('#toggle-width-btn').click();
  assert.equal(await expandida(), false);

  await page.reload();
  await page.waitForFunction(() => window.__edimarkReady === true);
  assert.equal(await expandida(), false, 'la columna centrada elegida no sobrevivió a la recarga');

  await page.locator('#toggle-width-btn').click();
  await page.reload();
  await page.waitForFunction(() => window.__edimarkReady === true);
  assert.equal(await expandida(), true);
});

/*
  El panel y la lupa, atados en los dos sentidos: subir el aumento aparta el
  separador para que la hoja siga entera, y moverlo recalcula el aumento. La
  atadura se para donde el editor de Markdown se quedaría sin su ancho mínimo:
  la promesa es que la página se ve completa, y para ir más allá se suelta.
*/
test('la lupa y el separador van atados en los dos sentidos', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.evaluate(() => window.__applyDocumentFormatToPreview());
  await page.waitForFunction(() => document.querySelectorAll('#page-sheets .page-sheet').length > 0);

  const medir = () => page.evaluate(() => {
    const desk = document.getElementById('preview-desk');
    return {
      md: document.getElementById('markdown-panel').offsetWidth,
      barraHorizontal: desk.scrollWidth > desk.clientWidth,
      zoom: Number(getComputedStyle(document.documentElement).getPropertyValue('--preview-zoom')) || 1,
      paginas: document.querySelectorAll('#page-sheets .page-sheet').length,
    };
  });

  await page.locator('#html-output').click();
  const partida = await medir();
  assert.ok(partida.zoom >= 1);
  assert.equal(await page.locator('#preview-link-toggle').getAttribute('aria-pressed'), 'true');

  // Ampliar aparta el separador: el editor de Markdown cede ancho.
  const antesDeAmpliar = partida.zoom;
  await page.locator('#preview-zoom-in').click();
  await page.waitForFunction((previo) => (
    (Number(getComputedStyle(document.documentElement).getPropertyValue('--preview-zoom')) || 1) > previo
  ), antesDeAmpliar);
  const ampliado = await medir();
  assert.ok(ampliado.zoom > antesDeAmpliar);
  assert.ok(ampliado.md < partida.md, 'el separador no se apartó al ampliar');
  assert.equal(ampliado.barraHorizontal, false);
  assert.ok(ampliado.paginas > 0);

  /*
    Y sigue ampliando hasta donde cabe, no más: al llegar ahí el `+` se apaga,
    que es lo que dice que el ancho se ha acabado.
  */
  const mas = page.locator('#preview-zoom-in');
  for (let i = 0; i < 8 && await mas.getAttribute('aria-disabled') !== 'true'; i += 1) {
    await mas.click();
    await page.waitForTimeout(120);
  }
  assert.equal(await mas.getAttribute('aria-disabled'), 'true', 'el + nunca dijo que se había acabado el ancho');
  const tope = await medir();
  assert.equal(tope.barraHorizontal, false, 'la lupa pasó de lo que cabe en el panel');
  assert.ok(tope.md >= 280, 'el editor de Markdown se quedó sin su ancho mínimo');

  // Mover el separador recalcula el aumento, que es el otro sentido.
  await page.evaluate(() => {
    const md = document.getElementById('markdown-panel');
    const hp = document.getElementById('html-panel');
    const total = md.offsetWidth + hp.offsetWidth;
    md.style.width = `${Math.round(total * 0.7)}px`;
    hp.style.width = `${Math.round(total * 0.3)}px`;
  });
  await page.waitForFunction(() => (
    (Number(getComputedStyle(document.documentElement).getPropertyValue('--preview-zoom')) || 1) < 1
  ));
  const estrechado = await medir();
  assert.equal(estrechado.barraHorizontal, false);
  assert.ok(estrechado.paginas > 0, 'encogerla entera conserva el reparto en páginas');
  assert.equal(await page.locator('#preview-zoom-reset').getAttribute('data-ajuste'), 'true');
});

/*
  La atadura es cosa de los dos paneles uno al lado del otro, que es donde el
  ancho de uno se lo quita al otro. Con un solo panel a la vista nadie le
  disputa el ancho a la hoja, y en una pantalla estrecha los paneles van uno
  encima del otro y no hay separador que mover: en los dos casos el interruptor
  se retira y la lupa vuelve a ser libre.
*/
test('la atadura solo existe con los dos paneles uno al lado del otro', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.setViewportSize({ width: 1500, height: 900 });
  await page.evaluate(() => window.__applyDocumentFormatToPreview());
  const interruptor = page.locator('#preview-link-toggle');
  assert.equal(await interruptor.isVisible(), true);

  // Con la vista previa sola: sin interruptor, y la lupa se mueve y se queda.
  await page.locator('#layout-switch [data-layout="html"]').click();
  await page.waitForTimeout(500);
  assert.equal(await interruptor.isVisible(), false);

  await page.locator('#preview-zoom-out').click();
  const bajado = await page.locator('#preview-zoom-value').innerText();
  await page.waitForTimeout(500);
  assert.equal(
    await page.locator('#preview-zoom-value').innerText(),
    bajado,
    'la lupa volvió sola a llenar el panel sin nadie con quien repartirlo',
  );

  // Y en una pantalla de móvil, donde los paneles se apilan, tampoco está.
  await page.locator('#layout-switch [data-layout="dual"]').click();
  await page.waitForTimeout(500);
  assert.equal(await interruptor.isVisible(), true);
  await page.setViewportSize({ width: 420, height: 800 });
  await page.waitForTimeout(600);
  assert.equal(await interruptor.isVisible(), false);
});

/*
  Lo que se le manda al cuadro de impresión del sistema: los márgenes y el
  papel ya resueltos. En Linux es la única vía —allí el motor no hace caso a
  `@page`— y Rust se los pone al cuadro antes de abrirlo.
*/
test('la impresión lleva consigo los márgenes y el papel del documento', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill('---\npapersize: "letter"\nmargin-top: "4"\nmargin-left: "3.5"\n---\n\nTexto\n');
  await page.waitForFunction(
    () => (window.__paginaParaImprimir?.().marginTop ?? null) === 4,
  );

  // Los lados que el documento no fija llevan los 18 mm de la hoja de
  // impresión, para que el papel salga igual en los tres sistemas.
  assert.deepEqual(await page.evaluate(() => window.__paginaParaImprimir()), {
    marginTop: 4,
    marginRight: 1.8,
    marginBottom: 1.8,
    marginLeft: 3.5,
    paperSize: 'letter',
    orientation: 'portrait',
  });
});


test('sin serifa se aplica a enlaces y fórmulas y conserva el TeX al copiar y cambiar de fuente', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  await page.locator('#new-tab-btn').click();
  const body = String.raw`Texto [enlace](https://example.org) y $x^2 + \frac{a}{b} + \mathbb{R}$.

$$y = \sqrt{x}$$`;
  await page.locator('#markdown-input').fill('---\nfont: sans\n---\n\n' + body);
  await page.waitForFunction(() => document.querySelectorAll('#html-output .katex .mathsf').length > 0);
  const fonts = await page.locator('#html-output').evaluate(el => ({
    body: getComputedStyle(el).fontFamily,
    link: getComputedStyle(el.querySelector('a')).fontFamily,
    math: getComputedStyle(el.querySelector('.mathsf')).fontFamily,
    original: [...el.querySelectorAll('annotation')].map(n => n.textContent),
  }));
  assert.equal(fonts.link, fonts.body);
  assert.match(fonts.math, /KaTeX_SansSerif/);
  assert.ok(fonts.original.every(tex => !tex.includes('\\mathsf')));
  assert.equal(await page.locator('#html-output .mathbb').count(), 1);
  const copied = await page.evaluate(() => buildHtmlWithTex());
  assert.ok(!copied.includes('\\mathsf'));
  assert.ok(copied.includes('\\mathbb{R}'));
  await page.emulateMedia({ media: 'print' });
  assert.match(await page.locator('#html-output .mathsf').first().evaluate(el => getComputedStyle(el).fontFamily), /KaTeX_SansSerif/);
  await page.emulateMedia({ media: 'screen' });
  await page.locator('#markdown-input').fill('---\nfont: serif\n---\n\n' + body);
  await page.waitForFunction(() => document.querySelectorAll('#html-output .katex .mathsf').length === 0);
  assert.equal(await page.locator('#html-output .katex').count(), 2);
});


test('una actualización temprana del idioma no bloquea el editor al arrancar', async (t) => {
  const { context, page } = await openApp({
    initStorage: () => {
      document.addEventListener('DOMContentLoaded', () => {
        window.__earlyPreviewCheck = {
          editorMissing: typeof markdownEditor === 'undefined',
          called: typeof updateHtml === 'function',
        };
        try {
          updateHtml();
          window.__earlyPreviewCheck.updating = isUpdating;
        } catch (error) {
          window.__earlyPreviewCheck.error = error.message;
        }
      }, { once: true });
    },
  });
  t.after(() => context.close());
  assert.deepEqual(await page.evaluate(() => window.__earlyPreviewCheck), {
    editorMissing: true, called: true, updating: false,
  });
  await page.locator('#new-tab-btn').click();
  await page.locator('#markdown-input').fill('# El editor sigue funcionando');
  await page.waitForFunction(() => document.querySelector('#html-output h1')?.textContent === 'El editor sigue funcionando');
});

test('Las imágenes sin documento no se quedan ocupando sitio', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  /*
    Las pestañas cerradas guardan sus imágenes por si vuelven, pero ese
    registro vive en memoria: al cerrar la aplicación se pierde y las imágenes
    se quedaban sin dueño. Unas cuantas importaciones de prueba dejaron así
    101 MB en la base de datos.

    La propia aplicación hace esta limpieza al arrancar, en un rato ocioso y
    después de declararse lista. Hay que esperarla: si llega mientras se
    preparan las imágenes de la prueba, se lleva las huérfanas antes de que se
    cuenten, y en Firefox eso pasaba una vez de cada pocas.
  */
  await page.evaluate(() => window.__edimarkAssetPurge);
  const antes = await page.evaluate(async () => {
    const doc = docs.find(d => d.id === currentId);
    await replacePersistedDocumentAssets('documento-que-ya-no-existe', [
      { relativePath: 'viejo/images/01.png', contents: new Blob([new Uint8Array(64)]) },
      { relativePath: 'viejo/images/02.png', contents: new Blob([new Uint8Array(64)]) },
    ]);
    await replacePersistedDocumentAssets(doc.id, [
      { relativePath: 'vivo/images/01.png', contents: new Blob([new Uint8Array(64)]) },
    ]);
    return {
      huerfanas: (await readPersistedDocumentAssets('documento-que-ya-no-existe')).length,
      vivas: (await readPersistedDocumentAssets(doc.id)).length,
    };
  });
  assert.deepEqual(antes, { huerfanas: 2, vivas: 1 });

  const despues = await page.evaluate(async () => {
    const doc = docs.find(d => d.id === currentId);
    const borradas = await purgeOrphanDocumentAssets(new Set(docs.map(d => d.id)));
    return {
      borradas,
      huerfanas: (await readPersistedDocumentAssets('documento-que-ya-no-existe')).length,
      vivas: (await readPersistedDocumentAssets(doc.id)).length,
    };
  });
  // Las del documento abierto siguen ahí; las del que ya no existe, no.
  assert.deepEqual(despues, { borradas: 2, huerfanas: 0, vivas: 1 });
});

/*
  La cortina del arranque. Componer la hoja toma el hilo de una vez: mientras
  dura no se repinta ni se atiende un clic, así que el botón de salir prometía
  una salida que no existía. Un documento largo ya no se compone al abrir.
*/
// Estas funciones viajan al navegador serializadas y se ejecutan allí, así que
// no pueden llamar a nada de aquí ni leer ninguna variable de fuera: cada una
// se basta sola.
const sesionLarga = () => {
  try {
    const relleno = 'La fotosíntesis convierte la luz en energía química. '.repeat(4000);
    localStorage.setItem('edimarkweb-docslist', JSON.stringify([{ id: 'doc-largo', name: 'largo.md' }]));
    localStorage.setItem('edimarkweb-active-doc', 'doc-largo');
    localStorage.setItem('edimarkweb-autosave-doc-largo', `# Documento largo\n\n${relleno}`);
    localStorage.removeItem('edimarkweb-hoja-rapida');
  } catch (_error) {
    // El script corre también para el documento opaco inicial.
  }
};

const sesionCorriente = () => {
  try {
    const relleno = 'La fotosíntesis convierte la luz en energía química. '.repeat(90);
    localStorage.setItem('edimarkweb-docslist', JSON.stringify([{ id: 'doc-largo', name: 'largo.md' }]));
    localStorage.setItem('edimarkweb-active-doc', 'doc-largo');
    localStorage.setItem('edimarkweb-autosave-doc-largo', `# Documento corriente\n\n${relleno}`);
    localStorage.removeItem('edimarkweb-hoja-rapida');
  } catch (_error) {
    // El script corre también para el documento opaco inicial.
  }
};

test('La ayuda lleva al artículo del blog', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.click('#help-menu-btn');
  const enlaces = await page.evaluate(() => ({
    menu: document.getElementById('help-article-link')?.getAttribute('href'),
    menuDestino: document.getElementById('help-article-link')?.getAttribute('target'),
    acercaDe: document.getElementById('about-article-link')?.getAttribute('href'),
  }));
  // El manual cuenta cómo se hace cada cosa; el artículo, para qué sirve.
  const articulo = 'https://educacion.bilateria.org/edimarkweb-escribir-en-markdown-y-entregar-en-cualquier-formato';
  assert.equal(enlaces.menu, articulo);
  assert.equal(enlaces.menuDestino, '_blank');
  assert.equal(enlaces.acercaDe, articulo);
});

test('Un documento largo no se compone al arrancar y la ventana sigue viva', async (t) => {
  const { context, page } = await openApp({ initStorage: sesionLarga });
  t.after(() => context.close());

  await page.waitForFunction(() => window.__edimarkReady === true, null, { timeout: 60000 });
  const estado = await page.evaluate(() => ({
    aviso: Boolean(document.querySelector('[data-edimark-on-demand]')),
    boton: Boolean(document.querySelector('.preview-on-demand-btn')),
    texto: document.getElementById('markdown-input')?.value.length,
    salidaOculta: document.getElementById('app-loading-cancel')?.hasAttribute('hidden'),
  }));
  // El texto está, la hoja espera a que la pidan y la salida no se retiró,
  // porque en este camino nada toma el hilo.
  assert.equal(estado.aviso, true);
  assert.equal(estado.boton, true);
  assert.ok(estado.texto > 100000, `el documento no se restauró: ${estado.texto}`);
  assert.equal(estado.salidaOculta, false);

  // Y se compone cuando se pulsa.
  await page.click('.preview-on-demand-btn');
  await page.waitForFunction(() => !document.querySelector('[data-edimark-on-demand]'), null, { timeout: 60000 });
  assert.ok(await page.locator('#html-output p').count() > 0);
});

test('Con un documento corriente la hoja se compone y la salida se retira', async (t) => {
  const { context, page } = await openApp({ initStorage: sesionCorriente });
  t.after(() => context.close());

  await page.waitForFunction(() => window.__edimarkReady === true, null, { timeout: 60000 });
  const estado = await page.evaluate(() => ({
    aviso: Boolean(document.querySelector('[data-edimark-on-demand]')),
    parrafos: document.querySelectorAll('#html-output p').length,
    salidaOculta: document.getElementById('app-loading-cancel')?.hasAttribute('hidden'),
  }));
  assert.equal(estado.aviso, false);
  assert.ok(estado.parrafos > 0, 'la hoja no se compuso');
  // Durante ese tramo el hilo está tomado: el botón se va antes de empezar.
  assert.equal(estado.salidaOculta, true);
});

test('Las imágenes se convierten en bloque y llevan al texto', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAJklEQVQoz2NgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYqgAABz0AAeHkQ+0AAAAASUVORK5CYII=';
  await page.evaluate(([png]) => {
    markdownEditor.setValue([
      '# Imágenes de los dos tipos', '',
      'Un párrafo antes, para que haya texto por encima.', '',
      `![Incrustada](${png})`, '',
      `![Otra incrustada](${png})`, '',
      '![Enlazada](logo_100px.png)', '',
      'Y el cierre.', '',
    ].join('\n'));
  }, [PNG]);
  await page.waitForFunction(() => currentBase64State?.placeholders?.size === 2 && currentLinkedImages?.size === 1);
  await page.click('#base64-hidden-toggle');
  await page.waitForSelector('.base64-hidden-item');

  // Cada conversión en bloque se ofrece solo mientras queda algo que convertir.
  const visibles = () => page.evaluate(() => ({
    extraer: !document.getElementById('base64-extract-btn').hidden,
    incrustar: !document.getElementById('linked-embed-all-btn').hidden,
  }));
  assert.deepEqual(await visibles(), { extraer: true, incrustar: true });

  // La acción individual toca solo su línea. Al quedar una sola incrustada,
  // la acción general desaparece porque ya sería un duplicado.
  await page.locator('.base64-hidden-item').filter({ hasText: 'Otra incrustada' })
    .getByRole('button', { name: 'Pasar a la carpeta' }).click();
  await page.waitForFunction(() => currentBase64State?.placeholders?.size === 1);
  const trasIndividual = await page.evaluate(() => markdownEditor.getValue());
  assert.equal((trasIndividual.match(/data:image\/png;base64,/g) || []).length, 1);
  assert.match(trasIndividual, /!\[Otra incrustada\]\([^/)]+\/images\/01\.png\)/);
  assert.deepEqual(await visibles(), { extraer: false, incrustar: true });

  // Ir al texto deja seleccionado el fragmento de esa imagen, y de la
  // incrustada lo que se selecciona es su marcador, que es lo que se ve.
  const seleccionTras = async nombre => page.evaluate((titulo) => {
    const item = [...document.querySelectorAll('.base64-hidden-item')]
      .find(candidato => candidato.querySelector('h4')?.textContent === titulo);
    [...item.querySelectorAll('.base64-hidden-btn')]
      .find(boton => boton.getAttribute('aria-label') === 'Ir al texto').click();
    const area = document.getElementById('markdown-input');
    return area.value.slice(area.selectionStart, area.selectionEnd);
  }, nombre);
  assert.equal(await seleccionTras('Enlazada'), '![Enlazada](logo_100px.png)');
  assert.match(await seleccionTras('Incrustada'), /^__EDIMARK_B64_\d+__$/);

  await page.click('#linked-embed-all-btn');
  await page.waitForFunction(() => currentLinkedImages?.size === 0);
  const texto = await page.evaluate(() => markdownEditor.getValue());
  assert.ok(!texto.includes('(logo_100px.png)'), 'la enlazada sigue enlazada');
  assert.equal((texto.match(/data:image\/png;base64,/g) || []).length, 3);
  // Ya no queda ninguna enlazada y vuelven a ser dos incrustadas.
  assert.deepEqual(await visibles(), { extraer: true, incrustar: false });
});

test('El cuadro de Almacenamiento cuenta lo guardado y borra lo que sobra', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  /*
    Hasta la 2.54.0 lo único que vaciaba la base era el barrido del arranque y
    la salida de emergencia de la cortina, que solo aparece cuando la carga ya
    va lenta. Aquí se ve lo que ocupa y se borra cuando se quiera.
  */
  await page.evaluate(async () => {
    const doc = docs.find(d => d.id === currentId);
    await replacePersistedDocumentAssets(doc.id, [
      { relativePath: 'vivo/images/01.png', contents: new Blob([new Uint8Array(2048)]) },
    ]);
    await replacePersistedDocumentAssets('documento-que-ya-no-existe', [
      { relativePath: 'viejo/images/01.png', contents: new Blob([new Uint8Array(4096)]) },
    ]);
  });

  await page.click('#settings-menu-btn');
  await page.click('#storage-settings-btn');
  await page.waitForFunction(() => document.getElementById('storage-orphans')?.textContent.includes('·'));
  const leido = await page.evaluate(() => ({
    documentos: document.getElementById('storage-documents').textContent,
    imagenes: document.getElementById('storage-images').textContent,
    huerfanas: document.getElementById('storage-orphans').textContent,
  }));
  assert.equal(leido.documentos, '1');
  assert.match(leido.imagenes, /^1 · /);
  assert.match(leido.huerfanas, /^1 · /);

  await page.click('#storage-purge-btn');
  // El botón se apaga al empezar a borrar, así que esperar a eso es esperar a
  // la mitad: lo que dice que ha terminado es el mensaje, que deja de tener
  // puntos suspensivos.
  await page.waitForFunction(() => {
    const mensaje = document.getElementById('storage-modal-status')?.textContent || '';
    return mensaje && !mensaje.includes('…');
  });
  const tras = await page.evaluate(async () => ({
    estado: document.getElementById('storage-modal-status').textContent,
    huerfanas: (await readPersistedDocumentAssets('documento-que-ya-no-existe')).length,
    vivas: (await readPersistedDocumentAssets(currentId)).length,
  }));
  // Se va lo que no tiene dueño y se queda lo del documento abierto.
  assert.match(tras.estado, /1/);
  assert.equal(tras.huerfanas, 0);
  assert.equal(tras.vivas, 1);

  // La pregunta de olvidar la sesión se hace dentro del cuadro, no con un
  // `confirm` del navegador, que en la ventana de la aplicación llega apagado.
  assert.equal(await page.evaluate(() => document.getElementById('storage-forget-confirm').hidden), true);
  await page.click('#storage-forget-btn');
  assert.equal(await page.evaluate(() => document.getElementById('storage-forget-confirm').hidden), false);
  await page.click('#storage-forget-no');
  assert.equal(await page.evaluate(() => document.getElementById('storage-forget-confirm').hidden), true);
});

test('el diálogo PDF guía convertir, importar y volver a convertir tras un cambio', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.evaluate(async () => {
    window.Worker = class FakePdfWorker {
      postMessage(message) {
        if (message.operation === 'inspect') {
          queueMicrotask(() => {
            this.onmessage?.({ data: { type: 'info', result: { pages: 1 } } });
            this.onmessage?.({ data: { type: 'scanned', result: { scanned: 0, scannedPages: [], pages: 1 } } });
          });
          return;
        }
        if (message.operation === 'convert') {
          setTimeout(() => this.onmessage?.({ data: {
            type: 'result',
            result: { markdown: '# Documento convertido', pages: 1, textPages: 1, ocrPages: [] },
          } }), 80);
        }
      }
      terminate() {}
    };
    const { importPdf } = await import('./pdf-import.js?test=pdf-action-order');
    window.__pdfActionOrder = importPdf(
      new File(['pdf'], 'orden.pdf', { type: 'application/pdf' }),
      key => key,
    );
  });

  await page.waitForFunction(() => document.querySelector('.pdf-import-dialog')?.getAttribute('aria-busy') === 'false');
  const esPrincipal = selector => page.locator(selector)
    .evaluate(button => button.classList.contains('pdf-primary-action'));
  assert.equal(await page.locator('#pdf-cancel').isDisabled(), false);
  assert.equal(await page.locator('#pdf-preview').isDisabled(), false);
  assert.equal(await page.locator('#pdf-accept').isDisabled(), true);
  assert.equal(await esPrincipal('#pdf-preview'), true);
  assert.equal(await esPrincipal('#pdf-accept'), false);

  await page.locator('#pdf-preview').click();
  assert.equal(await page.locator('#pdf-cancel').isDisabled(), false);
  assert.equal(await page.locator('#pdf-preview').isDisabled(), true);
  assert.equal(await page.locator('#pdf-accept').isDisabled(), true);
  assert.equal(await esPrincipal('#pdf-preview'), true);
  await page.waitForFunction(() => document.querySelector('.pdf-import-dialog')?.getAttribute('aria-busy') === 'false');
  assert.equal(await page.locator('#pdf-preview').isDisabled(), true);
  assert.equal(await page.locator('#pdf-accept').isDisabled(), false);
  assert.equal(await esPrincipal('#pdf-preview'), false);
  assert.equal(await esPrincipal('#pdf-accept'), true);

  await page.locator('#pdf-pages').fill('1');
  assert.equal(await page.locator('#pdf-cancel').isDisabled(), false);
  assert.equal(await page.locator('#pdf-preview').isDisabled(), false);
  assert.equal(await page.locator('#pdf-accept').isDisabled(), true);
  assert.equal(await esPrincipal('#pdf-preview'), true);
  assert.equal(await esPrincipal('#pdf-accept'), false);
  await page.locator('#pdf-cancel').click();
  await page.waitForFunction(() => !document.querySelector('.pdf-import-dialog'));
});

/*
  La prueba abre el diálogo cuatro veces y cada una arranca el motor de nuevo.
  El Firefox de Playwright tarda en ello unos 47 s en algunos equipos (un
  Firefox normal, 10 s; Chromium, 9 s), y la prueba entera llegaba a 207 s.
*/
test('PDF real: opciones, columnas, tablas, imágenes y cancelación sin modificar documentos', { timeout: 300000 }, async (t) => {
  const { context, page, requests } = await openApp();
  t.after(() => context.close());
  const initial = await page.evaluate(() => markdownEditor.getValue());
  const fixture = resolve(defaultRepoRoot, 'test/fixtures/pdf-import.pdf');
  const avance = [];
  await page.exposeFunction('anotarAvance', paso => avance.push(paso));
  await page.evaluate(() => {
    new MutationObserver(() => {
      const bar = document.querySelector('#pdf-import-progress');
      if (!bar || bar.hidden) return;
      window.anotarAvance(bar.getAttribute('aria-valuenow') || '');
      window.anotarAvance(document.querySelector('#pdf-import-status')?.textContent || '');
    }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  });
  await page.locator('#import-file-input').setInputFiles(fixture);
  await page.locator('.pdf-import-dialog').waitFor();
  assert.equal(await page.locator('#pdf-cancel').isDisabled(), false);
  await page.waitForFunction(
    () => document.querySelector('#pdf-import-info')?.textContent.includes('13'),
    null,
    { timeout: 120000 },
  );
  assert.match(await page.locator('#pdf-import-info').innerText(), /13/);
  // Ya no hay tope de páginas que anunciar, ni por qué avisar de la espera:
  // trece páginas se convierten en un momento.
  assert.doesNotMatch(await page.locator('#pdf-import-info').innerText(), /200/);
  assert.doesNotMatch(await page.locator('#pdf-import-info').innerText(), /varios minutos/);
  // Y en un documento sin una sola página escaneada, el OCR no se ofrece.
  await page.waitForFunction(
    () => document.querySelector('.pdf-import-dialog')?.dataset.scanned === '0',
    null,
    { timeout: 120000 },
  );
  assert.equal(await page.locator('.pdf-ocr-option').isHidden(), true);
  assert.doesNotMatch(await page.locator('#pdf-import-info').innerText(), /escaneadas/);
  assert.equal(await page.locator('#pdf-preview').isDisabled(), false);
  assert.equal(await page.locator('#pdf-preview').evaluate(button => button.classList.contains('pdf-primary-action')), true);
  assert.equal(await page.locator('#pdf-accept').evaluate(button => button.classList.contains('pdf-primary-action')), false);
  await page.locator('#pdf-preview').click();
  assert.equal(await page.locator('#pdf-cancel').isDisabled(), false);
  await page.waitForFunction(() => document.querySelector('.pdf-import-dialog').getAttribute('aria-busy') === 'false', null, { timeout: 120000 });
  assert.equal(await page.locator('#pdf-accept').isDisabled(), false, await page.locator('#pdf-import-status').innerText());
  assert.equal(await page.locator('#pdf-preview').isDisabled(), true);
  assert.equal(await page.locator('#pdf-preview').evaluate(button => button.classList.contains('pdf-primary-action')), false);
  assert.equal(await page.locator('#pdf-accept').evaluate(button => button.classList.contains('pdf-primary-action')), true);
  /*
    Convertir un PDF largo lleva minutos: sin señal de avance el diálogo se
    confunde con uno colgado, así que la barra tiene que haber contado páginas
    y desaparecer al terminar.
  */
  assert.ok(avance.some(paso => /\b1 (de|of|\/) 13\b|1 de 13/.test(paso)), avance.join(' | '));
  assert.ok(avance.includes('100'), avance.join(' | '));
  assert.equal(await page.locator('#pdf-import-progress').isHidden(), true);
  const preview = page.frameLocator('#pdf-import-preview');
  const text = await preview.locator('body').innerText();
  assert.ok(!text.includes('REPEATED HEADER'));
  assert.ok(!text.includes('REPEATED FOOTER'));
  assert.ok(text.indexOf('LEFT END') < text.indexOf('RIGHT START'));
  /*
    Tres tablas: la segunda lleva un símbolo matemático en una celda y aun así
    debe llegar como tabla, no rasterizada junto al resto de la fórmula; la
    tercera está dibujada como la imprime un navegador —bordes de celda sin una
    sola línea vertical—, que es lo que se recibe al reimportar un PDF salido de
    la propia aplicación; y la cuarta lleva reglas de ancho completo sin ningún
    borde de columna, al estilo de LaTeX.
  */
  assert.ok(await preview.locator('table').count() >= 8, text);
  assert.match(text, /Total/);
  /*
    En esa misma tabla, el símbolo y el número de la última celda están a la
    misma altura pero llegan de MuPDF como dos líneas, igual que los trozos de
    una fila en una tabla guardada desde una página web. El extractor ponía un
    salto entre ellas: «6 × 0 = 0» salía en tres líneas.
  */
  assert.equal(
    (await preview.locator('table', { hasText: 'Variable' }).locator('tr', { hasText: 'y' }).locator('td').nth(1).innerText()).trim(),
    '= 24',
  );
  assert.match(text, /Negrita/);
  assert.match(text, /Uvas/);
  /*
    Y dos tablas más, que son los casos negativos del descarte de rejillas
    decorativas: un horario de paso uniforme en los dos ejes —lo más parecido
    a una rejilla que hay entre las tablas de verdad— y una tabla ancha que
    casi cubre la hoja. Descartar por tamaño era la regla que daba falsos
    positivos, así que ninguna de las dos puede perderse.
  */
  assert.match(text, /Miercoles/);
  assert.match(text, /C5F7/);
  /*
    La página de rejilla decorativa es el caso contrario: reglas sangradas
    hasta el borde del papel y pintadas por debajo del texto. PyMuPDF las lee
    como una tabla que ocupa la hoja entera y MuPDF tacha cuanto cruzan, así
    que el párrafo tiene que llegar entero, fuera de toda celda y sin tachar.
  */
  assert.match(text, /REJILLA DECORATIVA/);
  /*
    Y las dos tablas sin título de columna. Markdown no tiene tabla sin
    cabecera, así que el conversor asciende la primera fila y bautiza «Col2»
    cada celda que encuentra vacía: en un formulario eso le cuesta su fila a la
    primera etiqueta y mete en el documento una palabra que nunca tuvo. La
    tabla de doble entrada es el caso contrario, y distinguirlas es el motivo
    de que las dos estén aquí: su primera fila sí titula las columnas, aunque
    la esquina esté vacía, y tiene que seguir siendo la cabecera.
  */
  assert.doesNotMatch(text, /\bCol[12]\b/, text);
  const formulario = preview.locator('table', { hasText: 'Asignatura' });
  assert.equal((await formulario.locator('thead').innerText()).trim(), '');
  assert.deepEqual(
    await formulario.locator('tbody tr td:first-child').allInnerTexts(),
    ['Titulo', 'Curso', 'Asignatura'],
  );
  const dobleEntrada = preview.locator('table', { hasText: 'Ambito' });
  assert.deepEqual(await dobleEntrada.locator('thead th').allInnerTexts(), ['', 'Saber', 'Ambito']);
  assert.deepEqual(await dobleEntrada.locator('tbody tr td:first-child').allInnerTexts(), ['1', '2']);

  /*
    Y las notas al pie, que son dos mitades confirmándose entre sí: el número
    en superíndice arriba y la línea en cuerpo menor que empieza por ese mismo
    número abajo. Donde solo hay una de las dos no se toca nada, y por eso la
    página lleva un exponente, «m²», cuyo número no tiene nota: tiene que
    seguir siendo un exponente y no convertirse en llamada.

    Las tres llamadas están además donde el conversor las perdía: una en el
    cuerpo, otra en la fila de cabecera de una tabla, y la tercera en el
    título, que se escribe con el texto plano de su línea y se deja el estilo.
  */
  const notas = preview.locator('[data-edimark-footnotes] li');
  assert.deepEqual(
    (await notas.allInnerTexts()).map(nota => nota.replace(/[↩\s]+$/, '')),
    [
      'La marca que va en el titulo de la pagina.',
      'Medida tomada en el curso anterior.',
      'Agrupacion de materias que se imparten juntas.',
    ],
    text,
  );
  assert.equal(await preview.locator('sup.footnote-reference').count(), 3, text);
  assert.match(text, /se mide en m\s*2 y no cambia/);
  assert.doesNotMatch(text, /aula20|Materia21|pie22/, text);

  /*
    Una tabla enmarcada celda a celda, con filas altas y un título justo encima
    del marco. restore_table_grid está para redibujar las verticales que le
    faltan a una tabla impresa; a esta no le falta ninguna, y restaurarla
    igualmente estiraba la primera fila hasta el título y lo cortaba por las
    columnas: «T | abla enmarcada».
  */
  assert.match(text, /Tabla enmarcada/);
  assert.equal(await preview.locator('table', { hasText: 'enmarcada' }).count(), 0, text);
  assert.equal(await preview.locator('table', { hasText: 'Tabla del 7' }).locator('tr').count(), 2, text);

  const rejilla = text.slice(text.indexOf('REJILLA DECORATIVA'));
  assert.match(rejilla, /Este parrafo cruza las reglas de la rejilla y debe/);
  assert.match(rejilla, /llegar entero, sin celdas y sin tachados\./);
  assert.equal(await preview.locator('table', { hasText: 'REJILLA DECORATIVA' }).count(), 0, text);
  assert.equal(await preview.locator('s, del, u', { hasText: 'rejilla' }).count(), 0, text);
  /*
    Y con las tablas inventadas se va también la otra pérdida de esa página:
    el conversor aparta el texto que cae dentro de un grupo de vectores, que
    en un documento maquetado es cada caja de color, o sea el cuerpo del
    texto. En una guía real eran dos quintas partes del documento.
  */
  assert.match(rejilla, /El texto de esta caja de color tambien tiene que/);
  assert.match(rejilla, /llegar al resultado\./);
  assert.ok(await preview.locator('img').count() >= 1);
  /*
    La fotografía se incrusta como JPEG, que es como venía guardada en el
    archivo: rasterizarla de nuevo como PNG multiplicaba su peso hasta agotar
    la memoria en informes reales. La fórmula, en cambio, sigue en PNG, donde
    el trazo no se ensucia.
  */
  const fuentes = await preview.locator('img').evaluateAll(nodes => nodes.map(n => n.getAttribute('src') || ''));
  const cabeceras = fuentes.map(src => src.slice(0, 24)).join(' | ');
  assert.ok(fuentes.some(src => src.startsWith('data:image/jpeg;base64,')), cabeceras);
  assert.ok(fuentes.some(src => src.startsWith('data:image/png;base64,')), cabeceras);
  /*
    Las imágenes ya no viajan dentro del texto: la vista previa las repone,
    pero solo una docena. El resto se nombra, y el aviso dice cuántas son.
  */
  assert.equal(fuentes.length, 12, cabeceras);
  assert.match(text, /3 imágenes más no se muestran/);
  assert.equal(await page.evaluate(() => markdownEditor.getValue()), initial);
  await page.locator('#pdf-pages').fill('99');
  assert.equal(await page.locator('#pdf-accept').isDisabled(), true);
  assert.equal(await page.locator('#pdf-preview').isDisabled(), false);
  assert.equal(await page.locator('#pdf-preview').evaluate(button => button.classList.contains('pdf-primary-action')), true);
  assert.equal(await page.locator('#pdf-accept').evaluate(button => button.classList.contains('pdf-primary-action')), false);
  await page.locator('#pdf-preview').click();
  await page.waitForFunction(() => document.querySelector('#pdf-import-status').textContent.includes('Intervalo'));
  await page.locator('#pdf-pages').fill('2');
  await page.locator('#pdf-remove-headers').uncheck();
  await page.locator('#pdf-keep-images').uncheck();
  await page.locator('#pdf-preview').click();
  await page.waitForFunction(() => document.querySelector('.pdf-import-dialog').getAttribute('aria-busy') === 'false', null, { timeout: 120000 });
  assert.equal(await page.locator('#pdf-accept').isDisabled(), false, await page.locator('#pdf-import-status').innerText());
  assert.match(await preview.locator('body').innerText(), /REPEATED HEADER/);
  assert.equal(await preview.locator('img').count(), 0);
  await page.locator('#pdf-accept').click();
  // Importar crea el documento, guarda sus recursos y lo activa, todo ello
  // después de cerrarse el diálogo: hay que esperar al editor, no al clic.
  await page.waitForFunction(() => /Apples/.test(markdownEditor.getValue()), null, { timeout: 60000 });
  /*
    El texto llega al editor antes de que el diálogo se vaya: montar el
    documento se anuncia en dos tramos y el diálogo se queda a la vista
    diciéndolo. Volver a importar exige esperar a que se cierre.
  */
  await page.waitForFunction(() => !document.querySelector('.pdf-import-dialog'), null, { timeout: 60000 });
  const imported = await page.evaluate(() => markdownEditor.getValue());
  assert.match(imported, /Apples/);
  assert.doesNotMatch(imported, /LEFT START/);
  assert.match(imported, /\|/);
  /*
    La fotografía de la primera página llega como archivo aparte, con su ruta
    en el texto y su recurso registrado. Dentro del documento no queda ni un
    base64: es lo que permitió importar informes que antes agotaban la memoria.
  */
  await page.locator('#import-file-input').setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector('#pdf-import-info')?.textContent.includes('13'), null, { timeout: 120000 });
  await page.locator('#pdf-pages').fill('1');
  await page.locator('#pdf-preview').click();
  // El botón, no el aria-busy: entre pulsar y ponerse a trabajar hay un
  // instante en que el diálogo todavía dice que está libre.
  await page.waitForFunction(
    () => document.querySelector('#pdf-accept') && !document.querySelector('#pdf-accept').disabled,
    null,
    { timeout: 120000 },
  );
  await page.locator('#pdf-accept').click();
  await page.waitForFunction(
    () => /images\/01\.jpg/.test(markdownEditor.getValue()),
    null,
    { timeout: 60000 },
  );
  await page.waitForFunction(() => !document.querySelector('.pdf-import-dialog'), null, { timeout: 60000 });
  const conFoto = await page.evaluate(() => markdownEditor.getValue());
  /*
    Pedir una sola página no impide reconocer lo que se repite: el encabezado
    se busca en todo el documento aunque solo se reescriba la página pedida.
  */
  assert.doesNotMatch(conFoto, /REPEATED HEADER/);
  assert.match(conFoto, /!\[[^\]]*\]\([^)\s]*\/images\/01\.jpg\)/, conFoto.slice(0, 300));
  assert.doesNotMatch(conFoto, /data:image/);
  const recursos = await page.evaluate(async () => {
    const doc = docs.find(d => d.id === currentId);
    const archivos = await collectLinkedDocumentAssets(doc, markdownEditor.getValue());
    return archivos.map(archivo => archivo.relativePath);
  });
  assert.ok(recursos.some(ruta => /images\/01\.jpg$/.test(ruta)), recursos.join(' | '));
  /*
    Guardar las imágenes de un informe entero son segundos en una sola
    transacción, y la barra se quedaba quieta hasta saltar al final: ahora se
    cuentan según la base de datos las confirma.
  */
  assert.ok(avance.some(paso => /Guardando imágenes… \d+ de \d+/.test(paso)), avance.slice(-8).join(' | '));

  await page.locator('#import-file-input').setInputFiles(fixture);
  await page.waitForFunction(() => document.querySelector('#pdf-import-info')?.textContent.includes('13'), null, { timeout: 120000 });
  await page.locator('#pdf-preview').click();
  await page.locator('#pdf-cancel').click();
  assert.equal(await page.locator('.pdf-import-dialog').count(), 0);
  assert.equal(await page.evaluate(() => markdownEditor.getValue()), conFoto);
  assert.equal(requests.some(url => /pythonhosted|pyodide.org|cdn.jsdelivr.net\/pyodide/.test(url)), false);
});

test('PDF largo: más de doscientas páginas de una vez', { timeout: 300000 }, async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  const fixture = resolve(defaultRepoRoot, 'test/fixtures/pdf-long.pdf');
  const avisos = [];
  await page.exposeFunction('anotarEstado', texto => avisos.push(texto));
  await page.evaluate(() => {
    new MutationObserver(() => window.anotarEstado(
      document.querySelector('#pdf-import-status')?.textContent || '',
    )).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await page.locator('#import-file-input').setInputFiles(fixture);
  await page.waitForFunction(
    () => document.querySelector('#pdf-import-info')?.textContent.includes('210'),
    null,
    { timeout: 120000 },
  );
  // Doscientas diez sí merecen el aviso.
  assert.match(await page.locator('#pdf-import-info').innerText(), /varios minutos/);
  const comenzado = Date.now();
  await page.locator('#pdf-preview').click();
  await page.waitForFunction(
    () => document.querySelector('#pdf-accept') && !document.querySelector('#pdf-accept').disabled,
    null,
    { timeout: 240000 },
  );
  console.log(`   conversión de 210 páginas: ${Math.round((Date.now() - comenzado) / 1000)} s`);
  await page.locator('#pdf-accept').click();
  await page.waitForFunction(
    () => /Pagina larga numero 210\b/.test(markdownEditor.getValue()),
    null,
    { timeout: 60000 },
  );
  const imported = await page.evaluate(() => markdownEditor.getValue());
  // Las doscientas diez, no las doscientas primeras.
  assert.match(imported, /Pagina larga numero 1\b/);
  assert.match(imported, /Pagina larga numero 201\b/);
  assert.match(imported, /Pagina larga numero 210\b/);
  /*
    La cabecera del capítulo cubre veinte de las doscientas diez páginas: no
    llega a la mitad del documento, que era lo que se exigía para retirarla, y
    aun así es margen repetido que no debe colarse en el texto.
  */
  assert.doesNotMatch(imported, /CAPITULO SEGUNDO/);
  // La cuenta de páginas llegó hasta el final, sin quedarse en 200.
  assert.ok(avisos.some(texto => /de 210/.test(texto)), avisos.slice(-6).join(' | '));
  /*
    Convertir no es lo último que pasa: armar la vista previa y luego crear el
    documento con sus imágenes llevan lo suyo en un documento largo, y antes se
    hacían en silencio, con la última página en pantalla, como si se hubiera
    quedado colgado. Las dos esperas se anuncian.
  */
  assert.ok(avisos.some(texto => /Preparando la vista previa/.test(texto)), avisos.join(' | ').slice(-300));
  assert.ok(avisos.some(texto => /Importando en una pestaña nueva/.test(texto)), avisos.join(' | ').slice(-300));
});

test('PDF escaneado: el OCR local produce Markdown editable', { timeout: 180000 }, async (t) => {
  const { context, page, requests } = await openApp();
  t.after(() => context.close());
  const fixture = resolve(defaultRepoRoot, 'test/fixtures/pdf-ocr.pdf');

  // Al servir dist/ ejercitamos las rutas vendorizadas que usa Tauri, sin
  // depender del CDN para el motor ni para el modelo del idioma.
  if (process.env.EDIMARK_STATIC_ROOT) {
    await page.evaluate(() => document.body.classList.add('desktop-mode'));
  }

  await page.locator('#import-file-input').setInputFiles(fixture);
  await page.waitForFunction(
    () => document.querySelector('#pdf-import-info')?.textContent.includes('4'),
    null,
    { timeout: 120000 },
  );
  /*
    Las cuatro páginas están escaneadas, así que la opción se ofrece, con su
    recuento. Sin marcarla: el reconocimiento es lento y nadie lo ha pedido.
    Y el idioma no se enseña mientras no haya reconocimiento que hacer.
  */
  await page.waitForFunction(
    () => document.querySelector('.pdf-import-dialog')?.dataset.scanned === '4',
    null,
    { timeout: 120000 },
  );
  assert.equal(await page.locator('.pdf-ocr-option').isHidden(), false);
  assert.match(await page.locator('#pdf-import-info').innerText(), /4 parecen escaneadas \(las 1-4\)/);
  assert.equal(await page.locator('#pdf-ocr').isChecked(), false);
  assert.equal(await page.locator('.pdf-ocr-language').isHidden(), true);
  await page.locator('#pdf-ocr').check();
  assert.equal(await page.locator('.pdf-ocr-language').isHidden(), false);
  assert.equal(await page.locator('#pdf-ocr-language').inputValue(), 'spa');

  await page.locator('#pdf-preview').click();
  await page.waitForFunction(
    () => document.querySelector('.pdf-import-dialog').getAttribute('aria-busy') === 'false',
    null,
    { timeout: 180000 },
  );
  assert.equal(await page.locator('#pdf-accept').isDisabled(), false, await page.locator('#pdf-import-status').innerText());
  assert.match(await page.locator('#pdf-import-status').innerText(), /OCR/i);
  const previewText = await page.frameLocator('#pdf-import-preview').locator('body').innerText();
  assert.match(previewText, /DOCUMENTO ESCANEADO/i);
  assert.match(previewText, /Ferreras aparece/i);

  await page.locator('#pdf-accept').click();
  await page.waitForFunction(
    () => /DOCUMENTO ESCANEADO/i.test(markdownEditor.getValue()),
    null,
    { timeout: 60000 },
  );
  const imported = await page.evaluate(() => markdownEditor.getValue());
  assert.match(imported, /### DOCUMENTO ESCANEADO/i);
  assert.match(imported, /Ferreras aparece/i);
  assert.doesNotMatch(imported, /edimark-ocr-page/);
  // El escaneo con una referencia añadida encima sigue siendo una imagen: la
  // pizca de texto extraíble no puede dejar la página sin reconocer.
  assert.match(imported, /### ANEXO DIGITALIZADO/i);
  assert.match(imported, /firma la ultima diligencia/i);
  assert.match(imported, /Ref\. 4712-B/);
  // La lámina sin texto pasa por el OCR sin resultado: conserva su imagen,
  // que la importación extrae como recurso, y no deja una página vacía.
  assert.match(imported, /!\[\]\([^)\s]*images\/\d+\.png\)/);
  // Ninguna imagen viaja ya dentro del texto.
  assert.doesNotMatch(imported, /data:image/);
  assert.doesNotMatch(imported, /## Página 2/);
  // Y una portada con imagen grande y poco texto conserva su texto de verdad,
  // que el reconocimiento no mejora, junto con la imagen.
  assert.match(imported, /Portada del informe anual/);
  assert.doesNotMatch(imported, /## Página 4/);
  assert.ok(requests.some(url => /spa\.traineddata\.gz/.test(url)), 'no se cargó el modelo OCR español');
  if (process.env.EDIMARK_STATIC_ROOT) {
    assert.ok(
      requests.some(url => /\/vendor\/tesseract\/lang\/spa\.traineddata\.gz$/.test(url)),
      'el escritorio no cargó su modelo OCR local',
    );
    assert.equal(
      requests.some(url => /cdn\.jsdelivr\.net\/npm\/(?:tesseract\.js|@tesseract\.js-data)/.test(url)),
      false,
      'el OCR del escritorio intentó usar el CDN',
    );
  }
});

test('PDF grande: imágenes fuera de localStorage, dólares literales y recuperación tras recargar', { timeout: 180000 }, async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  const image = Buffer.concat([PNG_PIXEL, Buffer.alloc(5 * 1024 * 1024)]).toString('base64');
  const source = `Price $200/month\n\n**Conclusion**\n\n![Large](data:image/png;base64,${image}\n)\n\nAnother price US$40 billion.\n\nMath $x+1$`;
  // Sin imágenes sueltas: se prueba la repesca del base64 que aún llega
  // incrustado, que es como viaja la página cuyo OCR no leyó nada.
  const id = await page.evaluate(async markdown => {
    const doc = await createImportedPdfDocument('Large PDF', { markdown, images: [] });
    return doc.id;
  }, source);
  await page.waitForFunction(() => {
    const img = document.querySelector('#html-output img');
    return img?.complete && img.naturalWidth > 0;
  });
  assert.match(await page.locator('#html-output strong').first().innerText(), /Conclusion/);
  assert.doesNotMatch(await page.locator('#html-output').innerText(), /data:image|base64,/);
  const stored = await page.evaluate(id => localStorage.getItem(`edimarkweb-autosave-${id}`), id);
  assert.ok(stored.length < 500);
  assert.match(stored, /Large-PDF\/images\/01.png/);
  assert.equal(await page.evaluate(() => shownStorageNoticeKeys.has('storage_quota_exceeded')), false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__edimarkReady === true);
  await page.waitForFunction(() => {
    const img = document.querySelector('#html-output img');
    return img?.src.startsWith('blob:') && img.complete && img.naturalWidth > 0;
  });
  const assets = await page.evaluate(async () => {
    const doc = docs.find(d => d.id === currentId);
    const files = await collectLinkedDocumentAssets(doc, markdownEditor.getValue());
    return files.map(file => ({ path: file.relativePath, size: file.contents.size }));
  });
  assert.equal(assets.length, 1);
  assert.equal(assets[0].size, PNG_PIXEL.length + 5 * 1024 * 1024);
  assert.equal(await page.evaluate(() => currentId), id);
  // Usar el WASM real: que no lance una excepción no demuestra que el DOCX
  // contenga imágenes. La imagen supera los límites de descarga de Internet.
  await context.unroute(/pandoc\.b64(?:\.gz)?(?:\?.*)?$/);
  const exported = await page.evaluate(async () => {
    const markdown = markdownEditor.getValue();
    let saved;
    window.EdiMarkPlatform.saveFile = async options => {
      saved = options.contents;
      return { saved: true };
    };
    const { readZipEntries } = await import('./zip-reader.js');
    const mediaSizes = {};
    for (const format of ['docx', 'odt', 'epub']) {
      await window.PandocExporter.exportDocument({ format, markdown });
      const entries = await readZipEntries(new Uint8Array(await saved.arrayBuffer()));
      mediaSizes[format] = [...entries].filter(([path]) => /\.png$/i.test(path))
        .map(([, bytes]) => bytes.length);
    }
    const html = await window.PandocExporter.generateHtml({ markdown });
    const fragment = new DOMParser().parseFromString(html, 'text/html');
    return {
      mediaSizes,
      htmlImage: fragment.querySelector('img')?.getAttribute('src').startsWith('data:image/png;base64,'),
    };
  });
  for (const format of ['docx', 'odt', 'epub']) {
    assert.ok(exported.mediaSizes[format].includes(PNG_PIXEL.length + 5 * 1024 * 1024), format);
  }
  assert.equal(exported.htmlImage, true);
});

/*
  Releer del disco. Un documento abierto desde un archivo puede cambiar por
  fuera mientras se edita, y hasta ahora la única salida era cerrar la pestaña
  y volver a abrirlo. El botón de la fila de las pestañas lo relee: calla si el
  archivo sigue igual, y pregunta antes de tirar cambios sin guardar.
*/
test('el botón de releer trae lo que hay en el disco y avisa antes de descartar', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  // En la web no hay una ruta de disco que releer: la clase `hidden` debe
  // prevalecer sobre el `display:flex` común de los botones de acción.
  const boton = page.locator('#reload-from-disk-btn');
  assert.equal(await boton.isVisible(), false);

  // El escritorio, de mentira: un archivo cuyo contenido decide la prueba.
  await page.evaluate(() => {
    window.__disco = 'Del disco, versión 1.\n';
    window.__preguntas = [];
    window.__respuesta = true;
    window.EdiMarkPlatform = {
      ...(window.EdiMarkPlatform || {}),
      isDesktop: true,
      openTextDocumentAtPath: async (path) => ({ path, name: 'notas', content: window.__disco }),
      confirm: async (message) => { window.__preguntas.push(message); return window.__respuesta; },
    };
  });
  // En una pestaña que no viene de ningún archivo no hay nada que releer.
  await page.evaluate(() => updateReloadFromDiskState());
  assert.equal(await boton.isVisible(), true);
  assert.equal(await boton.isDisabled(), true);
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  const fondoDesactivado = await boton.evaluate(element => getComputedStyle(element).backgroundColor);
  await boton.hover();
  assert.equal(await boton.evaluate(element => getComputedStyle(element).backgroundColor), fondoDesactivado);
  assert.equal(fondoDesactivado, 'rgba(0, 0, 0, 0)');
  assert.equal(await boton.evaluate(element => getComputedStyle(element).opacity), '0.45');

  await page.evaluate(() => window.__edimarkOpenNativePaths(['/tmp/notas.md']));
  await page.waitForFunction(() => markdownEditor.getValue().includes('versión 1'));
  assert.equal(await boton.isDisabled(), false);

  /*
    Y solo en esa: una pestaña nueva no viene de ningún archivo, ni tampoco
    la que queda en blanco al cerrarlas todas.
  */
  await page.evaluate(() => newDoc('Sin guardar', 'Escrito aquí mismo.'));
  assert.equal(await boton.isDisabled(), true);
  await page.evaluate(() => { const ids = docs.map(d => d.id); return closeDocs(ids); });
  await page.waitForFunction(() => docs.length === 1 && !docs[0].filePath && docs[0].md === '');
  assert.equal(await boton.isDisabled(), true);

  await page.evaluate(() => window.__edimarkOpenNativePaths(['/tmp/notas.md']));
  await page.waitForFunction(() => markdownEditor.getValue().includes('versión 1'));
  assert.equal(await boton.isDisabled(), false);

  // El archivo cambia por fuera y el editor no tiene nada sin guardar: entra
  // sin preguntar.
  await page.evaluate(() => { window.__disco = 'Del disco, versión 2.\n'; });
  await boton.click();
  await page.waitForFunction(() => markdownEditor.getValue().includes('versión 2'));
  assert.deepEqual(await page.evaluate(() => window.__preguntas), []);
  // Y releído es lo guardado: la pestaña no queda marcada como sucia.
  assert.equal(await page.locator('.tab[aria-selected="true"] .tab-dirty').isHidden(), true);

  // Con cambios sin guardar se pregunta, y un «no» los respeta.
  await page.locator('#markdown-input').fill('Escrito a mano, sin guardar.\n');
  await page.evaluate(() => { window.__disco = 'Del disco, versión 3.\n'; window.__respuesta = false; });
  await boton.click();
  await page.waitForFunction(() => window.__preguntas.length === 1);
  assert.match((await page.evaluate(() => window.__preguntas))[0], /notas/);
  assert.match(await page.locator('#markdown-input').inputValue(), /Escrito a mano/);

  // Y un «sí» trae el disco encima de lo escrito.
  await page.evaluate(() => { window.__respuesta = true; });
  await boton.click();
  await page.waitForFunction(() => markdownEditor.getValue().includes('versión 3'));

  // Si el archivo no ha cambiado no se toca nada y se dice en la barra.
  await boton.click();
  await page.waitForFunction(() => /no ha cambiado/i.test(document.getElementById('status-toast-message')?.textContent || ''));
});

/*
  El manual es la bienvenida, no un inquilino: se abre solo mientras nadie lo
  haya cerrado. Cerrarlo es decir que ya se ha leído, y desde entonces una
  sesión vacía arranca con un documento en blanco.
*/
test('el manual se abre solo hasta que se cierra una vez', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('.tab-name', { hasText: 'Manual' }).waitFor();
  await page.locator('.tab', { hasText: 'Manual' }).locator('.tab-close').click();
  await page.waitForFunction(() => docs.length === 1 && !docs[0].isManual);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__edimarkReady === true);
  await page.locator('.tab-name').first().waitFor();
  assert.equal(await page.locator('.tab', { hasText: 'Manual' }).count(), 0);
  assert.equal(await page.locator('.tab').count(), 1);
  // Y sigue a un clic de distancia donde siempre.
  await page.keyboard.press('F1');
  await page.locator('.tab-name', { hasText: 'Manual' }).waitFor();
});

/*
  La cortina del arranque. Un documento que cuelga el montaje deja la ventana
  quieta y sin salida: el botón abre una sesión vacía y olvida la guardada, que
  es lo único que rompe el bucle. Como eso se pierde, se pregunta antes.
*/
test('cancelar el arranque abre vacío y olvida la sesión guardada', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());

  await page.locator('.tab-name').first().waitFor();
  /*
    La salida está a la vista desde el primer momento y no depende del hilo:
    cuando el arranque es corto la pantalla se va antes de que ningún
    temporizador llegue a disparar, y cuando es largo el hilo está tomado
    montando el documento y allí no corre ni un `setTimeout`.
  */
  const salida = await page.evaluate(() => {
    const boton = document.getElementById('app-loading-cancel');
    const estilo = getComputedStyle(boton);
    return {
      escondido: boton.hasAttribute('hidden'),
      animacion: estilo.animationName,
      retraso: estilo.animationDelay,
    };
  });
  assert.deepEqual(salida, { escondido: false, animacion: 'app-loading-cancel-in', retraso: '0s' });

  await page.locator('#markdown-input').fill('Trabajo de la sesión anterior.\n');
  await page.waitForFunction(() => localStorage.getItem('edimarkweb-docslist')?.includes('id'));

  // La cortina vuelve, como en un arranque que todavía no ha terminado.
  await page.evaluate(() => document.getElementById('app-loading').removeAttribute('hidden'));
  /*
    La pregunta se hace en la propia pantalla: en la ventana de la aplicación
    los modales del navegador llegan apagados, y una pregunta que no se ve se
    responde sola que no.
  */
  await page.locator('#app-loading-cancel').click();
  await page.locator('#app-loading-confirm').waitFor({ state: 'visible' });
  await page.locator('#app-loading-confirm-no').click();
  await page.locator('#app-loading-confirm').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#app-loading-cancel').isVisible(), true);
  assert.match(await page.evaluate(() => localStorage.getItem('edimarkweb-docslist') || ''), /id/);

  await page.locator('#app-loading-cancel').click();
  await page.locator('#app-loading-confirm-yes').click();
  await page.waitForFunction(() => window.__edimarkReady === true && !localStorage.getItem('edimarkweb-docslist'));
  assert.equal(await page.evaluate(() => localStorage.getItem('edimarkweb-active-doc')), null);
  // La sesión nueva empieza de cero: una sola pestaña, y sin lo de antes.
  await page.locator('.tab-name').first().waitFor();
  assert.equal(await page.locator('.tab').count(), 1);
  assert.doesNotMatch(await page.locator('#markdown-input').inputValue(), /sesión anterior/);

  /*
    Un clic dado después de que la carga terminara no descarta nada: quien lo
    da ya está viendo su sesión, no la pantalla de apertura.
  */
  await page.locator('#markdown-input').fill('Otra sesión.\n');
  await page.waitForFunction(() => localStorage.getItem('edimarkweb-docslist')?.includes('id'));
  const tardio = await page.evaluate(() => {
    askToCancelStartup(performance.now());
    return Boolean(localStorage.getItem('edimarkweb-docslist'));
  });
  assert.equal(tardio, true);
});

/*
  Un documento enorme no se abre solo al arrancar. Montarlo son minutos con la
  ventana tomada, y quien importó un informe de trescientas páginas se
  encontraba con que cada apertura de la aplicación se le iba en esperar, sin
  salida posible. Su pestaña sigue ahí y se abre cuando se pulsa.
*/
test('un documento enorme espera en su pestaña en vez de tomar el arranque', async (t) => {
  const enorme = `# Informe\n\n${'Texto corriente de relleno. '.repeat(14000)}\n`;
  const { context, page } = await openApp({
    initStorage: `(() => {
      const md = ${JSON.stringify(enorme)};
      localStorage.setItem('edimarkweb-docslist', JSON.stringify([{ id: 'gordo', name: 'Informe' }]));
      localStorage.setItem('edimarkweb-autosave-gordo', md);
      localStorage.setItem('edimarkweb-active-doc', 'gordo');
    })()`,
  });
  t.after(() => context.close());

  await page.waitForFunction(() => window.__edimarkReady === true);
  // Su pestaña está, pero el editor abre en otra: no se ha montado.
  await page.locator('.tab', { hasText: 'Informe' }).waitFor();
  assert.doesNotMatch(await page.locator('#markdown-input').inputValue(), /Texto corriente de relleno/);
  assert.match(await page.locator('#status-toast-message').innerText(), /Informe/);

  // Y se abre cuando se pulsa, que es cuando alguien ha pedido la espera.
  await page.locator('.tab', { hasText: 'Informe' }).click();
  await page.waitForFunction(() => /Texto corriente de relleno/.test(markdownEditor.getValue()), null, { timeout: 60000 });
});

/*
  La hoja de un documento enorme no se compone sola. Analizar el Markdown y
  repartirlo en la vista previa son minutos con la ventana tomada en un equipo
  donde el recolector de basura del navegador entra en barrena, y se vuelven a
  pagar en cada apertura. El texto está en el editor enseguida; la hoja, cuando
  alguien la pide.
*/
test('la vista previa de un documento enorme espera a que la pidan', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  await page.locator('.tab-name').first().waitFor();

  const enorme = `# Informe\n\n${'Un párrafo de relleno con unas cuantas palabras. '.repeat(7000)}\n`;
  await page.evaluate((md) => markdownEditor.setValue(md), enorme);
  await page.locator('#html-output .preview-on-demand').waitFor();
  assert.equal(await page.locator('#html-output p').count(), 1, 'la hoja no debe componerse');
  // El texto sí está, que es lo que se necesita para trabajar y para exportar.
  assert.match(await page.locator('#markdown-input').inputValue(), /párrafo de relleno/);

  await page.locator('.preview-on-demand-btn').click();
  await page.waitForFunction(() => !document.querySelector('#html-output .preview-on-demand'));
  assert.ok(await page.locator('#html-output h1').count() >= 1, 'pedida, la hoja se compone');

  // Y una vez pedida, sigue repintándose al escribir, como cualquier otra.
  await page.evaluate((md) => markdownEditor.setValue(`${md}\n\n## Añadido\n`), enorme);
  await page.locator('#html-output h2', { hasText: 'Añadido' }).waitFor();

  /*
    No todos los equipos sufren igual: el mismo documento se compone en décimas
    de segundo con el motor de Windows y tarda minutos con el de Linux. Aquí ha
    ido rápido, así que el equipo queda marcado como sobrado y no se vuelve a
    preguntar: otro documento igual de largo se compone sin avisos.
  */
  assert.equal(await page.evaluate(() => localStorage.getItem('edimarkweb-hoja-rapida')), '1');
  await page.evaluate(() => { newDoc('Otro', ''); });
  await page.evaluate((md) => markdownEditor.setValue(md), enorme);
  await page.locator('#html-output h1').waitFor();
  assert.equal(await page.locator('#html-output .preview-on-demand').count(), 0);
});

/*
  Con la hoja a la vista, cada tecla la rehacía entera. Mientras eso cuesta
  milisegundos no se nota, pero en un informe de cuatrocientas páginas son
  minutos por pulsación: la vista previa se queda atrás a propósito, lo dice, y
  se pone al día cuando se le pide.
*/
test('la vista previa deja de seguir al teclado cuando rehacerla cuesta demasiado', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  await page.locator('.tab-name').first().waitFor();

  await page.locator('#markdown-input').fill('# Corto\n\nUna línea.\n');
  await page.locator('#html-output h1', { hasText: 'Corto' }).waitFor();
  assert.equal(await page.locator('#preview-stale').isVisible(), false);

  /*
    Y ahora, como si el último repintado hubiera costado lo que cuesta el de un
    informe de cuatrocientas páginas: es esa medida, y no el tamaño, la que
    decide si la vista previa puede seguir al teclado.
  */
  await page.evaluate(() => { costeDeRehacerLaHoja = 30000; });

  // Ya no sigue al teclado: avisa y espera a que se lo pidan.
  await page.locator('#markdown-input').fill('# Corto\n\nTexto nuevo del todo.\n');
  await page.locator('#preview-stale').waitFor({ state: 'visible' });
  assert.doesNotMatch(await page.locator('#html-output').innerText(), /Texto nuevo del todo/);

  await page.locator('#preview-stale-btn').click();
  await page.waitForFunction(() => /Texto nuevo del todo/.test(document.getElementById('html-output').innerText));
  await page.locator('#preview-stale').waitFor({ state: 'hidden' });

  /*
    Y como ese repintado ha resultado barato de verdad, la vista previa vuelve a
    seguir al teclado sola: el documento pudo adelgazar por el camino.
  */
  await page.locator('#markdown-input').fill('# Corto\n\nÚltimo texto.\n');
  await page.locator('#html-output', { hasText: 'Último texto' }).waitFor();
  assert.equal(await page.locator('#preview-stale').isVisible(), false);
});

/*
  Diagramas Mermaid (ADR 0004). Mermaid llega del CDN, como el resto de
  bibliotecas de la web. Sirena se sirve desde su paquete de npm, con el
  Mermaid de la hoja en la carpeta donde ella lo busca, desviando las
  peticiones a sirenaapp.github.io: así el origen es el de verdad.
*/
const DIAGRAMA = 'flowchart LR\n    A[Entrega] --> B{¿A tiempo?}\n    B -- Sí --> C[Se corrige]';
const DIBUJO = '#html-output .edimark-mermaid svg[id^="edimark-mermaid"]';

test('un diagrama Mermaid se dibuja en la hoja y vuelve intacto al Markdown', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  const fuente = `# Diagramas\n\n\`\`\`mermaid\n${DIAGRAMA}\n\`\`\`\n\n`
    + '```mermaid\nflowchart TD\n    esto no es ][\n```\n\nFinal del documento.\n';
  await page.locator('#new-tab-btn').click();
  await page.evaluate(md => markdownEditor.setValue(md), fuente);
  await page.locator(DIBUJO).waitFor({ timeout: 30000 });
  // El que tiene un error enseña su código y el aviso de Mermaid con la línea.
  await page.locator('#html-output .edimark-mermaid-error').waitFor();
  assert.match(await page.locator('#html-output .edimark-mermaid-detail').innerText(), /line 2/);

  await page.locator('#html-output p').filter({ hasText: /^Final del documento\.$/ }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Editado.');
  const editado = await page.evaluate(() => {
    document.getElementById('html-output').focus();
    forceMarkdownUpdate = true;
    updateMarkdown();
    return markdownEditor.getValue();
  });
  assert.ok(editado.includes('Final del documento. Editado.'), 'la edición no llegó al Markdown');
  assert.ok(editado.includes(`\`\`\`mermaid\n${DIAGRAMA}\n\`\`\``), `el diagrama no volvió igual:\n${editado}`);
  assert.ok(editado.includes('```mermaid\nflowchart TD\n    esto no es ][\n```'), `el diagrama con error no volvió igual:\n${editado}`);
});

test('al exportar, cada diagrama es una imagen centrada y sin pie', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  const preparado = await page.evaluate(async (codigo) => {
    const resultado = await window.PandocExporter.prepareDiagramImages(
      `Antes.\n\n\`\`\`mermaid\n${codigo}\n\`\`\`\n\nDespués.\n`, {});
    return {
      markdown: resultado.markdown,
      failed: resultado.failed,
      files: Object.fromEntries(Object.entries(resultado.files).map(([nombre, bytes]) => [nombre, Array.from(bytes)])),
    };
  }, DIAGRAMA);
  assert.equal(preparado.failed, 0);
  const files = Object.fromEntries(Object.entries(preparado.files).map(([nombre, bytes]) => [nombre, new Uint8Array(bytes)]));
  assert.deepEqual(Object.keys(files), ['edimark-diagram-0.png']);
  assert.equal(new TextDecoder().decode(files['edimark-diagram-0.png'].slice(1, 4)), 'PNG');

  const html = new TextDecoder().decode((await runPandoc(`-f ${MARKDOWN_READER_NO_AUTO_IDS} -t html`, preparado.markdown, files)).bytes);
  assert.match(html, /<div data-custom-style="Figure">\s*<p><img src="\/edimark-diagram-0\.png" width="\d+"[^>]*alt="Diagrama"/);
  assert.doesNotMatch(html, /<figcaption|<pre/);
  const latex = new TextDecoder().decode((await runPandoc(`-f ${MARKDOWN_READER_NO_AUTO_IDS} -t latex`, preparado.markdown, files)).bytes);
  assert.match(latex, /\\begin\{center\}\s*\\includegraphics\[width=[\d.]+in[^\]]*\]\{\/edimark-diagram-0\.png\}~?\s*\\end\{center\}/);
  const docx = await runPandoc(`-f ${MARKDOWN_READER_NO_AUTO_IDS} -t docx -o out.docx`, preparado.markdown, files);
  const { readZipEntries } = await import('../zip-reader.js');
  const entries = await readZipEntries(docx.bytes);
  const documento = new TextDecoder().decode(entries.get('word/document.xml'));
  assert.ok([...entries.keys()].some(nombre => /^word\/media\/.+\.png$/.test(nombre)), 'el DOCX no lleva la imagen');
  assert.match(documento, /w:pStyle w:val="Figure"/);
});

test('Sirena edita un diagrama de la hoja y lo devuelve a su bloque', async (t) => {
  const { context, page } = await openApp();
  t.after(() => context.close());
  const sirenaRoot = join(defaultRepoRoot, 'node_modules', 'sirenaapp');
  const mermaidDist = join(defaultRepoRoot, 'node_modules', 'mermaid', 'dist');
  const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
  await context.route(/^https:\/\/sirenaapp\.github\.io\//, async (route) => {
    const ruta = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\/+/, '') || 'index.html';
    const archivo = ruta.startsWith('vendor/mermaid/')
      ? join(mermaidDist, ruta.slice('vendor/mermaid/'.length))
      : join(sirenaRoot, ruta);
    try {
      await route.fulfill({ status: 200, contentType: tipos[extname(archivo)] || 'application/octet-stream', body: await readFile(archivo) });
    } catch (_error) {
      await route.fulfill({ status: 404, body: '' });
    }
  });
  // Dos diagramas iguales: se edita el segundo, el de la lista, que conserva su sangría.
  const fuente = '```mermaid\nflowchart LR\n    A --> B\n```\n\n- Lista\n\n  ```mermaid\n  flowchart LR\n      A --> B\n  ```\n';
  await page.locator('#new-tab-btn').click();
  await page.evaluate(md => markdownEditor.setValue(md), fuente);
  await page.waitForFunction(selector => document.querySelectorAll(selector).length === 2, DIBUJO, { timeout: 30000 });

  const [sirena] = await Promise.all([
    context.waitForEvent('page'),
    page.locator('#html-output .edimark-mermaid').nth(1).dblclick(),
  ]);
  await sirena.waitForFunction(() => document.body.classList.contains('otro-programa'), null, { timeout: 30000 });
  assert.equal(await sirena.locator('#editor').inputValue(), 'flowchart LR\n    A --> B');
  await sirena.locator('#editor').fill('flowchart LR\n    A --> B\n    B --> C');
  // El botón cierra la ventana en el mismo clic: se pulsa desde la página,
  // sin esperar a que Playwright confirme el clic en una ventana que ya no está.
  const cerrada = sirena.waitForEvent('close');
  await sirena.evaluate(() => document.getElementById('exe-insertar').click()).catch(() => {});
  await cerrada;
  await page.waitForFunction(() => markdownEditor.getValue().includes('B --> C'));
  assert.equal(await page.evaluate(() => markdownEditor.getValue()),
    fuente.replace('      A --> B\n  ```', '      A --> B\n      B --> C\n  ```'));

  // Nuevo desde la barra y cancelar: Cancelar no cambia nada.
  const antes = await page.evaluate(() => markdownEditor.getValue());
  const [otra] = await Promise.all([context.waitForEvent('page'), page.locator('#open-sirena-btn').click()]);
  await otra.waitForFunction(() => document.body.classList.contains('otro-programa'), null, { timeout: 30000 });
  const cerradaOtra = otra.waitForEvent('close');
  await otra.evaluate(() => document.getElementById('exe-cancelar').click()).catch(() => {});
  await cerradaOtra;
  assert.equal(await page.evaluate(() => markdownEditor.getValue()), antes);
});
