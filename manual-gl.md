![Logotipo de EdiMarkdown](logo_100px.png)

# Manual de EdiMarkdown

EdiMarkdown é un editor de textos en Markdown para docentes e creadores de contido. Escríbese rápido, importa documentos de Word, LibreOffice, EPUB, HTML, LaTeX ou PDF, e exporta a eses mesmos formatos, con fórmulas matemáticas incluídas. Funciona no navegador, sen instalar nada, e tamén como aplicación de escritorio para Linux, Windows e macOS. Nos dous casos o traballo queda no teu equipo: nin os documentos nin as imaxes saen del.

## Para empezar

Non fai falta saber Markdown. Escribe no panel da esquerda e verás o documento composto á dereita; os botóns da barra de ferramentas poñen negras, títulos, listas, táboas, ligazóns, imaxes e fórmulas, e funcionan nos dous paneis.

Cando remates: **Gardar** (`Ctrl+S`) deixa un ficheiro `.md` de texto corrente, que se abre en calquera sitio, e **Exportar** xera o Word, o PDF ou o formato que precises entregar.

Este manual está sempre en **Axuda** ou con `F1`. Tamén hai un [artigo do blog](https://educacion.bilateria.org/edimarkdown-escribir-en-markdown-y-convertir-a-cualquier-formato) (en castelán) que conta para que serve EdiMarkdown na aula, con exemplos e capturas.

---

## Os dous editores

A pantalla divídese en dous paneis que **editan o mesmo documento** á vez:

* **Editor Markdown** (esquerda): o texto en código fonte, tal cal.
* **Editor visual** (dereita): o documento xa composto, como unha folla de papel. Escríbese directamente sobre el e a barra de formato tamén funciona aquí.

Arrastra a barra central para repartir o espazo, ou usa os tres botóns de disposición (`Ctrl+L`) para ver só un editor, ou os dous. A dobre frecha oculta as barras e deixa toda a pantalla para escribir.

A lupa da barra de estado (ou `Ctrl` + `+` / `Ctrl` + `-`) amplía ou reduce o que ves, sen cambiar o documento: o papel sempre sae ao 100 % ao imprimir ou exportar. O interruptor coa cadea, xunto á lupa, mantén a páxina enteira visible aínda que movas o separador entre paneis; pódese soltar se prefires controlar o zoom á man.

**Pegar calquera cousa**: con `Ctrl+V`, EdiMarkdown coloca no panel adecuado o que traias do portapapeis. O texto e o Markdown van ao editor Markdown; o contido con formato —de Word, dunha web, dun chatbot— e as imaxes recomponse no editor visual. Non fan falta pasos intermedios: copia de onde sexa e pega.

---

## Lapelas e menús

Cada documento vive na súa lapela. `Ctrl+Alt+N` crea unha, `Ctrl+Alt+AvPáx` pasa á seguinte, e un punto vermello (`●`) avisa de cambios sen gardar. O botón dereito sobre unha lapela abre **Renomear**, **Pechar** e, en **Reabrir**, as últimas dez lapelas pechadas.

Todo se autogarda só no equipo: se recargas a páxina ou volves abrir o programa, o contido reaparece. É unha rede de seguridade, non un substituto de gardar o ficheiro.

Xunto ao logotipo están os menús:

* **Ficheiro**: abrir, importar, pegar LaTeX, gardar e gardar como.
* **Exportar** (`Ctrl+Alt+E`): os seis formatos de saída.
* **Configuración** (`Ctrl+,`): idioma da interface, tema, corrector ortográfico e as opcións xerais dos documentos.
* **Axuda**: este manual (`F1`) e, no escritorio, buscar actualizacións.

A barra de ferramentas reúne negra, cursiva, cabeceiras, listas, citas, código, ligazóns, imaxes, táboas, citas bibliográficas e fórmulas. Cada botón di, ao pasar o rato, que fai e con que atallo.

---

## Abrir, importar e arrastrar

* **Abrir** (`Ctrl+O`): ficheiros `.md` e `.markdown`.
* **Importar** (`Ctrl+Alt+O`): converte a Markdown documentos `.docx`, `.odt`, `.epub`, `.html`, `.tex` e tamén **PDF**.
* **Arrastrar e soltar**: solta un ou varios ficheiros, ou cartafoles enteiros, sobre a aplicación; cada un ábrese na súa lapela.

Na aplicación de escritorio, `Ctrl+S` escribe sobre o ficheiro que abriches; no navegador descárgase.

### Importar PDF

Escolle un PDF en **Importar** (ou arrástrao). A conversión ocorre no teu equipo. Podes quitar cabeceiras e pés repetidos, conservar imaxes, aplicar OCR ás páxinas escaneadas e escoller que páxinas importar. Preme **Converter a Markdown**, revisa o resultado na vista previa e despois **Importar nunha lapela nova**.

A detección de táboas e fórmulas non é infalible, e o OCR pode fallar con fotografías ou baixa resolución. Se desaparece texto útil, desactiva a eliminación de cabeceiras e pés. Admítense ficheiros de ata 50 MB.

---

## Imaxes

O botón **Imaxe** admite un ficheiro do disco ou unha URL, e pregunta como inserila:

* **Con ruta relativa** (o recomendado): o documento só nomea a imaxe, que queda no seu propio cartafol. Mantén o `.md` lixeiro, pero o documento e as súas imaxes viaxan xuntos.
* **Dentro do documento**: a imaxe incrústase no ficheiro, que se volve autónomo pero máis pesado. Útil para enviar un `.md` solto por correo.

**Pé de figura**: se escribes un pé no cadro, a imaxe vai soa no seu parágrafo, centrada e co pé debaixo, na folla e ao exportar. En Markdown escríbese `![Pé da figura](imaxes/foto.png)`, nun parágrafo propio, e o pé pódese corrixir directamente sobre a folla. Sen pé, a imaxe segue o aliñamento do texto. As imaxes non admiten texto arredor: van sempre na súa propia liña.

Baixo o editor Markdown, o **xestor de imaxes** lista as do documento: podes velas, substituílas, eliminalas, incrustalas ou pasalas ao cartafol, e **Ir ao texto** lévate ata onde están escritas.

---

## Fórmulas matemáticas

As fórmulas escríbense en LaTeX e vense ao momento. Tres formas de poñelas:

* **Menú de fórmulas** (editor Markdown): `Ctrl+M` e despois un número escolle o delimitador; `Intro` insire o recomendado, `\(...\)`.
* **Fiestra de fórmula** (editor visual): o botón `{}` abre un cadro co código e o resultado á vista mentres escribes.
* **EdiCuaTeX** (`Ctrl+Alt+M`): editor visual de fórmulas para construílas a golpe de rato.

Exemplos: $ax^2 + bx + c = 0$ en liña, ou en bloque:

$$
x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}
$$

