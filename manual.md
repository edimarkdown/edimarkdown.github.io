![Logotipo de EdiMarkdown](logo_100px.png)

# Manual de EdiMarkdown

EdiMarkdown es un editor de textos en Markdown para docentes y creadores de contenido. Se escribe rápido, importa documentos de Word, LibreOffice, EPUB, HTML, LaTeX o PDF, y exporta a esos mismos formatos, con fórmulas matemáticas incluidas. Funciona en el navegador, sin instalar nada, y también como aplicación de escritorio para Linux, Windows y macOS. En los dos casos el trabajo queda en tu equipo: ni los documentos ni las imágenes salen de él.

## Para empezar

No hace falta saber Markdown. Escribe en el panel de la izquierda y verás el documento compuesto a la derecha; los botones de la barra de herramientas ponen negritas, títulos, listas, tablas, enlaces, imágenes y fórmulas, y funcionan en los dos paneles.

Cuando termines: **Guardar** (`Ctrl+S`) deja un archivo `.md` de texto corriente, que se abre en cualquier sitio, y **Exportar** genera el Word, el PDF o el formato que necesites entregar.

Este manual está siempre en **Ayuda** o con `F1`. También hay un [artículo del blog](https://educacion.bilateria.org/edimarkdown-escribir-en-markdown-y-convertir-a-cualquier-formato) que cuenta para qué sirve EdiMarkdown en clase, con ejemplos y capturas.

---

## Los dos editores

La pantalla se divide en dos paneles que **editan el mismo documento** a la vez:

* **Editor Markdown** (izquierda): el texto en código fuente, tal cual.
* **Editor visual** (derecha): el documento ya compuesto, como una hoja de papel. Se escribe directamente sobre él y la barra de formato también funciona aquí.

Arrastra la barra central para repartir el espacio, o usa los tres botones de disposición (`Ctrl+L`) para ver solo un editor, o los dos. La doble flecha oculta las barras y deja toda la pantalla para escribir.

La lupa de la barra de estado (o `Ctrl` + `+` / `Ctrl` + `-`) agranda o reduce lo que ves, sin cambiar el documento: el papel siempre sale al 100 % al imprimir o exportar. El interruptor con la cadena, junto a la lupa, mantiene la página entera visible aunque muevas el separador entre paneles; se puede soltar si prefieres controlar el zoom a mano.

**Pegar cualquier cosa**: con `Ctrl+V`, EdiMarkdown coloca en el panel adecuado lo que traigas del portapapeles. El texto y el Markdown van al editor Markdown; el contenido con formato —de Word, de una web, de un chatbot— y las imágenes se recomponen en el editor visual. No hacen falta pasos intermedios: copia de donde sea y pega.

---

## Pestañas y menús

Cada documento vive en su pestaña. `Ctrl+Alt+N` crea una, `Ctrl+Alt+AvPág` pasa a la siguiente, y un punto rojo (`●`) avisa de cambios sin guardar. El botón derecho sobre una pestaña abre **Renombrar**, **Cerrar** y, en **Reabrir**, las últimas diez pestañas cerradas.

Todo se autoguarda solo en el equipo: si recargas la página o vuelves a abrir el programa, el contenido reaparece. Es una red de seguridad, no un sustituto de guardar el archivo.

Junto al logotipo están los menús:

* **Archivo**: abrir, importar, pegar LaTeX, guardar y guardar como.
* **Exportar** (`Ctrl+Alt+E`): los seis formatos de salida.
* **Configuración** (`Ctrl+,`): idioma de la interfaz, tema, corrector ortográfico y las opciones generales de los documentos.
* **Ayuda**: este manual (`F1`) y, en el escritorio, buscar actualizaciones.

La barra de herramientas reúne negrita, cursiva, encabezados, listas, citas, código, enlaces, imágenes, tablas, citas bibliográficas y fórmulas. Cada botón dice al pasar el ratón qué hace y con qué atajo.

---

## Abrir, importar y arrastrar

* **Abrir** (`Ctrl+O`): archivos `.md` y `.markdown`.
* **Importar** (`Ctrl+Alt+O`): convierte a Markdown documentos `.docx`, `.odt`, `.epub`, `.html`, `.tex` y también **PDF**.
* **Arrastrar y soltar**: suelta uno o varios archivos, o carpetas enteras, sobre la aplicación; cada uno se abre en su pestaña.

En la aplicación de escritorio, `Ctrl+S` escribe sobre el archivo que abriste; en el navegador se descarga.

### Importar PDF

Elige un PDF en **Importar** (o arrástralo). La conversión ocurre en tu equipo. Puedes quitar encabezados y pies repetidos, conservar imágenes, aplicar OCR a las páginas escaneadas y elegir qué páginas importar. Pulsa **Convertir a Markdown**, revisa el resultado en la vista previa y después **Importar en una pestaña nueva**.

La detección de tablas y fórmulas no es infalible, y el OCR puede fallar con fotografías o baja resolución. Si desaparece texto útil, desactiva la eliminación de encabezados y pies. Se admiten archivos de hasta 50 MB.

---

## Imágenes

El botón **Imagen** admite un archivo del disco o una URL, y pregunta cómo insertarla:

* **Con ruta relativa** (lo recomendado): el documento solo nombra la imagen, que se queda en su propia carpeta. Mantiene el `.md` ligero, pero el documento y sus imágenes viajan juntos.
* **Dentro del documento**: la imagen se incrusta en el archivo, que se vuelve autónomo pero más pesado. Útil para enviar un `.md` suelto por correo.

**Pie de figura**: si escribes un pie en el cuadro, la imagen va sola en su párrafo, centrada y con el pie debajo, en la hoja y al exportar. En Markdown se escribe `![Pie de la figura](imagenes/foto.png)`, en un párrafo propio, y el pie se puede corregir directamente sobre la hoja. Sin pie, la imagen sigue la alineación del texto. Las imágenes no admiten texto alrededor: van siempre en su propio renglón.

Bajo el editor Markdown, el **gestor de imágenes** lista las del documento: puedes verlas, reemplazarlas, eliminarlas, incrustarlas o pasarlas a la carpeta, y **Ir al texto** te lleva hasta donde están escritas.

---

## Fórmulas matemáticas

Las fórmulas se escriben en LaTeX y se ven al momento. Tres maneras de ponerlas:

* **Menú de fórmulas** (editor Markdown): `Ctrl+M` y luego un número elige el delimitador; `Intro` inserta el recomendado, `\(...\)`.
* **Ventana de fórmula** (editor visual): el botón `{}` abre un cuadro con el código y el resultado a la vista mientras escribes.
* **EdiCuaTeX** (`Ctrl+Alt+M`): editor visual de fórmulas para construirlas a golpe de ratón.

Ejemplos: $ax^2 + bx + c = 0$ en línea, o en bloque:

$$
x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}
$$

