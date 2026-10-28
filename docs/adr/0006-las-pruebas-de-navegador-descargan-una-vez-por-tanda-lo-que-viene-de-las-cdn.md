# 6. Las pruebas de navegador descargan una vez por tanda lo que viene de las CDN

Fecha: 2026-10-28 · Estado: aceptado

## Contexto

`index.html` carga unas veinte bibliotecas de jsDelivr y cdnjs (CodeMirror,
KaTeX, Marked, Turndown, Lucide…), y la aplicación pide otras al usarlas
(Mermaid, Tesseract). Cada prueba de `test/browser.test.mjs` abre un contexto
nuevo del navegador y carga la aplicación desde cero, así que una tanda completa
hace unas 6.700 peticiones a esas CDN.

El 28-10-2026, en GitHub, 3 de 16 tandas fallaron porque cdnjs dejó colgada una
de esas peticiones y `page.goto` agotó sus 30 s esperando a `DOMContentLoaded`.
Pasó con los dos Chromium probados, y en una de las tandas tumbó once pruebas.

## Decisión

`servirCdnDesdeCopia(context)` intercepta en cada contexto de prueba las
peticiones GET a `cdn.jsdelivr.net` y `cdnjs.cloudflare.com`. La primera vez que
aparece una dirección, Node la descarga (hasta tres intentos de 10 s) y guarda
la copia en memoria. Esa petición y las siguientes, de cualquier prueba, se
sirven desde la copia con `Access-Control-Allow-Origin: *`, porque las
etiquetas llevan `crossorigin` e `integrity`.

Si la descarga falla, o la CDN no responde con un 200, la petición sale a la red
como antes. Las rutas que registre después una prueba concreta tienen
preferencia, porque Playwright atiende primero la última registrada.

## Alternativas descartadas

- **Reintentar `page.goto`**: oculta el síntoma, pero cada carga sigue
  dependiendo de unas veinte peticiones externas.
- **Copiar las bibliotecas al repositorio o servirlas desde `node_modules`**:
  las pruebas dejarían de probar las mismas direcciones y versiones que usa la
  web publicada, y habría que mantener esa copia al día a mano.
- **Alargar el tiempo de espera**: una petición colgada puede durar más que
  cualquier plazo razonable, y alargarlo solo hace más lenta la tanda que falla.

## Consecuencias

Cada tanda depende de la CDN para unas 40 descargas en lugar de para unas
6.700, y una petición lenta se paga una vez, no en cada prueba. Las pruebas
siguen cargando lo mismo que la web publicada: si cambia una dirección en
`index.html`, la copia la sigue sin tocar nada. No hay ganancia de tiempo
medible en local (443 s frente a 449 s en Chromium), donde la red ya iba
rápida.

## Evidencia

- Registro de peticiones pendientes al agotarse `page.goto` en GitHub, el
  28-10-2026: siempre una o varias de `cdnjs.cloudflare.com` (CodeMirror,
  Turndown) con 30 s de espera.
- Playwright: cuando varias rutas casan con una petición, se atiende primero la
  registrada en último lugar
  ([`browserContext.route`](https://playwright.dev/docs/api/class-browsercontext#browser-context-route)).

## Riesgos y limitaciones

La primera descarga de cada dirección sigue pudiendo colgarse: entonces esa
prueba espera hasta 30 s y, si no llega, la petición va a la red como antes. La
copia vive en memoria durante la tanda; los datos de Tesseract son los más
pesados y caben de sobra.

## Validación

El 28-10-2026, en local, con un contador temporal en la ruta: en Chromium,
6.742 peticiones resueltas con 38 descargas y 195 de 195 pruebas superadas; en
Firefox, 6.698 peticiones con 36 descargas, 194 superadas y la que solo
funciona en Chromium saltada, como antes.