Letras gregas ($\alpha$, $\Omega$), subíndices ($H_2O$) e símbolos de conxuntos ($\mathbb{R}$, $A \subseteq B$) escríbense igual que en calquera fórmula LaTeX.

---

## Diagramas

Un bloque de código coa etiqueta `mermaid` debúxase como diagrama. Este código:

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

* **Para crear un sen saber Mermaid**, o botón de diagrama da barra, xunto ao de EdiCuaTeX, abre **Sirena**, un editor visual de diagramas. **Inserir** pono no documento.
* **Para cambialo**, dobre clic sobre o diagrama, ou o lapis da súa esquina: ábrese en Sirena e, ao inserilo, substitúe o que había.
* Se o código ten un erro, vese o código co aviso de Mermaid, que di en que liña está.

Ao exportar a DOCX, ODT, EPUB, HTML ou TEX, cada diagrama sae como unha imaxe centrada, e o ficheiro `.md` conserva o código. Na versión web, a primeira vez que aparece un diagrama cómpre conexión para cargar Mermaid.

---

## Citas e bibliografía

En **Configuración → Opcións xerais… → Citas** podes cargar unha biblioteca **BibTeX** (`.bib`) ou **CSL JSON** (`.json`), ou probar con **Cargar bibliografía de exemplo**. O botón do libro (`Ctrl+Alt+B`) abre un buscador por autor, título ou ano, con **Engadir referencia manualmente** sempre á man.

**APA 7** é o estilo inicial; tamén hai Chicago, MLA, IEEE ou un CSL propio. A bibliografía final móstrase ao pé da vista previa e reprodúcese ao exportar. Ao gardar, a biblioteca cópiase xunto ao documento, así que abonda con conservalos xuntos para levar o traballo a outro equipo.

---

## Buscar e substituír