Letras griegas ($\alpha$, $\Omega$), subíndices ($H_2O$) y símbolos de conjuntos ($\mathbb{R}$, $A \subseteq B$) se escriben igual que en cualquier fórmula LaTeX.

---

## Diagramas

Un bloque de código con la etiqueta `mermaid` se dibuja como diagrama. Este código:

````markdown
```mermaid
flowchart LR
    A[Idea] --> B[Borrador]
    B --> C[Entrega]
```
````

```mermaid
flowchart LR
    A[Idea] --> B[Borrador]
    B --> C[Entrega]
```

* **Para crear uno sin saber Mermaid**, el botón de diagrama de la barra, junto al de EdiCuaTeX, abre **Sirena**, un editor visual de diagramas. **Insertar** lo pone en el documento.
* **Para cambiarlo**, doble clic sobre el diagrama, o el lápiz de su esquina: se abre en Sirena y, al insertarlo, sustituye al que había.
* Si el código tiene un error, se ve el código con el aviso de Mermaid, que dice en qué línea está.

Al exportar a DOCX, ODT, EPUB, HTML o TEX, cada diagrama sale como una imagen centrada, y el archivo `.md` conserva el código. En la versión web, la primera vez que aparece un diagrama hace falta conexión para cargar Mermaid.

---

## Citas y bibliografía

En **Configuración → Opciones generales… → Citas** puedes cargar una biblioteca **BibTeX** (`.bib`) o **CSL JSON** (`.json`), o probar con **Cargar bibliografía de ejemplo**. El botón del libro (`Ctrl+Alt+B`) abre un buscador por autor, título o año, con **Añadir referencia manualmente** siempre a mano.

**APA 7** es el estilo inicial; también hay Chicago, MLA, IEEE o un CSL propio. La bibliografía final se muestra al pie de la vista previa y se reproduce al exportar. Al guardar, la biblioteca se copia junto al documento, así que basta con conservarlos juntos para llevar el trabajo a otro equipo.

