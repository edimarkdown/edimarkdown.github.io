# 11. La cabecera impresa es una opción del formato, y con cabecera o pie propios no salen los del navegador

Fecha: 2026-11-12 · Estado: aceptado

## Contexto

Desde el [ADR 10](0010-la-hoja-impresa-puede-llevar-su-propio-pie-con-el-nombre-y-el-numero-de-pagina.md)
la hoja puede imprimir su propio pie. Con ese pie elegido, Chrome retira el
suyo, pero sigue poniendo arriba su encabezado —la fecha, la hora y el título
de la página— mientras su casilla de encabezado y pie esté marcada, que es
como viene. El papel salía así con un pie del documento y una cabecera del
navegador que desde el formato no se podía quitar ni cambiar.

Chrome decide lado por lado: si la página define alguna caja de margen de
`@page` arriba, no pone su encabezado; si define alguna abajo, no pone su pie.
Basta una caja con el contenido vacío (`content: ""`); con `content: none` no
hay caja y el navegador sigue poniendo lo suyo.

## Decisión

El formato tiene un ajuste más, **Cabecera al imprimir** (`printHeader`, clave
`print-header` del bloque de metadatos), con cuatro valores: «Ninguna»,
«Nombre del documento», «Fecha» y «Nombre y fecha». Como el pie, se fija en las
opciones generales o en cada documento, y de partida vale «Ninguna».

La cabecera se dibuja igual que el pie, con cajas de margen de `@page`
(`prepararMargenesDeImpresion`): el nombre en `@top-left` y la fecha en que se
imprime en `@top-right`, escrita entera y en el idioma de la aplicación
(«12 de noviembre de 2026»), con la letra de la hoja, a 9 pt y en gris. Un
documento sin nombre propio no imprime «Documento sin título».

En cuanto el documento pide cabecera o pie, la hoja ocupa los dos lados: el que
no lleva nada recibe una caja vacía, y así no salen ni el encabezado ni el pie
del navegador. Si no pide ninguno de los dos, la hoja no añade nada y el
navegador imprime lo suyo según su casilla, como siempre.

## Alternativas descartadas

- **Quitar siempre el encabezado y el pie del navegador**, también cuando el
  documento no pide nada. Cambiaría lo que imprime quien no ha tocado el
  ajuste: quien saca el número de página con la casilla del navegador se
  quedaría sin él sin haberlo pedido.
- **Dejar la cabecera del navegador y explicar su casilla.** Es lo que había:
  un papel con pie del documento y cabecera ajena, y un ajuste del navegador
  que hay que encontrar en cada equipo.
- **No ofrecer la fecha.** Al ocupar la hoja el lado de arriba desaparece la
  fecha que ponía el navegador; sin esta opción, quien la quería no tendría
  cómo recuperarla.
- **La fecha en cifras** («12/11/2026»). Se lee de dos maneras según el país.

## Consecuencias

- Con pie o cabecera elegidos, el papel lleva solo lo que dice el formato. En
  ese caso Chrome ni siquiera ofrece su casilla en el cuadro de impresión.
- Quien tenía «Pie al imprimir» y contaba con la cabecera del navegador deja de
  verla; la recupera con «Nombre y fecha», sin la hora.
- El ADR 10 daba por hecho que, con la casilla marcada, salían los dos pies. En
  las versiones probadas aquí no es así: el del navegador desaparece.

## Evidencia

- Página mínima con `@page` y distintas cajas, impresa con
  `chrome --headless --print-to-pdf` en Chrome 145, 149, 151, 153, 156 y 157 y
  Chromium 156 (2026-11-12). En todas: sin cajas, encabezado y pie del
  navegador; con cajas solo abajo, encabezado del navegador y pie de la página;
  con una caja arriba, aunque esté vacía, sin encabezado del navegador; con
  `content: none`, como si no hubiera caja.
- Cuadro de impresión real de Chromium 156 sobre la aplicación (2026-11-12):
  en la versión 3.5.5 con solo el pie, arriba sale «fecha, hora» y el nombre
  del documento; con este cambio no sale, y la casilla «Encabezado y pie de
  página» desaparece del cuadro.
- Las mismas páginas mínimas con Edge 156 en Windows 11 (2026-11-12), que es
  también la versión de su WebView2, el motor de la aplicación de Windows:
  mismo resultado que en Chrome.
- [El artículo de Chrome sobre las cajas de margen](https://developer.chrome.com/blog/print-margins)
  dice que el navegador añade lo suyo aunque la página ponga contenido; es de
  la versión 131 y no describe este reparto por lados, que es lo observado.

## Riesgos y limitaciones

- El reparto por lados no está documentado: es lo que hacen las versiones
  probadas. Si una versión futura dejara de hacerlo, volverían a salir las
  cabeceras del navegador junto a las de la hoja.
- Firefox, Safari y las aplicaciones de macOS y Linux no entienden las cajas
  de margen: allí no salen ni esta cabecera ni el pie, y en los navegadores
  sigue mandando su casilla.
- En Windows se ha probado el motor (Edge y su WebView2, la misma versión)
  con páginas mínimas, no el cuadro de impresión de la aplicación instalada.

## Validación

Prueba de navegador `al imprimir, la cabecera y el pie llevan lo que pide el
documento, y quitan los del navegador`, en Chromium y Firefox; prueba unitaria
del ajuste en `document-format.test.mjs`; y PDF de prueba desde la aplicación
con el encabezado y el pie del navegador activados, en cinco combinaciones:
sin nada salen los del navegador, y con pie, con cabecera o con los dos sale
solo lo pedido.
