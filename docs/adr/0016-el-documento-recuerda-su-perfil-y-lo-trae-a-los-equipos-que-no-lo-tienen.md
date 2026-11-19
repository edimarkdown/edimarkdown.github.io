# 16. El documento recuerda su perfil y lo trae a los equipos que no lo tienen

Fecha: 2026-11-19 · Estado: aceptado

## Contexto

Un perfil de formato (`format-profiles.js`) es un juego de ajustes con nombre
—texto, página, índice y numeración— que se aplica a un documento copiando sus
valores al bloque de metadatos del `.md`. Los perfiles viven en el
`localStorage` de cada equipo (`edimarkweb-format-profiles`); el documento solo
llevaba los valores.

Al cerrar y volver a entrar, el selector «Perfil de formato» salía siempre en
«Ninguno», aunque el documento conservara todos los ajustes del perfil. Quien
lo usaba entendía que el perfil no se había cargado. Y en otro equipo el
perfil no existía: había que volver a crearlo a mano con los mismos valores.

## Decisión

- Al aplicar un perfil, o al guardar como perfil los campos del cuadro, el
  documento escribe su nombre en una línea propia del bloque de metadatos:
  `format-profile: "Nombre"`. «Quitar todo del documento» la quita, como el
  resto de ajustes.
- Al abrir el cuadro, el selector enseña el perfil que nombra el documento. Si
  los campos no coinciden con lo que fija el perfil, el rótulo dice
  «Nombre (modificado)», y se actualiza mientras se cambian; volver a aplicar
  el perfil repone sus valores.
- Un documento sin la línea (anterior a ella, o escrito a mano) muestra el
  perfil cuyos ajustes son exactamente los suyos, ni uno más ni uno menos
  (`findProfileForSettings`), y solo si hay uno. Que coincida solo lo que el
  perfil fija no basta: uno que fije nada más la letra encajaría con casi
  cualquier documento. Abrir el cuadro no escribe nada; la línea se escribe al
  pulsar «Aplicar».
- Cuando un documento pasa a ser el activo (al abrirlo, al cambiar de pestaña o
  al arrancar), si nombra un perfil que este equipo no tiene, el perfil se
  compone con los ajustes que lleva el documento y se añade a la lista sin
  preguntar, con un aviso breve que se va solo.
- Si en este equipo ya hay un perfil con ese nombre, no se toca aunque diga
  otra cosa: puede ser otro perfil que se llama igual. El documento lo enseña
  como «(modificado)».
- Borrar un perfil lo anota en `edimarkweb-format-profiles-forgotten`, y los
  nombres anotados no se vuelven a añadir solos. Guardar otra vez un perfil con
  ese nombre lo saca de la lista. Un documento que nombra un perfil borrado lo
  enseña como «Nombre (no guardado en este equipo)», sin poder aplicarlo.

La clave no es `edimark-profile`, que es la primera línea de un archivo de
perfil y lleva su número de versión: aquí va un nombre, y la misma clave con
dos sentidos se confundiría.

## Alternativas descartadas

- **Enseñar el nombre en otro equipo y dejar que se guarde a mano** con un
  clic. Era menos invasivo, pero deja en manos de cada persona un paso que el
  programa puede dar solo; el aviso al añadirlo ya dice lo que ha pasado.
- **Un perfil por defecto para los documentos nuevos.** Para eso están las
  opciones generales: serían dos sitios para lo mismo.
- **Reconocer el perfil solo comparando valores**, sin escribir nada en el
  documento. No sirve en un equipo sin el perfil, y dos perfiles con los mismos
  valores serían indistinguibles. Se compara solo cuando falta la línea.
- **Sobrescribir el perfil local con el del documento** cuando se llaman igual.
  Un documento recibido de otra persona cambiaría los perfiles propios sin
  avisar.

## Consecuencias

- El selector dice la verdad sobre el documento, y un documento lleva consigo
  su perfil a cualquier equipo.
- Abrir documentos de otras personas puede añadir perfiles a la lista. Se
  borran como cualquier otro y no vuelven.
- El nombre del perfil pasa a las exportaciones como un metadato más, igual que
  `print-header` o `print-footer`, que Pandoc deja pasar sin efecto en el
  formato.
- El perfil que se compone en otro equipo solo tiene lo que se ve en el
  documento: texto, página, índice y numeración. Es todo lo que el cuadro del
  documento guarda en un perfil, así que no se pierde nada.

## Evidencia

- `format-profiles.js`: `DOCUMENT_PROFILE_KEY`, `readDocumentProfileName` y
  `documentProfileEntries`, probadas en `test/format-profiles.test.mjs`.
- `script.js`: `adoptDocumentProfile`, llamada al final de `switchTo` y antes de
  dar el arranque por terminado; `renderFormatProfiles` compone los rótulos.

## Riesgos y limitaciones

- Si se edita a mano la línea `format-profile` con un nombre que no existe y
  sin ningún ajuste, no se añade nada: un perfil vacío no cambiaría nada.
- Un documento que se edita fuera de EdiMarkdown puede quedarse con la línea
  aunque sus valores ya no sean los del perfil; el cuadro lo enseña como
  «(modificado)».

## Validación

`test/browser.test.mjs`, «el documento recuerda su perfil y lo trae a un equipo
que no lo tiene», en Chromium y Firefox: guardar y aplicar un perfil, recargar y
verlo elegido; cambiar un campo y ver «(modificado)»; abrir el archivo en un
navegador sin perfiles y ver que se añade y se puede aplicar a otro documento;
borrarlo y comprobar que no vuelve al abrir otra vez el documento. Y «un
documento de antes se reconoce por tener exactamente los ajustes de un
perfil»: lo reconoce sin escribir nada hasta «Aplicar», y deja de reconocerlo
con un ajuste de más.
