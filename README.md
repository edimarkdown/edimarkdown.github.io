# EdiMarkdown

EdiMarkdown es un editor Markdown orientado a docentes, estudiantes y creadores técnicos que necesitan escribir, visualizar y exportar contenido sin montar una cadena de herramientas. Funciona en el navegador y también como aplicación de escritorio para Linux, Windows y macOS, con las mismas prestaciones: edición Markdown y HTML sincronizada, soporte completo de LaTeX con KaTeX y utilidades de importación/exportación basadas en Pandoc.

- 🌐 Aplicación publicada en: [https://edimarkdown.github.io/](https://edimarkdown.github.io/)
  - Hasta la versión 3.4.0 estaba en `edimarkweb.github.io`. Esa dirección lleva a esta y, si el navegador guarda documentos de allí, ofrece traerlos con un clic.
- 💻 Aplicación de escritorio: [últimos instaladores para Linux, Windows y macOS](https://github.com/edimarkdown/edimarkdown.github.io/releases/latest)
  - 🍎 En macOS, la primera vez hay que quitar la cuarentena: `xattr -dr com.apple.quarantine /Applications/EdiMarkdown.app` ([por qué](manual.md#la-aplicación-de-escritorio))
- 📘 Manual de usuario: [manual.md](manual.md) (también en [inglés](manual-en.md), [català](manual-ca.md), [galego](manual-gl.md) y [euskara](manual-eu.md))
- 🐞 Incidencias y mejoras: [Issues de GitHub](https://github.com/edimarkdown/edimarkdown.github.io/issues)

![Interfaz de EdiMarkdown](logo.png)

## Características principales

- **Edición dual sincronizada**: dos editores del mismo documento —el editor Markdown y el editor visual—, que se actualizan al instante el uno con el otro.
- **Pestañas ilimitadas con autoguardado**: trabaja con varios documentos a la vez; cada pestaña guarda una copia local para evitar pérdidas.
- **Menú Archivo unificado**: abrir (`Ctrl+O`), importar PDF y documentos de oficina (`Ctrl+Alt+O`), pegar LaTeX (`Ctrl+Mayús+V`), guardar (`Ctrl+S`), guardar como (`Ctrl+Mayús+S`) y exportar a DOCX, ODT, EPUB, HTML autónomo o LaTeX completo.
- **Soporte matemático avanzado**: integración con KaTeX y acceso directo a EdiCuaTeX para insertar expresiones complejas.
- **Imágenes con ruta relativa**: los `![](imagenes/01.png)` de cualquier Markdown se muestran en el editor visual. La aplicación de escritorio las busca sola en la carpeta del documento; en el navegador, un aviso ofrece vincular esa carpeta —o basta con arrastrarla al editor— y las imágenes usadas se conservan al recargar la página. Al guardar, las imágenes recuperadas se copian con el `.md` conservando su estructura (en navegadores sin escritura de carpetas, dentro de un ZIP). Las imágenes extraídas de Base64 se organizan en `documento/images/`. El Markdown mantiene siempre la ruta original, y al insertar una imagen se puede elegir entre referenciarla (lo recomendado) o incrustarla en el documento.
- **Corrección ortográfica del sistema**: el editor activa el corrector disponible en el navegador o WebView y selecciona el diccionario según el idioma efectivo del documento.
- **Editor visual**: escribe sobre el resultado final con la misma barra de formato, copia HTML o genera variantes LaTeX desde un menú contextual.
- **Citas académicas portables**: carga bibliotecas BibTeX o CSL JSON —o usa la bibliografía de ejemplo incluida—, busca y edita citas múltiples, elige APA 7 (predeterminado), Chicago, MLA, IEEE o un CSL propio, y personaliza el título y nivel de la bibliografía; Pandoc/citeproc compone en la vista previa y en DOCX, ODT, EPUB, HTML, LaTeX y PDF. Al guardar `documento.md`, la biblioteca viaja en `documento/references.bib` (o `.json`) y queda declarada en sus metadatos YAML.
- **Búsqueda y reemplazo inteligente**: ignora tildes y mayúsculas, resalta coincidencias, admite expresiones regulares y ofrece navegación rápida.
- **Internacionalización y accesibilidad**: selector de idioma, control del tamaño de fuente, modo claro/oscuro y atajos visibles.
- **Diseño adaptable**: barras plegables, modo escritorio independiente, área de edición a pantalla completa y posibilidad de ampliar el ancho de trabajo.
- **Aplicación de escritorio**: paquetes nativos para Linux, Windows y macOS que asocian los archivos `.md`, guardan sobre el documento original, funcionan sin conexión —Pandoc y EdiCuaTeX van incluidos— y avisan de las versiones nuevas ofreciendo descargarlas e instalarlas.

## Flujo de trabajo destacado

| Zona | Qué ofrece |
| --- | --- |
| **Barra superior** | Gestión de archivos, idioma, tamaño de fuente, tema, ancho expandido, ventana independiente, impresión, diálogo «Acerca de» y acceso directo al manual (`Ctrl+H`). En la aplicación de escritorio añade «Buscar actualizaciones…» y «Salir». |
| **Barra de herramientas** | Formatos básicos, listas, citas, bloques de código, enlaces, imágenes, tablas y un menú de fórmulas con snippets listos. |
| **Editor Markdown** | Editor de texto con contador de caracteres, indicador de idioma del documento, plegado de imágenes base64, botón de copia y soporte de arrastrar y soltar archivos o carpetas enteras (`.md` y también DOCX, ODT, EPUB, HTML o TEX, que se convierten al vuelo). |
| **Editor visual** | Escribe sobre el documento compuesto, cambia entre este y el código HTML, copia contenido con distintos perfiles (HTML, LaTeX parcial o completo). |

Las pestañas muestran un punto rojo (`●`) cuando hay cambios sin guardar y pueden renombrarse con doble clic. El autoguardado recupera el contenido al recargar la página o al volver a abrir la aplicación; cada versión, web y escritorio, mantiene su propia copia de trabajo.

## Importación, exportación y copia rápida

- **Imágenes**: las rutas relativas se resuelven contra la carpeta del documento (escritorio) o contra la carpeta vinculada por el usuario (navegador), y las que no se encuentran se marcan en el editor visual en lugar de aparecer rotas.
- **Importar**: abre Markdown locales, pega documentos LaTeX completos o convierte ficheros mediante Pandoc (DOCX, ODT, EPUB, HTML, TEX). Al arrastrar y soltar se admiten carpetas enteras, que se recorren en busca de archivos compatibles. Las imágenes de los documentos DOCX, ODT y EPUB se extraen del archivo y se incrustan en el Markdown. Los PDF se convierten localmente con Python/WebAssembly (PyMuPDF4LLM sin el motor Layout nativo) y Tesseract.js puede aplicar OCR, página a página, a las escaneadas, incluidas las que solo conservan un número o una referencia sobre la imagen; es una opción que solo aparece si el documento tiene páginas escaneadas, desactivada por defecto y, cuando el reconocimiento no aporta más que la conversión normal, se conservan la imagen y el texto de esta. Incluyen selección de páginas, idioma de reconocimiento, eliminación opcional de encabezados y pies repetidos, conservación de imágenes —las fotografías se guardan como JPEG, igual que venían en el archivo— y fórmulas detectadas como imágenes, y vista previa antes de abrir una pestaña nueva. Las tablas, fórmulas y el texto reconocido requieren revisión. El conversor se carga bajo demanda; el escritorio incluye también el motor y cinco idiomas para trabajar sin conexión. Límite: 50 MB por PDF, sin tope de páginas; las imágenes salen como archivos junto al documento y la conversión avisa del tiempo que le queda.
- **Exportar**: genera descargas inmediatas en DOCX, ODT, EPUB (libro digital), HTML autónomo (con estilos y fórmulas incrustados) o LaTeX preparado para compilar, además de PDF mediante impresión. Todos los formatos declaran el idioma del documento —corrector ortográfico en DOCX y ODT, partición de palabras en LaTeX, atributo `lang` en HTML y EPUB— y el `.tex` usa el primer encabezado como título. Desde **Configuración → Opciones generales…** se fijan ese idioma, el autor, la portada del EPUB (generada, propia o ninguna), el índice automático, la numeración de apartados, la biblioteca y el estilo de citas y, para LaTeX, la clase, sus opciones y un preámbulo propio que se reutiliza en cada exportación. El HTML autónomo toma el título de la pestaña del primer encabezado. Cada documento puede además llevar el suyo: el botón de idioma de la barra de estado lo guarda como `lang` en el front matter del `.md`, de modo que viaja con el archivo.
- **Copiar**: botones dedicados para copiar Markdown del editor Markdown o seleccionar, desde el editor visual, qué formato enviar al portapapeles.

## Atajos esenciales

| Acción | Windows / Linux | macOS |
| --- | --- | --- |
| Negrita / Cursiva | `Ctrl+B`, `Ctrl+I` | `Cmd+B`, `Cmd+I` |
| Encabezados H1–H6 | `Ctrl+1..6` | `Cmd+1..6` |
| Lista / Lista numerada | `Ctrl+Mayús+L` / `Ctrl+Mayús+O` | `Cmd+Mayús+L` / `Cmd+Mayús+O` |
| Nueva pestaña / Cerrar | `Ctrl+Alt+N` / `Ctrl+Alt+W` | `Cmd+Alt+N` / `Cmd+Alt+W` |
| Pestaña siguiente / anterior | `Ctrl+Alt+AvPág` / `Ctrl+Alt+RePág` | `Cmd+Alt+AvPág` / `Cmd+Alt+RePág` |
| Fórmula en línea / en bloque | `Ctrl+M` y luego `1` / `2` | `Cmd+M` y luego `1` / `2` |
| Deshacer / Rehacer | `Ctrl+Z` / `Ctrl+Mayús+Z` | `Cmd+Z` / `Cmd+Mayús+Z` |
| Abrir / Guardar / Guardar como | `Ctrl+O` / `Ctrl+S` / `Ctrl+Mayús+S` | `Cmd+O` / `Cmd+S` / `Cmd+Mayús+S` |
| Importar / Exportar | `Ctrl+Alt+O` / `Ctrl+Alt+E` | `Cmd+Alt+O` / `Cmd+Alt+E` |
| Editor EdiCuaTeX | `Ctrl+Alt+M` | `Cmd+Alt+M` |
| Pegar LaTeX | `Ctrl+Mayús+V` | `Cmd+Mayús+V` |
| Cambiar diseño | `Ctrl+L` | `Cmd+L` |
| Buscar | `Ctrl+F` | `Cmd+F` |
| Manual | `Ctrl+H` o `F1` | `F1` |
| Imprimir | `Ctrl+P` | `Cmd+P` |

Consulta la tabla completa en el [manual](manual.md#atajos-de-teclado).

## Ejecutar la aplicación en local

1. Clona el repositorio usando SSH (configurado en `~/.gitconfig`):
   ```bash
   git clone git@github.com:edimarkdown/edimarkdown.github.io.git
   cd edimarkdown.github.io
   ```
2. Opción rápida: abre `index.html` directamente en tu navegador. Ten en cuenta que la versión web carga varias bibliotecas desde CDN, así que necesita conexión; la que funciona sin ella es la aplicación de escritorio, que las lleva incorporadas.
3. Si prefieres servirlo localmente, utiliza la utilidad que quieras (`python -m http.server`, `npx serve`, etc.) para evitar restricciones de origen en algunos navegadores.

### Construir los estilos (opcional)

El CSS principal (`tailwind.build.css`) ya está generado. Si modificas `tailwind.css`, ejecuta:

```bash
npm install
npm run build:css
```

### Aplicación de escritorio

La aplicación de Linux, Windows y macOS reutiliza el mismo frontend mediante Tauri 2. El proceso de
construcción crea `dist/` con todas las bibliotecas y Pandoc en local, por lo que el ejecutable no
depende de los CDN para arrancar ni para editar o exportar documentos.

En Debian, MX Linux y derivados instala una vez los requisitos nativos:

```bash
sudo apt install libwebkit2gtk-4.1-dev libdbus-1-dev libxdo-dev \
  libssl-dev libayatana-appindicator3-dev librsvg2-dev build-essential
```

Después instala Rust y las dependencias npm. Para abrir el prototipo o generar los instaladores:

```bash
npm install
npm run desktop:dev
npm run desktop:build
```

En Linux se generan paquetes DEB y AppImage; en Windows, instaladores MSI y NSIS; y en macOS,
una imagen DMG por arquitectura, la de Apple silicon y la de Intel. Los DMG no se firman con una
identidad de desarrollador de Apple ni se notarizan, así que macOS los marca en cuarentena y al
abrirlos avisa de que la aplicación «está dañada»; se resuelve una sola vez con
`xattr -dr com.apple.quarantine /Applications/EdiMarkdown.app`, que es lo que documenta el manual.
Firmarlos exigiría una cuenta del Apple Developer Program y sus secretos en el flujo. El flujo
`Native application builds` de GitHub Actions adjunta esos instaladores a GitHub Releases al
crear una etiqueta `v*` o al indicar manualmente una etiqueta existente. Los paquetes de Linux se
construyen en Ubuntu 22.04 a propósito: el binario queda atado a la glibc de la máquina que lo
compila, y una más reciente dejaría fuera a Debian 12 y a Ubuntu 22.04.

El corrector ortográfico utiliza los diccionarios del sistema. Windows y macOS toman los idiomas
instalados en el dispositivo; en Linux puede ser necesario instalar el paquete Hunspell del idioma
que falte (por ejemplo, `hunspell-es`), pero no herramientas de desarrollo.

### Pruebas

```bash
npm install
npm test              # rápido: preparación del Markdown (títulos, metadatos, imágenes)
npm run test:platform # capa de plataforma compartida entre web y escritorio
npm run test:updater  # comprobación de versiones y elección del instalador
npm run test:browser  # interfaz real en Chromium y Firefox con Playwright
npm run test:export   # lento: convierte con el pandoc.wasm real y valida el EPUB/DOCX/ODT
npm run test:all
```

`npm run test:export` carga el WASM de Pandoc incluido en el repositorio y comprueba que cada
documento de muestra produce un archivo **no vacío** y con estructura válida. Pandoc señala sus
fallos internos dejando la salida vacía en lugar de lanzar un error, así que estas pruebas son las
que evitan que una exportación rota llegue al usuario como una descarga de 0 bytes.

## Tecnologías empleadas

- **HTML5 / CSS3 / JavaScript** sin framework.
- **Tailwind CSS** y `@tailwindcss/typography` para la capa visual.
- **CodeMirror** para la vista de código HTML.
- **Marked.js** y **Turndown + plugin GFM** para las conversiones Markdown ↔ HTML.
- **KaTeX** y **EdiCuaTeX** para matemáticas.
- **Split.js** para la distribución de paneles y **Lucide Icons** para los iconos.

## Lo que se carga de fuera

La versión web descarga sus bibliotecas de dos CDN, con la versión fijada y comprobación de integridad (SRI). No envía los documentos a ningún servidor ni recoge estadísticas de uso.

| Dirección | Qué se carga | Cuándo |
| :--- | :--- | :--- |
| `cdn.jsdelivr.net` | Marked, KaTeX y sus tipografías, Lucide, Split.js, Tesseract.js y el adaptador que ejecuta Pandoc en el navegador (browser_wasi_shim) | Al abrir |
| `cdnjs.cloudflare.com` | CodeMirror y Turndown | Al abrir |
| `cdn.jsdelivr.net` | Motor del OCR y datos del idioma elegido | Al aplicar OCR a un PDF |
| `edicuatex.github.io` | EdiCuaTeX, el editor visual de fórmulas | Al pulsar su botón |
| `www.youtube.com` e `i.ytimg.com` | Vídeos incrustados y sus miniaturas | Solo si el documento incluye alguno |

Pandoc y el conversor de PDF (Pyodide y PyMuPDF) se sirven desde el propio sitio. Sin conexión la versión web no arranca, porque el editor llega de un CDN. La aplicación de escritorio lleva todo dentro, también EdiCuaTeX y el OCR en cinco idiomas, y funciona sin conexión; solo sale a internet para comprobar si hay una versión nueva (`api.github.com`) y para las miniaturas de los vídeos incrustados.

## Contribuir

1. Crea un fork y una rama descriptiva.
2. Instala dependencias si necesitas regenerar CSS (`npm install`).
3. Asegúrate de que tus cambios funcionan en navegadores modernos (Chromium/Firefox).
4. Envía un pull request describiendo el problema resuelto y, si aplica, captura o vídeo corto.

Para reportar errores o proponer mejoras, utiliza las [incidencias de GitHub](https://github.com/edimarkdown/edimarkdown.github.io/issues). El [manual](manual.md) sirve como referencia funcional para validar comportamientos.

## Cómo se ha hecho

EdiMarkdown se programa en el nivel 4 del [MIAE](https://jjdeharo.github.io/miae/?nivel=4), la colaboración avanzada entre la persona y la IA. El código se ha escrito en diálogo con asistentes de IA, entre ellos Claude Code. El autor decide qué hace el programa y cómo se usa, prueba cada cambio en pantalla y corrige lo que no funciona. Cada versión pasa además las pruebas automáticas descritas en [Pruebas](#pruebas), en Chromium y Firefox.

## Licencia

El código de EdiMarkdown se distribuye bajo la [GNU Affero General Public License v3.0](LICENSE). Puedes usarlo, modificarlo y desplegarlo siempre que mantengas la misma licencia, publiques las mejoras y entregues el código fuente cuando la aplicación se ofrezca como servicio.
