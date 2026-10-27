![EdiMarkdown-en logotipoa](logo_100px.png)

# EdiMarkdown eskuliburua

EdiMarkdown Markdown testu-editore bat da, irakasleentzat eta eduki-sortzaileentzat. Azkar idazten da, Word, LibreOffice, EPUB, HTML, LaTeX edo PDF dokumentuak inportatzen ditu, eta formatu horietara berretara esportatzen du, formula matematikoak barne. Nabigatzailean funtzionatzen du, ezer instalatu gabe, eta baita mahaigaineko aplikazio gisa ere Linux, Windows eta macOSerako. Bi kasuetan lana zure ekipoan gelditzen da: ez dokumentuak ez irudiak ez dira handik ateratzen.

## Hasteko

Ez duzu Markdown jakin beharrik. Idatzi ezkerreko panelean eta ikusiko duzu dokumentua eskuinean osatzen; tresna-barrako botoiek lodia, izenburuak, zerrendak, taulak, estekak, irudiak eta formulak jartzen dituzte, eta bi paneletan funtzionatzen dute.

Amaitutakoan: **Gorde** (`Ctrl+S`) `.md` fitxategi bat uzten du, testu arrunta, edonon irekitzen dena, eta **Esportatu** aukerak Word, PDF edo eman behar duzun formatua sortzen du.

