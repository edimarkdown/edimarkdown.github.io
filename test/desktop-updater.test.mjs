import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

import updater from '../desktop-updater.js';

const { compareVersions, selectInstallerAsset, checkForUpdate, downloadAsset } = updater;

const asset = name => ({ name, url: `https://example.test/${name}` });

test('ordena versiones por número y no como texto', () => {
  assert.ok(compareVersions('2.9.0', '2.10.0') < 0);
  assert.ok(compareVersions('2.17.0', 'v2.17.0') === 0);
  assert.ok(compareVersions('2.18.0', '2.17.9') > 0);
  assert.ok(compareVersions('2.18.0-beta.1', '2.18.0') < 0);
});

test('elige el instalador más automático de cada sistema', () => {
  const assets = [
    asset('EdiMarkdown_2.18.0_amd64.deb'),
    asset('EdiMarkdown_2.18.0_amd64.AppImage'),
    asset('EdiMarkdown_2.18.0_x64-setup.exe'),
    asset('EdiMarkdown_2.18.0_x64_en-US.msi'),
    asset('EdiMarkdown_2.18.0_aarch64.dmg'),
    asset('EdiMarkdown_2.18.0_x64.dmg'),
  ];
  assert.equal(selectInstallerAsset(assets, 'linux/x86_64').name, 'EdiMarkdown_2.18.0_amd64.deb');
  assert.equal(selectInstallerAsset(assets, 'windows/x86_64').name, 'EdiMarkdown_2.18.0_x64-setup.exe');
  assert.equal(selectInstallerAsset(assets, 'macos/aarch64').name, 'EdiMarkdown_2.18.0_aarch64.dmg');
  assert.equal(selectInstallerAsset(assets, 'macos/x86_64').name, 'EdiMarkdown_2.18.0_x64.dmg');
});

test('descarta los instaladores de otra arquitectura', () => {
  const assets = [asset('EdiMarkdown_2.18.0_arm64.deb'), asset('EdiMarkdown_2.18.0_amd64.AppImage')];
  assert.equal(selectInstallerAsset(assets, 'linux/x86_64').name, 'EdiMarkdown_2.18.0_amd64.AppImage');
  assert.equal(selectInstallerAsset(assets, 'linux/aarch64').name, 'EdiMarkdown_2.18.0_arm64.deb');
  assert.equal(selectInstallerAsset([asset('notas.txt')], 'linux/x86_64'), null);
});

test('acepta el único instalador cuando la publicación no nombra la arquitectura', () => {
  const assets = [asset('EdiMarkdown-setup.exe')];
  assert.equal(selectInstallerAsset(assets, 'windows/x86_64').name, 'EdiMarkdown-setup.exe');
});

test('avisa solo cuando la versión publicada es posterior', async () => {
  const release = {
    tag_name: 'v2.18.0',
    html_url: 'https://example.test/notas',
    assets: [{ name: 'EdiMarkdown_2.18.0_amd64.deb', browser_download_url: 'https://example.test/deb', size: 10 }],
  };
  const fetchImpl = async () => ({ ok: true, json: async () => release });

  const nueva = await checkForUpdate({ currentVersion: '2.17.0', target: 'linux/x86_64', fetchImpl });
  assert.equal(nueva.available, true);
  assert.equal(nueva.version, '2.18.0');
  assert.equal(nueva.asset.url, 'https://example.test/deb');

  const alDia = await checkForUpdate({ currentVersion: '2.18.0', target: 'linux/x86_64', fetchImpl });
  assert.equal(alDia.available, false);
  assert.equal(alDia.asset, null);
});

test('propaga los errores HTTP de la consulta', async () => {
  const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });
  await assert.rejects(
    checkForUpdate({ currentVersion: '2.17.0', target: 'linux/x86_64', fetchImpl }),
    /HTTP 403/,
  );
});

test('descarga por trozos e informa del progreso', async () => {
  const chunks = [new Uint8Array([1, 2]), new Uint8Array([3, 4, 5])];
  const fetchImpl = async () => ({
    ok: true,
    headers: { get: () => '5' },
    body: {
      getReader() {
        let index = 0;
        return {
          read: async () => (index < chunks.length
            ? { done: false, value: chunks[index++] }
            : { done: true, value: undefined }),
        };
      },
    },
  });
  const progress = [];
  const bytes = await downloadAsset(
    { name: 'x.deb', url: 'https://example.test/x.deb', size: 5 },
    { fetchImpl, onProgress: ratio => progress.push(ratio) },
  );
  assert.deepEqual([...bytes], [1, 2, 3, 4, 5]);
  assert.deepEqual(progress, [0.4, 1]);
});

/*
  La versión se escribe en cuatro sitios. Los instaladores toman su número de
  tauri.conf.json: en la 3.5.0 se quedó en 3.4.0 y salieron con el número
  anterior, así que el actualizador los habría vuelto a ofrecer sin fin.
*/
test('la versión coincide en la web, en npm, en Tauri y en Rust', () => {
  const leer = ruta => readFileSync(new URL(`../${ruta}`, import.meta.url), 'utf8');
  const npm = JSON.parse(leer('package.json')).version;
  assert.equal(JSON.parse(leer('src-tauri/tauri.conf.json')).version, npm);
  assert.equal(leer('src-tauri/Cargo.toml').match(/^version = "([^"]+)"/m)[1], npm);
  assert.equal(leer('script.js').match(/^const APP_VERSION = '([^']+)';/m)[1], npm);
});
