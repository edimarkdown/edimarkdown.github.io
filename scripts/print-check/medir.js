JSON.stringify({
  paginas: document.querySelectorAll('#page-sheets .page-sheet').length,
  inicios: Array.from(document.querySelectorAll('#html-output [data-page-start]')).map(e => (e.innerText || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)),
  pagina: window.__paginaParaImprimir ? window.__paginaParaImprimir() : null,
  ancho: document.getElementById('html-output') ? document.getElementById('html-output').getBoundingClientRect().width : 0,
  alto: document.getElementById('html-output') ? document.getElementById('html-output').getBoundingClientRect().height : 0,
  desbordan: (() => { const h = document.getElementById('html-output'); if (!h) return []; const cs = getComputedStyle(h); const der = h.getBoundingClientRect().right - parseFloat(cs.paddingRight); return Array.from(h.querySelectorAll('*')).map(e => ({ e, r: e.getBoundingClientRect() })).filter(x => x.r.right > der + 1 && x.r.height > 0).slice(0, 8).map(x => x.e.tagName + ' +' + Math.round(x.r.right - der) + 'px «' + (x.e.innerText || '').trim().slice(0, 30) + '»'); })(),
  anchoTexto: (() => { const h = document.getElementById('html-output'); if (!h) return 0; const cs = getComputedStyle(h); return h.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); })(),
  desbordeHoja: (() => { const h = document.getElementById('html-output'); return h ? h.scrollWidth - h.clientWidth : 0; })(),
  listo: window.__previo !== 'pendiente',
  ua: navigator.userAgent })