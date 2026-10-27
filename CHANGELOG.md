# Historial de cambios

Todos los cambios de EdiMarkdown (antes EdiMarkWeb), de la versión más reciente a la más antigua. Cada versión corresponde a una etiqueta `vX.Y.Z` del repositorio; los instaladores de escritorio están en las [publicaciones de GitHub](https://github.com/edimarkweb/edimarkweb.github.io/releases).

El formato sigue la idea de [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y la numeración, [versionado semántico](https://semver.org/lang/es/).

## [3.4.0] - 2026-10-27

- Los bloques de código con la etiqueta `mermaid` se dibujan como diagramas en la vista previa, en pantalla y al imprimir. El archivo `.md` conserva el código. Si el diagrama tiene un error, se ve su código con el aviso de Mermaid, que dice en qué línea está.
- Al exportar a DOCX, ODT, EPUB, HTML o LaTeX, cada diagrama sale como una imagen centrada, igual que en la vista previa. Antes salía como un bloque de código.
- Los diagramas se crean y se cambian con Sirena, el editor visual de diagramas Mermaid: un botón nuevo de la barra abre uno nuevo, y el doble clic sobre un diagrama, o el lápiz de su esquina, abre ese diagrama. Al insertarlo vuelve a su sitio en el documento, y el cambio se puede deshacer.
- La aplicación de escritorio lleva Sirena y Mermaid incluidos, así que los diagramas funcionan también sin conexión.

## [3.3.0] - 2026-10-26

- Los bloques en columnas (`<div style="column-count:4">`) salen en columnas también en DOCX y ODT, con el mismo número de columnas, la misma separación y la línea entre columnas si la hay. Antes Word y LibreOffice lo ponían todo en una sola columna.
- En la vista previa, un bloque en columnas más largo que la página se reparte página a página, como en el papel. Antes el hueco entre hojas cortaba las líneas por la mitad, y al imprimir el bloque bajaba entero a otra hoja y dejaba la anterior casi en blanco.
- Una tabla más larga que la página se parte por filas en la vista previa, con la cabecera repetida arriba de cada página, igual que al imprimir. Antes el hueco entre hojas atravesaba las filas del corte.
- Escribir en la hoja visual dentro de un bloque en columnas ya no lo convierte en una sola columna.
- Con el tema oscuro, lo impreso y el PDF salen en papel blanco y con el texto en colores legibles. Antes salían con el fondo de la ventana en negro.
- Los márgenes del DOCX llevan todos los datos que exige el formato de Word, también cuando el documento solo fija algunos lados.

## [3.2.5] - 2026-09-27

- «Acerca de» indica de cada componente de terceros quién lo hizo, enlaza a su proyecto y da su licencia. El nombre del autor y la licencia de EdiMarkdown también llevan enlace, y el manual enlaza al texto de la licencia en los cinco idiomas.
- La aplicación de escritorio incluye el archivo de la licencia, y su aviso de privacidad dice que solo se conecta por su cuenta a GitHub, para buscar actualizaciones, y cómo desactivar la comprobación al arrancar.
- Tres botones no llegaban a los 24 píxeles que pide la norma de accesibilidad WCAG 2.2 para lo que se pulsa y ahora los alcanzan: el que despliega los tipos de lista y, en el móvil, los de idioma y formato de la barra de estado.
- El conversor de PDF se descarga con la versión de la aplicación: tras una actualización, el navegador ya no puede seguir usando una copia antigua.

## [3.2.4] - 2026-09-27

- En la aplicación de escritorio, la ruta que encabeza el menú del botón derecho de una pestaña se puede pulsar: abre la carpeta del archivo en el gestor de archivos del sistema, con el archivo marcado, en Windows, macOS y Linux. Si el documento no está guardado en ningún archivo, el aviso sigue siendo solo texto.

## [3.2.3] - 2026-09-26

- Siempre queda una pestaña abierta: al cerrar la última, o todas desde el menú del botón derecho, se abre una en blanco en lugar de dejar el editor sin ninguna.
- Un documento vacío que no está guardado en ningún archivo ya no pasa a «Reabrir» al cerrarse, porque no hay nada que recuperar.

## [3.2.2] - 2026-09-25

- En la aplicación de escritorio, al pasar el ratón por una pestaña se ve dónde está su archivo: la ruta completa, o que no está guardado en ninguno y solo existe en la copia automática de EdiMarkdown. Si hay cambios sin guardar, lo dice también. El mismo dato encabeza el menú del botón derecho de la pestaña, para quien usa pantalla táctil o teclado.
- El rótulo «Reabrir» del menú de la pestaña tiene el contraste mínimo, como el resto de textos grises desde la 3.2.0.

## [3.2.1] - 2026-09-25

- Las pestañas se crean, se cierran y se recorren con `Ctrl` + `Alt` + `N`, `Ctrl` + `Alt` + `W` y `Ctrl` + `Alt` + `AvPág` / `RePág`. En el navegador, `Ctrl` + `T`, `Ctrl` + `W` y `Ctrl` + `Tab` son del propio navegador y la aplicación no llega a recibirlos: `Ctrl` + `W` cerraba la aplicación entera. En la aplicación de escritorio siguen funcionando también los de siempre. En macOS, el manual se abre con `F1`.
- En un móvil estrecho, los menús de la barra superior pasan a una segunda fila en lugar de salirse de la pantalla.
- «Acerca de» acredita todos los componentes de terceros, y el README indica qué carga la versión web de fuera, cuándo y para qué.
- Pandoc se carga solo desde el propio sitio: se retira la copia de reserva que había en otro repositorio.

## [3.2.0] - 2026-09-25

- La versión web deja de contar visitas: ya no avisa a ningún servidor de estadísticas al abrirse, y el aviso de privacidad lo dice. La versión de escritorio nunca lo hizo.
- Los dos editores se pueden dejar con el teclado: `Esc` y después `Tab` (o `Mayús` + `Tab`) salen del editor Markdown y de una lista de la hoja, donde `Tab` sangra. Los editores y las casillas de las tareas tienen nombre para los lectores de pantalla, y los textos grises de los menús, las pestañas inactivas, el idioma del documento y los pies de figura en tema oscuro tienen el contraste mínimo.
- «Acerca de» y el README indican cómo se usa la IA en el desarrollo de EdiMarkdown: nivel 4 del MIAE y lo que comprueba el autor.

## [3.1.2] - 2026-09-25

- Al renombrar una pestaña con doble clic, el nombre admite espacios. Antes, en Chrome, Edge y la versión de escritorio para Windows, la edición se cortaba al pulsar la barra espaciadora y la pestaña se quedaba con la primera palabra. Pulsar dentro del campo para mover el cursor ya no arrastra la pestaña.

## [3.1.1] - 2026-09-15

- Figuras con pie: una imagen sola en su párrafo y con texto se muestra en la hoja centrada y con ese texto como pie, igual que ya salía en Word, LibreOffice, LaTeX y HTML. El pie se corrige directamente sobre la hoja, y la figura va centrada en todos los formatos, aunque el texto esté justificado o sangrado.
- El cuadro de Imagen pide un «Pie de figura» opcional. Si se escribe, la imagen se inserta en su propio párrafo; si no, ya no se inventa un texto con el nombre del archivo, que acababa como pie en el Word. Las imágenes pegadas tampoco lo llevan.
- En pantallas pequeñas, un menú de la barra que no cabe debajo de su botón se abre hacia arriba, en lugar de salirse de la pantalla y hacer saltar la página.

## [3.1.0] - 2026-09-15

- El código en línea se muestra sin las comillas invertidas decorativas que añadía el estilo de la hoja.
- Las listas se agrupan en un botón dividido: el icono aplica el último tipo elegido y la flecha abre viñetas, numeración y tareas. La elección se recuerda al volver a abrir la aplicación; en móvil, las dos zonas tienen tamaño táctil y el menú se ajusta a la pantalla.
- La barra permite crear tablas con alineación por columna y cambiar la de tablas existentes desde ambos paneles. Añade listas de tareas con casillas interactivas, botones separados para código en línea y bloques con lenguaje opcional, saltos de línea y un título opcional para los enlaces. Los cinco manuales y las pruebas de navegador cubren estos controles.
- Las tablas muestran su alineación izquierda, centrada o derecha también al imprimir. Editarlas en la hoja conserva esa alineación y las barras verticales escritas dentro de una celda, que antes podían crear columnas falsas. El muestrario Markdown y sus pruebas cubren ahora cada función del perfil, con comprobaciones de contenido y estructura.
- Importar recupera la sintaxis de las citas bibliográficas sin biblioteca que Pandoc devuelve escapadas, evitando que sus corchetes se interpreten como fórmulas. Se respetan los ejemplos escritos como código y las fórmulas reales.
- El manual se ha reescrito en los cinco idiomas para que sea más breve y claro: empieza por lo imprescindible y deja para el final el Markdown admitido (sintaxis compatible con GFM y funciones académicas de Pandoc, con sus límites).
- Al abrir un cuadro de diálogo, lo que se escribe en otro de sus campos nada más abrirlo ya no se pierde, porque el cursor ya no salta de vuelta al primer campo.
- Exportar conserva las comillas rectas, los puntos suspensivos escritos como tres puntos y los guiones, tal como se ven en la hoja; las URL HTTP(S) sueltas también se convierten en enlaces.
- Editar la hoja conserva las citas bibliográficas entre corchetes aunque todavía no se haya cargado su biblioteca: antes podían convertirse en fórmulas al volver a mostrar el documento.

## [3.0.5] - 2026-09-13

- El agradecimiento de «Acerca de» pasa a decir «Agradecimientos: Enrique Brito, por su colaboración en el desarrollo y mejora de EdiMarkdown.», en los cinco idiomas.
- Se vuelve a publicar la web: el despliegue de la 3.0.4 se quedó atascado durante una incidencia de GitHub y la dirección siguió sirviendo la versión anterior.

## [3.0.4] - 2026-09-13

- Importar PDF: las notas al pie se enlazan. La llamada del texto y la nota del final de la página, que llegaban sueltas, se convierten en notas de verdad, también cuando la llamada está en una tabla o en un título.
- Importar PDF: las tablas guardadas desde una página web ya no parten cada fila en varias líneas (`6 × 0 = 0` llegaba en tres) ni cortan el título que tienen encima por las columnas.
- Hoja: una lista, una cita o la sección de notas más larga que una página se reparte por dentro en lugar de quedar atravesada por el corte, y la sección de notas puede por fin pasar a la página siguiente. La impresión corta por el mismo sitio.
- Al volver a una pestaña, la hoja vuelve a donde se dejó.
- «Acerca de» incluye un agradecimiento a Enrique Brito.

## [3.0.3] - 2026-09-13

- Importar PDF: una tabla sin títulos de columna, como la de un formulario, ya no pierde su primera fila ni gana cabeceras inventadas («Col2»). La tabla de doble entrada, cuya esquina está vacía a propósito, conserva su cabecera.

## [3.0.2] - 2026-09-13

- Importar PDF: las páginas maquetadas con un programa de diseño, con una rejilla decorativa que llega al borde del papel, ya no se leen como una tabla que ocupa la hoja entera. El texto deja de llegar troceado y tachado, y se recupera el de las cajas de color, que antes se perdía.

## [3.0.1] - 2026-09-12

- El paquete `.deb` se puede instalar encima de la 2.x: `edi-markdown` declara que sustituye a `edi-mark-web`, y la actualización retira el paquete antiguo sola.

## [3.0.0] - 2026-09-12

- La aplicación pasa a llamarse **EdiMarkdown**.

## [2.57.3] - 2026-09-12

- Las URL de las imágenes remotas dejan de mostrarse en la lista de imágenes.

## [2.57.2] - 2026-09-12

- El diálogo de importar PDF guía mejor sus acciones.

## [2.57.1] - 2026-09-12

- Desplazamiento sincronizado entre los dos paneles.

## [2.57.0] - 2026-09-12

- Subíndices y superíndices en la hoja: `H~2~O` y `m^2^` se ven igual que en lo que se exporta (antes `~` se leía como tachado). Botones x² y x₂ en la barra y explicación en los cinco manuales.
- El editor visual ya no convierte `H~2~O` en `H2O`, y una tilde o un circunflejo escapados siguen escapados al volver al Markdown.
- Notas al pie en la hoja.

## [2.56.3] - 2026-09-12

- El selector de delimitadores de fórmula (Ctrl+M) se queda abierto y se puede usar con el ratón además de con las teclas 1–4.

## [2.56.2] - 2026-09-12

- Cada imagen incrustada se puede pasar a la carpeta del documento por separado.

## [2.56.1] - 2026-09-12

- Escritorio: las imágenes pendientes de guardar sobreviven a un reinicio de la aplicación.
- Botones de tachado y línea horizontal en la barra.

## [2.56.0] - 2026-09-12

- El menú Ayuda y «Acerca de» llevan al artículo del blog que explica para qué sirve el programa en clase.

## [2.55.0] - 2026-09-11

- Al arrancar, un documento de más de 120.000 caracteres entra en el editor sin componer la hoja hasta que se pida, mientras el equipo no haya demostrado componer rápido. La ventana responde desde el principio.
- Cuando sí hay que componer, la cortina de arranque avisa de que el programa no responderá hasta terminar.

## [2.54.1] - 2026-09-11

- Las acciones de cada imagen caben en una sola línea aunque el nombre del archivo sea largo.

## [2.54.0] - 2026-09-11

- Configuración → Almacenamiento…: muestra lo que ocupan los documentos, su texto autoguardado y sus imágenes, y permite borrar las imágenes huérfanas y olvidar la sesión guardada.
- Conversión de todas las imágenes a la vez, de incrustadas a enlazadas y al revés, e «Ir al texto» en cada imagen.
- macOS: los manuales, el README y cada publicación explican cómo abrir la aplicación cuando el sistema dice que «está dañada».

## [2.53.1] - 2026-09-11

- Documentos enormes: el contador de palabras espera a que se deje de escribir y la vista previa deja de seguir al teclado cuando redibujarla cuesta más de 1,5 s (lo avisa y se actualiza a petición).
- El botón de releer del disco se desactiva al cerrar la última pestaña.

## [2.53.0] - 2026-09-11

- Documentos enormes: la paginación es mucho más rápida, y un documento de más de 300.000 caracteres no compone la hoja al abrirse hasta que se pida. Tampoco se monta solo al arrancar.

## [2.52.1] - 2026-09-10

- Importar PDF: el diálogo avisa mientras monta el documento en su pestaña.

## [2.52.0] - 2026-09-10

- La cortina de arranque lleva una barra en movimiento y, pasados tres segundos, un botón para empezar con una sesión limpia.
- El manual deja de abrirse en cada sesión vacía después de cerrarlo una vez. F1 y el menú Ayuda lo siguen abriendo.

## [2.51.0] - 2026-09-10

- Escritorio: botón para releer del disco el documento abierto, que pide confirmación si hay cambios sin guardar.
- Importar PDF: el aviso de páginas escaneadas dice cuáles son y advierte de que el texto del OCR sustituye a la imagen.

## [2.50.4] - 2026-09-09

- Abrir un documento largo tarda bastante menos (de 9,4 s a 2,9 s con 300 páginas), y una cortina cubre la ventana mientras se construye.
- Al arrancar se borran las imágenes que ya no pertenecen a ningún documento.
- Los mensajes con cantidades tienen su forma en singular en los cinco idiomas.

## [2.50.3] - 2026-09-09

- Importar PDF: el botón pasa a decir «Convertir a Markdown», el aviso de espera larga solo aparece con más de cien páginas y el guardado de imágenes muestra su progreso.

## [2.50.2] - 2026-09-09

- Importar PDF: la opción de OCR solo aparece cuando hay páginas escaneadas y dice cuántas son.

## [2.50.1] - 2026-09-09

- Importar PDF: la vista previa se limita al principio del documento, que se importa entero, y el diálogo informa de los pasos posteriores a la conversión.

## [2.50.0] - 2026-09-09

- Importar PDF: OCR local opcional para las páginas escaneadas.
- Importar PDF: desaparece el límite de 200 páginas. La conversión va por lotes, calcula el tiempo que queda y es mucho más rápida en documentos largos.
- Importar PDF: las fotografías se incrustan como JPEG y las imágenes viajan como archivos, lo que evita quedarse sin memoria con informes grandes.
- Importar PDF: los encabezados y pies repetidos se detectan también en libros largos, y solo se tratan las páginas que se convierten.
- La búsqueda muestra las coincidencias lejanas.

## [2.49.4] - 2026-09-08

- Escritorio: se evita el atasco de la primera importación de PDF.

## [2.49.3] - 2026-09-08

- Las importaciones largas de PDF no se interrumpen.

## [2.49.2] - 2026-09-08

- Importar PDF: las tablas llegan como tablas y no como imágenes, y muestra el progreso página a página.
- Menú contextual en las pestañas: renombrar, cerrar, cerrar las demás, cerrar todas y reabrir alguna de las diez últimas cerradas.
- Escritorio: se pueden soltar archivos PDF.

## [2.49.1] - 2026-09-08

- Importar PDF: las imágenes se conservan sin llenar el almacenamiento del navegador, y las imágenes locales pasan directamente a Pandoc.

## [2.49.0] - 2026-09-08

- **Importar PDF** en local, con vista previa, selección de páginas, eliminación de encabezados y pies repetidos y conservación de imágenes.

## [2.48.4] - 2026-09-05

- La tipografía del documento se aplica también a los enlaces y a las letras de las fórmulas.
- Arreglos en la carga de imágenes locales y en el refresco de la vista previa.

## [2.48.3] - 2026-09-03

- EdiCuaTeX 1.5.5: funcionan `\require{bbm}`, `\require{bboldx}` y `\require{dsfont}`, que dejaban la fórmula en blanco.

## [2.48.2] - 2026-09-03

- EdiCuaTeX 1.5.4: sin el motor de voz de MathJax, que no se usaba. Cada instalador ocupa 5 MB menos y los lectores de pantalla siguen leyendo el MathML.

## [2.48.1] - 2026-09-03

- EdiCuaTeX 1.5.3: arregla la construcción del instalador de Windows, que impidió publicar la 2.48.0.

## [2.48.0] - 2026-09-03

- EdiCuaTeX llega como dependencia, con MathJax 4 y MathML para los lectores de pantalla.
- EdiCuaTeX 1.5.2: el editor de menús funciona sin conexión en el escritorio.

## [2.47.0] - 2026-09-01

- Los delimitadores recomendados `\(…\)` y `\[…\]` pasan a ser las opciones 1 y 2, y Ctrl+M seguido de Intro inserta `\(…\)`.
- El audio, el vídeo y los marcos escritos a mano ya no se pierden al escribir en el editor visual.
- Escritorio: los vídeos de YouTube se muestran como una tarjeta que los abre en el navegador.

## [2.46.1] - 2026-09-01

- Escritorio: la vista previa puede incrustar vídeos.

## [2.46.0] - 2026-09-01

- Un estilo de citas personalizado (CSL) viaja con el documento, en su carpeta.

## [2.45.0] - 2026-09-01

- **Perfiles de formato**: se guardan con nombre unos ajustes de documento (texto, página, índice y numeración) para aplicarlos a otros documentos.
- La carpeta del documento sigue a su nombre también al guardarlo por primera vez y en el navegador, y conserva imágenes propias como el logotipo del manual.
- La lista de referencias se ordena por apellido.
- El diálogo de citas muestra el estilo bibliográfico y lleva a sus opciones.

## [2.44.0] - 2026-09-01

- Se pueden añadir referencias desde el diálogo de citas.
- La bibliografía de ejemplo se añade a la existente en lugar de sustituirla, y la clave de la cita se genera si se deja vacía.

## [2.43.0] - 2026-09-01

- Modos de cita y tipos de referencia, con edición de la bibliografía desde la interfaz.
- La versión se muestra bajo el nombre de la aplicación.

## [2.42.1] - 2026-09-01

- Mejoras en la paginación y en el formato del código al exportar a DOCX y ODT.

## [2.42.0] - 2026-08-31

- **Citas académicas** portables, con bibliografía que viaja con el documento.

## [2.41.2] - 2026-08-31

- Se reorganizan las opciones del documento («Opciones generales» y «Opciones de este documento») y las tarjetas de imagen.

## [2.41.1] - 2026-08-31

- Linux: la impresión en horizontal ya no sale en blanco.

## [2.41.0] - 2026-08-30

- Orientación de página, salto de página antes de cada encabezado de nivel 1 y profundidad del índice.

## [2.40.2] - 2026-08-30

- Los bloques preformateados anchos se ajustan a la hoja.

## [2.40.1] - 2026-08-30

- La sangría de la vista previa se limita a los párrafos, se recupera la pestaña activa, se respetan los valores de formato borrados y los diálogos de ajustes se confirman con Intro.

## [2.40.0] - 2026-08-30

- La lista de imágenes reúne las enlazadas y las incrustadas: todas se pueden ver, reemplazar (desde el portapapeles, el disco o una URL) y quitar, y las enlazadas, incrustar.
- «Guardar como» renombra la carpeta de imágenes.
- El contador muestra caracteres y palabras.

## [2.39.4] - 2026-08-30

- Linux: los márgenes y el papel del documento se pasan al cuadro de impresión del sistema y valen en todas las páginas.

## [2.39.3] - 2026-08-29

- Se imprime con el tamaño de papel del documento.

## [2.39.2] - 2026-08-29

- La barra de estado es más baja y deja más sitio al documento.

## [2.39.1] - 2026-08-29

- La hoja puede llenar el panel hasta el 200 %, y el ancho solo se ata a la lupa con los dos paneles a la vista.

## [2.39.0] - 2026-08-29

- Un interruptor ata el ancho del editor visual a su lupa, para que la hoja quepa sin barra horizontal.
- La aplicación abre con el ancho expandido y aplica el formato del documento desde el arranque.

## [2.38.0] - 2026-08-29

- El editor visual muestra **páginas de verdad**, con tamaño de papel A4 o Carta que llega a los cinco formatos.
- El índice aparece en la hoja con número de página cuando el documento lo pide.
- DOCX: los márgenes se escriben en el orden que Word acepta.

## [2.37.0] - 2026-08-29

- Los paneles pasan a llamarse editor Markdown y editor visual, y los manuales se reescriben más cortos.
- Botón de exportar en la barra que repite el último formato, idioma del documento visible en la barra de estado y los seis niveles de encabezado legibles en el tema oscuro.
- Letra con remates e interlineado 1,5 por defecto. Los márgenes llegan al papel y la lupa ya no afecta a la impresión.
- Escritorio: arrastrar y soltar documentos y carpetas, un documento ya abierto vuelve a su pestaña, y los `.md` llevan el icono de la aplicación en el paquete `.deb`.

## [2.36.0] - 2026-08-28

- La barra de estado resume el formato con que va a salir el documento.
- Los archivos propios se piden con la versión en la URL para no servir copias viejas.

## [2.35.0] - 2026-08-28

- Las imágenes se guardan en una carpeta con el nombre del documento, para que dos documentos no se pisen las imágenes.

## [2.34.0] - 2026-08-28

- Los controles de los paneles pasan a una barra de estado bajo los dos, y el documento empieza más arriba.

## [2.33.1] - 2026-08-28

- La pestaña activa se distingue con una banda de color y el título en negrita.

## [2.33.0] - 2026-08-28

- Las imágenes incrustadas se pueden pasar a archivos en la carpeta del documento.
- Botón de ventana independiente junto a los de la vista.

## [2.32.0] - 2026-08-28

- Cada pestaña conserva el cursor y el desplazamiento.
- El tabulador anida las listas en los dos paneles.

## [2.31.0] - 2026-08-28

- Los paneles se sincronizan por la línea y no por la proporción.
- La barra de formato funciona también sobre el editor visual, con una ventana para escribir fórmulas.

## [2.30.0] - 2026-08-28

- Cada panel tiene su lupa y desaparece el ajuste «Tamaño de texto».
- Las tablas anchas se desplazan dentro de la hoja.

## [2.29.1] - 2026-08-28

- Escritorio: la lupa agranda la página también en Linux.

## [2.29.0] - 2026-08-28

- La vista previa se presenta como una hoja con lupa, y las tres disposiciones se eligen con botones.

## [2.28.1] - 2026-08-28

- Los menús no se salen de la pantalla en móviles estrechos.

## [2.28.0] - 2026-08-27

- En el navegador se guarda con el cuadro del sistema y no como una descarga.
- Un EPUB exportado vuelve igual al importarlo, con su tipografía, su idioma y sin título duplicado.
- Todas las opciones de los menús llevan su explicación escrita. El tamaño de texto de la interfaz ya no altera la vista previa.

## [2.27.0] - 2026-08-27

- Exportar pasa a ser un menú propio, y cada formato lleva su explicación bajo el nombre.

## [2.26.0] - 2026-08-27

- Un solo botón para copiar el documento en cuatro formatos, con acorde Ctrl+Alt+C.
- Las fórmulas se insertan con un único acorde (Ctrl+M y 1–4), y la cabecera se reorganiza.

## [2.25.0] - 2026-08-27

- PDF en el menú de exportar, a través del cuadro de impresión.
- Índice y numeración de apartados por documento.
- El editor Markdown tiene altura en el móvil y una imagen pegada entra una sola vez.

## [2.24.1] - 2026-08-26

- Se avisa antes de cerrar una pestaña con cambios sin guardar, también en el escritorio.
- Los campos de los diálogos tienen borde visible y los botones de exportación se traducen.

## [2.24.0] - 2026-08-26

- La URL como tercera forma de insertar una imagen.
- Se recuerda de dónde viene cada documento entre sesiones, y las preferencias se guardan en disco para que la versión nueva las encuentre.
- Se aclara que la aplicación de escritorio no recoge estadísticas.

## [2.23.2] - 2026-08-26

- La lista de imágenes incrustadas se pliega y muestra una miniatura de cada una.

## [2.23.1] - 2026-08-26

- Tras lanzar el instalador de una actualización se ofrece cerrar la aplicación.
- La marca del corrector ortográfico sigue al ajuste.

## [2.23.0] - 2026-08-26

- Los valores heredados se muestran bajo cada campo, y las opciones de exportación se reparten en pestañas.
- Escritorio: los ajustes se guardan en disco y los diálogos recuerdan la última carpeta.

## [2.22.3] - 2026-08-26

- Las imágenes enlazadas se recuperan al recargar la página.

## [2.22.2] - 2026-08-26

- Las imágenes enlazadas se guardan junto al documento Markdown.

## [2.22.1] - 2026-08-26

- El idioma, el autor y el formato de un documento se editan juntos en un mismo cuadro.

## [2.22.0] - 2026-08-26

- **Formato por documento** (alineación, letra, interlineado, márgenes, sangría y partición de palabras), que viaja en el archivo y llega a los cinco formatos.
- Corrector ortográfico en el escritorio en Linux, con un interruptor en Configuración.
- Un ejemplo de imagen escrito como código ya no llena de base64 los documentos exportados.

## [2.21.2] - 2026-08-25

- Escritorio: se reproducen audio y vídeo externos.

## [2.21.1] - 2026-08-25

- Escritorio: se imprime el documento entero y no solo la primera página.

## [2.21.0] - 2026-08-25

- La vista previa muestra las imágenes enlazadas con ruta relativa, y al insertar una imagen se elige entre ruta relativa o incrustada.

## [2.20.1] - 2026-08-25

- Escritorio: la actualización se descarga correctamente.
- Linux: abrir un `.md` desde el gestor de archivos lo carga en la aplicación.

## [2.20.0] - 2026-08-25

- El aviso de escritorio anuncia cada versión nueva.

## [2.19.0] - 2026-08-25

- Entrada «Salir» en el menú Archivo del escritorio, y botón de disposición que muestra la activa.
- Los paquetes de Linux se construyen para Debian 12 y Ubuntu 22.04, y hay imagen de disco para Mac con Intel.
- Manual reescrito en los cinco idiomas, con la aplicación de escritorio.

## [2.18.0] - 2026-08-25

- El escritorio busca actualizaciones una vez al día y ofrece instalarlas.

## [2.17.0] - 2026-08-25

- Mejoras en los flujos de documento y de escritorio: menú de disposición de paneles y elegir imagen del disco.

## [2.16.0] - 2026-08-25

- **Aplicaciones de escritorio** para Linux y Windows, con diálogos nativos, «Guardar como», corrector del sistema y enlaces externos.
- EdiCuaTeX integrado con el tema y el idioma, y más atajos de teclado.
- Diálogo «Acerca de» en lugar del pie de la web.

## [2.15.1] - 2026-08-09

- El índice de DOCX y ODT se escribe dentro del documento en lugar de abrirse vacío.

## [2.15.0] - 2026-08-09

- Portada del EPUB: generada con el título y el autor, una imagen propia o ninguna.

## [2.14.1] - 2026-08-09

- Intento de que el índice de los DOCX se rellene al abrirlos. Los DOCX reempaquetados se comprimen.

## [2.14.0] - 2026-08-09

- Índice automático y numeración de apartados en las opciones de exportación.

## [2.13.0] - 2026-08-09

- Las páginas HTML exportadas llevan título, y se añade el autor, general o por documento.

## [2.12.0] - 2026-08-09

- Todos los formatos exportados declaran su idioma, general o propio de cada documento.
- La vista previa reconoce y oculta el bloque de metadatos YAML.

## [2.11.0] - 2026-08-09

- El LaTeX autónomo lleva el idioma y portada, y se pueden fijar la clase, sus opciones y un preámbulo propio.

## [2.10.0] - 2026-08-09

- Ctrl+O abre archivos y se pueden soltar carpetas.
- El botón de EdiCuaTeX indica que es un editor de fórmulas.
- Manuales al día.

## [2.9.0] - 2026-08-08

- Pandoc se descarga comprimido y se aprovecha la caché del navegador.
- No se pierde lo último escrito al cambiar de pestaña, y se puede buscar en el panel HTML.
- La vista previa se repinta con límite de frecuencia.
- Seguridad: la analítica va aislada y se desarman los manejadores y los enlaces `javascript:` de los archivos importados.

## [2.8.3] - 2026-08-08

- La importación muestra su progreso y el selector acepta varios archivos.

## [2.8.2] - 2026-08-08

- Exportar el manual ya no cuelga el navegador: se añade un límite de tamaño para las imágenes incrustadas.

## [2.8.1] - 2026-08-08

- Búsqueda mucho más rápida en documentos grandes, descargas más fiables y autoguardado solo cuando hay cambios.

## [2.8.0] - 2026-08-08

- Los enlaces internos de la vista previa encuentran su destino, las imágenes con ruta relativa se exportan y un ODT exportado conserva sus fórmulas al importarlo.
- Correcciones de seguridad y de estabilidad en la carga de Pandoc, la conversión de LaTeX y «Reemplazar uno».
- El manual amplía los ejemplos de fórmulas.

## [2.7.31] - 2026-08-08

- El manual espera a conocer el idioma antes de cargarse.

## [2.7.30] - 2026-08-08

- Manual traducido a los cinco idiomas, que se abre en el de la interfaz.

## [2.7.29] - 2026-08-08

- Tema Sistema, Claro y Oscuro como submenú, y la elección se recuerda.

## [2.7.28] - 2026-08-08

- El idioma y el tamaño de texto pasan a ser submenús.

## [2.7.27] - 2026-08-08

- Se reagrupa la barra superior.

## [2.7.26] - 2026-08-08

- El tema, el ancho y la ventana independiente pasan al menú Configuración.

## [2.7.25] - 2026-08-08

- El submenú de exportar se abre al pasar el ratón, y las barras de herramientas se hacen más coherentes.

## [2.7.24] - 2026-08-08

- Todos los desplegables comparten estilo, y el menú de copiar marca la opción activa.

## [2.7.23] - 2026-08-08

- El submenú de exportar cuelga del menú Archivo.

## [2.7.22] - 2026-08-08

- El menú Archivo se agrupa en entrada y salida, y muestra sus atajos.

## [2.7.21] - 2026-08-08

- Se recuperan las cabeceras de tabla al importar ODT.

## [2.7.20] - 2026-08-08

- Las tablas importadas se ven como tablas, y el aviso de arrastrar y soltar usa el estilo de la aplicación.

## [2.7.19] - 2026-08-08

- Se pueden soltar todos los formatos admitidos, no solo Markdown.

## [2.7.18] - 2026-08-08

- Se recuperan las imágenes al importar DOCX, ODT y EPUB.

## [2.7.17] - 2026-08-08

- Importación de EPUB.

## [2.7.16] - 2026-08-08

Incluye las versiones 2.7.14 y 2.7.15, que no llegaron a etiquetarse.

- Exportación a EPUB.
- Una exportación fallida lo dice en lugar de descargar un archivo vacío, y las imágenes remotas se incrustan antes de convertir.
- Las líneas `---` que separan secciones ya no rompen la exportación.
- Estadísticas de uso anónimas con aviso de privacidad.

## [2.7.13] - 2026-03-07

- Búsqueda con expresiones regulares.

## [2.7.12] - 2025-11-19

- Se conservan los delimitadores de fórmula en la vista previa.

## [2.7.11] - 2025-11-19

- Botones para maximizar cada panel y aviso cuando un control de formato está desactivado.

## [2.7.10] - 2025-11-18

- Los botones de deshacer funcionan en cualquier vista.

## [2.7.9] - 2025-11-18

- Se limpian los saltos vacíos de las tablas pegadas.

## [2.7.8] - 2025-11-18

- El pegado con formato vuelve a ser el predeterminado.

## [2.7.7] - 2025-11-18

- Se conservan los delimitadores LaTeX al pegar.

## [2.7.6] - 2025-11-18

- Se normalizan las listas numeradas pegadas.

## [2.7.5] - 2025-11-18

- Se evitan escapes innecesarios al pegar.

## [2.7.4] - 2025-11-18

- Se corrige el pegado de fórmulas LaTeX.

## [2.7.3] - 2025-11-16

- Se ajusta la sección del manual sobre el pegado.

## [2.7.2] - 2025-11-16

- Mejoras en el pegado.

## [2.7.1] - 2025-11-16

- Solo se imprime el panel HTML.

## [2.7] - 2025-11-16

- El botón de modo foco no se imprime.

## [2.6] - 2025-11-14

- Pie legal y README actualizados.

## [2.5] - 2025-11-13

- Las pestañas se pueden arrastrar.

## [2.4] - 2025-11-13

- Se estabiliza el espaciado del modo foco.

## [2.3] - 2025-11-13

- Modo foco.

## [2.2] - 2025-11-12

- Manual con vídeos nuevos.

## [2.1] - 2025-11-11

- Mejor conversión de tablas de HTML a Markdown y más traducciones.

## [2.0] - 2025-11-11

- Menú Archivo reorganizado.

## [1.13] - 2025-11-11

- Importación de varios formatos y mejor pegado de LaTeX.

## [1.12] - 2025-11-11

- Diálogo para importar LaTeX y compilación local de Tailwind.

## [1.11] - 2025-11-10

- El manual y el README explican la edición dual y la diferencia entre exportar y copiar.

## [1.10] - 2025-11-10

- Se corrige el renderizado de fórmulas con KaTeX.

## [1.9] - 2025-11-10

- El botón de EdiCuaTeX se desactiva en la vista previa.

## [1.8] - 2025-11-10

- El botón de nueva pestaña no se imprime.

## [1.7] - 2025-11-10

- Mejor barra de herramientas en el móvil.

## [1.6] - 2025-11-10

- Mejor sincronización entre editores y mejor impresión en móvil y escritorio.

## [1.5] - 2025-11-05

- Se corrigen regresiones al copiar al portapapeles.

## [1.4] - 2025-11-05

- Mejoras al copiar y al exportar fórmulas.

## [1.3] - 2025-11-05

- La vista previa sigue al cursor del Markdown, y mejoran las acciones de copiar y los avisos.

## [1.2] - 2025-11-05

- Se reordena el menú de fórmulas.

## [1.1] - 2025-11-05

Primera versión etiquetada.

- Editor Markdown con vista previa, fórmulas LaTeX, búsqueda, arrastrar y soltar e internacionalización.
- Integración con EdiCuaTeX y modo de ventana independiente.
- Exportación a DOCX, ODT, HTML y LaTeX mediante Pandoc WASM.
