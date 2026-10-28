# 8. El cambio de disposición termina cuando acaban sus animaciones

Fecha: 2026-10-28 · Estado: aceptado

## Contexto

Al cambiar de disposición, el panel que llega crece desde cero y el que se va
se encoge hasta cero, los dos con una transición de 180 ms. Al terminar, el que
se va se esconde (`display: none`) y se retira la clase `layout-changing`, que
es la que pone la transición.

Las dos cosas se hacían con temporizadores contados desde el clic: 200 ms para
esconder el panel y 220 ms para retirar la clase. Pero la transición no empieza
con el clic, sino en el primer fotograma después de él, y el propio clic ocupa
el hilo un buen rato. En un equipo cargado, el temporizador vencía antes de que
la transición acabara, o incluso antes de que empezara. El panel que se iba
desaparecía y el que llegaba daba un salto.

La prueba «los paneles entran creciendo por su lado» lo vio dos veces en GitHub
el 28-10-2026: el borde derecho del editor visual se quedaba en 1208 y 1167 px
en vez de 1219.

## Decisión

Al final del cambio, `terminarCambioDePaneles` recoge con `getAnimations()` las
animaciones de los dos paneles y espera a que terminen todas
(`Promise.allSettled` sobre sus `finished`). Entonces esconde el que se va y
retira la transición. `getAnimations()` devuelve las transiciones ya creadas
aunque aún no hayan arrancado. Si no hay ninguna, como con el movimiento
reducido, el cambio termina en el acto.

Cada cambio lleva un número. El final de uno interrumpido por otro no hace
nada, porque al reemplazarse sus transiciones su `finished` se resuelve igual.
Las animaciones sin fin no cuentan. Si el navegador no tiene `getAnimations`,
se vuelve al temporizador de 220 ms.

## Alternativas descartadas

- **Alargar los temporizadores**: cualquier plazo se queda corto en un equipo lo
  bastante lento, y en uno rápido el cambio se hace más largo sin motivo.
- **Escuchar `transitionend`**: no llega si la transición se cancela o no llega a
  crearse, y con el movimiento reducido no hay ninguna; habría que añadir otro
  temporizador de respaldo para esos casos.
- **Arreglar solo la prueba**, esperando a que acabe la animación antes de
  medir: el salto lo ve también quien usa la aplicación en un equipo lento.

## Consecuencias

El panel que se va se esconde cuando ya mide cero, sin salto, por lento que sea
el equipo. En uno cargado, el cambio termina más tarde que antes, cuando de
verdad ha acabado la animación.

## Evidencia

Medido en local en el instante en que se esconde el panel (con un
`MutationObserver`), con Chromium y la CPU frenada por CDP
(`Emulation.setCPUThrottlingRate`):

- Antes: con la CPU normal, el borde en su sitio. Frenada cuatro veces, en 1208,
  1103 y 1167 px; frenada ocho veces, en 341 px en todos los cambios.
- Después: 1219 px en los 20 cambios, de la CPU normal a doce veces más lenta.

## Riesgos y limitaciones

Una animación que no terminara nunca dejaría el panel a la vista con ancho
cero, invisible pero presente. Por eso se descartan las de duración infinita.

## Validación

La prueba mide ahora los bordes en el instante en que se esconde el panel, no
después, y en Chromium la CPU va frenada ocho veces. Con el código anterior
falló 3 de 3 veces (341 px); con el nuevo pasó 5 de 5 veces, y en Firefox
también.
