window.__previo = 'pendiente';
(async () => {
  try {
    for (let i = 0; i < 100 && (typeof markdownEditor === 'undefined' || !markdownEditor || !document.querySelector('#page-sheets .page-sheet')); i += 1) await new Promise(r => setTimeout(r, 300));
    const t = await (await fetch('manual.md')).text();
    markdownEditor.setValue('---\npapersize: "letter"\norientation: "landscape"\nmargin-left: "3cm"\nmargin-right: "2.5cm"\nmargin-top: "2cm"\nmargin-bottom: "2cm"\nfontsize: "11pt"\n---\n\n' + t);
    await new Promise(r => setTimeout(r, 4000));
    window.__previo = 'hecho';
  } catch (e) { window.__previo = 'error: ' + e; document.title = 'ERROR ' + e; }
})(); 'ok'
