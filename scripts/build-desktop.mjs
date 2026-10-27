import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = join(projectRoot, 'dist');

const appFiles = [
  'asset-paths.js',
  'bibliography.js',
  'desktop-updater.js',
  'document-format.js',
  'format-profiles.js',
  'favicon.ico',
  'i18n.js',
  'index.html',
  'LICENSE',
  'logo_100px.png',
  'logo_256.png',
  'manifest.json',
  'manual-ca.md',
  'manual-en.md',
  'manual-eu.md',
  'manual-gl.md',
  'manual.md',
  'mermaid-diagrams.js',
  'odt-formulas.js',
  'office-format.js',
  'odt-tables.js',
  'pdf-import.js',
  'pdf-worker.js',
  'pdf-import.py',
  'pandoc-exporter.js',
  'pandoc-prepare.js',
  'pandoc-wasm.js',
  'pandoc.b64',
  'pandoc.b64.gz',
  'package.json',
  'platform-api.js',
  'script.js',
  'search.js',
  'style.css',
  'tailwind.build.css',
  'zip-reader.js',
  'zip-writer.js',
];

const directories = ['csl', 'locales', 'vendor/pdf-runtime'];

const vendorFiles = new Map([
  ['node_modules/marked/lib/marked.umd.js', 'vendor/marked.umd.js'],
  ['node_modules/turndown/dist/turndown.js', 'vendor/turndown.js'],
  ['vendor/turndown-plugin-gfm.js', 'vendor/turndown-plugin-gfm.js'],
  ['node_modules/katex/dist/katex.min.css', 'vendor/katex/katex.min.css'],
  ['node_modules/katex/dist/katex.min.js', 'vendor/katex/katex.min.js'],
  ['node_modules/katex/dist/contrib/auto-render.min.js', 'vendor/katex/auto-render.min.js'],
  ['node_modules/lucide/dist/umd/lucide.min.js', 'vendor/lucide.min.js'],
  ['node_modules/codemirror/lib/codemirror.css', 'vendor/codemirror/codemirror.min.css'],
  ['node_modules/codemirror/theme/eclipse.css', 'vendor/codemirror/theme/eclipse.min.css'],
  ['node_modules/codemirror/theme/material-darker.css', 'vendor/codemirror/theme/material-darker.min.css'],
  ['node_modules/codemirror/lib/codemirror.js', 'vendor/codemirror/codemirror.min.js'],
  ['node_modules/codemirror/addon/mode/overlay.js', 'vendor/codemirror/addon/mode/overlay.min.js'],
  ['node_modules/codemirror/addon/search/searchcursor.js', 'vendor/codemirror/addon/search/searchcursor.js'],
  ['node_modules/codemirror/mode/xml/xml.js', 'vendor/codemirror/mode/xml/xml.min.js'],
  ['node_modules/codemirror/mode/javascript/javascript.js', 'vendor/codemirror/mode/javascript/javascript.min.js'],
  ['node_modules/codemirror/mode/css/css.js', 'vendor/codemirror/mode/css/css.min.js'],
  ['node_modules/codemirror/mode/htmlmixed/htmlmixed.js', 'vendor/codemirror/mode/htmlmixed/htmlmixed.min.js'],
  ['node_modules/codemirror/mode/markdown/markdown.js', 'vendor/codemirror/mode/markdown/markdown.min.js'],
  ['node_modules/codemirror/mode/gfm/gfm.js', 'vendor/codemirror/mode/gfm/gfm.min.js'],
  ['node_modules/codemirror/addon/edit/continuelist.js', 'vendor/codemirror/addon/edit/continuelist.min.js'],
  ['node_modules/split.js/dist/split.min.js', 'vendor/split.min.js'],
  ['node_modules/mermaid/dist/mermaid.min.js', 'vendor/mermaid/mermaid.min.js'],
  ['node_modules/tesseract.js/dist/tesseract.min.js', 'vendor/tesseract/tesseract.min.js'],
  ['node_modules/tesseract.js/dist/worker.min.js', 'vendor/tesseract/worker.min.js'],
  ['node_modules/@tesseract.js-data/spa/4.0.0_best_int/spa.traineddata.gz', 'vendor/tesseract/lang/spa.traineddata.gz'],
  ['node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz', 'vendor/tesseract/lang/eng.traineddata.gz'],
  ['node_modules/@tesseract.js-data/cat/4.0.0_best_int/cat.traineddata.gz', 'vendor/tesseract/lang/cat.traineddata.gz'],
  ['node_modules/@tesseract.js-data/glg/4.0.0_best_int/glg.traineddata.gz', 'vendor/tesseract/lang/glg.traineddata.gz'],
  ['node_modules/@tesseract.js-data/eus/4.0.0_best_int/eus.traineddata.gz', 'vendor/tesseract/lang/eus.traineddata.gz'],
]);