A lupa (ou `Ctrl+F`) abre o buscador. Resalta todas as coincidencias, `Enter` salta á seguinte, e a frecha lateral despraga a substitución, unha a unha ou todas de golpe. O botón **Regex** interpreta a busca como expresión regular.

---

## O formato do documento

Xunto ao contador de caracteres hai un botón co idioma do documento (`ES`, `CA`...). Ao premelo ábrese **Este documento**, con dúas lapelas:

* **Documento**: idioma, autor, índice automático e numeración de apartados.
* **Formato**: aliñamento, tipo e tamaño de letra, interliñado, tamaño de papel, marxes e sangría.

Todo o que fixes gárdase dentro do propio `.md`, nunhas liñas de metadatos ao principio do ficheiro, así que viaxa co documento a calquera equipo. Se repites os mesmos axustes en varios traballos, gárdaos como **perfil** (arriba do cadro) para aplicalos dun clic noutro documento.

**Configuración → Opcións xerais…** garda os valores de partida para os documentos novos: idioma, autor, texto e páxina, portada do EPUB, bibliografía e opcións de LaTeX.

---

## Exportar

**Exportar** (`Ctrl+Alt+E`) xera o documento listo para entregar:

* **DOCX (Word)**: para compartir con quen usa Word, ou abrir en Google Docs.
* **ODT (LibreOffice)**: para suites libres como LibreOffice ou OnlyOffice.
* **EPUB**: libro dixital compatible con lectores EPUB 3.
* **HTML**: páxina web autónoma, cos estilos e as fórmulas dentro.
* **TEX (LaTeX)**: un `.tex` completo, listo para compilar.
* **PDF**: abre o diálogo de impresión («Gardar como PDF»); sae exactamente o que ves en pantalla.

O botón de copiar, xunto a Exportar, leva o contido ao portapapeis en Markdown, HTML ou LaTeX, sen xerar ningún ficheiro.

---

## A aplicación de escritorio

