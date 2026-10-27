# 4. Los diagramas Mermaid se dibujan en la hoja, salen como imagen y se editan con Sirena

Fecha: 2026-10-27 · Estado: aceptado

## Contexto

Un bloque de código con la etiqueta `mermaid` es la forma habitual de escribir
un diagrama en Markdown, y GitHub o eXeLearning lo dibujan. EdiMarkdown lo
enseñaba como código, en la hoja y en todo lo exportado. Pandoc tampoco lo
dibuja: lo deja como bloque de código en DOCX, ODT, EPUB, HTML y LaTeX.

Sirena, del mismo autor y con la misma licencia, es un editor de diagramas
Mermaid para quien no sabe escribirlo. Desde su versión 2.5.0 otro programa
puede abrirla con un diagrama y recibirlo de vuelta
([ADR 38 de Sirena](https://github.com/sirenaapp/sirenaapp.github.io/blob/main/docs/adr/0038-abierta-desde-otro-programa-sirena-le-devuelve-el-diagrama.md)).

## Decisión

Las tres piezas van juntas, porque lo exportado tiene que coincidir con la
pantalla.

**La hoja dibuja el diagrama.** `mermaid-diagrams.js` cambia cada bloque
`mermaid` (o `{.mermaid}`, la clase de Pandoc) por un solo elemento con el
dibujo, de modo que el índice de líneas de la hoja sigue casando con el
Markdown. El código queda en `data-edimark-mermaid`, y `buildHtmlWithTex` lo
devuelve como bloque de código antes de pasar la hoja a Markdown o a HTML: el
Markdown no cambia nunca por dibujar. Lo ya dibujado se guarda por código,
porque la hoja se rehace entera con cada tecla. Un diagrama con errores enseña
su código y el aviso de Mermaid, con la línea y lo que esperaba.

- **Mermaid 12.2.0**, el mismo que Sirena, se descarga solo cuando un diagrama
  se acerca a la pantalla, o al imprimir o exportar: pesa unos 5 MB. Cargarlo
  en cuanto el documento tenía un diagrama hacía que el manual, que se abre
  solo la primera vez y lleva uno al final, lo bajara nada más llegar; en las
  pruebas de GitHub esa descarga retrasaba la página lo bastante como para
  que la barra del móvil se moviera bajo el dedo. La web lo toma del CDN con huella SRI;
  la aplicación de escritorio lleva su copia, y `build-desktop.mjs` cambia la
  dirección en `mermaid-diagrams.js`.
- **La configuración es la de Sirena**: rótulos como texto SVG salvo que el
  diagrama tenga fórmulas. Así se ve igual en las dos aplicaciones y el
  navegador deja convertirlo en PNG. No lleva los parches de Sirena a fallos de
  Mermaid: se ve como en GitHub o en eXe.
- **Siempre en claro**, también con el tema oscuro, sobre su propio fondo
  blanco: es lo que sale en el papel y en lo exportado.
- La hoja de estilos de KaTeX pone `position: relative` a cada fórmula, y WebKit
  pintaba fuera de su caja la fórmula de un rótulo del diagrama. Dentro del
  diagrama se anula; la posición no cambia la medida.

**Al exportar, cada diagrama es una imagen.** `mapMermaidBlocks`
(`pandoc-prepare.js`) localiza los bloques con la misma regla que la hoja: solo
la primera palabra de la etiqueta, que es lo que mira marked. Cada diagrama se
dibuja y se pasa a PNG al doble de resolución, con su ancho en píxeles para que
no salga al doble de tamaño. Va sin pie, como en la hoja: seguido de un espacio
de no separación, Pandoc no lo toma por figura. Va centrado: con el estilo
«Figure» en DOCX y ODT (el que ya centra las figuras), la misma regla CSS en
HTML y EPUB, y un entorno `center` en LaTeX, que los demás formatos no leen.
El LaTeX descargado lleva los PNG en una carpeta `diagrams/` junto al `.tex`.
Un diagrama que no se puede dibujar se exporta como código y se avisa.

**Se edita con Sirena.** Doble clic sobre el diagrama, o el lápiz que aparece
al pasar por encima (en pantallas táctiles, siempre), lo abre en Sirena; el
botón de la barra junto a EdiCuaTeX abre uno nuevo. Igual que EdiCuaTeX, va en
una ventana aparte en la web y dentro de la aplicación en el escritorio, que
lleva su copia de Sirena (paquete `sirenaapp`, sin Mermaid, al que se le añade
el de la hoja). El diagrama llega en el enlace (`#z=`) y vuelve por
`postMessage`, comprobando el origen y la ventana. Al volver sustituye solo el
código de su bloque, con su valla y su sangría, en una sola operación que se
puede deshacer. Entre varios diagramas iguales se sabe cuál era por su orden.
Si mientras tanto ese bloque ha cambiado, el diagrama se añade como nuevo y se
avisa.

## Alternativas descartadas

- **Dibujar el diagrama en el documento exportado con SVG.** Word, LibreOffice
  y los lectores de EPUB no leen igual el SVG de Mermaid, que lleva estilos y a
  veces HTML dentro; el PNG sale igual en todos.
- **Hacer del diagrama una figura con pie.** La hoja no le pone pie, y lo
  exportado no coincidiría con lo que se ve.
- **Cargar Mermaid siempre al arrancar.** Son 5 MB que la mayoría de documentos
  no necesita.
- **Incluir el diagrama en el muestrario común del perfil Markdown.** Sus
  pruebas comparan la hoja con el HTML de Pandoc sin preparar, donde el
  diagrama es código. Los diagramas tienen pruebas propias.

## Consecuencias

Los documentos con diagramas se ven, se imprimen y se exportan como se
escribieron. Hay que mantener dos versiones fijadas a la vez: la de Mermaid en
`mermaid-diagrams.js` (con su SRI) y en `package.json`, y la de `sirenaapp`,
que conviene subir cuando Sirena cambie de Mermaid.

## Evidencia

- marked (18.0.9) pone en la clase del código solo la primera palabra de la
  etiqueta (`language-{.mermaid}`), por eso las dos detecciones miran solo esa.
- Con un `blob:`, WebKit no carga el dibujo bajo la política de seguridad de la
  aplicación de escritorio, y con HTML dentro el lienzo queda contaminado en
  todos los navegadores; con una dirección `data:` funciona en los tres motores.

## Riesgos y limitaciones

- La web necesita conexión la primera vez que dibuja un diagrama; sin ella,
  enseña el código y lo dice.
- El diagrama de una lista sale centrado en la página, no sangrado con la
  lista.
- Mermaid y Sirena en WebKitGTK, el motor de la aplicación de escritorio en
  Linux, solo se han probado con el WebKit de Playwright y la política de
  seguridad de la aplicación, no en la aplicación instalada. Con esa política,
  el único script en línea de Sirena (el que corrige una dirección sin barra
  final) no se ejecuta; en el escritorio no hace falta, porque se abre por
  `index.html`.

## Validación

27-10-2026, en Chromium, Firefox y WebKit: dibujo de un diagrama de flujo, un
mapa mental, uno con fórmula y uno con errores; ida y vuelta por la edición
visual sin cambiar los bloques; exportación desde la aplicación a DOCX, ODT y
EPUB con el Pandoc real (imágenes dentro, estilo «Figure» centrado, sin pie) y
vista en LibreOffice; PNG con fórmula idéntico en los tres motores; impresión a
PDF; `dist/` servido con la política de seguridad de Tauri y sin red exterior;
y Sirena editando el segundo de dos diagramas iguales dentro de una lista, uno
con `~~~ {.mermaid}`, uno nuevo y cancelar.
