# 15. La impresión sale de una copia de la hoja partida en páginas

Fecha: 2026-11-12 · Estado: propuesto

Es una propuesta: está comprobada su base, no está construida. Lo que sigue
describe lo que se quiere hacer y lo que ya se sabe.

## Contexto

Hoy se imprime la propia hoja: cada bloque que estrena página lleva un salto
forzado y el motor reparte el papel
([ADR 2](0002-la-hoja-reparte-columnas-y-tablas-por-paginas-sin-anadir-nada-al-texto.md)).
Eso deja dos cosas sin resolver fuera de Chrome y Edge:

- **La cabecera y el pie no se imprimen** en Firefox, en Safari ni en las
  aplicaciones de macOS y Linux
  ([ADR 14](0014-la-hoja-ensena-la-cabecera-y-el-pie-del-papel-solo-donde-el-motor-los-imprime.md)):
  se dibujan con las cajas de margen de `@page`, que esos motores no tienen. En
  las aplicaciones no hay ni la casilla del navegador, así que allí un
  documento no puede llevar número de página.
- **En WebKit, una tabla partida no corta donde la hoja**: el motor no respeta
  el salto forzado entre filas ni repite la cabecera de la tabla
  ([ADR 12](0012-la-hoja-compensa-la-escala-de-impresion-de-webkit-midiendo-el-ancho-del-papel.md)).

Dibujar la cabecera y el pie anclados al bloque que estrena cada página se
probó y no basta: exige que el papel corte exactamente donde prevé la hoja, y
eso es justo lo que WebKit no cumple en las tablas. Una página que el motor
abre por su cuenta saldría sin cabecera ni pie y con la numeración corrida.

## Decisión

Al imprimir, donde el motor no tiene cajas de margen, no se imprime la hoja
sino una copia suya partida en páginas: una caja por página, del tamaño del
papel, con la cabecera arriba, el pie abajo y, entre los dos, los bloques que
la hoja asignó a esa página. El motor ya no reparte nada: solo pasa de página
al acabar cada caja.

- La copia se construye al imprimir a partir del reparto que la hoja ya tiene
  (`refreshPageBreaks`) y se retira al terminar. La hoja editable no se toca,
  así que nada puede acabar en el Markdown aunque el motor no avise de que la
  impresión ha terminado.
- Un contenedor que la hoja parte por dentro (lista, cita, tabla, bloque en
  columnas) se copia a trozos: cada página lleva su parte, y la de una tabla,
  su cabecera. Con eso las tablas cortan donde la hoja también en WebKit.
- La página lleva `@page { margin: 0 }` y los márgenes del documento pasan a
  ser el relleno de cada caja; en Linux, los márgenes que Rust da al cuadro de
  impresión son cero.
- Chrome, Edge y la aplicación de Windows siguen como están, con sus cajas de
  margen.

## Alternativas descartadas

- **Anclar la cabecera y el pie al bloque que estrena cada página.** Lo dicho
  arriba: falla en las páginas que el motor abre por su cuenta.
- **Un elemento fijo que el motor repita en cada página.** Chromium y Firefox
  lo repiten; WebKit lo pone en una sola página, y ninguno puede numerar con
  él.
- **Generar el PDF con otro motor** (Pandoc con Typst o LaTeX). El papel
  dejaría de ser lo que se ve en la hoja.
- **Dejarlo como está.** Las aplicaciones de macOS y Linux seguirían sin
  número de página.

## Consecuencias

- Es un cambio grande en la impresión de tres de los cinco sitios donde se usa
  EdiMarkdown, con riesgo de que algo que hoy sale bien salga distinto. Va en
  una rama, por pasos, y se compara con lo de ahora documento a documento.
- La copia duplica el documento mientras dura la impresión: en un documento
  muy largo habrá que medir lo que cuesta.
- Lo que depende de la posición en el documento —la numeración de una lista
  partida, los contadores, los identificadores repetidos, las reglas de estilo
  que miran el primer hijo— hay que mantenerlo a mano en cada trozo.

## Evidencia

- Página de prueba con cuatro cajas del tamaño de una A4, cada una con su
  cabecera y su pie, y una de ellas con un trozo de tabla y su cabecera
  (`scripts/print-check/prototipo/paginas-como-cajas.html`), impresa a PDF el
  2026-11-12 en Chromium, Firefox 160 y WebKitGTK 2.50.6 con los márgenes a
  cero: cuatro páginas en los tres, la cabecera a 0,9 cm del borde y el pie a
  28,75 cm, y 10 cm que miden 10,00 cm (en WebKitGTK, con la compensación de
  escala del ADR 12).
- La caja tiene que medir medio milímetro menos que la página (29,65 cm): con
  los 29,7 cm justos, WebKitGTK intercala una página en blanco tras cada una.
- La cabecera y el pie anclados al bloque, y el elemento fijo, se probaron el
  mismo día en los tres motores con los resultados que recogen las
  alternativas.

## Riesgos y limitaciones

- No se ha probado todavía en macOS, ni con una copia de la hoja real: solo la
  base, con una página hecha a mano.
- Las reglas de estilo de la hoja cuelgan de `#html-output`: la copia tiene que
  recibirlas sin duplicar ese identificador, y eso está por resolver.
- Con la ventana más estrecha que el papel la hoja no se reparte en páginas:
  habrá que repartirla al imprimir o imprimir como hasta ahora.

## Validación

Pendiente. Las herramientas de `scripts/print-check/` comparan página a página
la hoja y el papel en WebKitGTK, Firefox y macOS.