Eskuliburu hau beti dago eskura **Laguntza** atalean edo `F1`ekin. Bada [blogeko artikulu](https://educacion.bilateria.org/edimarkweb-escribir-en-markdown-y-entregar-en-cualquier-formato) bat ere (gaztelaniaz) EdiMarkdown gelan zertarako den azaltzen duena, adibide eta pantaila-argazkiekin.

---

## Bi editoreak

Pantaila bi paneletan banatzen da, dokumentu bera aldi berean editatzen dutenak:

* **Markdown editorea** (ezkerra): testua kode-iturburuan, hala-hala.
* **Editore bisuala** (eskuina): jada osatutako dokumentua, paper-orri bat bezala. Zuzenean idazten da bertan, eta formatu-tresna-barrak hemen ere funtzionatzen du.

Arrastatu erdiko barra espazioa banatzeko, edo erabili disposizio-hiru botoiak (`Ctrl+L`) editore bakarra ikusteko, edo biak. Klik bikoitzeko geziak tresna-barrak ezkutatzen ditu eta pantaila osoa idazteko uzten du.

Egoera-barrako luparrak (edo `Ctrl` + `+` / `Ctrl` + `-`) ikusten duzuna handitzen edo txikitzen du, dokumentua aldatu gabe: orria beti % 100ean ateratzen da inprimatzean edo esportatzean. Luparen ondoko katearen etengailuak orri osoa ikusgai mantentzen du panelen arteko banatzailea mugitzen baduzu ere; askatu daiteke zoom-a eskuz kontrolatzea nahiago baduzu.

**Edozer itsatsi**: `Ctrl+V`rekin, EdiMarkdownek arbeletik dakarrena panel egokian jartzen du. Testua eta Markdown-a Markdown editorera doaz; formatudun edukia —Word batetik, web orri batetik, chatbot batetik— eta irudiak editore bisualean berreraikitzen dira. Ez da tarteko urratsik behar: kopiatu edonondik eta itsatsi.

---

## Fitxak eta menuak

Dokumentu bakoitza bere fitxan bizi da. `Ctrl+Alt+N`k bat sortzen du, `Ctrl+Alt+AvPág`ek hurrengora pasatzen du, eta puntu gorri batek (`●`) gorde gabeko aldaketak daudela adierazten du. Fitxa baten gainean eskuineko botoiarekin **Berrizendatu**, **Itxi** eta, **Berriro ireki** atalean, itxitako azken hamar fitxak irekitzen dira.

Dena bakarrik gordetzen da ekipoan: orria birkargatu edo aplikazioa berriro irekitzen baduzu, edukia hor dago berriro. Segurtasun-sarea da, ez fitxategia gordetzearen ordezkoa.

Logotipoaren ondoan menuak daude:

* **Fitxategia**: ireki, inportatu, itsatsi LaTeX, gorde eta gorde honela.
* **Esportatu** (`Ctrl+Alt+E`): irteerako sei formatuak.
* **Ezarpenak** (`Ctrl+,`): interfazearen hizkuntza, gaia, zuzentzaile ortografikoa eta dokumentuen aukera orokorrak.
* **Laguntza**: eskuliburu hau (`F1`) eta, mahaigainean, eguneraketak bilatzea.

Tresna-barrak lodia, etzana, izenburuak, zerrendak, aipuak, kodea, estekak, irudiak, taulak, bibliografia-aipuak eta formulak biltzen ditu. Botoi bakoitzak, sagua gainetik pasatzean, zer egiten duen eta zein lasterbiderekin esaten du.

---

## Ireki, inportatu eta arrastatu

* **Ireki** (`Ctrl+O`): `.md` eta `.markdown` fitxategiak.
* **Inportatu** (`Ctrl+Alt+O`): `.docx`, `.odt`, `.epub`, `.html`, `.tex` dokumentuak eta **PDF** ere Markdown-era bihurtzen ditu.
* **Arrastatu eta jaregin**: jaregin fitxategi bat edo gehiago, edo karpeta osoak, aplikazioaren gainean; bakoitza bere fitxan irekiko da.

Mahaigaineko aplikazioan, `Ctrl+S`k ireki duzun fitxategiaren gainean idazten du; nabigatzailean deskargatu egiten da.

### PDF bat inportatu

Aukeratu PDF bat **Inportatu** atalean (edo arrastatu). Bihurketa zure ekipoan gertatzen da. Errepikatutako goiburuak eta orri-oinak kendu, irudiak mantendu, OCR aplikatu eskaneatutako orriei eta zer orri inportatu aukera dezakezu. Sakatu **Markdown-era bihurtu**, berrikusi emaitza aurrebistan eta gero **Inportatu fitxa berri batean**.

Taulen eta formulen detekzioa ez da hutsezina, eta OCRk huts egin dezake argazkiekin edo bereizmen baxuarekin. Testu erabilgarria desagertzen bada, desaktibatu goiburuak eta orri-oinak kentzea. 50 MB arteko fitxategiak onartzen dira.

---

## Irudiak

**Irudia** botoiak diskoko fitxategi bat edo URL bat onartzen du, eta nola txertatu galdetzen du:

* **Ibilbide erlatiboarekin** (gomendatua): dokumentuak irudia bakarrik izendatzen du, bere karpetan geratzen dena. `.md` fitxategia arina mantentzen du, baina dokumentua eta bere irudiak batera bidaiatzen dute.
* **Dokumentuaren barruan**: irudia fitxategian txertatzen da, autonomo bihurtzen dena baina astunagoa. Erabilgarria `.md` bakarra postaz bidaltzeko.

**Irudi-oina**: koadroan oin bat idazten baduzu, irudia bakarrik doa bere paragrafoan, erdiratuta eta oina azpian duela, orrian eta esportatzean. Markdown-en `![Irudiaren oina](irudiak/argazkia.png)` idazten da, paragrafo propioan, eta oina zuzenean orrian zuzen daiteke. Oinik gabe, irudiak testuaren lerrokatzea jarraitzen du. Irudiek ez dute testurik onartzen inguruan: beti beren lerroan doaz.

Markdown editorearen azpian, **irudien kudeatzaileak** dokumentuko irudiak zerrendatzen ditu: ikusi, ordezkatu, ezabatu, txertatu edo karpetara pasa ditzakezu, eta **Testura joan** aukerak idatzita dauden tokira eramaten zaitu.

---

## Formula matematikoak

Formulak LaTeXen idazten dira eta berehala ikusten dira. Hiru modu daude jartzeko:

* **Formulen menua** (Markdown editorea): `Ctrl+M` eta gero zenbaki batek mugatzailea aukeratzen du; `Sartu`k gomendatutakoa txertatzen du, `\(...\)`.
* **Formula-leihoa** (editore bisuala): `{}` botoiak kodea eta emaitza ikusgai duen koadro bat irekitzen du idatzi ahala.
* **EdiCuaTeX** (`Ctrl+Alt+M`): formulen editore bisuala, saguarekin eraikitzeko.

Adibideak: $ax^2 + bx + c = 0$ lerroan, edo blokean:

$$
x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}
$$

