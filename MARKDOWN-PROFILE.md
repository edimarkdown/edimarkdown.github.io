# Perfil Markdown de EdiMarkdown

El formato de trabajo es Markdown con una base compatible con GFM y extensiones
académicas de Pandoc. No se declara conformidad completa con ninguno de los dos
dialectos. Marked compone la hoja, Turndown recupera el Markdown de la edición
visual y Pandoc convierte los documentos. El perfil es el contrato común entre
esas rutas, no una conversión automática de los archivos del usuario.

## Sintaxis recomendada

| Elemento | Escritura |
| --- | --- |
| Encabezados | `# Título` hasta `###### Título` |
| Énfasis | `*cursiva*`, `**negrita**`, `~~tachado~~` |
| Listas | `- elemento`, `1. elemento`; sangrar las continuaciones y sublistas |
| Tareas | `- [ ] pendiente`, `- [x] hecha` |
| Citas en bloque | `> texto` |
| Código | Comillas invertidas en línea o cercas de tres o más comillas invertidas |
| Tabla | Tuberías, fila de cabecera y fila separadora; sin celdas combinadas |
| Enlaces | `[texto](URL)`; se reconocen también URL HTTP(S) sueltas |
| Imágenes | `![alternativo](ruta)`; conservar la carpeta de recursos al trasladar el archivo |
| Figuras | Una imagen con texto, sola en su párrafo: `![Pie](ruta)`. Es figura con pie en la hoja y en Pandoc (`implicit_figures`); se centra en todos los formatos |
| Diagramas | Bloque de código con la etiqueta `mermaid` (o `{.mermaid}`). La hoja lo dibuja con Mermaid y la exportación lo convierte en una imagen centrada y sin pie; el Markdown conserva el código ([ADR 4](docs/adr/0004-los-diagramas-mermaid-se-dibujan-en-la-hoja-salen-como-imagen-y-se-editan-con-sirena.md)) |
| Separador | `---` en su propio bloque, separado con líneas en blanco |
| Salto visible | Dos espacios al final de línea; un salto normal continúa el párrafo |
| Índices | `H~2~O`, `m^2^`; los espacios interiores deben escaparse |
| Fórmulas | `$…$`, `$$…$$`, `\(...\)`, `\[...\]`; conservar el delimitador elegido |
| Notas | `[^nota]` y `[^nota]: Texto`; continuaciones con cuatro espacios |
| Bibliografía | `[@clave]`, `@clave`, `[-@clave]`; biblioteca BibTeX o CSL JSON para componerlas |
| Metadatos | YAML al inicio del archivo; los campos de formato son los documentados en el manual |

## Convenciones y límites

- Separar los bloques con una línea en blanco evita diferencias de interpretación
  entre los motores. Los enlaces explícitos son preferibles para máxima portabilidad:
  el reconocimiento de direcciones sueltas tiene casos límite distintos.
- La puntuación es literal, también al exportar: no se aplica la extensión `smart`.
- La edición visual genera títulos ATX, listas con guion, cursiva con asterisco,
  código cercado y tachado doble. Las importaciones generan tablas con tuberías y
  simplifican separadores y fórmulas de bloque. La reescritura visual puede cambiar
  la disposición del Markdown, aunque debe conservar su significado.
- Guardar y abrir no pasan el documento por un formateador. Las rutas originales
  de imágenes y los delimitadores matemáticos se conservan.
- Tablas de rejilla o multilínea, listas de definiciones, notas en línea de Pandoc,
  atributos `{#id}`, spans y bloques `:::` no forman parte del contrato de la hoja.
  Que Pandoc pueda exportarlos no implica que la edición visual los preserve.
- Una barra dentro de código en una celda, como `` `a \| b` ``, tiene una
  interpretación distinta: Marked elimina ese escape y Pandoc lo conserva.
  Esa combinación queda fuera del perfil común; la barra escapada en texto
  normal y el código sin barras dentro de las celdas sí están comprobados.
- El HTML depende del destino: un vídeo o un iframe no tiene equivalente en Word.
  LaTeX crudo fuera de fórmulas es una capacidad de conversión, no de la hoja.
- LaTeX matemático está limitado por KaTeX en pantalla y por el conversor del
  formato de destino. No se promete que cualquier macro funcione en ambos.
- El perfil conserva las funciones académicas; un visor GFM sin extensiones puede
  mostrar sus marcas literalmente. GFM y las funciones adicionales de la web de
  GitHub no son exactamente lo mismo.

## Comprobaciones

El [muestrario](test/fixtures/markdown-profile.md) se puede abrir en la aplicación.
Está organizado por funciones e incluye una [bibliografía sintética](test/fixtures/markdown-profile.bib)
que se puede cargar desde las opciones de citas. Sus pruebas de navegador escriben
en la hoja y comprueban el resultado tras volver a Markdown y exportar a HTML.
Las de exportación procesan el mismo documento con el WASM real a DOCX, ODT y EPUB,
abren los archivos resultantes y verifican el contenido. Para ODT se usan también
las reparaciones de fórmulas y cabeceras de la ruta real de importación.
El lector ODT de Pandoc devuelve las ecuaciones como fórmulas de bloque, incluso
cuando el archivo las guarda en línea. Por eso la prueba verifica también el
anclaje y el atributo `display` de cada fórmula directamente dentro del ODT:
así comprueba el formato exportado sin confundirlo con esa limitación al releerlo.

