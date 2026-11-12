window.__previo = 'pendiente';
(async () => {
  try {
    for (let i = 0; i < 100 && (typeof markdownEditor === 'undefined' || !markdownEditor || !document.querySelector('#page-sheets .page-sheet')); i += 1) await new Promise(r => setTimeout(r, 300));
    atarPanelALaLupa(false); applyZoom(PREVIEW_ZOOM, 1);
    await new Promise(r => setTimeout(r, 3000));
    window.__previo = 'hecho';
  } catch (e) { window.__previo = 'error: ' + e; }
})(); 'ok'
