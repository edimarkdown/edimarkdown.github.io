# 5. Las pruebas de navegador usan siempre el Chromium de Playwright

Fecha: 2026-10-28 · Estado: aceptado

## Contexto

`test/browser.test.mjs` arrancaba `/usr/bin/chromium` cuando existía y el
Chromium de Playwright solo si no. En el equipo de desarrollo ese archivo es el
Chromium estable de Debian; en las máquinas `ubuntu-latest` de GitHub es una
compilación de desarrollo de Chromium (un *snapshot*) que cambia con cada
imagen del sistema. El workflow instalaba el Chromium de Playwright, pero la
prueba no lo usaba.

El 27-10-2026 la prueba «Sirena edita un diagrama de la hoja y lo devuelve a su
bloque» terminó con «Target crashed» en unas pasadas de GitHub sí y en otras no,
mientras que en local y en el contenedor de Playwright pasaba siempre.

## Decisión

Las pruebas de navegador arrancan el Chromium que trae Playwright, sin
`executablePath`, en local y en GitHub. Es el que instala
`npx playwright install` y el que corresponde a la versión de Playwright del
`package-lock.json`.

## Alternativas descartadas

- **Seguir con `/usr/bin/chromium` solo en local** (con `!process.env.CI`): deja
  dos navegadores distintos según dónde se pruebe, que es justo lo que ocultó
  este fallo durante un día.
- **Actualizar Playwright**: la 1.64.1, la última estable, cae igual con el
  Chromium 156.0.8078.0.
- **Retocar EdiMarkdown para que no se caiga** (abrir Sirena con `noopener`):
  Sirena devuelve el diagrama por `window.opener`, y el fallo no está en la
  aplicación sino en una combinación de Playwright y navegador que Playwright no
  admite.

## Consecuencias

Lo que se prueba en local es lo mismo que se prueba en GitHub, y un cambio de
imagen de GitHub ya no puede romper las pruebas. A cambio, las pruebas ya no
pasan por el Chromium estable del sistema: eso se cubre probando la aplicación a
mano o con el skill `probar-web`. Al actualizar Playwright hay que volver a
ejecutar `npx playwright install chromium` en el equipo local.

## Evidencia

- Playwright: «Note that Playwright only works with the bundled Chromium,
  Firefox or WebKit, use at your own risk» (opción `executablePath` de
  `browserType.launch`, `node_modules/playwright-core/types/types.d.ts`,
  versión 1.62.1).
- Las [notas de la imagen ubuntu24/20261026.354](https://github.com/actions/runner-images/releases/tag/ubuntu24%2F20261026.354)
  cambian Chromium de 155.0.8059.0 a 156.0.8078.0.
- Las cuatro pasadas caídas del 27-10-2026 corrieron en la imagen 20261025.353.1;
  las siete que pasaron, en la 20261012.334.1.

## Riesgos y limitaciones

No se ha averiguado qué cambio de Chromium produce la caída. Las pasadas lentas
de GitHub dan además tiempos agotados sueltos (`page.goto` a los 30 s), que no
tienen que ver con esto.

## Validación

El 28-10-2026, en local, con el snapshot 1706520 de `chromium-browser-snapshots`
(que dice ser 156.0.8078.0):

- La prueba de Sirena cae 15 de 15 veces; con el 155.0.8059.0, ninguna.
- Una página de tres líneas que abre `window.open('about:blank', 'x')` al hacer
  clic cae con Playwright 1.62.1 y 1.64.1; no cae con `noopener`, ni con ese
  mismo Chromium manejado por CDP sin Playwright, ni con Chromium 155, el 156 de
  Debian (156.0.8078.47) o el de Playwright (151.0.7922.34).

En GitHub, 14 pasadas con el Chromium de Playwright y ninguna caída: diez
pasaron enteras, dos fallaron por tiempo agotado y dos se cortaron a los 20
minutos, en una tanda de máquinas muy lentas.
