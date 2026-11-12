# 10. La hoja impresa puede llevar su propio pie con el nombre y el número de página

Fecha: 2026-11-05 (revisado el mismo día: pasa a ser opcional) · Estado: aceptado

## Contexto

Imprimir o guardar en PDF pasa por el cuadro de impresión del navegador o del
webview. El número de página solo salía marcando su casilla de encabezado y
pie, y ese pie pone a la izquierda la dirección de la página: la del editor en
la web y `tauri.localhost` en la aplicación de escritorio. En el papel no dice
nada, y una página no la puede cambiar. Arriba salía el título fijo de la
aplicación.

## Decisión

El pie es un ajuste del formato, **Pie al imprimir** (`printFooter`, clave
`print-footer` del bloque de metadatos), con tres valores: «Ninguno»,
«Número de página» y «Nombre y número de página». Como los demás, se fija en
las opciones generales o en cada documento. De partida vale «Ninguno», que es
como se imprimía antes de existir el ajuste.

Al imprimir (`prepararMargenesDeImpresion`, en el botón y en `beforeprint`), si el
documento pide pie, la página añade una hoja de estilo con cajas de margen de
`@page`: `@bottom-right` con `counter(page) " / " counter(pages)` y, con
«Nombre y número de página», `@bottom-left` con el nombre del documento, en la
letra de la hoja, a 9 pt y en gris. Un documento sin nombre propio no imprime
«Documento sin título»: solo el número.

Mientras dura la impresión, `document.title` es el nombre del documento, que
es lo que el navegador pone en su encabezado si se deja y lo que propone como
nombre del PDF. Vuelve con `afterprint` o al acabar la impresión de la
aplicación.


## Alternativas descartadas

- **Ponerlo siempre, sin opción.** Fue la primera versión (3.5.2), y no todo
  el mundo quiere un pie en el papel.
- **Activarlo de partida.** Cambiaría lo que imprime quien ya usaba la
  aplicación sin haberlo pedido.
- **Cambiar la dirección que imprime el navegador.** No se puede desde la
  página: `history.replaceState` solo cambia la ruta dentro del mismo origen, y
  el origen es lo que sobra.
- **Dibujar el pie como elementos de la hoja.** Habría que repetir el
  reparto en páginas del navegador, que es quien decide dónde corta.

## Consecuencias

- En Chrome, Edge y la aplicación de Windows, quien lo elige tiene el pie sin
  tocar el cuadro de impresión; quien no, imprime como siempre.
- Con la casilla del navegador marcada, Chrome retira su pie al ver el de la
  hoja, pero no su encabezado. De ahí sale el
  [ADR 11](0011-la-cabecera-impresa-es-una-opcion-del-formato-y-con-cabecera-o-pie-propios-no-salen-los-del-navegador.md),
  que hace opcional también la cabecera y quita la del navegador.

## Evidencia

- [Chrome 131 añadió las cajas de margen de `@page`](https://developer.chrome.com/blog/print-margins);
  según [caniuse](https://caniuse.com/mdn-css_at-rules_page_at_bottom-left),
  Firefox y Safari no las admiten.
- PDF de prueba desde la aplicación con Chromium 151 (2026-11-05): cinco
  páginas con `informe "aclaraciones".md` y `1 / 5`… `5 / 5`, alineados con los
  márgenes del texto.

## Riesgos y limitaciones

- Firefox, Safari, la aplicación de macOS (WKWebView) y la de Linux
  (WebKitGTK, que además ignora `@page`) no dibujan este pie. En los
  navegadores queda su propia casilla.
- Con márgenes de página muy pequeños el pie puede no caber.

## Validación

Prueba de navegador `al imprimir, la cabecera y el pie llevan lo que pide el
documento, y quitan los del navegador`, en Chromium y Firefox, que también elige el
valor en el desplegable y comprueba que llega al Markdown; prueba unitaria del
ajuste en `document-format.test.mjs`, y el PDF de prueba descrito arriba.
La aplicación de Windows se comprueba en una máquina virtual con Windows 11.
