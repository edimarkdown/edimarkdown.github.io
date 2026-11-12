# 13. El reparto en páginas deja un milímetro de holgura al final de cada página

Fecha: 2026-11-12 · Estado: aceptado

## Contexto

La hoja reparte el documento en páginas midiendo cada bloque en pantalla
([ADR 2](0002-la-hoja-reparte-columnas-y-tablas-por-paginas-sin-anadir-nada-al-texto.md)),
y al imprimir cada bloque que estrena página lleva un salto forzado, para que
el papel corte donde cortó la pantalla. Eso solo se cumple si en el papel cabe
en cada página lo mismo que en la hoja.

En Firefox no siempre cabe. El manual, que la hoja reparte en 10 páginas, salía
en 11: la página 6 terminaba en pantalla con 1,5 px libres después de una
lista, y en el papel el último punto de esa lista, de siete líneas, no entraba
y saltaba él solo a una página propia, seguida del salto forzado de la
siguiente.

Con las reglas de impresión aplicadas en pantalla, cada bloque mide lo mismo
que en la hoja: la diferencia no está en la hoja de estilos, sino en cómo
compone el motor la página impresa.

## Decisión

Al decidir si un bloque cabe en lo que queda de página, el reparto da por que
no cabe lo que entraría por menos de un milímetro (`HOLGURA_DEL_PAPEL_CM`,
0,1 cm, a la escala de la lupa). El papel conserva su caja de texto entera, así
que ese milímetro es lo que una página impresa puede crecer respecto a la de
pantalla sin desbordar a otra.

La holgura no se aplica al bloque que abre la página: uno que la llena él solo
no tiene adónde bajar, y pedirle un milímetro libre dejaría una página en
blanco delante.

El reparto por dentro de un bloque en columnas no cambia: lleva sus propias
tolerancias y se comprueba midiendo.

## Alternativas descartadas

- **Dar el milímetro en el papel**, reduciendo el margen inferior de `@page`.
  Habría que hacerlo en tres sitios —la regla de partida, la del documento y el
  `PageSetup` que Rust da al cuadro de impresión en Linux— y el texto podría
  entrar en un margen que el documento fija.
- **Corregir la causa en vez de tolerarla.** No se ha encontrado. Se probó a
  quitar al imprimir el margen inferior del bloque que cierra cada página, por
  si Firefox lo contaba al decidir si cabe, y el resultado no cambió.
- **Dejarlo como estaba.** El papel salía con una hoja más que la vista previa
  y con una página casi vacía en medio.

## Consecuencias

- En Firefox, el papel vuelve a cortar donde la hoja en el caso que fallaba.
- En todos los motores, un bloque que cabía por menos de un milímetro baja
  ahora a la página siguiente. En Chromium no hacía falta, pero una sola regla
  mantiene igual la hoja en todos los navegadores.
- La holgura absorbe hasta un milímetro por página. Una diferencia mayor entre
  la pantalla y el papel volvería a desbordar.

## Evidencia

- Firefox 160 en Linux, imprimiendo a PDF el manual desde la aplicación
  (2026-11-12), sin ventana y con ventana en una pantalla virtual, con la lupa
  al 100 % y ajustada al panel: antes, 11 páginas en el papel para 10 en la
  hoja, con una página de siete líneas; después, 10 y 10.
- Holgura medida en la hoja antes del cambio, página por página: 1,5 px en la
  página que desbordaba; en las demás, entre 1 y 142 px.
- Con las reglas de impresión emuladas en Firefox (Playwright) y la hoja al
  ancho de la caja de texto, los 110 bloques del manual miden lo mismo que en
  pantalla, salvo la tabla que en pantalla lleva los saltos entre filas.

## Riesgos y limitaciones

- No se conoce la causa de la diferencia en Firefox ni su tope: el milímetro
  sale de un caso medido, no de una cota. Es una hipótesis que sean fracciones
  de píxel acumuladas línea a línea; si lo fueran, una página con más líneas
  podría pasar del milímetro.
- La prueba automática comprueba la regla del reparto, no el PDF de Firefox,
  que las pruebas de navegador no pueden generar.

## Validación

Prueba de navegador `lo que cabe en la página por menos de un milímetro baja a
la siguiente`, en Chromium y Firefox: con 6,5 px libres dos bloques comparten
página; con 1,5 px, el segundo baja; y un bloque que llena la página él solo se
queda en ella. Y el PDF del manual desde Firefox descrito arriba.
