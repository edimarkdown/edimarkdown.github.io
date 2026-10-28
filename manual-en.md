![EdiMarkdown logo](logo_100px.png)

# EdiMarkdown manual

EdiMarkdown is a Markdown text editor for teachers and content creators. You write quickly, import documents from Word, LibreOffice, EPUB, HTML, LaTeX or PDF, and export to those same formats, with mathematical formulas included. It runs in the browser, with nothing to install, and also as a desktop application for Linux, Windows and macOS. Either way the work stays on your own computer: neither the documents nor the images leave it.

## Getting started

You do not need to know Markdown. Type in the left-hand pane and watch the document take shape on the right; the toolbar buttons add bold, headings, lists, tables, links, images and formulas, and they work in both panes.

When you are done: **Save** (`Ctrl+S`) leaves a plain-text `.md` file that opens anywhere, and **Export** produces the Word, PDF, or whichever format you have to hand in.

This manual is always available under **Help** or with `F1`. There is also a [blog article](https://educacion.bilateria.org/edimarkdown-escribir-en-markdown-y-convertir-a-cualquier-formato) (in Spanish) explaining what EdiMarkdown is for in class, with examples and screenshots.

---

## The two editors

The screen is split into two panes that **edit the same document** at once:

* **Markdown editor** (left): the text in source code, as is.
* **Visual editor** (right): the document already laid out, like a sheet of paper. You write directly on it, and the format toolbar works here too.

Drag the middle bar to resize the panes, or use the three layout buttons (`Ctrl+L`) to show only one editor, or both. The double-arrow button hides the toolbars and gives the whole screen to writing.

The magnifier in the status bar (or `Ctrl` + `+` / `Ctrl` + `-`) zooms what you see in and out, without changing the document: the page always prints or exports at 100%. The chain switch next to the magnifier keeps the whole page visible even as you move the divider between panes; you can release it if you'd rather control the zoom by hand.

**Paste anything**: with `Ctrl+V`, EdiMarkdown places whatever is on the clipboard into the right pane. Plain text and Markdown go to the Markdown editor; formatted content — from Word, a web page, a chatbot — and images are rebuilt in the visual editor. No extra steps: copy from anywhere and paste.

---

## Tabs and menus

Each document lives in its own tab. `Ctrl+Alt+N` creates one, `Ctrl+Alt+PgDn` moves to the next one, and a red dot (`●`) marks unsaved changes. Right-clicking a tab opens **Rename**, **Close** and, under **Reopen**, the last ten closed tabs.

Everything autosaves on your computer: if you reload the page or reopen the app, the content is still there. It's a safety net, not a substitute for saving the file.

Next to the logo are the menus:

* **File**: open, import, paste LaTeX, save and save as.
* **Export** (`Ctrl+Alt+E`): the six output formats.
* **Settings** (`Ctrl+,`): interface language, theme, spell checker and the general options for documents.
* **Help**: this manual (`F1`) and, on desktop, check for updates.

The toolbar brings together bold, italic, headings, lists, quotes, code, links, images, tables, bibliographic citations and formulas. Every button shows on hover what it does and its shortcut.

---

## Opening, importing and dragging

* **Open** (`Ctrl+O`): `.md` and `.markdown` files.
* **Import** (`Ctrl+Alt+O`): converts `.docx`, `.odt`, `.epub`, `.html`, `.tex` documents and also **PDF** to Markdown.
* **Drag and drop**: drop one or more files, or whole folders, onto the app; each opens in its own tab.

In the desktop app, `Ctrl+S` writes to the file you opened; in the browser it downloads.

### Importing a PDF

Choose a PDF under **Import** (or drag it in). Conversion happens on your own computer. You can remove repeated headers and footers, keep images, apply OCR to scanned pages, and choose which pages to import. Press **Convert to Markdown**, review the result in the preview, then **Import into a new tab**.

Table and formula detection isn't perfect, and OCR can fail on photographs or low resolution. If useful text disappears, turn off header/footer removal. Files up to 50 MB are supported.

---

## Images

The **Image** button accepts a file from disk or a URL, and asks how to insert it:

* **With a relative path** (recommended): the document just names the image, which stays in its own folder. Keeps the `.md` file light, but the document and its images travel together.
* **Inside the document**: the image is embedded in the file, which becomes self-contained but heavier. Useful for sending a single `.md` file by email.

**Figure caption**: if you type a caption in the dialog, the image goes alone in its paragraph, centred with the caption underneath, both on the sheet and on export. In Markdown it is written `![Figure caption](images/photo.png)` in its own paragraph, and the caption can be corrected directly on the sheet. Without a caption, the image follows the text alignment. Text cannot wrap around images: they always sit on their own line.

Below the Markdown editor, the **image manager** lists the document's images: you can view, replace, delete, embed or move them to the folder, and **Go to text** takes you to where each one is written.

---

## Mathematical formulas

Formulas are written in LaTeX and render instantly. Three ways to add them:

* **Formula menu** (Markdown editor): `Ctrl+M` then a number picks the delimiter; `Enter` inserts the recommended `\(...\)`.
* **Formula window** (visual editor): the `{}` button opens a box with the code and the result visible as you type.
* **EdiCuaTeX** (`Ctrl+Alt+M`): a visual formula editor for building them with the mouse.

Examples: $ax^2 + bx + c = 0$ inline, or as a block:

$$
x = \frac{-b \pm \sqrt{b^2-4ac}}{2a}
$$

Greek letters ($\alpha$, $\Omega$), subscripts ($H_2O$) and set symbols ($\mathbb{R}$, $A \subseteq B$) are written just like in any LaTeX formula.

---

## Diagrams

A code block labelled `mermaid` is drawn as a diagram. This code:

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

* **To create one without knowing Mermaid**, the diagram button on the toolbar, next to the EdiCuaTeX one, opens **Sirena**, a visual diagram editor. **Insert** puts it in the document.
* **To change it**, double-click the diagram, or use the pencil in its corner: it opens in Sirena and, when inserted, replaces the one that was there.
* If the code has an error, you see the code with Mermaid's message, which says on which line it is.

When exporting to DOCX, ODT, EPUB, HTML or TEX, each diagram comes out as a centred image, and the `.md` file keeps the code. In the web version, the first time a diagram appears a connection is needed to load Mermaid.

---

## Citations and bibliography

Under **Settings → General options… → Citations** you can load a **BibTeX** (`.bib`) or **CSL JSON** (`.json`) library, or try **Load sample bibliography**. The book button (`Ctrl+Alt+B`) opens a search by author, title or year, with **Add reference manually** always available.

**APA 7** is the default style; Chicago, MLA, IEEE or your own CSL file are also available. The final bibliography shows at the bottom of the preview and carries over on export. When you save, the library is copied alongside the document, so keeping them together is enough to move your work to another computer.

---

## Find and replace

The magnifier (or `Ctrl+F`) opens the search box. It highlights all matches, `Enter` jumps to the next one, and the side arrow expands replace, one at a time or all at once. The **Regex** button treats the search as a regular expression.

---

## Document formatting

Next to the character count is a button showing the document's language (`ES`, `CA`...). Clicking it opens **This document**, with two tabs:

* **Document**: language, author, automatic table of contents and section numbering.
* **Format**: alignment, font and size, line spacing, paper size, margins and indentation.

Everything you set is saved inside the `.md` file itself, in metadata lines at the top, so it travels with the document to any computer. If you repeat the same settings across several jobs, save them as a **profile** (at the top of the dialog) to apply them with one click to another document.

**Settings → General options…** sets the defaults for new documents: language, author, text and page, EPUB cover, bibliography and LaTeX options.

---

## Export

**Export** (`Ctrl+Alt+E`) produces the document ready to hand in:

* **DOCX (Word)**: to share with Word users, or open in Google Docs.
* **ODT (LibreOffice)**: for free suites like LibreOffice or OnlyOffice.
* **EPUB**: a digital book compatible with EPUB 3 readers.
* **HTML**: a self-contained web page, with styles and formulas included.
* **TEX (LaTeX)**: a complete `.tex` file, ready to compile.
* **PDF**: opens the print dialog ("Save as PDF"); it produces exactly what you see on screen.

The copy button, next to Export, sends the content to the clipboard as Markdown, HTML or LaTeX, without creating a file.

---

## The desktop application

It's the same app, installed on Linux, Windows and macOS. Installers are on the [downloads page](https://github.com/edimarkdown/edimarkdown.github.io/releases/latest).

Compared with the browser, it adds: double-click to open `.md` files, direct saving without going through the downloads folder, the location of each tab's file when hovering over it or in its right-click menu (clicking it opens its folder), the system's spell checker, and offline use (Pandoc, EdiCuaTeX, Sirena and Mermaid are bundled in). On launch it checks for a new version and offers **Download and install**.

**On macOS**, if the system warns that the app "is damaged", drag EdiMarkdown to Applications and run in Terminal:

```
xattr -dr com.apple.quarantine /Applications/EdiMarkdown.app
```

This is just macOS's usual warning for unsigned software; that command opens it normally.

---

## Keyboard shortcuts

| Action | Shortcut (Windows/Linux) | Shortcut (macOS) |
| :--- | :--- | :--- |
| **Formatting** | | |
| Bold | `Ctrl` + `B` | `Cmd` + `B` |
| Italic | `Ctrl` + `I` | `Cmd` + `I` |
| Headings 1-6 | `Ctrl` + `1..6` | `Cmd` + `1..6` |
| Bulleted list | `Ctrl` + `Shift` + `L` | `Cmd` + `Shift` + `L` |
| Numbered list | `Ctrl` + `Shift` + `O` | `Cmd` + `Shift` + `O` |
| Quote | `Ctrl` + `Shift` + `Q` | `Cmd` + `Shift` + `Q` |
| Indent / outdent a list item | `Tab` / `Shift` + `Tab` | `Tab` / `Shift` + `Tab` |
| Move up a level (on an empty item) | `Enter` | `Enter` |
| Code | `Ctrl` + `` ` `` | `Cmd` + `` ` `` |
| Link | `Ctrl` + `K` | `Cmd` + `K` |
| Image | `Ctrl` + `Shift` + `I` | `Cmd` + `Shift` + `I` |
| Table | `Ctrl` + `Shift` + `T` | `Cmd` + `Shift` + `T` |
| Formula `$...$` (inline) | `Ctrl` + `M` then `1` | `Cmd` + `M` then `1` |
| Formula `$$...$$` (block) | `Ctrl` + `M` then `2` | `Cmd` + `M` then `2` |
| Formula `\(...\)` (inline) | `Ctrl` + `M` then `3` | `Cmd` + `M` then `3` |
| Formula `\[...\]` (block) | `Ctrl` + `M` then `4` | `Cmd` + `M` then `4` |
| Undo / Redo | `Ctrl` + `Z` / `Ctrl` + `Shift` + `Z` | `Cmd` + `Z` / `Cmd` + `Shift` + `Z` |
| **Document management** | | |
| New tab | `Ctrl` + `Alt` + `N` | `Cmd` + `Alt` + `N` |
| Close tab | `Ctrl` + `Alt` + `W` | `Cmd` + `Alt` + `W` |
| Next / previous tab | `Ctrl` + `Alt` + `PgDn` / `Ctrl` + `Alt` + `PgUp` | `Cmd` + `Alt` + `PgDn` / `Cmd` + `Alt` + `PgUp` |
| Save | `Ctrl` + `S` | `Cmd` + `S` |
| Save as… | `Ctrl` + `Shift` + `S` | `Cmd` + `Shift` + `S` |
| Open file | `Ctrl` + `O` | `Cmd` + `O` |
| Import document | `Ctrl` + `Alt` + `O` | `Cmd` + `Alt` + `O` |
| Paste LaTeX (open modal) | `Ctrl` + `Shift` + `V` | `Cmd` + `Shift` + `V` |
| **Interface** | | |
| Open EdiCuaTeX | `Ctrl` + `Alt` + `M` | `Cmd` + `Alt` + `M` |
| Paste from clipboard | `Ctrl` + `Alt` + `V` | `Cmd` + `Alt` + `V` |
| Open Export | `Ctrl` + `Alt` + `E` | `Cmd` + `Alt` + `E` |
| Copy (`1` Markdown · `2` HTML · `3` LaTeX · `4` full LaTeX) | `Ctrl` + `Alt` + `C` then `1`–`4` | `Cmd` + `Alt` + `C` then `1`–`4` |
| Open Settings | `Ctrl` + `,` | `Cmd` + `,` |
| Maximize the editing area | `Ctrl` + `Shift` + `F` | `Cmd` + `Shift` + `F` |
| Change layout | `Ctrl` + `L` | `Cmd` + `L` |
| Leave the editor with the keyboard | `Esc` then `Tab` | `Esc` then `Tab` |
| Find | `Ctrl` + `F` | `Cmd` + `F` |
| Zoom in / out on the active pane | `Ctrl` + `+` / `Ctrl` + `-` | `Cmd` + `+` / `Cmd` + `-` |
| User manual | `Ctrl` + `H` or `F1` | `F1` |
| Reload the manual | `Ctrl` + `Shift` + `H` | `Cmd` + `Shift` + `H` |
| Print | `Ctrl` + `P` | `Cmd` + `P` |

---

## Supported Markdown

EdiMarkdown uses a base compatible with GitHub Flavored Markdown (GFM), extended with Pandoc features: headings, bold and italic, lists and block quotes, links and images, code, tables, tasks (`- [ ]`) and strikethrough (`~~text~~`).

Extensions include LaTeX formulas, footnotes `[^note]`, bibliographic citations `[@key]`, YAML metadata, subscripts `H~2~O`, superscripts `m^2^` and Mermaid diagrams.

**Limits**: not every Pandoc extension is guaranteed to appear on the visual sheet. Definition lists, grid tables or `:::` blocks fall outside the common profile, though you can still write them in the Markdown editor and they will carry over on export.

---

## License and contributions

EdiMarkdown is free software under the [GNU Affero General Public License v3.0](https://www.gnu.org/licenses/agpl-3.0.html): you can use it in your classroom, adapt it and deploy it on your own servers, as long as you share any improvement under the same license. If you find a problem or want to propose changes, open an issue on [GitHub](https://github.com/edimarkdown/edimarkdown.github.io/issues) or send a pull request.