---

## Buscar y reemplazar

La lupa (o `Ctrl+F`) abre el buscador. Resalta todas las coincidencias, `Enter` salta a la siguiente, y la flecha lateral despliega el reemplazo, una a una o todas de golpe. El botón **Regex** interpreta la búsqueda como expresión regular.

---

## El formato del documento

Junto al contador de caracteres hay un botón con el idioma del documento (`ES`, `CA`...). Al pulsarlo se abre **Este documento**, con dos pestañas:

* **Documento**: idioma, autor, índice automático y numeración de apartados.
* **Formato**: alineación, tipo y tamaño de letra, interlineado, tamaño de papel, márgenes y sangría.

Todo lo que fijes se guarda dentro del propio `.md`, en unas líneas de metadatos al principio del archivo, así que viaja con el documento a cualquier equipo. Si repites los mismos ajustes en varios trabajos, guárdalos como **perfil** (arriba del cuadro) para aplicarlos de un clic en otro documento.

**Configuración → Opciones generales…** guarda los valores de partida para los documentos nuevos: idioma, autor, texto y página, portada del EPUB, bibliografía y opciones de LaTeX.

---

## Exportar

**Exportar** (`Ctrl+Alt+E`) genera el documento listo para entregar:

* **DOCX (Word)**: para compartir con quien usa Word, o abrir en Google Docs.
* **ODT (LibreOffice)**: para suites libres como LibreOffice u OnlyOffice.
* **EPUB**: libro digital compatible con lectores EPUB 3.
* **HTML**: página web autónoma, con los estilos y las fórmulas dentro.
* **TEX (LaTeX)**: un `.tex` completo, listo para compilar.
* **PDF**: abre el diálogo de impresión («Guardar como PDF»); sale exactamente lo que ves en pantalla.

El botón de copiar, junto a Exportar, lleva el contenido al portapapeles en Markdown, HTML o LaTeX, sin generar ningún archivo.

---

## La aplicación de escritorio

