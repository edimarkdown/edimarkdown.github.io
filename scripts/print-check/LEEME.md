# Comprobar que el papel corta donde la hoja

Las pruebas de navegador no pueden generar el PDF de Firefox ni el de WebKit,
que es el motor de Safari y de las aplicaciones de macOS y Linux. Estas
herramientas cargan EdiMarkdown en cada motor, sin ventana, esperan al reparto
en páginas, anotan dónde empieza cada página en la hoja y lo imprimen a PDF por
el mismo camino que la aplicación. `compara.py` dice después si el papel tiene
las mismas páginas que la hoja y si empiezan donde ella.

Hace falta servir el repositorio, por ejemplo con
`python3 -m http.server 8931 --bind 127.0.0.1` desde su raíz.

| Motor | Orden |
|---|---|
| WebKitGTK (aplicación de Linux) | `python3 webkitgtk.py http://localhost:8931/index.html /tmp/w.pdf /tmp/w.json "$(cat previo-100.js)"` |
| Firefox | `./firefox.sh http://localhost:8931/index.html /tmp/f.pdf /tmp/f.json previo-100.js` |
| WebKit en macOS | `./macos http://localhost:8931/index.html m.pdf m.json 595.28 841.89 previo-100.js`, en un Mac |

Y después, `python3 compara.py /tmp/w.json /tmp/w.pdf`.

- `previo-100.js` deja la lupa al 100 %, que es cuando la pantalla y el papel
  miden lo mismo; `previo-carta.js` carga el manual en Carta apaisada con
  márgenes propios. Sin guion previo se imprime el manual tal como se abre.
- La escala se comprueba con el logotipo del manual, que mide 100 px:
  `pdfimages -f 1 -l 1 -list salida.pdf` tiene que dar 96 puntos por pulgada.
- `webkitgtk.py` necesita `python3-gi` y `gir1.2-webkit2-4.1`; `firefox.sh`, el
  Firefox del sistema y Node 22; `compara.py`, `poppler-utils`.
- `macos.swift` se compila con `swiftc -O macos.swift -o macos`. Sin un Mac a
  mano, se ejecuta en una máquina `macos-latest` de GitHub Actions.

`prototipo/paginas-como-cajas.html` es la página de prueba del
[ADR 15](../../docs/adr/0015-la-impresion-sale-de-una-copia-de-la-hoja-partida-en-paginas.md),
que está propuesto y sin construir: cuatro páginas dibujadas como cajas, cada
una con su cabecera y su pie.

Las decisiones que se comprueban con esto están en los ADR
[12](../../docs/adr/0012-la-hoja-compensa-la-escala-de-impresion-de-webkit-midiendo-el-ancho-del-papel.md)
y [13](../../docs/adr/0013-el-reparto-en-paginas-deja-un-milimetro-de-holgura-al-final-de-cada-pagina.md).
