# 12. La hoja compensa la escala de impresión de WebKit midiendo el ancho del papel

Fecha: 2026-11-12 · Estado: aceptado

## Contexto

WebKit —el motor de Safari y de las aplicaciones de macOS y Linux— compone la
página impresa a 90 píxeles de CSS por pulgada, no a los 96 del estándar. Todo
sale 96/90, un 6,7 %, más grande de lo que pide el documento: 10 cm miden
10,67 cm en el papel, y una letra de 12 pt se imprime a 12,8 pt.

Para la hoja no es solo una cuestión de tamaño. El reparto en páginas se hace
en pantalla, a 96 por pulgada, y al imprimir cada bloque que estrena página
lleva un salto forzado
([ADR 2](0002-la-hoja-reparte-columnas-y-tablas-por-paginas-sin-anadir-nada-al-texto.md)).
Con el texto un 6,7 % más grande, en cada página del papel cabe menos de lo
que la hoja le ha asignado: lo que sobra pasa a una página de más y, tras él,
llega el salto forzado. En la aplicación de Linux, el manual —10 páginas en la
hoja— salía en 16, dos de ellas en blanco y otras con dos o cinco líneas.

WebKit corrigió la escala el 31-10-2026, pero la corrección está en el código
en desarrollo y no en ninguna versión publicada que se haya podido probar. La
aplicación de Linux usa además el WebKitGTK de cada distribución, así que las
dos escalas van a convivir durante años.

## Decisión

La hoja de estilos de impresión que se genera con el formato del documento
(`applyDocumentMarginsToPrint`) lleva, solo en WebKit, una regla que mide la
escala y la compensa (`toLegacyWebKitPrintScaleRule`, en `document-format.js`):

- El papel y los márgenes del documento dicen cuántos píxeles de ancho tiene la
  caja de texto a 96 por pulgada (`printTextWidthPx`): una A4 con 1,8 cm de
  margen, 657,64 px.
- Al imprimir, `#preview-paper` ocupa el ancho de esa caja y se declara
  contenedor (`container-type: inline-size`). Una consulta de contenedor
  comprueba si mide entre el 92,5 % y el 95 % de lo esperado, que es donde cae
  el 93,75 % (90/96) de la escala antigua.
- Si es así, `#html-output` se reduce con `zoom: 0.9375`. Cada medida vuelve a
  su tamaño y el texto se parte en las mismas líneas que en pantalla.

Con la escala corregida el ancho es el esperado, la consulta no se cumple y no
se toca nada: la hoja se ajusta sola cuando llegue el motor nuevo.

WebKit se reconoce por `navigator.vendor` («Apple Computer, Inc.», también en
WebKitGTK). En los demás motores la regla no se escribe.

## Alternativas descartadas

- **Preguntar la versión del motor.** La cadena del agente no la dice: WebKit
  la tiene congelada, y la aplicación de escritorio ni siquiera lleva la de
  Safari. Tampoco se sabe aún qué versión traerá la corrección.
- **Una consulta de medios** (`@media print and (max-width: …)`). Al imprimir,
  WebKit contesta con el ancho de la ventana, no con el del papel: con una
  ventana de 900 px decía 900.
- **Reducir siempre en WebKit.** Con el motor corregido, el papel saldría un
  6,25 % más pequeño de lo debido.
- **Repartir la hoja a 90 por pulgada en WebKit**, para que coincida con el
  papel sin tocarlo. El papel seguiría saliendo más grande que lo que pide el
  documento, y la pantalla dejaría de ser igual en todos los navegadores.
- **Dar la escala al cuadro de impresión desde Rust**, en Linux. No vale para
  Safari ni para macOS, y no se ha comprobado que WebKitGTK reparta las páginas
  con esa escala.

## Consecuencias

- En la aplicación de Linux el papel vuelve a cortar donde la hoja y cada
  medida sale a su tamaño.
- La regla depende de que el papel del cuadro de impresión sea el del
  documento. Con otro papel el ancho no cuadra y no se compensa: se imprime
  como hasta ahora.
- Es una regla más que mantener hasta que la escala antigua desaparezca de los
  equipos, que en Linux serán años.

## Evidencia

- [Cambio de WebKit del 31-10-2026](https://github.com/WebKit/WebKit/commit/a47d3db47b)
  ([incidencia 329426](https://bugs.webkit.org/show_bug.cgi?id=329426)): su
  descripción dice que la página se componía a 90 px por pulgada, un 6,7 % más
  grande, por un factor de 1,25 de 2003.
- Página de prueba con dos marcas a 10 cm, impresa a PDF (2026-11-12): 10,00 cm
  en Chromium y en Firefox 160; 10,67 cm en WebKitGTK 2.50.6 y en el motor de
  Safari 27.2 sobre macOS 15.8.2 (un `WKWebView` en una máquina de GitHub).
- El manual impreso desde la aplicación cargada en WebKitGTK 2.50.6, por el
  mismo camino que la aplicación de Linux (`PrintOperation` con el `PageSetup`
  del documento): antes, 16 páginas en el papel para 10 en la hoja y el
  logotipo de 100 px a 91 puntos por pulgada; después, 10 y 10 y el logotipo a
  96, como en Firefox. En Carta apaisada con márgenes propios, 12 y 12.
- Página de sondeo con una regla por cada tramo de ancho: al imprimir en
  WebKitGTK, `(max-width)` da el ancho de la ventana.

## Riesgos y limitaciones

- **macOS no está resuelto.** En la máquina de GitHub, la aplicación cargada en
  un `WKWebView` imprime el manual encogido —el logotipo a 109 puntos por
  pulgada, un 12 % más pequeño de lo exacto— con este cambio y sin él: la caja
  de texto no mide lo esperado, la consulta no se cumple y la regla no actúa.
  La página de prueba sencilla sí sale allí a la escala antigua. La causa del
  encogimiento está sin determinar, y no se ha probado la aplicación de macOS
  instalada ni el cuadro de impresión de Safari.
- WebKit no respeta el salto de página forzado entre las filas de una tabla ni
  repite su cabecera: en una tabla partida, el corte del papel se desvía de la
  hoja en una fila. Es anterior a este cambio y sigue igual.
- La corrección de WebKit no se ha podido probar: que con ella el ancho sea el
  esperado se deduce de su descripción.

## Validación

Pruebas unitarias de `printTextWidthPx` y de la regla en
`test/document-format.test.mjs`. Prueba de navegador `en WebKit la hoja
compensa la escala antigua del papel, y solo cuando el ancho impreso la
delata`, en Chromium y Firefox haciéndose pasar por WebKit: la regla solo se
escribe para ese motor, sigue al papel y a los márgenes del documento, y la
hoja se reduce con el ancho de la escala antigua y no con el esperado ni con
otro. Y los PDF de WebKitGTK descritos arriba.
