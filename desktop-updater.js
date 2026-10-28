/*
  Comprobación de actualizaciones de la aplicación de escritorio.

  La lógica vive aquí, aislada del DOM y de las API nativas, para poder
  probarla con Node: solo necesita la versión en marcha, el objetivo
  («linux/x86_64») y una función `fetch`.
*/
(function initDesktopUpdater(root, factory) {
  const exported = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = exported;
  } else {
    root.EdiMarkUpdater = exported;
  }
}(typeof window !== 'undefined' ? window : globalThis, function desktopUpdaterFactory() {
  const RELEASES_API_URL = 'https://api.github.com/repos/edimarkdown/edimarkdown.github.io/releases/latest';
  const RELEASES_PAGE_URL = 'https://github.com/edimarkdown/edimarkdown.github.io/releases/latest';

  // Cada plataforma ordena sus instaladores de más a menos automático: el
  // paquete nativo se instala solo y la AppImage se limita a reemplazarse.
  const PREFERRED_EXTENSIONS = {
    windows: ['exe', 'msi'],
    macos: ['dmg'],
    linux: ['deb', 'appimage'],
  };

  const ARCHITECTURE_ALIASES = new Map([
    ['x86_64', ['x86_64', 'x64', 'amd64', 'win64']],
    ['aarch64', ['aarch64', 'arm64']],
    ['arm', ['armhf', 'armv7']],
    ['x86', ['i386', 'i686', 'x86', 'ia32', 'win32']],
  ]);

  const ALL_ARCHITECTURE_TOKENS = [...ARCHITECTURE_ALIASES.values()].flat();

  function normalizeVersion(version) {
    return String(version || '').trim().replace(/^v/i, '');
  }

  /*
    Comparación numérica campo a campo. Devuelve un número negativo si `a` es
    anterior a `b`, positivo si es posterior y cero si son equivalentes. Un
    sufijo de prelanzamiento (2.18.0-beta.1) se considera anterior a la versión
    final, como en semver.
  */
  function compareVersions(a, b) {
    const split = version => {
      const [core, prerelease = ''] = normalizeVersion(version).split('-');
      return {
        numbers: core.split('.').map(part => Number.parseInt(part, 10) || 0),
        prerelease,
      };
    };
    const left = split(a);
    const right = split(b);
    const length = Math.max(left.numbers.length, right.numbers.length);
    for (let index = 0; index < length; index += 1) {
      const difference = (left.numbers[index] || 0) - (right.numbers[index] || 0);
      if (difference !== 0) return difference < 0 ? -1 : 1;
    }
    if (left.prerelease === right.prerelease) return 0;
    if (!left.prerelease) return 1;
    if (!right.prerelease) return -1;
    return left.prerelease < right.prerelease ? -1 : 1;
  }

  function parseTarget(target) {
    const [rawOs = '', rawArch = ''] = String(target || '').toLowerCase().split('/');
    const os = rawOs === 'darwin' ? 'macos' : rawOs;
    return { os, arch: rawArch };
  }

  function extensionOf(name) {
    const match = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return match ? match[1] : '';
  }

  function architectureTokens(arch) {
    for (const [canonical, aliases] of ARCHITECTURE_ALIASES) {
      if (canonical === arch || aliases.includes(arch)) return aliases;
    }
    return arch ? [arch] : [];
  }

  function mentionsToken(name, tokens) {
    const lower = String(name || '').toLowerCase();
    return tokens.some(token => new RegExp(`(^|[^a-z0-9])${token}([^a-z0-9]|$)`).test(lower));
  }

  /*
    Elige el adjunto que corresponde a esta máquina. Si ninguno nombra la
    arquitectura (una publicación con un solo instalador por sistema), se acepta
    el que tampoco nombre otra distinta.
  */
  function selectInstallerAsset(assets, target) {
    const { os, arch } = parseTarget(target);
    const extensions = PREFERRED_EXTENSIONS[os];
    if (!extensions) return null;
    const usable = (Array.isArray(assets) ? assets : []).filter(asset => asset && asset.name && asset.url);
    const wanted = architectureTokens(arch);
    for (const extension of extensions) {
      const candidates = usable.filter(asset => extensionOf(asset.name) === extension);
      const exact = candidates.find(asset => mentionsToken(asset.name, wanted));
      if (exact) return exact;
      const neutral = candidates.find(asset => !mentionsToken(asset.name, ALL_ARCHITECTURE_TOKENS));
      if (neutral) return neutral;
    }
    return null;
  }

  function normalizeRelease(release) {
    const assets = Array.isArray(release?.assets) ? release.assets : [];
    return {
      version: normalizeVersion(release?.tag_name || release?.name),
      notesUrl: release?.html_url || RELEASES_PAGE_URL,
      assets: assets.map(asset => ({
        name: String(asset?.name || ''),
        url: String(asset?.browser_download_url || ''),
        size: Number(asset?.size) || 0,
      })),
    };
  }

  async function fetchLatestRelease(fetchImpl) {
    const response = await fetchImpl(RELEASES_API_URL, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return normalizeRelease(await response.json());
  }

  /*
    Resultado uniforme para la interfaz: `available` decide si se avisa y
    `asset` si se puede ofrecer la descarga directa o solo la página web.
  */
  async function checkForUpdate({ currentVersion, target, fetchImpl = fetch } = {}) {
    const release = await fetchLatestRelease(fetchImpl);
    if (!release.version) throw new Error('La publicación no indica ninguna versión.');
    const available = compareVersions(currentVersion, release.version) < 0;
    return {
      available,
      version: release.version,
      currentVersion: normalizeVersion(currentVersion),
      notesUrl: release.notesUrl,
      asset: available ? selectInstallerAsset(release.assets, target) : null,
      releasesPageUrl: RELEASES_PAGE_URL,
    };
  }

  /*
    Descarga con progreso. Se lee el cuerpo por trozos porque un instalador
    pesa decenas de megabytes y un aviso inmóvil parecería un bloqueo.
  */
  async function downloadAsset(asset, { fetchImpl = fetch, onProgress } = {}) {
    const response = await fetchImpl(asset.url, { headers: { Accept: 'application/octet-stream' } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const expected = Number(response.headers?.get?.('content-length')) || asset.size || 0;
    if (!response.body || typeof response.body.getReader !== 'function') {
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (typeof onProgress === 'function') onProgress(1);
      return bytes;
    }
    const reader = response.body.getReader();
    const chunks = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      if (typeof onProgress === 'function') {
        onProgress(expected ? Math.min(received / expected, 1) : null);
      }
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }

  return {
    RELEASES_API_URL,
    RELEASES_PAGE_URL,
    normalizeVersion,
    compareVersions,
    selectInstallerAsset,
    fetchLatestRelease,
    checkForUpdate,
    downloadAsset,
  };
}));
