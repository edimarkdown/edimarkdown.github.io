# 2. La hoja reparte columnas y tablas por páginas sin añadir nada al texto

Fecha: 2026-10-26 · Estado: aceptado

## Contexto

La vista previa reparte el documento en hojas empujando hacia abajo el primer
bloque de cada página (`data-page-start` y un `margin-top`). Un contenedor más
alto que la página —lista, cita, sección de notas— se abre (`data-page-split`) y
se empujan sus hijos. Dos casos quedaban fuera:

- Un bloque en columnas (`<div style="column-count:4">`) más alto que la
  página. Si se abría, los saltos caían en puntos sueltos de una columna; si no,
  pasaba entero y el hueco entre hojas atravesaba las filas. Al imprimir, el
  bloque se mantenía entero (`break-inside: avoid`) y bajaba a otra hoja,
  dejando la anterior casi en blanco.
- Una tabla más alta que la página. Pasaba entera y el hueco entre hojas
  atravesaba las filas del corte, mientras que el papel sí la partía.

La hoja es editable y todo lo que contiene vuelve al Markdown, así que el
reparto no puede añadir elementos al texto.

## Decisión

**Columnas.** El bloque en columnas no se abre. Se marca con `data-page-flow`
para que el papel pueda partirlo, y se reparte como en el papel: se llenan las
columnas de cada página y el juego se cierra al final de la hoja. La pieza que
cierra cada página lleva `data-column-end`, y su `::after` con `column-span:
all` cierra el juego de columnas. En pantalla mide el hueco hasta la hoja
siguiente (`--column-jump`); en el papel es un salto de página. La pieza de
cierre se estima llenando columnas con la altura de cada pieza y se confirma
midiendo.

**Tablas.** Una tabla más alta que la página se parte por filas. Una fila no
admite margen, así que el salto va en un `::before` de cada celda de la fila que
estrena página. La cabecera se repite arriba de cada página, como hace el
navegador al imprimir: es una copia en la capa de las hojas (`#page-sheets`),
fuera del texto editable, con el ancho de cada columna, la letra y la alineación
de la original. Al imprimir, la fila lleva el salto de página, ninguna fila se
parte y la cabecera se deja entera, porque si se pudiera partir Chromium dejaría
de repetirla.

Los dos pseudoelementos del hueco, el de las columnas y el de las filas, no
reciben clics (`pointer-events: none`): en Firefox, pulsar en el hueco entre
hojas llevaba el cursor al principio del documento, y lo que se escribía iba al
título.

**Turndown** conserva el `div` de columnas al volver de la hoja al Markdown, sin
las marcas del reparto.

**Tema al imprimir.** Mientras se imprime se quita el tema oscuro (clase `dark`),
y vuelve al terminar (`afterprint` o lo primero que se toque).

## Alternativas descartadas

- Abrir el bloque en columnas y empujar sus puntos: dentro de una columna, el
  salto descoloca la columna entera.
- Dejar que el bloque en columnas se equilibre en toda su longitud: el hueco
  entre hojas atraviesa las filas.
- Partir el bloque en varios `div`, uno por página: añade elementos a la hoja,
  que pasarían al Markdown o cambiarían al editar.
- Empujar la fila de la tabla con `padding-top` o un borde transparente en las
  celdas: con `border-collapse`, el borde ancho se come la línea de la fila
  anterior, y el relleno pinta el fondo de la celda en el hueco.
- Repetir la cabecera clonándola dentro de la tabla: sería editable y acabaría
  en el Markdown.
- No repetir la cabecera ni en pantalla ni en el papel: el papel la repetía ya,
  y quitarla empeoraba lo impreso.
- Corregir el tema oscuro al imprimir regla a regla: hay unas 160 reglas
  `.dark`, y cualquier regla nueva volvería a colarse en el papel.

## Consecuencias

- Ninguna línea de un bloque en columnas ni ninguna fila de una tabla queda
  atravesada por el hueco entre hojas, y el papel corta donde la pantalla.
- La paginación cuesta más en WebKit con bloques en columnas largos: unos
  0,2 s por reparto en una lista de 422 puntos a cuatro columnas (0,02 s en
  Chromium). Solo se reparte cuando cambia la altura de la hoja.
- La impresión ya no hereda el tema oscuro: el papel es siempre blanco.

## Evidencia

- `script.js`: `refreshPageBreaks`, `repartirColumnas`, `bloquesPaginables`,
  `cabecerasRepetidas`, `imprimirEnClaro`; `style.css`: reglas de
  `data-column-end`, `tr[data-page-start]` y `@media print`.
- Chromium repite la cabecera de una tabla partida solo si el `thead` no se puede
  partir: comprobado imprimiendo el manual con y sin `break-inside: avoid` en el
  `thead`.

## Riesgos y limitaciones

- Con una tabla partida, la pantalla y el papel coinciden en Chromium. En
  Firefox no se ha podido comprobar el PDF de forma automática.
- Si en el documento la estimación de la pieza de cierre de columnas se queda
  corta, la página lleva un punto menos que en el papel: con la lista de prueba,
  en una de cuatro páginas.
- Un bloque en columnas dentro de una lista o una cita no se reparte: no se abre
  más allá de `PROFUNDIDAD_MAXIMA`.

## Validación

- `test/browser.test.mjs`: «un bloque en columnas más largo que la página se
  reparte por páginas», «escribir en la hoja conserva el bloque en columnas»,
  «pulsar en el hueco entre hojas deja el cursor en el bloque en columnas»,
  «una tabla más larga que la página se parte por filas» y «con el tema oscuro
  se imprime en claro», en Chromium y Firefox.
- Manual y lista de cuatro columnas comprobados a mano en Chromium, Firefox y
  WebKit, y en PDF de Chromium (mismos cortes que la pantalla, cabecera
  repetida, fondo blanco con el tema oscuro).
