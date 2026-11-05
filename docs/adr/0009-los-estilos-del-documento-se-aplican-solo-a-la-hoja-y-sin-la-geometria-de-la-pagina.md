# 9. Los estilos del documento se aplican solo a la hoja y sin la geometría de la página

Fecha: 2026-11-05 · Estado: aceptado

## Contexto

Marked deja pasar el HTML que lleva el Markdown, y un bloque `<style>` llegaba
a la vista previa tal cual. La vista previa es un elemento de la página, y la
página es la aplicación entera: un usuario que quería márgenes de papel
escribió `<style> body { margin-top: 2.5cm; margin-left: 3cm; … } </style>` y
lo que se desplazó fue la ventana completa, con los menús y el editor, en la
web y en la aplicación de Windows. El documento seguía igual.

Además, al escribir una letra en la hoja, Turndown trataba `<style>` como un
elemento desconocido y conservaba solo su texto: el CSS acababa en el Markdown
como un párrafo y las etiquetas se perdían.

Los márgenes y el tamaño del papel ya tienen su sitio: las opciones del
documento, que se guardan en sus metadatos, se imprimen con `@page` y llegan a
DOCX, ODT y LaTeX.

## Decisión

Al montar la hoja (`previewFragmentFromHtml`), cada `<style>` se reescribe con
el CSSOM (`scopeDocumentStyles`):

- `html`, `:root` y `body` pasan a ser `#html-output`; cualquier otro selector
  se busca dentro de la hoja (`#html-output p`). `body p` es lo que hay dentro
  de la hoja, no la hoja.
- De las reglas sobre la hoja misma se quita la geometría (márgenes, rellenos,
  medidas, posición, transformaciones, `display`, `overflow`, columnas) y se
  queda el aspecto (color, fondo, letra). Las opciones del documento mandan
  sobre la letra porque son lo que reciben los demás formatos.
- Los `@page` y los `@import` no pasan a la pantalla. `@media`, `@supports`,
  `@container` y `@layer` se recorren por dentro; `@font-face` y `@keyframes`
  pasan tal cual.
- Si el navegador no puede construir la hoja de estilo, el bloque queda vacío
  en pantalla: no se arriesga la interfaz.

El texto original viaja en `data-edimark-css` y `buildHtmlWithTex` lo repone
antes de que nada salga de la hoja, igual que las rutas de las imágenes. Para la
vuelta a Markdown, cada `<style>` cruza Turndown aparte
(`turndownKeepingDocumentStyles`), porque Turndown junta los espacios de todo
texto antes de aplicar sus reglas, y la regla `edimarkStyle` lo devuelve
entero. Un `<style>` que no sale de la hoja (lo pegado de otra página o de
Word) se descarta.

## Alternativas descartadas

- **Quitar los `<style>` de la vista previa.** Arregla la interfaz, pero lo que
  se ve dejaría de parecerse al HTML exportado, que sí los lleva.
- **Meter la hoja en un Shadow DOM o en un `iframe`.** Aislaría de verdad, pero
  la hoja es el editor visual, con la paginación, la selección, las fórmulas y
  los diagramas montados sobre el DOM de la página. El cambio sería enorme para
  un caso poco frecuente.
- **`@scope`.** Acotaría los selectores sin reescribirlos, pero `body` seguiría
  sin coincidir con la hoja y la geometría habría que quitarla igual, así que la
  reescritura hace falta de todos modos. Tampoco se ha comprobado en todos los
  motores donde corre la aplicación.
- **Traducir los márgenes de `body` a las opciones del documento.** Adivinar
  qué quería decir cada regla es frágil, y habría dos sitios para decir lo
  mismo.

## Consecuencias

- Un `<style>` ya no puede romper la interfaz, y su efecto en pantalla coincide
  con el del HTML exportado salvo en la geometría de la página.
- Lo que alguien escriba para los márgenes en CSS no hace nada en la hoja: el
  manual dice que se fijan en las opciones del documento.
- La edición en la hoja conserva el bloque `<style>` letra por letra.

## Evidencia

- Reproducido el 2026-11-05 en Chromium y Firefox con el caso del usuario:
  antes, `getComputedStyle(document.body).marginLeft` valía `113.386px` (3 cm);
  después, `0px`, con el color y los márgenes de los párrafos aplicados dentro
  de la hoja.
- Antes, la vuelta de la hoja daba `body { margin-left: 3cm; } p { … }` como
  párrafo, sin etiquetas.

## Riesgos y limitaciones

- Un selector que dependa de algo de fuera de la hoja (`.dark p`) se busca
  dentro de ella y no coincide.
- Las reglas anidadas de CSS se copian sin reescribir dentro de su regla, que
  sí está acotada.

## Validación

Prueba de navegador `un <style> del documento se queda en la hoja y vuelve
entero al Markdown`, en Chromium y Firefox: la aplicación no se mueve, la hoja
recibe el color, no la geometría, y el Markdown vuelve idéntico.
