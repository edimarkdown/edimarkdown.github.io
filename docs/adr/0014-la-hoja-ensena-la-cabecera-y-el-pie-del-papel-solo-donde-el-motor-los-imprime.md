# 14. La hoja enseña la cabecera y el pie del papel solo donde el motor los imprime

Fecha: 2026-11-12 · Estado: aceptado

## Contexto

La cabecera y el pie al imprimir
([ADR 10](0010-la-hoja-impresa-puede-llevar-su-propio-pie-con-el-nombre-y-el-numero-de-pagina.md)
y [ADR 11](0011-la-cabecera-impresa-es-una-opcion-del-formato-y-con-cabecera-o-pie-propios-no-salen-los-del-navegador.md))
eran el único ajuste del formato que no se veía en la vista previa: la letra,
los márgenes, el papel y los saltos de página se ven en la hoja, y estos dos
solo al abrir el cuadro de impresión.

Se dibujan con las cajas de margen de `@page`, que solo tienen Chrome, Edge y
la aplicación de Windows. En Firefox, en Safari y en las aplicaciones de macOS
y Linux no salen en el papel.

## Decisión

La hoja dibuja la cabecera y el pie en los márgenes de cada página de la vista
previa (`refreshPageBreaks`), con lo mismo que llevará el papel: el nombre del
documento a la izquierda y la fecha a la derecha arriba; el nombre y «página /
total» abajo. Con la letra de la hoja, a 9 pt y en gris, alineados con la caja
de texto y centrados en el margen, que es donde los pone el motor.

Van en la capa de las hojas (`#page-sheets`), como el rótulo de la página y las
cabeceras repetidas de las tablas: fuera del texto editable, así que no pasan
al Markdown, y ocultos al imprimir, donde los pone la página.

Lo que piden la cabecera y el pie se resuelve en un solo sitio
(`cabeceraYPieDelDocumento`), del que leen el papel y la hoja.

Solo se dibujan donde el motor los imprime. Se le pregunta al propio motor
(`imprimeCajasDeMargen`): el que no entiende las cajas de margen descarta la
regla al leerla. Donde no se imprimen, la hoja no los enseña, y un aviso bajo
el ajuste lo dice: en el navegador, que manda la casilla de su cuadro de
impresión; en la aplicación, que no salen.

Con el pie puesto, el rótulo «Página N» no se mete en el margen inferior cuando
no cabe fuera de la hoja: caería sobre el número del pie, que ya dice lo mismo.

## Alternativas descartadas

- **Enseñarlos en todos los motores.** En Firefox, Safari y las aplicaciones de
  macOS y Linux la hoja prometería algo que el papel no lleva.
- **No enseñarlos hasta que se impriman en todas partes.** Imprimirlos sin las
  cajas de margen exige otra forma de imprimir, que es un trabajo aparte; quien
  usa Chrome, Edge o Windows no tiene por qué esperar.
- **Reconocer el motor por su nombre.** Dejaría de valer el día que Firefox o
  WebKit dibujen las cajas de margen; la pregunta directa se actualiza sola.
- **Dibujarlos dentro de la hoja editable.** Acabarían en el Markdown.

## Consecuencias

- En Chrome, Edge y Windows, lo que se elige se ve antes de imprimir.
- En los demás, el ajuste sigue ofreciéndose, porque viaja con el documento y
  vale para quien lo abra en otro sitio, pero dice que allí no sale.
- Con la ventana más estrecha que el papel la hoja no se reparte en páginas, y
  entonces tampoco hay cabecera ni pie que enseñar.

## Evidencia

- `new CSSStyleSheet()` con `@page { @top-left { content: ""; } }` (2026-11-12):
  Chromium 151 conserva la caja; Firefox 153 y WebKitGTK 2.50.6 devuelven
  `@page { }`.
- La hoja y el PDF de Chromium, con el manual, cabecera «Nombre y fecha» y pie
  «Nombre y número de página», página 2: en la hoja, el texto va de 1,80 a
  19,21 cm, con la cabecera a 0,89 cm del borde y el pie a 28,79; en el papel,
  de 1,80 a 19,21 cm, a 0,90 y a 28,81.

## Riesgos y limitaciones

- Un nombre de documento tan largo que no quepa en una línea puede partirse de
  otra manera en la hoja que en el papel.
- La fecha de la hoja es la del día en que se mira; la del papel, la del día en
  que se imprime.

## Validación

Prueba de navegador `la hoja enseña la cabecera y el pie que saldrán en el
papel, y solo donde se imprimen`, en Chromium y Firefox: en Chromium, los
textos de cada página, su sitio, que no entran en el texto editable ni en el
Markdown, cada valor del ajuste, el cambio de nombre del documento y el rótulo
de la página con la hoja sin sitio; en Firefox, que no se dibujan y que el
aviso aparece junto al ajuste.
