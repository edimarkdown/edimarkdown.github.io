![Logotip d'EdiMarkdown](logo_100px.png)

# Manual d'EdiMarkdown

EdiMarkdown és un editor de textos en Markdown per a docents i creadors de contingut. S'escriu de pressa, importa documents de Word, LibreOffice, EPUB, HTML, LaTeX o PDF, i exporta a aquests mateixos formats, amb fórmules matemàtiques incloses. Funciona al navegador, sense instal·lar res, i també com a aplicació d'escriptori per a Linux, Windows i macOS. En els dos casos la feina queda al teu equip: ni els documents ni les imatges en surten.

## Per començar

No cal saber Markdown. Escriu al panell de l'esquerra i veuràs el document compost a la dreta; els botons de la barra d'eines posen negretes, títols, llistes, taules, enllaços, imatges i fórmules, i funcionen als dos panells.

Quan acabis: **Desar** (`Ctrl+S`) deixa un arxiu `.md` de text corrent, que s'obre a qualsevol lloc, i **Exportar** genera el Word, el PDF o el format que necessitis lliurar.

Aquest manual és sempre a **Ajuda** o amb `F1`. També hi ha un [article del blog](https://educacion.bilateria.org/edimarkdown-escribir-en-markdown-y-convertir-a-cualquier-formato) que explica per a què serveix EdiMarkdown a classe, amb exemples i captures.

---

## Els dos editors

La pantalla es divideix en dos panells que **editen el mateix document** alhora:

* **Editor Markdown** (esquerra): el text en codi font, tal qual.
* **Editor visual** (dreta): el document ja compost, com un full de paper. S'hi escriu directament i la barra de format també hi funciona.

Arrossega la barra central per repartir l'espai, o fes servir els tres botons de disposició (`Ctrl+L`) per veure només un editor, o tots dos. La doble fletxa amaga les barres i deixa tota la pantalla per escriure.

La lupa de la barra d'estat (o `Ctrl` + `+` / `Ctrl` + `-`) amplia o redueix el que veus, sense canviar el document: el paper sempre surt al 100 % en imprimir o exportar. L'interruptor amb la cadena, al costat de la lupa, manté la pàgina sencera visible encara que moguis el separador entre panells; es pot deixar anar si prefereixes controlar el zoom a mà.

**Enganxar qualsevol cosa**: amb `Ctrl+V`, EdiMarkdown col·loca al panell adequat allò que portis del porta-retalls. El text i el Markdown van a l'editor Markdown; el contingut amb format —de Word, d'una web, d'un chatbot— i les imatges es recomponen a l'editor visual. No calen passos intermedis: copia d'on sigui i enganxa.

---

## Pestanyes i menús

Cada document viu a la seva pestanya. `Ctrl+Alt+N` en crea una, `Ctrl+Alt+AvPàg` passa a la següent, i un punt vermell (`●`) avisa de canvis sense desar. El botó dret sobre una pestanya obre **Reanomena**, **Tanca** i, a **Torna a obrir**, les últimes deu pestanyes tancades.

Tot es desa sol a l'equip: si recarregues la pàgina o tornes a obrir el programa, el contingut hi torna a ser. És una xarxa de seguretat, no un substitut de desar l'arxiu.

Al costat del logotip hi ha els menús:

* **Fitxer**: obrir, importar, enganxar LaTeX, desar i desar com a.
* **Exportar** (`Ctrl+Alt+E`): els sis formats de sortida.
* **Configuració** (`Ctrl+,`): idioma de la interfície, tema, corrector ortogràfic i les opcions generals dels documents.
* **Ajuda**: aquest manual (`F1`) i, a l'escriptori, cercar actualitzacions.

La barra d'eines reuneix negreta, cursiva, encapçalaments, llistes, cites, codi, enllaços, imatges, taules, citacions bibliogràfiques i fórmules. Cada botó diu, en passar-hi el ratolí, què fa i amb quina drecera.

---

## Obrir, importar i arrossegar

* **Obrir** (`Ctrl+O`): arxius `.md` i `.markdown`.
* **Importar** (`Ctrl+Alt+O`): converteix a Markdown documents `.docx`, `.odt`, `.epub`, `.html`, `.tex` i també **PDF**.
* **Arrossegar i deixar anar**: deixa anar un o més arxius, o carpetes senceres, sobre l'aplicació; cadascun s'obre a la seva pestanya.

A l'aplicació d'escriptori, `Ctrl+S` escriu sobre l'arxiu que has obert; al navegador es descarrega.

### Importar PDF

Tria un PDF a **Importar** (o arrossega'l). La conversió passa al teu equip. Pots treure encapçalaments i peus repetits, conservar imatges, aplicar OCR a les pàgines escanejades i triar quines pàgines importar. Prem **Convertir a Markdown**, revisa el resultat a la vista prèvia i després **Importar en una pestanya nova**.

La detecció de taules i fórmules no és infal·lible, i l'OCR pot fallar amb fotografies o baixa resolució. Si desapareix text útil, desactiva l'eliminació d'encapçalaments i peus. S'admeten arxius de fins a 50 MB.

---

## Imatges

El botó **Imatge** admet un arxiu del disc o una URL, i pregunta com inserir-la:

* **Amb ruta relativa** (el recomanat): el document només anomena la imatge, que es queda a la seva pròpia carpeta. Manté el `.md` lleuger, però el document i les seves imatges viatgen junts.
* **Dins del document**: la imatge s'incrusta a l'arxiu, que es torna autònom però més pesant. Útil per enviar un `.md` solt per correu.

**Peu de figura**: si escrius un peu al quadre, la imatge va sola al seu paràgraf, centrada i amb el peu a sota, al full i en exportar. En Markdown s'escriu `![Peu de la figura](imatges/foto.png)`, en un paràgraf propi, i el peu es pot corregir directament sobre el full. Sense peu, la imatge segueix l'alineació del text. Les imatges no admeten text al voltant: van sempre a la seva pròpia línia.

Sota l'editor Markdown, el **gestor d'imatges** llista les del document: pots veure-les, reemplaçar-les, eliminar-les, incrustar-les o passar-les a la carpeta, i **Anar al text** et porta fins on estan escrites.

---

## Fórmules matemàtiques

Les fórmules s'escriuen en LaTeX i es veuen a l'instant. Tres maneres de posar-les:

* **Menú de fórmules** (editor Markdown): `Ctrl+M` i després un número tria el delimitador; `Retorn` insereix el recomanat, `\(...\)`.
* **Finestra de fórmula** (editor visual): el botó `{}` obre un quadre amb el codi i el resultat a la vista mentre escrius.
* **EdiCuaTeX** (`Ctrl+Alt+M`): editor visual de fórmules per construir-les a cop de ratolí.

Exemples: $ax^2 + bx + c = 0$ en línia, o en bloc:

$$
x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}
$$

Lletres gregues ($\alpha$, $\Omega$), subíndexs ($H_2O$) i símbols de conjunts ($\mathbb{R}$, $A \subseteq B$) s'escriuen igual que en qualsevol fórmula LaTeX.

---

## Diagrames

Un bloc de codi amb l'etiqueta `mermaid` es dibuixa com a diagrama. Aquest codi:

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

* **Per crear-ne un sense saber Mermaid**, el botó de diagrama de la barra, al costat del d'EdiCuaTeX, obre **Sirena**, un editor visual de diagrames. **Insereix** el posa al document.
* **Per canviar-lo**, doble clic sobre el diagrama, o el llapis de la seva cantonada: s'obre a Sirena i, en inserir-lo, substitueix el que hi havia.
* Si el codi té un error, es veu el codi amb l'avís de Mermaid, que diu a quina línia és.

En exportar a DOCX, ODT, EPUB, HTML o TEX, cada diagrama surt com una imatge centrada, i l'arxiu `.md` conserva el codi. A la versió web, la primera vegada que apareix un diagrama cal connexió per carregar Mermaid.

---

## Cites i bibliografia

A **Configuració → Opcions generals… → Cites** pots carregar una biblioteca **BibTeX** (`.bib`) o **CSL JSON** (`.json`), o provar amb **Carregar bibliografia d'exemple**. El botó del llibre (`Ctrl+Alt+B`) obre un cercador per autor, títol o any, amb **Afegir referència manualment** sempre a mà.

**APA 7** és l'estil inicial; també hi ha Chicago, MLA, IEEE o un CSL propi. La bibliografia final es mostra al peu de la vista prèvia i es reprodueix en exportar. En desar, la biblioteca es copia al costat del document, així que n'hi ha prou de conservar-los junts per portar la feina a un altre equip.

---

## Cercar i reemplaçar

La lupa (o `Ctrl+F`) obre el cercador. Ressalta totes les coincidències, `Enter` salta a la següent, i la fletxa lateral desplega el reemplaçament, un per un o tots de cop. El botó **Regex** interpreta la cerca com una expressió regular.

---

## El format del document

Al costat del comptador de caràcters hi ha un botó amb l'idioma del document (`ES`, `CA`...). En prémer-lo s'obre **Aquest document**, amb dues pestanyes:

* **Document**: idioma, autor, índex automàtic i numeració d'apartats.
* **Format**: alineació, tipus i mida de lletra, interlineat, mida de paper, marges i sagnia.

Tot el que fixis es desa dins del mateix `.md`, en unes línies de metadades al principi de l'arxiu, així que viatja amb el document a qualsevol equip. Si repeteixes els mateixos ajustos en diversos treballs, desa'ls com a **perfil** (a dalt del quadre) per aplicar-los d'un clic a un altre document.

**Configuració → Opcions generals…** desa els valors de partida per als documents nous: idioma, autor, text i pàgina, portada de l'EPUB, bibliografia i opcions de LaTeX.

---

## Exportar

**Exportar** (`Ctrl+Alt+E`) genera el document a punt per lliurar:

* **DOCX (Word)**: per compartir amb qui fa servir Word, o obrir a Google Docs.
* **ODT (LibreOffice)**: per a suites lliures com LibreOffice o OnlyOffice.
* **EPUB**: llibre digital compatible amb lectors EPUB 3.
* **HTML**: pàgina web autònoma, amb els estils i les fórmules dins.
* **TEX (LaTeX)**: un `.tex` complet, a punt per compilar.
* **PDF**: obre el diàleg d'impressió («Desar com a PDF»); en surt exactament el que veus en pantalla.

El botó de copiar, al costat d'Exportar, porta el contingut al porta-retalls en Markdown, HTML o LaTeX, sense generar cap arxiu.

---

## L'aplicació d'escriptori

És la mateixa aplicació instal·lada a Linux, Windows i macOS. Els instal·ladors són a la [pàgina de descàrregues](https://github.com/edimarkdown/edimarkdown.github.io/releases/latest).

Davant del navegador afegeix: doble clic per obrir arxius `.md`, desament directe sense passar per la carpeta de descàrregues, la ubicació de l'arxiu de cada pestanya en passar-hi el ratolí per sobre o al seu menú del botó dret (si la premeu, s'obre la seva carpeta), corrector ortogràfic del sistema i funcionament sense connexió (Pandoc, EdiCuaTeX, Sirena i Mermaid hi van inclosos). En arrencar comprova si hi ha una versió nova i ho avisa amb **Descarregar i instal·lar**.

**A macOS**, si el sistema avisa que l'aplicació «està malmesa», arrossega EdiMarkdown a Aplicacions i executa al Terminal:

```
xattr -dr com.apple.quarantine /Applications/EdiMarkdown.app
```

És només l'avís habitual de macOS davant de programari sense signar; amb aquesta ordre s'obre amb normalitat.

---

## Dreceres de teclat

| Acció | Drecera (Windows/Linux) | Drecera (macOS) |
| :--- | :--- | :--- |
| **Format** | | |
| Negreta | `Ctrl` + `B` | `Cmd` + `B` |
| Cursiva | `Ctrl` + `I` | `Cmd` + `I` |
| Encapçalaments 1-6 | `Ctrl` + `1..6` | `Cmd` + `1..6` |
| Llista amb pics | `Ctrl` + `Maj` + `L` | `Cmd` + `Maj` + `L` |
| Llista numerada | `Ctrl` + `Maj` + `O` | `Cmd` + `Maj` + `O` |
| Cita | `Ctrl` + `Maj` + `Q` | `Cmd` + `Maj` + `Q` |
| Imbricar / desimbricar un punt de llista | `Tab` / `Maj` + `Tab` | `Tab` / `Maj` + `Tab` |
| Pujar un nivell (en un punt buit) | `Retorn` | `Retorn` |
| Codi | `Ctrl` + `` ` `` | `Cmd` + `` ` `` |
| Enllaç | `Ctrl` + `K` | `Cmd` + `K` |
| Imatge | `Ctrl` + `Maj` + `I` | `Cmd` + `Maj` + `I` |
| Taula | `Ctrl` + `Maj` + `T` | `Cmd` + `Maj` + `T` |
| Fórmula `$...$` (en línia) | `Ctrl` + `M` i després `1` | `Cmd` + `M` i després `1` |
| Fórmula `$$...$$` (en bloc) | `Ctrl` + `M` i després `2` | `Cmd` + `M` i després `2` |
| Fórmula `\(...\)` (en línia) | `Ctrl` + `M` i després `3` | `Cmd` + `M` i després `3` |
| Fórmula `\[...\]` (en bloc) | `Ctrl` + `M` i després `4` | `Cmd` + `M` i després `4` |
| Desfer / Refer | `Ctrl` + `Z` / `Ctrl` + `Maj` + `Z` | `Cmd` + `Z` / `Cmd` + `Maj` + `Z` |
| **Gestió de documents** | | |
| Pestanya nova | `Ctrl` + `Alt` + `N` | `Cmd` + `Alt` + `N` |
| Tancar pestanya | `Ctrl` + `Alt` + `W` | `Cmd` + `Alt` + `W` |
| Pestanya següent / anterior | `Ctrl` + `Alt` + `AvPàg` / `Ctrl` + `Alt` + `RePàg` | `Cmd` + `Alt` + `AvPàg` / `Cmd` + `Alt` + `RePàg` |
| Desar | `Ctrl` + `S` | `Cmd` + `S` |
| Desar com a… | `Ctrl` + `Maj` + `S` | `Cmd` + `Maj` + `S` |
| Obrir arxiu | `Ctrl` + `O` | `Cmd` + `O` |
| Importar document | `Ctrl` + `Alt` + `O` | `Cmd` + `Alt` + `O` |
| Enganxar LaTeX (obrir modal) | `Ctrl` + `Maj` + `V` | `Cmd` + `Maj` + `V` |
| **Interfície** | | |
| Obrir EdiCuaTeX | `Ctrl` + `Alt` + `M` | `Cmd` + `Alt` + `M` |
| Enganxar des del porta-retalls | `Ctrl` + `Alt` + `V` | `Cmd` + `Alt` + `V` |
| Obrir Exportar | `Ctrl` + `Alt` + `E` | `Cmd` + `Alt` + `E` |
| Copiar (`1` Markdown · `2` HTML · `3` LaTeX · `4` LaTeX complet) | `Ctrl` + `Alt` + `C` i després `1`–`4` | `Cmd` + `Alt` + `C` i després `1`–`4` |
| Obrir Configuració | `Ctrl` + `,` | `Cmd` + `,` |
| Maximitzar l'àrea d'edició | `Ctrl` + `Maj` + `F` | `Cmd` + `Maj` + `F` |
| Canviar disposició | `Ctrl` + `L` | `Cmd` + `L` |
| Sortir de l'editor amb el teclat | `Esc` i després `Tab` | `Esc` i després `Tab` |
| Cercar | `Ctrl` + `F` | `Cmd` + `F` |
| Ampliar / reduir el panell en què ets | `Ctrl` + `+` / `Ctrl` + `-` | `Cmd` + `+` / `Cmd` + `-` |
| Manual d'ús | `Ctrl` + `H` o `F1` | `F1` |
| Recarregar el manual | `Ctrl` + `Maj` + `H` | `Cmd` + `Maj` + `H` |
| Imprimir | `Ctrl` + `P` | `Cmd` + `P` |

---

## Markdown admès

EdiMarkdown utilitza una base compatible amb GitHub Flavored Markdown (GFM), ampliada amb funcions de Pandoc: encapçalaments, negreta i cursiva, llistes i cites en bloc, enllaços i imatges, codi, taules, tasques (`- [ ]`) i ratllat (`~~text~~`).

Les ampliacions són les fórmules LaTeX, les notes al peu `[^nota]`, les cites bibliogràfiques `[@clau]`, les metadades YAML, els subíndexs `H~2~O`, els superíndexs `m^2^` i els diagrames Mermaid.

**Límits**: no totes les extensions de Pandoc es veuen al full visual. Les llistes de definicions, les taules de graella o els blocs `:::` queden fora del perfil comú, encara que els pots escriure igualment a l'editor Markdown i arribaran a l'exportació.

---

## Llicència i contribucions

EdiMarkdown és programari lliure sota la [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html): pots fer-lo servir a la teva aula, adaptar-lo i desplegar-lo en servidors propis, sempre que comparteixis qualsevol millora sota la mateixa llicència. Si detectes un problema o vols proposar canvis, obre una incidència a [GitHub](https://github.com/edimarkdown/edimarkdown.github.io/issues) o envia un pull request.