Es la misma aplicación instalada en Linux, Windows y macOS. Los instaladores están en la [página de descargas](https://github.com/edimarkdown/edimarkdown.github.io/releases/latest).

Frente al navegador añade: doble clic para abrir archivos `.md`, guardado directo sin pasar por la carpeta de descargas, la ubicación del archivo de cada pestaña al pasar el ratón por encima o en su menú del botón derecho (al pulsarla se abre su carpeta), corrector ortográfico del sistema y funcionamiento sin conexión (Pandoc, EdiCuaTeX, Sirena y Mermaid van incluidos). Al arrancar comprueba si hay una versión nueva y avisa con **Descargar e instalar**.

**En macOS**, si el sistema avisa de que la aplicación «está dañada», arrastra EdiMarkdown a Aplicaciones y ejecuta en el Terminal:

```
xattr -dr com.apple.quarantine /Applications/EdiMarkdown.app
```

Es solo el aviso habitual de macOS ante software sin firmar; con ese comando se abre con normalidad.

---

## Atajos de teclado

| Acción | Atajo (Windows/Linux) | Atajo (macOS) |
| :--- | :--- | :--- |
| **Formato** | | |
| Negrita | `Ctrl` + `B` | `Cmd` + `B` |
| Cursiva | `Ctrl` + `I` | `Cmd` + `I` |
| Encabezados 1-6 | `Ctrl` + `1..6` | `Cmd` + `1..6` |
| Lista con viñetas | `Ctrl` + `Shift` + `L` | `Cmd` + `Shift` + `L` |
| Lista numerada | `Ctrl` + `Shift` + `O` | `Cmd` + `Shift` + `O` |
| Cita | `Ctrl` + `Shift` + `Q` | `Cmd` + `Shift` + `Q` |
| Anidar / desanidar un punto de lista | `Tab` / `Mayús` + `Tab` | `Tab` / `Mayús` + `Tab` |
| Subir un nivel (en un punto vacío) | `Intro` | `Intro` |
| Código | `Ctrl` + `` ` `` | `Cmd` + `` ` `` |
| Enlace | `Ctrl` + `K` | `Cmd` + `K` |
| Imagen | `Ctrl` + `Shift` + `I` | `Cmd` + `Shift` + `I` |
| Tabla | `Ctrl` + `Shift` + `T` | `Cmd` + `Shift` + `T` |
| Fórmula `$...$` (en línea) | `Ctrl` + `M` luego `1` | `Cmd` + `M` luego `1` |
| Fórmula `$$...$$` (en bloque) | `Ctrl` + `M` luego `2` | `Cmd` + `M` luego `2` |
| Fórmula `\(...\)` (en línea) | `Ctrl` + `M` luego `3` | `Cmd` + `M` luego `3` |
| Fórmula `\[...\]` (en bloque) | `Ctrl` + `M` luego `4` | `Cmd` + `M` luego `4` |
| Deshacer / Rehacer | `Ctrl` + `Z` / `Ctrl` + `Shift` + `Z` | `Cmd` + `Z` / `Cmd` + `Shift` + `Z` |
| **Gestión de documentos** | | |
| Nueva pestaña | `Ctrl` + `Alt` + `N` | `Cmd` + `Alt` + `N` |
| Cerrar pestaña | `Ctrl` + `Alt` + `W` | `Cmd` + `Alt` + `W` |
| Pestaña siguiente / anterior | `Ctrl` + `Alt` + `AvPág` / `Ctrl` + `Alt` + `RePág` | `Cmd` + `Alt` + `AvPág` / `Cmd` + `Alt` + `RePág` |
| Guardar | `Ctrl` + `S` | `Cmd` + `S` |
| Guardar como… | `Ctrl` + `Shift` + `S` | `Cmd` + `Shift` + `S` |
| Abrir archivo | `Ctrl` + `O` | `Cmd` + `O` |
| Importar documento | `Ctrl` + `Alt` + `O` | `Cmd` + `Alt` + `O` |
| Pegar LaTeX (abrir modal) | `Ctrl` + `Shift` + `V` | `Cmd` + `Shift` + `V` |
| **Interfaz** | | |
| Abrir EdiCuaTeX | `Ctrl` + `Alt` + `M` | `Cmd` + `Alt` + `M` |
| Pegar desde el portapapeles | `Ctrl` + `Alt` + `V` | `Cmd` + `Alt` + `V` |
| Abrir Exportar | `Ctrl` + `Alt` + `E` | `Cmd` + `Alt` + `E` |
| Copiar (`1` Markdown · `2` HTML · `3` LaTeX · `4` LaTeX completo) | `Ctrl` + `Alt` + `C` luego `1`–`4` | `Cmd` + `Alt` + `C` luego `1`–`4` |
| Abrir Configuración | `Ctrl` + `,` | `Cmd` + `,` |
| Maximizar área de edición | `Ctrl` + `Shift` + `F` | `Cmd` + `Shift` + `F` |
| Cambiar diseño | `Ctrl` + `L` | `Cmd` + `L` |
| Salir del editor con el teclado | `Esc` y luego `Tab` | `Esc` y luego `Tab` |
| Buscar | `Ctrl` + `F` | `Cmd` + `F` |
| Ampliar / reducir el panel en el que estás | `Ctrl` + `+` / `Ctrl` + `-` | `Cmd` + `+` / `Cmd` + `-` |
| Manual de uso | `Ctrl` + `H` o `F1` | `F1` |
| Recargar el manual | `Ctrl` + `Shift` + `H` | `Cmd` + `Shift` + `H` |
| Imprimir | `Ctrl` + `P` | `Cmd` + `P` |

---

## Markdown admitido

EdiMarkdown usa una base compatible con GitHub Flavored Markdown (GFM), ampliada con funciones de Pandoc: encabezados, negrita y cursiva, listas y citas en bloque, enlaces e imágenes, código, tablas, tareas (`- [ ]`) y tachado (`~~texto~~`).

Las ampliaciones son las fórmulas LaTeX, las notas al pie `[^nota]`, las citas bibliográficas `[@clave]`, los metadatos YAML, los subíndices `H~2~O`, los superíndices `m^2^` y los diagramas Mermaid.

**Límites**: no todas las extensiones de Pandoc se ven en la hoja visual. Las listas de definiciones, las tablas de rejilla o los bloques `:::` quedan fuera del perfil común, aunque puedes escribirlas igualmente en el editor Markdown y llegarán a la exportación.

---

## Licencia y contribuciones

EdiMarkdown es software libre bajo la [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html): puedes usarlo en tu aula, adaptarlo y desplegarlo en servidores propios, siempre que compartas cualquier mejora bajo la misma licencia. Si detectas un problema o quieres proponer cambios, abre una incidencia en [GitHub](https://github.com/edimarkdown/edimarkdown.github.io/issues) o envía un pull request.