### Matriz de cobertura

**Hoja** significa comprobación antes de editar, después de editar y en el HTML
exportado desde ese Markdown. Las expectativas están en
[`test/helpers/markdown-profile.mjs`](test/helpers/markdown-profile.mjs); no se
generan a partir del resultado que se está probando. **Archivo** corresponde a
las pruebas `perfil Markdown` de [`test/epub-export.test.mjs`](test/epub-export.test.mjs).
Las pruebas de navegador están en [`test/browser.test.mjs`](test/browser.test.mjs).

| Función del perfil | Ejemplos del muestrario | Comprobación |
| --- | --- | --- |
| Encabezados | H1–H6 y secciones H2 | Hoja: nivel, texto y orden exactos; los títulos dentro del código no cuentan |
| Énfasis e índices | Negrita, cursiva, tachado, subíndice y superíndice, también en celdas | Hoja: elementos y texto exactos; literales escapados no generan formato |
| Listas | Numerada, viñetas y sublista | Hoja: tipo, inicio, orden, texto y anidamiento |
| Tareas | Pendiente y hecha | Hoja: dos casillas con estados distintos y sintaxis conservada |
| Citas en bloque | Párrafo citado | Hoja: bloque y texto conservados |
| Enlaces | Explícito, URL suelta, entre ángulos, con título, por referencia y en tabla | Hoja: texto, destino y título; no se exige conservar la forma abreviada de la referencia |
| Imágenes | Imagen incrustada | Hoja: imagen y texto alternativo; archivo: imagen presente tras releer DOCX, ODT y EPUB |
| Código | En línea, bloque con lenguaje, cerca de cuatro marcas con cerca de tres dentro | Hoja: contenido literal; no genera títulos, tablas, fórmulas ni citas adicionales |
| Tablas | Cabecera, varias filas, tres alineaciones, celda vacía, barra escapada y formato interior | Hoja: cada celda, posición, alineación y formato; archivo: contenido y posición de todas las celdas |
| Separador | Regla entre bloques | Hoja: una regla; no se interpreta como metadatos |
| Saltos y párrafos | Salto blando, dos espacios al final de línea y párrafo independiente | Hoja: el salto blando no crea un salto visible; el duro crea uno |
| Fórmulas | Los cuatro delimitadores | Hoja: cuatro fórmulas sin errores y delimitadores conservados; archivo: cuatro ecuaciones editables con su contenido y tipo |
| Notas | Nota sencilla, llamada repetida y nota de dos párrafos | Hoja: cada llamada apunta al contenido correcto; archivo: tres llamadas conservadas |
| Bibliografía | Parentética, narrativa, solo año, múltiple y con página | Hoja sin biblioteca: sintaxis conservada; archivo: claves, modo y localizador en el análisis de Pandoc; citeproc real compone las citas y dos referencias sin duplicarlas; reimportación ODT sin biblioteca: siguen siendo citas, no fórmulas |
| YAML | Idioma y autor | Vuelta de la hoja: conserva los dos campos; las pruebas existentes de metadatos comprueban los destinos |

Los casos que necesitan archivos o interacción adicionales siguen teniendo pruebas
propias: `las imágenes con ruta relativa se ven al vincular su carpeta`,
`lo que sale de la vista previa conserva la ruta relativa, no el blob`,
`inserta y edita citas narrativas, sin autor y con localizador`,
`el botón inserta notas al pie desde los dos editores` y
`los cuatro delimitadores se renderizan y sobreviven a la vuelta a Markdown`.
La matriz cubre este perfil definido y sus casos representativos, no todas las
combinaciones posibles ni las extensiones de Pandoc excluidas arriba.

Ejecutar `npm run test:all` y, tras `npm run build:desktop`, las pruebas del perfil
en Chromium y Firefox:

```sh
node --test --test-name-pattern='perfil Markdown' test/browser.test.mjs
BROWSER=firefox node --test --test-name-pattern='perfil Markdown' test/browser.test.mjs
```

Los tests `barra del perfil` en `test/browser.test.mjs` comprueban también los
controles de tablas alineadas, tareas interactivas, código en línea y en bloque,
saltos visibles y títulos de enlaces. Se ejecutan en ambos navegadores cambiando
el patrón anterior por `barra del perfil`.

Al ampliar la sintaxis, añadir primero un ejemplo y comprobar la hoja, su vuelta
a Markdown y el contenido exportado. No basta con que el archivo de salida exista.

Referencias: [opciones de Marked](https://marked.js.org/using_advanced#options),
[Markdown de Pandoc](https://pandoc.org/MANUAL.html#pandocs-markdown).