É a mesma aplicación instalada en Linux, Windows e macOS. Os instaladores están na [páxina de descargas](https://github.com/edimarkdown/edimarkdown.github.io/releases/latest).

Fronte ao navegador engade: dobre clic para abrir ficheiros `.md`, gardado directo sen pasar pola carpeta de descargas, a localización do ficheiro de cada lapela ao pasar o rato por riba ou no seu menú do botón dereito (ao premela ábrese o seu cartafol), corrector ortográfico do sistema e funcionamento sen conexión (Pandoc, EdiCuaTeX, Sirena e Mermaid van incluídos). Ao arrincar comproba se hai unha versión nova e avisa con **Descargar e instalar**.

**En macOS**, se o sistema avisa de que a aplicación «está danada», arrastra EdiMarkdown a Aplicacións e executa no Terminal:

```
xattr -dr com.apple.quarantine /Applications/EdiMarkdown.app
```

É só o aviso habitual de macOS ante software sen asinar; con ese comando ábrese con normalidade.

---

## Atallos de teclado

| Acción | Atallo (Windows/Linux) | Atallo (macOS) |
| :--- | :--- | :--- |
| **Formato** | | |
| Negra | `Ctrl` + `B` | `Cmd` + `B` |
| Cursiva | `Ctrl` + `I` | `Cmd` + `I` |
| Cabeceiras 1-6 | `Ctrl` + `1..6` | `Cmd` + `1..6` |
| Lista con viñetas | `Ctrl` + `Maiús` + `L` | `Cmd` + `Maiús` + `L` |
| Lista numerada | `Ctrl` + `Maiús` + `O` | `Cmd` + `Maiús` + `O` |
| Cita | `Ctrl` + `Maiús` + `Q` | `Cmd` + `Maiús` + `Q` |
| Aniñar / desaniñar un punto de lista | `Tab` / `Maiús` + `Tab` | `Tab` / `Maiús` + `Tab` |
| Subir un nivel (nun punto baleiro) | `Intro` | `Intro` |
| Código | `Ctrl` + `` ` `` | `Cmd` + `` ` `` |
| Ligazón | `Ctrl` + `K` | `Cmd` + `K` |
| Imaxe | `Ctrl` + `Maiús` + `I` | `Cmd` + `Maiús` + `I` |
| Táboa | `Ctrl` + `Maiús` + `T` | `Cmd` + `Maiús` + `T` |
| Fórmula `$...$` (en liña) | `Ctrl` + `M` logo `1` | `Cmd` + `M` logo `1` |
| Fórmula `$$...$$` (en bloque) | `Ctrl` + `M` logo `2` | `Cmd` + `M` logo `2` |
| Fórmula `\(...\)` (en liña) | `Ctrl` + `M` logo `3` | `Cmd` + `M` logo `3` |
| Fórmula `\[...\]` (en bloque) | `Ctrl` + `M` logo `4` | `Cmd` + `M` logo `4` |
| Desfacer / Refacer | `Ctrl` + `Z` / `Ctrl` + `Maiús` + `Z` | `Cmd` + `Z` / `Cmd` + `Maiús` + `Z` |
| **Xestión de documentos** | | |
| Nova lapela | `Ctrl` + `Alt` + `N` | `Cmd` + `Alt` + `N` |
| Pechar lapela | `Ctrl` + `Alt` + `W` | `Cmd` + `Alt` + `W` |
| Lapela seguinte / anterior | `Ctrl` + `Alt` + `AvPáx` / `Ctrl` + `Alt` + `RePáx` | `Cmd` + `Alt` + `AvPáx` / `Cmd` + `Alt` + `RePáx` |
| Gardar | `Ctrl` + `S` | `Cmd` + `S` |
| Gardar como… | `Ctrl` + `Maiús` + `S` | `Cmd` + `Maiús` + `S` |
| Abrir ficheiro | `Ctrl` + `O` | `Cmd` + `O` |
| Importar documento | `Ctrl` + `Alt` + `O` | `Cmd` + `Alt` + `O` |
| Pegar LaTeX (abrir modal) | `Ctrl` + `Maiús` + `V` | `Cmd` + `Maiús` + `V` |
| **Interface** | | |
| Abrir EdiCuaTeX | `Ctrl` + `Alt` + `M` | `Cmd` + `Alt` + `M` |
| Pegar desde o portapapeis | `Ctrl` + `Alt` + `V` | `Cmd` + `Alt` + `V` |
| Abrir Exportar | `Ctrl` + `Alt` + `E` | `Cmd` + `Alt` + `E` |
| Copiar (`1` Markdown · `2` HTML · `3` LaTeX · `4` LaTeX completo) | `Ctrl` + `Alt` + `C` logo `1`–`4` | `Cmd` + `Alt` + `C` logo `1`–`4` |
| Abrir Configuración | `Ctrl` + `,` | `Cmd` + `,` |
| Maximizar a área de edición | `Ctrl` + `Maiús` + `F` | `Cmd` + `Maiús` + `F` |
| Cambiar disposición | `Ctrl` + `L` | `Cmd` + `L` |
| Saír do editor co teclado | `Esc` e despois `Tab` | `Esc` e despois `Tab` |
| Buscar | `Ctrl` + `F` | `Cmd` + `F` |
| Ampliar / reducir o panel en que estás | `Ctrl` + `+` / `Ctrl` + `-` | `Cmd` + `+` / `Cmd` + `-` |
| Manual de uso | `Ctrl` + `H` ou `F1` | `F1` |
| Recargar o manual | `Ctrl` + `Maiús` + `H` | `Cmd` + `Maiús` + `H` |
| Imprimir | `Ctrl` + `P` | `Cmd` + `P` |

---

## Markdown admitido

EdiMarkdown usa unha base compatible con GitHub Flavored Markdown (GFM), ampliada con funcións de Pandoc: cabeceiras, negra e cursiva, listas e citas en bloque, ligazóns e imaxes, código, táboas, tarefas (`- [ ]`) e riscado (`~~texto~~`).

As ampliacións son as fórmulas LaTeX, as notas ao pé `[^nota]`, as citas bibliográficas `[@clave]`, os metadatos YAML, os subíndices `H~2~O`, os superíndices `m^2^` e os diagramas Mermaid.

**Límites**: non todas as extensións de Pandoc se ven na folla visual. As listas de definicións, as táboas de reixa ou os bloques `:::` quedan fóra do perfil común, aínda que podes escribilas igualmente no editor Markdown e chegarán á exportación.

---

## Licenza e contribucións

EdiMarkdown é software libre baixo a [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html): podes usalo na túa aula, adaptalo e despregalo en servidores propios, sempre que compartas calquera mellora baixo a mesma licenza. Se detectas un problema ou queres propor cambios, abre unha incidencia en [GitHub](https://github.com/edimarkdown/edimarkdown.github.io/issues) ou envía un pull request.