const indexReplacements = new Map([
  ['https://cdn.jsdelivr.net/npm/marked@18.0.9/lib/marked.umd.js', 'vendor/marked.umd.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/turndown/7.1.1/turndown.min.js', 'vendor/turndown.js'],
  ['https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/katex.min.css', 'vendor/katex/katex.min.css'],
  ['https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/katex.min.js', 'vendor/katex/katex.min.js'],
  ['https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/contrib/auto-render.min.js', 'vendor/katex/auto-render.min.js'],
  ['https://cdn.jsdelivr.net/npm/lucide@0.523.0/dist/umd/lucide.min.js', 'vendor/lucide.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.15/codemirror.min.css', 'vendor/codemirror/codemirror.min.css'],
  ['https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.15/theme/eclipse.min.css', 'vendor/codemirror/theme/eclipse.min.css'],
  ['https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.15/theme/material-darker.min.css', 'vendor/codemirror/theme/material-darker.min.css'],
  ['https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.15/codemirror.min.js', 'vendor/codemirror/codemirror.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.15/addon/mode/overlay.min.js', 'vendor/codemirror/addon/mode/overlay.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.15/addon/search/searchcursor.js', 'vendor/codemirror/addon/search/searchcursor.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.15/mode/xml/xml.min.js', 'vendor/codemirror/mode/xml/xml.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.15/mode/javascript/javascript.min.js', 'vendor/codemirror/mode/javascript/javascript.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.15/mode/css/css.min.js', 'vendor/codemirror/mode/css/css.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.15/mode/htmlmixed/htmlmixed.min.js', 'vendor/codemirror/mode/htmlmixed/htmlmixed.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.15/mode/markdown/markdown.min.js', 'vendor/codemirror/mode/markdown/markdown.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.15/mode/gfm/gfm.min.js', 'vendor/codemirror/mode/gfm/gfm.min.js'],
  ['https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.15/addon/edit/continuelist.min.js', 'vendor/codemirror/addon/edit/continuelist.min.js'],
  ['https://cdn.jsdelivr.net/npm/split.js@1.6.5/dist/split.min.js', 'vendor/split.min.js'],
  ['https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js', 'vendor/tesseract/tesseract.min.js'],
]);

