# 10. La hoja impresa lleva su propio pie con el nombre y el número de página

Fecha: 2026-11-05 · Estado: aceptado

## Contexto

Imprimir o guardar en PDF pasa por el cuadro de impresión del navegador o del
webview. El número de página solo salía marcando su casilla de encabezado y
pie, y ese pie pone a la izquierda la dirección de la página: la del editor en
la web y `tauri.localhost` en la aplicación de escritorio. En el papel no dice
nada, y una página no la puede cambiar. Arriba salía el título fijo de la
aplicación.

## Decisión

Al imprimir (`prepararPieDeImpresion`, en el botón y en `beforeprint`), la
página añade una hoja de estilo con cajas de margen de `@page`:
`@bottom-left` con el nombre del documento y `@bottom-right` con
`counter(page) " / " counter(pages)`, en la letra de la hoja, a 9 pt y en
gris. Un documento sin nombre propio no imprime «Documento sin título»: solo
el número.

Mientras dura la impresión, `document.title` es el nombre del documento, que
es lo que el navegador pone en su encabezado si se deja y lo que propone como
nombre del PDF. Vuelve con `afterprint` o al acabar la impresión de la
aplicación.

Va siempre, sin opción: un número de página en el pie es lo esperable en
cualquier documento impreso.

## Alternativas descartadas

- **Una opción para activarlo.** Sería un control más para algo que casi todo
  el mundo quiere; se añadirá si alguien necesita imprimir sin pie.
- **Cambiar la dirección que imprime el navegador.** No se puede desde la
  página: `history.replaceState` solo cambia la ruta dentro del mismo origen, y
  el origen es lo que sobra.
- **Dibujar el pie como elementos de la hoja.** Habría que repetir el
  reparto en páginas del navegador, que es quien decide dónde corta.

## Consecuencias

- En Chrome, Edge y la aplicación de Windows sale el pie sin tocar el cuadro de
  impresión.
- Con la casilla del navegador marcada, salen los dos pies: el del navegador
  pegado al borde y el de la hoja alineado con el texto. No se solapan, pero el
  número sale dos veces.

## Evidencia

- [Chrome 131 añadió las cajas de margen de `@page`](https://developer.chrome.com/blog/print-margins);
  según [caniuse](https://caniuse.com/mdn-css_at-rules_page_at_bottom-left),
  Firefox y Safari no las admiten.
- PDF de prueba desde la aplicación con Chromium 151 (2026-11-05): cinco
  páginas con `informe "aclaraciones".md` y `1 / 5`… `5 / 5`, alineados con los
  márgenes del texto. Con el pie del navegador activado a la vez, cada uno va
  en su línea.

## Riesgos y limitaciones

- Firefox, Safari, la aplicación de macOS (WKWebView) y la de Linux
  (WebKitGTK, que además ignora `@page`) no dibujan este pie. En los
  navegadores queda su propia casilla.
- Con márgenes de página muy pequeños el pie puede no caber.

## Validación

Prueba de navegador `al imprimir, el pie lleva el nombre del documento y el
número de página`, en Chromium y Firefox, y el PDF de prueba descrito arriba.
La aplicación de Windows se comprueba en una máquina virtual con Windows 11.