Greziar letrak ($\alpha$, $\Omega$), azpiindizeak ($H_2O$) eta multzo-sinboloak ($\mathbb{R}$, $A \subseteq B$) LaTeX formula ororen antzera idazten dira.

---

## Diagramak

`mermaid` etiketa duen kode-bloke bat diagrama gisa marrazten da. Kode hau:

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

* **Mermaid jakin gabe bat sortzeko**, barrako diagrama-botoiak, EdiCuaTeXenaren ondoan, **Sirena** irekitzen du, diagrama-editore bisual bat. **Txertatu** sakatuta dokumentuan jartzen da.
* **Aldatzeko**, klik bikoitza diagraman, edo haren izkinako arkatza: Sirenan irekitzen da eta, txertatzean, zegoena ordezten du.
* Kodeak errore bat badu, kodea eta Mermaiden abisua ikusten dira, zein lerrotan dagoen esaten duena.

DOCX, ODT, EPUB, HTML edo TEX formatura esportatzean, diagrama bakoitza irudi zentratu gisa ateratzen da, eta `.md` fitxategiak kodea gordetzen du. Web bertsioan, diagrama bat lehen aldiz agertzen denean konexioa behar da Mermaid kargatzeko.

---

## Aipuak eta bibliografia

**Ezarpenak → Aukera orokorrak… → Aipuak** atalean **BibTeX** (`.bib`) edo **CSL JSON** (`.json`) liburutegi bat karga dezakezu, edo probatu **Adibidezko bibliografia kargatu**. Liburu-botoiak (`Ctrl+Alt+B`) egile, izenburu edo urteka bilatzailea irekitzen du, **Erreferentzia eskuz gehitu** beti eskura duzula.

**APA 7** hasierako estiloa da; Chicago, MLA, IEEE edo zure CSL propioa ere badaude. Azken bibliografia aurrebistaren azpian erakusten da eta esportatzean errepikatzen da. Gordetzean, liburutegia dokumentuaren ondoan kopiatzen da, beraz nahikoa da biak batera mantentzea lana beste ekipo batera eramateko.

---

## Bilatu eta ordeztu

Luparrak (edo `Ctrl+F`) bilatzailea irekitzen du. Bat-etortze guztiak nabarmentzen ditu, `Sartu`k hurrengora salto egiten du, eta alboko geziak ordezpena zabaltzen du, bat bestearen atzetik edo denak batera. **Regex** botoiak bilaketa espresio erregular gisa interpretatzen du.

---

## Dokumentuaren formatua

Karaktere-kontagailuaren ondoan dokumentuaren hizkuntza duen botoi bat dago (`ES`, `CA`...). Sakatuz gero, **Dokumentu hau** irekitzen da, bi fitxarekin:

* **Dokumentua**: hizkuntza, egilea, aurkibide automatikoa eta ataleen zenbakiketa.
* **Formatua**: lerrokatzea, letra-mota eta -tamaina, lerroartea, paper-tamaina, marjinak eta koska.

Finkatzen duzun guztia `.md` fitxategiaren barruan gordetzen da, fitxategiaren hasieran dauden metadatu-lerroetan, beraz dokumentuarekin batera edozein ekipotara bidaiatzen du. Lan ezberdinetan ezarpen berak errepikatzen badituzu, gorde **profil** gisa (koadroaren goialdean) beste dokumentu batean klik batez aplikatzeko.

**Ezarpenak → Aukera orokorrak…** atalak dokumentu berrien abiapuntuko balioak gordetzen ditu: hizkuntza, egilea, testua eta orria, EPUBaren azala, bibliografia eta LaTeX aukerak.

---

## Esportatu

**Esportatu** (`Ctrl+Alt+E`) aukerak entregatzeko prest dagoen dokumentua sortzen du:

* **DOCX (Word)**: Word erabiltzen dutenekin partekatzeko, edo Google Docs-en irekitzeko.
* **ODT (LibreOffice)**: LibreOffice edo OnlyOffice bezalako suite libreetarako.
* **EPUB**: EPUB 3 irakurgailuekin bateragarria den liburu digitala.
* **HTML**: web orri autonomoa, estiloak eta formulak barruan dituela.
* **TEX (LaTeX)**: `.tex` fitxategi osoa, konpilatzeko prest.
* **PDF**: inprimatzeko elkarrizketa irekitzen du («Gorde PDF gisa»); pantailan ikusten duzuna zehazki ateratzen da.

Kopiatzeko botoiak, Esportatu-ren ondoan, edukia arbelera bidaltzen du Markdown, HTML edo LaTeX gisa, fitxategirik sortu gabe.

---

## Mahaigaineko aplikazioa

Aplikazio bera da, Linux, Windows eta macOSen instalatuta. Instalatzaileak [deskarga-orrian](https://github.com/edimarkweb/edimarkweb.github.io/releases/latest) daude.

Nabigatzailearen aurrean hau gehitzen du: klik bikoitza `.md` fitxategiak irekitzeko, zuzeneko gordetzea deskargen karpetatik pasatu gabe, fitxa bakoitzaren fitxategia non dagoen, sagua gainetik pasatzean edo eskuineko botoiaren menuan (sakatuz gero, bere karpeta irekitzen da), sistemaren zuzentzaile ortografikoa eta konexiorik gabe funtzionatzea (Pandoc, EdiCuaTeX, Sirena eta Mermaid barne datoz). Abiaraztean bertsio berririk dagoen egiaztatzen du eta **Deskargatu eta instalatu** eskaintzen du.

**macOSen**, sistemak aplikazioa «hondatuta» dagoela abisatzen badu, arrastatu EdiMarkdown Aplikazioetara eta exekutatu Terminalean:

```
xattr -dr com.apple.quarantine /Applications/EdiMarkdown.app
```

macOSek sinatu gabeko softwarearen aurrean ematen duen ohiko abisua besterik ez da; agindu horrekin normaltasunez irekitzen da.

---

## Teklatu-lasterbideak

| Ekintza | Lasterbidea (Windows/Linux) | Lasterbidea (macOS) |
| :--- | :--- | :--- |
| **Formatua** | | |
| Lodia | `Ctrl` + `B` | `Cmd` + `B` |
| Etzana | `Ctrl` + `I` | `Cmd` + `I` |
| 1-6 izenburuak | `Ctrl` + `1..6` | `Cmd` + `1..6` |
| Buletadun zerrenda | `Ctrl` + `Shift` + `L` | `Cmd` + `Shift` + `L` |
| Zenbakidun zerrenda | `Ctrl` + `Shift` + `O` | `Cmd` + `Shift` + `O` |
| Aipua | `Ctrl` + `Shift` + `Q` | `Cmd` + `Shift` + `Q` |
| Zerrenda-puntu bat habiaratu / atera | `Tab` / `Maius` + `Tab` | `Tab` / `Maius` + `Tab` |
| Maila bat igo (puntu huts batean) | `Sartu` | `Sartu` |
| Kodea | `Ctrl` + `` ` `` | `Cmd` + `` ` `` |
| Esteka | `Ctrl` + `K` | `Cmd` + `K` |
| Irudia | `Ctrl` + `Shift` + `I` | `Cmd` + `Shift` + `I` |
| Taula | `Ctrl` + `Shift` + `T` | `Cmd` + `Shift` + `T` |
| Formula `$...$` (lerroan) | `Ctrl` + `M` gero `1` | `Cmd` + `M` gero `1` |
| Formula `$$...$$` (blokean) | `Ctrl` + `M` gero `2` | `Cmd` + `M` gero `2` |
| Formula `\(...\)` (lerroan) | `Ctrl` + `M` gero `3` | `Cmd` + `M` gero `3` |
| Formula `\[...\]` (blokean) | `Ctrl` + `M` gero `4` | `Cmd` + `M` gero `4` |
| Desegin / Berregin | `Ctrl` + `Z` / `Ctrl` + `Shift` + `Z` | `Cmd` + `Z` / `Cmd` + `Shift` + `Z` |
| **Dokumentuen kudeaketa** | | |
| Fitxa berria | `Ctrl` + `Alt` + `N` | `Cmd` + `Alt` + `N` |
| Fitxa itxi | `Ctrl` + `Alt` + `W` | `Cmd` + `Alt` + `W` |
| Hurrengo / aurreko fitxa | `Ctrl` + `Alt` + `AvPág` / `Ctrl` + `Alt` + `RePág` | `Cmd` + `Alt` + `AvPág` / `Cmd` + `Alt` + `RePág` |
| Gorde | `Ctrl` + `S` | `Cmd` + `S` |
| Gorde honela… | `Ctrl` + `Shift` + `S` | `Cmd` + `Shift` + `S` |
| Fitxategia ireki | `Ctrl` + `O` | `Cmd` + `O` |
| Dokumentua inportatu | `Ctrl` + `Alt` + `O` | `Cmd` + `Alt` + `O` |
| Itsatsi LaTeX (modala ireki) | `Ctrl` + `Shift` + `V` | `Cmd` + `Shift` + `V` |
| **Interfazea** | | |
| EdiCuaTeX ireki | `Ctrl` + `Alt` + `M` | `Cmd` + `Alt` + `M` |
| Arbeletik itsatsi | `Ctrl` + `Alt` + `V` | `Cmd` + `Alt` + `V` |
| Esportatu ireki | `Ctrl` + `Alt` + `E` | `Cmd` + `Alt` + `E` |
| Kopiatu (`1` Markdown · `2` HTML · `3` LaTeX · `4` LaTeX osoa) | `Ctrl` + `Alt` + `C` gero `1`–`4` | `Cmd` + `Alt` + `C` gero `1`–`4` |
| Ezarpenak ireki | `Ctrl` + `,` | `Cmd` + `,` |
| Edizio-area maximizatu | `Ctrl` + `Shift` + `F` | `Cmd` + `Shift` + `F` |
| Diseinua aldatu | `Ctrl` + `L` | `Cmd` + `L` |
| Editoretik teklatuarekin irten | `Esc` eta gero `Tab` | `Esc` eta gero `Tab` |
| Bilatu | `Ctrl` + `F` | `Cmd` + `F` |
| Zauden panela handitu / txikitu | `Ctrl` + `+` / `Ctrl` + `-` | `Cmd` + `+` / `Cmd` + `-` |
| Erabilera-eskuliburua | `Ctrl` + `H` edo `F1` | `F1` |
| Eskuliburua birkargatu | `Ctrl` + `Shift` + `H` | `Cmd` + `Shift` + `H` |
| Inprimatu | `Ctrl` + `P` | `Cmd` + `P` |

---

## Onartutako Markdown sintaxia

EdiMarkdownek GitHub Flavored Markdown-ekin (GFM) bateragarria den oinarri bat erabiltzen du, Pandoc-en funtzioekin osatua: izenburuak, lodia eta etzana, zerrendak eta blokeko aipuak, estekak eta irudiak, kodea, taulak, zereginak (`- [ ]`) eta marratua (`~~testua~~`).

Hedapenak LaTeX formulak, `[^oharra]` oin-oharrak, `[@giltza]` bibliografia-aipuak, YAML metadatuak, `H~2~O` azpiindizeak, `m^2^` goi-indizeak eta Mermaid diagramak dira.

**Mugak**: Pandoc-en hedapen guztiak ez daude bermatuta orri bisualean agertzeko. Definizio-zerrendak, sareta-taulak edo `:::` blokeak profil komunetik kanpo geratzen dira, nahiz eta Markdown editorean idatzi ditzakezun eta esportaziora heltzen diren.

---

## Lizentzia eta ekarpenak

EdiMarkdown [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html) lizentziapeko software librea da: zure gelan erabili, egokitu eta zure zerbitzarietan zabaldu dezakezu, edozein hobekuntza lizentzia berarekin partekatzen baduzu. Arazoren bat aurkitzen baduzu edo aldaketak proposatu nahi badituzu, ireki gorabehera bat [GitHub](https://github.com/edimarkweb/edimarkweb.github.io/issues) atalean edo bidali pull request bat.
