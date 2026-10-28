# 7. La web se muda a edimarkdown.github.io y se lleva los documentos guardados en el navegador

Fecha: 2026-10-28 · Estado: aceptado

## Contexto

La aplicación se llama EdiMarkdown, pero hasta la 3.4.0 se publicaba con su
nombre anterior: en `edimarkweb.github.io`, desde el repositorio
`edimarkweb/edimarkweb.github.io`. Se cambia a `edimarkdown.github.io`, en la
organización `edimarkdown`.

Cambiar de dirección no es solo cambiar enlaces:

- La web guarda los documentos abiertos, la lista de pestañas y las
  preferencias en `localStorage`, y las imágenes en IndexedDB. Ese
  almacenamiento va atado al origen. En la dirección nueva, el editor saldría
  vacío.
- GitHub redirige el repositorio trasladado (web, git, incidencias), pero no su
  sitio de GitHub Pages. Si se crea otro repositorio en la ubicación anterior,
  esas redirecciones desaparecen.
- Las instalaciones de escritorio hasta la 3.4.0 buscan actualizaciones en
  `api.github.com/repos/edimarkweb/edimarkweb.github.io` y solo pueden
  descargar de `github.com/edimarkweb/*`.

El traslado anterior (de `jjdeharo.github.io/edimarkweb` a
`edimarkweb.github.io`) fue una redirección simple, y los documentos guardados
se quedaron en la dirección vieja.

## Decisión

1. El repositorio se traslada a la organización `edimarkdown` y se renombra
   `edimarkdown.github.io`. La 3.5.0 cambia todas las direcciones públicas: la
   web, los enlaces de la aplicación y los manuales, el actualizador de
   escritorio y sus permisos de red.
2. Los nombres internos no cambian: las claves `edimarkweb-…` de
   `localStorage`, la base `edimarkweb-assets`, el identificador
   `io.github.edimarkweb` y el nombre del paquete de Rust. No los ve nadie, y
   cambiar el identificador haría que la aplicación de escritorio se instalara
   como otra y perdiera sus documentos y ajustes.
3. En `edimarkweb/edimarkweb.github.io` queda un repositorio nuevo con una sola
   página, que se sirve también como `404.html` para cualquier ruta:
   - si el navegador no guarda documentos de allí con texto, o ya se
     trasladaron, salta a la misma ruta en la dirección nueva;
   - si los guarda, dice que la aplicación se ha mudado y ofrece llevarlos con
     un botón. El botón abre `mudanza.html` en la dirección nueva, y las dos
     páginas se pasan por `postMessage` la lista, los textos, las preferencias
     y las imágenes. Cuando la nueva confirma, la vieja lo anota y deja de
     preguntar;
   - si la nueva no confirma, ofrece descargar los documentos en un ZIP, con
     cada documento que tenga imágenes en su propia carpeta.
4. `mudanza.html` solo acepta datos de `https://edimarkweb.github.io` y de la
   ventana que la abrió. Lo que ya hubiera en la dirección nueva manda: los
   documentos traídos van detrás, un identificador repetido no se trae y una
   preferencia solo se copia si no estaba puesta. Escribe primero las imágenes,
   luego los textos y al final la lista; si algo falla, borra lo escrito.
5. Ese repositorio lleva además una publicación `v3.5.0` con los mismos
   instaladores. Las instalaciones hasta la 3.4.0 la encuentran donde buscan,
   se actualizan, y desde la 3.5.0 buscan en el repositorio nuevo.

## Alternativas descartadas

- **Redirección simple, como en el traslado anterior**: quien tuviera
  documentos abiertos solo en el navegador vería el editor vacío.
- **Una página dentro de otra (iframe) para leer el almacenamiento sin clic**:
  los navegadores separan el almacenamiento de un iframe de otro sitio, y cada
  subdominio de `github.io` cuenta como sitio distinto (está en la Public Suffix
  List). El iframe vería un almacenamiento vacío.
- **Pasar los datos en la dirección (fragmento)**: no requiere clic, pero un
  documento con imágenes supera con facilidad lo que cabe en una URL.
- **Abrir la ventana nueva sin clic**: los navegadores bloquean las ventanas
  que no abre una pulsación. Por eso el botón; quien no tiene documentos no lo
  ve.
- **Renombrar la organización `edimarkweb`**: GitHub tampoco redirige su sitio
  de Pages, y el nombre antiguo quedaría libre para cualquiera.
- **Cambiar también los nombres internos**: no lo ve nadie y obligaría a
  migrar también la aplicación de escritorio.

## Consecuencias

Quien abre la dirección antigua sin documentos no nota nada, salvo el cambio de
dirección. Quien los tiene pulsa una vez. Los enlaces a la web antigua siguen
funcionando, incluidos los que llevan ruta o ancla.

Con el repositorio nuevo en la ubicación anterior, `github.com/edimarkweb/…`
deja de redirigir: los enlaces antiguos a incidencias o a la página del código
llevan a ese repositorio, cuyo README remite al nuevo. Los de
`releases/latest` siguen funcionando, porque allí está la `v3.5.0`.

`mudanza.html` y la página antigua tienen que seguir hablando el mismo
protocolo mientras exista la segunda; la prueba «mudanza.html recibe los
documentos de la dirección anterior» lo vigila.

## Evidencia

- GitHub, [Transferring a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository):
  «we don't redirect GitHub Pages associated with the repository», y crear un
  repositorio en la ubicación anterior borra las redirecciones.
- `github.io` figura en la [Public Suffix List](https://publicsuffix.org/list/),
  así que `edimarkweb.github.io` y `edimarkdown.github.io` son sitios
  distintos para la partición del almacenamiento.

## Riesgos y limitaciones

- Safari borra lo que un sitio guarda desde sus scripts tras siete días de uso
  del navegador sin visitarlo; los documentos que ya no estén en la dirección
  antigua no se pueden traer.
- En una ventana privada de WebKit, la web no puede guardar imágenes en
  IndexedDB, tampoco antes de la mudanza. Los textos viajan igual.
- Si la nueva dirección está abierta en otra pestaña durante la mudanza, esa
  pestaña puede reescribir la lista al guardar y dejar fuera lo traído. Los
  textos siguen en el almacenamiento, pero sin pestaña.
- Entre el traslado del repositorio y la publicación de la página antigua, la
  dirección vieja da error durante unos minutos.

## Validación

El 28-10-2026, en local, con las dos direcciones reales interceptadas por
Playwright (y así con sus orígenes y su almacenamiento separados), en Chromium,
Firefox y WebKit:

- sin documentos, `edimarkweb.github.io/manual.md?x=1#y` salta a la misma ruta
  en la nueva;
- con dos documentos creados en la aplicación antigua, uno con imagen, llegan
  los dos, el texto exacto, la imagen y el tema; la imagen se ve en la vista
  previa (Chromium y Firefox), y la segunda visita a la antigua ya salta;
- si la nueva ya tenía un documento, el traído va detrás y el tema propio no
  cambia;
- si la nueva responde que no puede guardar, la antigua ofrece el ZIP, que
  contiene `Con imagen/Con imagen.md`, `Con imagen/img/a.png` y `Solo.md`, y
  sigue ofreciendo la mudanza en la visita siguiente.

En WebKit, la imagen se guardó como bytes, porque en sus contextos privados no
admite Blob en IndexedDB.
