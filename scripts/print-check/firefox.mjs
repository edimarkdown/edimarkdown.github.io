// Carga EdiMarkdown en Firefox sin ventana, espera al reparto en páginas,
// anota dónde empieza cada página en la hoja e imprime a PDF.
import { writeFileSync, readFileSync } from 'node:fs';
const [,, port, url, pdf, datos, previoFile] = process.argv;
const medir = readFileSync(new URL('./medir.js', import.meta.url), 'utf8');
const previo = previoFile ? readFileSync(previoFile, 'utf8') : '';
const ws = new WebSocket(`ws://127.0.0.1:${port}/session`);
let id = 0; const pend = new Map();
const send = (method, params = {}) => new Promise((ok, ko) => { const n = ++id; pend.set(n, { ok, ko }); ws.send(JSON.stringify({ id: n, method, params })); });
ws.onmessage = (e) => { const m = JSON.parse(e.data); const p = pend.get(m.id); if (!p) return; pend.delete(m.id); m.type === 'error' ? p.ko(new Error(m.message)) : p.ok(m.result); };
ws.onerror = () => { console.error('sin conexión'); process.exit(1); };
const espera = ms => new Promise(r => setTimeout(r, ms));
ws.onopen = async () => {
  try {
    await send('session.new', { capabilities: {} });
    const context = (await send('browsingContext.getTree')).contexts[0].context;
    await send('browsingContext.setViewport', { context, viewport: { width: 2700, height: 1100 } });
    await send('browsingContext.navigate', { context, url, wait: 'complete' });
    const evalua = async (code) => {
      const r = await send('script.evaluate', { expression: code, target: { context }, awaitPromise: false });
      return r.result && r.result.value;
    };
    if (previo) await evalua(previo);
    let ultimo = '', iguales = 0, d = null;
    for (let i = 0; i < 90 && iguales < 4; i += 1) {
      await espera(1000);
      const texto = await evalua(medir);
      if (!texto) continue;
      d = JSON.parse(texto);
      const clave = `${d.paginas}-${d.alto}`;
      iguales = (clave === ultimo && d.paginas > 1 && d.listo) ? iguales + 1 : 0;
      ultimo = clave;
    }
    if (iguales < 4) throw new Error('no se llegó a paginar: ' + ultimo);
    writeFileSync(datos, JSON.stringify(d, null, 1));
    const p = d.pagina; const apaisado = p.orientation === 'landscape';
    const cm = { a4: [21, 29.7], letter: [21.59, 27.94] }[p.paperSize || 'a4'];
    await evalua("window.dispatchEvent(new Event('beforeprint')); 'ok'");
    const r = await send('browsingContext.print', { context, background: true, orientation: apaisado ? 'landscape' : 'portrait',
      page: { width: cm[0], height: cm[1] },
      margin: { top: p.marginTop, bottom: p.marginBottom, left: p.marginLeft, right: p.marginRight } });
    writeFileSync(pdf, Buffer.from(r.data, 'base64'));
    console.log('impreso');
  } catch (err) { console.error(String(err)); }
  ws.close(); process.exit(0);
};