async function copyFile(source, destination) {
  const absoluteDestination = join(outputRoot, destination);
  await mkdir(dirname(absoluteDestination), { recursive: true });
  await cp(join(projectRoot, source), absoluteDestination);
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

for (const file of appFiles) await copyFile(file, file);
for (const directory of directories) {
  await mkdir(dirname(join(outputRoot, directory)), { recursive: true });
  await cp(join(projectRoot, directory), join(outputRoot, directory), { recursive: true });
}
for (const [source, destination] of vendorFiles) await copyFile(source, destination);

await build({
  entryPoints: [join(projectRoot, 'platform-tauri-entry.js')],
  outfile: join(outputRoot, 'platform-tauri.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome105', 'safari15'],
  minify: true,
});

await cp(
  join(projectRoot, 'node_modules/katex/dist/fonts'),
  join(outputRoot, 'vendor/katex/fonts'),
  { recursive: true },
);
await cp(
  join(projectRoot, 'node_modules/tesseract.js-core'),
  join(outputRoot, 'vendor/tesseract/core'),
  { recursive: true },
);
await cp(
  join(projectRoot, 'node_modules/@bjorn3/browser_wasi_shim/dist'),
  join(outputRoot, 'vendor/browser-wasi-shim'),
  { recursive: true },
);

// EdiCuaTeX llega como dependencia de npm y no como copia a mano, así que la
// revisión que se empaqueta la fija package-lock.json. El paquete publicado no
// trae MathJax, porque quien sirve el editor desde la web lo pide al CDN; aquí
// no hay red que valga, de modo que se genera su copia local. Sin ella el
// editor caería en el CDN y el escritorio dejaría de funcionar sin conexión.
const edicuatexRoot = join(projectRoot, 'node_modules/edicuatex');
if (!existsSync(join(edicuatexRoot, 'js/mathjax/tex-svg.js'))) {
  execFileSync(process.execPath, [join(edicuatexRoot, 'scripts/vendor-mathjax.mjs')], { stdio: 'inherit' });
  if (!existsSync(join(edicuatexRoot, 'js/mathjax/tex-svg.js'))) {
    throw new Error('No se generó la copia local de MathJax para EdiCuaTeX');
  }
}
const edicuatexOutput = join(outputRoot, 'vendor/edicuatex');
// Lo que sobra en el escritorio: las dependencias del paquete, su script de
// vendorizado y la documentación que acompaña al publicado en npm.
const edicuatexExcluded = new Set(['node_modules', 'scripts', 'package.json', 'README.md', 'README_es.md']);
await cp(edicuatexRoot, edicuatexOutput, {
  recursive: true,
  filter: source => !edicuatexExcluded.has(relative(edicuatexRoot, source).split(sep)[0]),
});

// Los dos retoques de integración se aplican sobre la copia de dist y no sobre
// el paquete, para que actualizar EdiCuaTeX no obligue a rehacer ningún parche.
// El tema entra por la interrogación `?mode=light|dark` que abre script.js.
for (const [target, patch, place] of [
  ['css/edicuatex.css', 'theme.css', 'final'],
  ['js/edicuatex-tools.js', 'theme.js', 'principio'],
]) {
  const targetPath = join(edicuatexOutput, target);
  if (!existsSync(targetPath)) throw new Error(`EdiCuaTeX ya no trae ${target}`);
  const original = await readFile(targetPath, 'utf8');
  const addition = await readFile(join(projectRoot, 'vendor/edicuatex-integration', patch), 'utf8');
  await writeFile(targetPath, place === 'final' ? original + addition : `${addition}\n${original}`);
}

/*
  Sirena, para editar los diagramas sin conexión. Su paquete de npm no lleva
  Mermaid (lo pone el programa que la usa, ADR 30 de Sirena): se le añade el
  mismo que dibuja la hoja, en la carpeta donde Sirena lo busca.
*/
const sirenaRoot = join(projectRoot, 'node_modules/sirenaapp');
if (!existsSync(join(sirenaRoot, 'index.html'))) throw new Error('Falta el paquete sirenaapp');
const sirenaOutput = join(outputRoot, 'vendor/sirena');
await cp(sirenaRoot, sirenaOutput, {
  recursive: true,
  filter: source => !['node_modules', 'package.json', 'README.md'].includes(relative(sirenaRoot, source).split(sep)[0]),
});
await cp(
  join(projectRoot, 'node_modules/mermaid/dist/mermaid.esm.min.mjs'),
  join(sirenaOutput, 'vendor/mermaid/mermaid.esm.min.mjs'),
);
// Solo los trozos, sin sus mapas de depuración (multiplicarían por cuatro lo
// que ocupa), como hace el guion `actualizar-mermaid.sh` de Sirena.
await cp(
  join(projectRoot, 'node_modules/mermaid/dist/chunks/mermaid.esm.min'),
  join(sirenaOutput, 'vendor/mermaid/chunks/mermaid.esm.min'),
  { recursive: true, filter: source => !source.endsWith('.map') },
);
await cp(join(projectRoot, 'node_modules/mermaid/LICENSE'), join(sirenaOutput, 'vendor/mermaid/LICENSE.txt'));

let indexHtml = await readFile(join(outputRoot, 'index.html'), 'utf8');
for (const [remoteUrl, localUrl] of indexReplacements) {
  if (!indexHtml.includes(remoteUrl)) throw new Error(`No se encontró la dependencia ${remoteUrl}`);
  indexHtml = indexHtml.replaceAll(remoteUrl, localUrl);
}
// Las sumas SRI corresponden a los ficheros minificados de cada CDN. Algunas
// copias de npm son equivalentes pero no byte a byte, así que el WebView las
// bloquearía si conservásemos los atributos de la versión remota.
indexHtml = indexHtml
  .replace(/\s+integrity="[^"]*"/g, '')
  .replace(/\s+crossorigin="anonymous"/g, '');
// Los archivos propios llevan `?v=` con la versión para que el navegador no
// sirva una copia vieja, así que la etiqueta no se puede buscar literal.
const platformScript = /<script src="platform-api\.js(\?[^"]*)?"><\/script>/;
const platformMatch = indexHtml.match(platformScript);
if (!platformMatch) throw new Error('No se encontró la API de plataforma');
indexHtml = indexHtml.replace(
  platformScript,
  `<script src="platform-tauri.js"></script>\n    <script src="platform-api.js${platformMatch[1] || ''}"></script>`,
);
await writeFile(join(outputRoot, 'index.html'), indexHtml);

const wasiRemoteUrl = 'https://cdn.jsdelivr.net/npm/@bjorn3/browser_wasi_shim@0.4.2/dist/index.js';
const pandocPath = join(outputRoot, 'pandoc-wasm.js');
let pandocBridge = await readFile(pandocPath, 'utf8');
if (!pandocBridge.includes(wasiRemoteUrl)) throw new Error('No se encontró la importación del shim WASI');
pandocBridge = pandocBridge.replace(wasiRemoteUrl, './vendor/browser-wasi-shim/index.js');
await writeFile(pandocPath, pandocBridge);

// Mermaid no va en index.html: mermaid-diagrams.js lo carga solo si el
// documento tiene diagramas, así que la dirección se cambia en ese archivo.
const mermaidRemoteUrl = 'https://cdn.jsdelivr.net/npm/mermaid@12.2.0/dist/mermaid.min.js';
const mermaidPath = join(outputRoot, 'mermaid-diagrams.js');
let mermaidLoader = await readFile(mermaidPath, 'utf8');
if (!mermaidLoader.includes(mermaidRemoteUrl)) throw new Error('No se encontró la dirección de Mermaid en mermaid-diagrams.js');
mermaidLoader = mermaidLoader.replace(mermaidRemoteUrl, 'vendor/mermaid/mermaid.min.js');
await writeFile(mermaidPath, mermaidLoader);

const remainingRemoteDependencies = [...indexHtml.matchAll(/(?:src|href)="(https?:\/\/(?:cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)[^\"]+)"/g)]
  .map(match => match[1]);
if (remainingRemoteDependencies.length) {
  throw new Error(`Quedan dependencias remotas: ${remainingRemoteDependencies.join(', ')}`);
}

console.log(`Aplicación de escritorio preparada en ${outputRoot}`);
