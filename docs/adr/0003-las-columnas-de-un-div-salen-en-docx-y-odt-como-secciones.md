# 3. Las columnas de un div salen en DOCX y ODT como secciones

Fecha: 2026-10-26 · Estado: aceptado

## Contexto

Un bloque `<div style="column-count:4">` se ve en columnas en la hoja, en el
HTML y en el EPUB, pero el DOCX y el ODT lo sacaban todo en una columna. Pandoc
lee el `div` como un `Div` con su atributo `style`, y sus escritores de DOCX y
ODT no lo interpretan.

Word y LibreOffice sí tienen columnas, pero en otra pieza: Word las pone en la
sección (`w:sectPr` con `w:cols`), y LibreOffice en una sección del texto
(`text:section`) con su estilo. La versión WASM de Pandoc no trae Lua, así que no
hay filtros.

## Decisión

La conversión pasa por el árbol de Pandoc cuando el documento tiene un bloque en
columnas (`convertWithAstPasses`, la misma pasada que ya aplicaba la letra sin
serifa a las fórmulas). Se pide el JSON, se cambia y se convierte desde él.

- Se leen las mismas propiedades que el navegador (`readColumnLayout`):
  `column-count`, `column-width`, el atajo `columns`, `column-gap` (1 em por
  omisión) y `column-rule`. Un ancho de columna da tantas como quepan en el
  ancho del texto.
- **DOCX**: el `Div` queda entre dos párrafos casi sin altura con un corte de
  sección continuo. El de delante cierra lo anterior en una columna y se omite si
  no hay nada antes, salvo que haya índice. El de detrás lleva las columnas
  (`w:num`, `w:space` y `w:sep` si hay línea). Al retocar el archivo, la sección
  final pasa a continua y el papel y los márgenes se escriben en todas las
  secciones. `w:pgMar` lleva siempre los siete atributos que exige el esquema.
- **ODT**: el `Div` va dentro de una `text:section` cuyo estilo lleva sus medidas
  en el nombre (`EdiMarkdownColumns_4_0.265cm`). Al retocar el archivo, el estilo
  se declara entre los automáticos de `content.xml`, con las columnas
  equilibradas al final, como en la hoja.
- Solo cambian de sección los bloques al nivel del cuerpo, también dentro de un
  `div` sin columnas. Uno dentro de una lista, de una cita o de otro bloque en
  columnas se queda como estaba, porque ni Word ni LibreOffice admiten ahí un
  cambio de sección.
- Sin bloques en columnas, la conversión es directa y el archivo sale igual que
  antes.

## Alternativas descartadas

- Insertar los cortes en el Markdown con bloques ```` ```{=openxml} ````:
  emparejar `<div>` y `</div>` en texto es frágil con `div` anidados y código.
- Un filtro Lua: la versión WASM de Pandoc no lo admite.
- Guardar el estilo de la sección del ODT entre los estilos comunes
  (`styles.xml`): LibreOffice escribe los de sus secciones entre los automáticos
  del contenido, y es la forma que se ha comprobado. La otra no se ha probado.

## Consecuencias

- El DOCX y el ODT tienen las columnas de la hoja, con el mismo número, la
  separación y la línea entre columnas.
- Un documento con columnas cuesta una conversión más de Pandoc (a JSON y desde
  JSON).
- LaTeX sigue sin columnas: el `div` no le dice nada a Pandoc y necesitaría el
  paquete `multicol`.

## Evidencia

- El Pandoc WASM del repositorio (API de documento 1.23.1) lee `<div style="…">` como
  `Div ("", [], [("style", "…")])`.
- Validación del DOCX con los esquemas OOXML (ISO/IEC 29500): sin márgenes
  propios, con márgenes y sin columnas, sin errores. Antes de este cambio,
  `w:pgMar` con solo los lados fijados no pasaba la validación.

## Riesgos y limitaciones

- Comprobado en LibreOffice; no se ha abierto en Microsoft Word. El esquema da
  el archivo por bueno, pero cómo reparte Word las columnas es una hipótesis
  pendiente de validación.
- El párrafo de cada corte de sección ocupa una línea de 1 pt.
- El `em` de `column-gap` se cuenta con la letra de 16 px del navegador, no con
  la del documento.

## Validación

- `test/prepare.test.mjs`, `test/office-format.test.mjs` y
  `test/epub-export.test.mjs` («columnas: DOCX y ODT conservan el bloque en
  columnas», con el Pandoc real).
- La lista de cuatro columnas exportada desde la aplicación en Chromium y
  Firefox, en DOCX y ODT, y convertida a PDF con LibreOffice: cuatro columnas que
  siguen de página en página, A4 y con los márgenes del documento.
