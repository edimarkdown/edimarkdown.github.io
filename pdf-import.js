import { stripUnsafeMarkup } from './markup-safety.js';

let active = false;
const OCR_LANGUAGES = new Set(['spa', 'eng', 'cat', 'glg', 'eus']);
const OCR_LANGUAGE_BY_UI = { es: 'spa', en: 'eng', ca: 'cat', gl: 'glg', eu: 'eus' };
// Below this many recognised characters a page reads as a caption, not a scan.
const OCR_CAPTION_LENGTH = 25;
// A page that already had text keeps it unless OCR reads substantially more.
const OCR_MIN_GAIN = 40;
/*
  Beyond this many pages a conversion is worth warning about: 210 light pages
  take 2 s in Chromium and 11 in Firefox, while a real 442-page report takes
  minutes. Below it the warning would be there for nothing, on every import.
*/
const LONG_DOCUMENT_PAGES = 100;
const OCR_CDN = {
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',
};

/*
  La misma composición de notas al pie que la hoja del documento. El programa
  las resuelve él, antes de entregarle el texto a `marked`, así que quien mira
  esta vista previa veía `[^1]` y `[^1]: …` en crudo mientras el documento ya
  importado los enseñaba compuestos. Las dos funciones son globales de
  `script.js`; si faltaran, se compone sin notas antes que no componer nada.
*/
function parseWithFootnotes(markdown) {
    const prepare = window.preparePreviewFootnotes;
    const render = window.renderPreviewFootnotes;
    if (typeof prepare !== 'function' || typeof render !== 'function') {
        return window.marked.parse(markdown);
    }
    const footnotes = prepare(markdown);
    return window.marked.parse(footnotes.markdown) + render(footnotes.notes);
}

function defaultOcrLanguage() {
    const uiLanguage = (document.documentElement.lang || 'es').split('-')[0].toLowerCase();
    return OCR_LANGUAGE_BY_UI[uiLanguage] || 'spa';
}

function ocrWorkerOptions(language, logger) {
    const desktop = document.body.classList.contains('desktop-mode');
    if (desktop) {
        return {
            workerPath: new URL('./vendor/tesseract/worker.min.js', document.baseURI).href,
            corePath: new URL('./vendor/tesseract/core', document.baseURI).href.replace(/\/$/, ''),
            langPath: new URL('./vendor/tesseract/lang', document.baseURI).href.replace(/\/$/, ''),
            workerBlobURL: false,
            logger,
        };
    }
    return {
        ...OCR_CDN,
        langPath: `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${language}@1.0.0/4.0.0_best_int`,
        logger,
    };
}

function ocrTextToMarkdown(text, pageNumber) {
    const lines = String(text || '')
        .replace(/\r\n?/g, '\n')
        .replace(/\f/g, '')
        .split('\n')
        .map(line => line.trimEnd());
    const converted = lines.map(line => {
        const trimmed = line.trim();
        const letters = trimmed.replace(/[^\p{L}]/gu, '');
        const heading = letters.length >= 3
            && trimmed.length <= 90
            && letters === letters.toLocaleUpperCase();
        return heading ? `### ${trimmed}` : line;
    }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return `## Página ${pageNumber}\n\n${converted}`.trim();
}

/* A page covered by an image is usually a scan, but it can also be a
   full-page illustration or a cover, and a scan may carry a page number added
   afterwards. The reading that says more wins: the ordinary conversion goes
   back in whenever OCR does not beat the text the page already had, so
   neither the image nor the text extracted from the file is lost. */
function ocrPageMarkdown(text, page) {
    const recognised = String(text || '').replace(/[^\p{L}\p{N}]/gu, '').length;
    const fallback = typeof page.fallback === 'string' ? page.fallback.trim() : '';
    const previous = Number(page.letters) || 0;
    if (previous && recognised < previous * 2 + OCR_MIN_GAIN) {
        return fallback || ocrTextToMarkdown(text, page.page);
    }
    const image = fallback.includes('![') ? fallback : '';
    if (!recognised && image) return image;
    if (image && recognised < OCR_CAPTION_LENGTH) {
        return `${image}\n\n${ocrTextToMarkdown(text, page.page)}`;
    }
    return ocrTextToMarkdown(text, page.page);
}

/*
  Without a page limit a whole report can take minutes, and a percentage on
  its own does not say how many. The estimate comes from the pace measured in
  this very conversion rather than from a table: it depends on the document,
  on the machine, and on whether recognition is running. Below a minute, or
  before there is enough measured, saying nothing beats guessing.
*/
export function remainingMinutes(elapsed, advanced, pending) {
    if (advanced <= 0 || pending <= 0 || elapsed < 8000) return 0;
    const minutes = Math.round((elapsed / advanced) * pending / 60000);
    return minutes >= 1 ? minutes : 0;
}

/*
  Naming the scanned pages saves the reader from hunting for them, but a scan
  of a whole book would spill hundreds of numbers into the dialog. Runs are
  written as ranges, and past a handful of them the rest is left as an
  ellipsis: enough to see where they are without burying the message.
*/
export function formatPageList(pages, groups = 6) {
    const sorted = [...new Set(pages.map(Number).filter(Number.isInteger))].sort((a, b) => a - b);
    const ranges = [];
    for (const page of sorted) {
        const last = ranges[ranges.length - 1];
        if (last && page === last[1] + 1) last[1] = page;
        else ranges.push([page, page]);
    }
    const shown = ranges.slice(0, groups)
        .map(([from, to]) => (from === to ? String(from) : `${from}-${to}`))
        .join(', ');
    return ranges.length > groups ? `${shown}…` : shown;
}

/*
  A preview is for looking over the result before importing it, not for
  reading the whole document, and building one is not free: laying out a
  442-page report took over a second of frozen dialog, and rebuilding every
  picture of it as base64 would be the very peak this conversion stopped
  paying. So the preview shows the beginning and the first few pictures. The
  document is imported whole either way.
*/
const PREVIEW_CHARACTERS = 80000;
const PREVIEW_IMAGES = 12;
const IMAGE_MIMES = { jpg: 'jpeg', svg: 'svg+xml' };

function base64FromBytes(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary);
}

export function previewMarkdown(markdown, images) {
    const truncated = markdown.length > PREVIEW_CHARACTERS;
    // Cortando por un final de línea, para no partir una tabla ni una palabra.
    const cut = truncated ? markdown.lastIndexOf('\n', PREVIEW_CHARACTERS) : -1;
    const visible = truncated ? markdown.slice(0, cut > 0 ? cut : PREVIEW_CHARACTERS) : markdown;
    let shown = 0;
    let hidden = 0;
    const rebuilt = visible.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt, path) => {
        const bytes = images?.get(path);
        if (!bytes) return match;
        if (shown >= PREVIEW_IMAGES) {
            hidden += 1;
            return `\`${path}\``;
        }
        shown += 1;
        const kind = path.split('.').pop().toLowerCase();
        return `![${alt}](data:image/${IMAGE_MIMES[kind] || kind};base64,${base64FromBytes(bytes)})`;
    });
    return { markdown: rebuilt, hiddenImages: hidden, truncated };
}

export async function importPdf(file, translate, assetFolder = '', accept = null) {
    if (active) return null;
    active = true;
    const t = key => translate(key, key);
    const dialog = document.createElement('dialog');
    dialog.className = 'pdf-import-dialog';
    dialog.setAttribute('aria-labelledby', 'pdf-import-title');
    dialog.innerHTML = `
      <form method="dialog" class="pdf-import-content">
        <h2 id="pdf-import-title"></h2>
        <p class="pdf-import-filename"></p>
        <p id="pdf-import-info" class="pdf-import-info" role="status"></p>
        <p class="pdf-import-note" id="pdf-import-note"></p>
        <div class="pdf-import-options">
          <label><input id="pdf-remove-headers" type="checkbox" checked> <span></span></label>
          <label><input id="pdf-keep-images" type="checkbox" checked> <span></span></label>
          <label class="pdf-ocr-option" hidden><input id="pdf-ocr" type="checkbox"> <span></span></label>
          <label class="pdf-ocr-language" for="pdf-ocr-language"><span></span>
            <select id="pdf-ocr-language">
              <option value="spa">Español</option>
              <option value="eng">English</option>
              <option value="cat">Català</option>
              <option value="glg">Galego</option>
              <option value="eus">Euskara</option>
            </select>
          </label>
          <label for="pdf-pages"></label>
          <input id="pdf-pages" type="text" placeholder="1-3, 5" autocomplete="off" aria-describedby="pdf-import-note">
        </div>
        <p id="pdf-import-status" role="status" aria-live="polite"></p>
        <div id="pdf-import-progress" role="progressbar" aria-labelledby="pdf-import-status" hidden><span class="pdf-import-progress-bar"></span></div>
        <iframe id="pdf-import-preview" sandbox="" referrerpolicy="no-referrer"></iframe>
        <div class="pdf-import-actions">
          <button id="pdf-cancel" type="button"></button>
          <button id="pdf-preview" class="pdf-primary-action" type="button" disabled></button>
          <button id="pdf-accept" type="button" disabled></button>
        </div>
      </form>`;
    const $ = selector => dialog.querySelector(selector);
    $('#pdf-import-title').textContent = t('pdf_title');
    $('.pdf-import-filename').textContent = file.name;
    $('#pdf-import-note').textContent = t('pdf_note');
    $('#pdf-remove-headers + span').textContent = t('pdf_remove_headers');
    $('#pdf-keep-images + span').textContent = t('pdf_keep_images');
    $('#pdf-ocr + span').textContent = t('pdf_ocr');
    $('.pdf-ocr-language > span').textContent = t('pdf_ocr_language');
    $('#pdf-ocr-language').value = defaultOcrLanguage();
    $('.pdf-ocr-language').hidden = !$('#pdf-ocr').checked;
    // La opción aparece cuando se sabe que el documento tiene qué reconocer.
    let scannedPages = 0;
    $('label[for="pdf-pages"]').textContent = t('pdf_pages');
    $('#pdf-cancel').textContent = t('pdf_cancel');
    $('#pdf-preview').textContent = t('pdf_preview');
    $('#pdf-accept').textContent = t('pdf_accept');
    $('#pdf-import-preview').title = t('pdf_preview_frame');
    document.body.append(dialog);
    // A fresh frame avoids competing about:blank/srcdoc navigations in Firefox
    // when options are changed and the preview is regenerated.
    function setPreview(html = '') {
        const frame = document.createElement('iframe');
        frame.id = 'pdf-import-preview';
        frame.title = t('pdf_preview_frame');
        frame.setAttribute('sandbox', '');
        frame.referrerPolicy = 'no-referrer';
        const loaded = new Promise(resolve => frame.addEventListener('load', resolve, { once: true }));
        frame.srcdoc = html;
        $('#pdf-import-preview').replaceWith(frame);
        return loaded;
    }
    const previousFocus = document.activeElement;
    let worker;
    let ocrWorker;
    let ocrWorkerLanguage;
    const pendingOcrImages = new Map();
    const images = new Map();
    let markdown = null;
    let busy = false;
    let inspected = false;
    // El ritmo real de esta conversión, para decir cuánto queda.
    let paceStage = '';
    let paceStart = 0;
    let paceDone = 0;
    let closed = false;
    let watchdog;
    return new Promise(resolve => {
        function finish(value) {
            if (closed) return;
            closed = true;
            clearTimeout(watchdog);
            worker?.terminate();
            ocrWorker?.terminate();
            dialog.close();
            dialog.remove();
            active = false;
            previousFocus?.focus();
            resolve(value);
        }
        /*
          La barra se mueve sola solo mientras no hay nada que contar —al abrir
          el conversor y al limpiar encabezados, que recorre el documento
          entero—; el resto del tiempo marca las páginas que lleva hechas.
        */
        function setProgress(stage, done, total) {
            if (stage === 'heartbeat') return;
            const bar = $('#pdf-import-progress');
            const indeterminate = !total || !done;
            bar.hidden = false;
            bar.dataset.indeterminate = String(indeterminate);
            if (indeterminate) {
                bar.removeAttribute('aria-valuenow');
                bar.querySelector('.pdf-import-progress-bar').style.width = '';
            } else {
                const percent = Math.round((done / total) * 100);
                bar.setAttribute('aria-valuenow', String(percent));
                bar.querySelector('.pdf-import-progress-bar').style.width = `${percent}%`;
            }
            // Durante la carga manda su propio mensaje, que dice cuánto ocupa.
            if (stage === 'loading' || !done) return;
            const key = stage === 'headers'
                ? 'pdf_scanning_page'
                : stage === 'analysing'
                    ? 'pdf_analysing_page'
                    : stage === 'ocr'
                        ? 'pdf_ocr_page'
                        : stage === 'saving' ? 'pdf_saving_images' : 'pdf_converting_page';
            let message = t(key)
                .replaceAll('{page}', String(done))
                .replaceAll('{total}', String(total));
            if (stage !== paceStage) {
                paceStage = stage;
                paceStart = Date.now();
                paceDone = done;
            }
            const minutes = remainingMinutes(Date.now() - paceStart, done - paceDone, total - done);
            if (minutes) {
                // «quedan unos 1 min» no lo dice nadie: el singular es suyo.
                const key = minutes === 1 ? 'pdf_time_remaining_one' : 'pdf_time_remaining_many';
                message += ` · ${t(key).replace('{minutes}', String(minutes))}`;
            }
            $('#pdf-import-status').textContent = message;
        }
        function clearProgress() {
            const bar = $('#pdf-import-progress');
            bar.hidden = true;
            bar.dataset.indeterminate = 'false';
            bar.removeAttribute('aria-valuenow');
            bar.querySelector('.pdf-import-progress-bar').style.width = '';
        }
        /*
          Un mensaje puesto justo antes de un trabajo largo no se ve: el hilo
          se bloquea sin haber pintado. Cediendo dos fotogramas, sí.
        */
        async function announce(key) {
            $('#pdf-import-status').textContent = t(key);
            setProgress('loading', 0, 0);
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        }
        function renewWatchdog() {
            clearTimeout(watchdog);
            if (busy) watchdog = setTimeout(() => fail('pdf_error'), 180000);
        }
        /*
          El OCR solo se ofrece si hay páginas escaneadas que reconocer, y su
          idioma solo si se ha marcado: una opción que no puede hacer nada en
          este documento estorba más que ayuda.
        */
        function syncOcrLanguage() {
            const enabled = $('#pdf-ocr').checked;
            $('.pdf-ocr-option').hidden = !scannedPages;
            $('.pdf-ocr-language').hidden = !enabled || !scannedPages;
            $('#pdf-ocr-language').disabled = busy || !enabled;
        }
        /*
          El diálogo tiene un orden deliberado: primero se convierte y solo
          después se importa. La acción principal y el único botón disponible
          avanzan juntos; tocar cualquier opción invalida el resultado y
          devuelve el énfasis a Convertir.
        */
        function syncActionState() {
            const converted = Boolean(markdown);
            $('#pdf-preview').disabled = busy || !inspected || converted;
            $('#pdf-accept').disabled = busy || !converted;
            $('#pdf-preview').classList.toggle('pdf-primary-action', !converted);
            $('#pdf-accept').classList.toggle('pdf-primary-action', converted);
        }
        function setBusy(value) {
            busy = value;
            renewWatchdog();
            if (!value) clearProgress();
            for (const input of dialog.querySelectorAll('input, select')) input.disabled = value;
            syncOcrLanguage();
            syncActionState();
            dialog.setAttribute('aria-busy', String(value));
        }
        function fail(key) {
            markdown = null;
            $('#pdf-import-status').textContent = t(key);
            worker?.terminate();
            worker = null;
            ocrWorker?.terminate();
            ocrWorker = null;
            ocrWorkerLanguage = null;
            pendingOcrImages.forEach(({ reject }) => reject(new Error(key)));
            pendingOcrImages.clear();
            setBusy(false);
        }

        function requestOcrImage(pageIndex) {
            return new Promise((resolveImage, rejectImage) => {
                pendingOcrImages.set(pageIndex, { resolve: resolveImage, reject: rejectImage });
                worker.postMessage({ operation: 'renderOcrPage', pageIndex });
            });
        }

        async function ensureOcrWorker(language) {
            if (!window.Tesseract?.createWorker) throw new Error('Tesseract unavailable');
            if (ocrWorker && ocrWorkerLanguage === language) return ocrWorker;
            if (ocrWorker) await ocrWorker.terminate();
            ocrWorker = null;
            ocrWorkerLanguage = null;
            $('#pdf-import-status').textContent = t('pdf_ocr_loading');
            setProgress('loading', 0, 0);
            const created = await window.Tesseract.createWorker(
                language,
                window.Tesseract.OEM?.LSTM_ONLY ?? 1,
                ocrWorkerOptions(language, () => { if (busy) renewWatchdog(); }),
            );
            if (closed) {
                await created.terminate();
                throw new Error('cancelled');
            }
            ocrWorker = created;
            ocrWorkerLanguage = language;
            return created;
        }

        async function applyOcr(result) {
            const pages = Array.isArray(result.ocrPages) ? result.ocrPages : [];
            if (!pages.length || !$('#pdf-ocr').checked) return result.markdown;
            const language = OCR_LANGUAGES.has($('#pdf-ocr-language').value)
                ? $('#pdf-ocr-language').value
                : 'spa';
            const recognizer = await ensureOcrWorker(language);
            let converted = result.markdown;
            for (let index = 0; index < pages.length; index += 1) {
                if (closed) throw new Error('cancelled');
                const page = pages[index];
                setProgress('ocr', index + 1, pages.length);
                const bytes = await requestOcrImage(page.index);
                const blob = new Blob([bytes], { type: 'image/png' });
                const recognition = await recognizer.recognize(blob);
                const pageMarkdown = ocrPageMarkdown(recognition.data?.text, page);
                // A replacement function: the page may carry `$` sequences.
                converted = converted.replace(`<!-- edimark-ocr-page:${page.page} -->`, () => pageMarkdown);
            }
            return converted;
        }
        function ensureWorker() {
            if (worker) return worker;
            // La versión con la que se pidió este módulo (su `?v=`) pasa al worker y de él
            // al Python, para que una versión nueva no conviva con piezas en caché.
            worker = new Worker(new URL(`./pdf-worker.js${new URL(import.meta.url).search}`, import.meta.url));
            worker.onerror = () => fail('pdf_error');
            worker.onmessage = async ({ data }) => {
                if (closed) return;
                // Every worker message proves activity: the three-minute
                // timeout measures silence, never total conversion time.
                if (busy) renewWatchdog();
                if (data.type === 'progress') setProgress(data.stage, data.done, data.total);
                else if (data.type === 'status') $('#pdf-import-status').textContent = t(data.key);
                else if (data.type === 'error') fail(data.key);
                else if (data.type === 'image') images.set(data.path, data.bytes);
                else if (data.type === 'ocrImage') {
                    const pending = pendingOcrImages.get(data.pageIndex);
                    if (pending) {
                        pendingOcrImages.delete(data.pageIndex);
                        pending.resolve(data.bytes);
                    }
                }
                else if (data.type === 'info') {
                    inspected = true;
                    const pages = Number(data.result.pages) || 0;
                    $('#pdf-import-info').textContent = t('pdf_document_info')
                        .replaceAll('{count}', String(pages))
                        + (pages > LONG_DOCUMENT_PAGES ? ` ${t('pdf_document_long')}` : '');
                    $('#pdf-import-status').textContent = '';
                    setBusy(false);
                }
                else if (data.type === 'scanned') {
                    scannedPages = Number(data.result.scanned) || 0;
                    if (scannedPages) {
                        const key = scannedPages === 1 ? 'pdf_document_scanned_one' : 'pdf_document_scanned_many';
                        const list = formatPageList(data.result.scannedPages || []);
                        $('#pdf-import-info').textContent += ` ${t(key)
                            .replaceAll('{scanned}', String(scannedPages))
                            .replaceAll('{pages}', list)
                            .replaceAll('{count}', String(data.result.pages))
                            // Sin lista de páginas el paréntesis sobraría.
                            .replace(/\s*\(\s*\)/, '')}`;
                    }
                    syncOcrLanguage();
                    // Para que la espera del recuento se pueda observar fuera.
                    dialog.dataset.scanned = String(scannedPages);
                } else if (data.type === 'result') {
                    try {
                        markdown = stripUnsafeMarkup(await applyOcr(data.result));
                        if (!markdown.trim()) { fail('pdf_empty'); return; }
                        /*
                          Convertir termina aquí, pero armar la vista previa de
                          un documento largo lleva sus segundos más, y hasta
                          ahora los pasaba en silencio con la última página en
                          pantalla: exactamente igual que si se hubiera colgado.
                        */
                        await announce('pdf_preparing_preview');
                        const preview = previewMarkdown(markdown, images);
                        const notes = [];
                        if (preview.truncated) notes.push(t('pdf_preview_truncated'));
                        if (preview.hiddenImages) {
                            notes.push(t(preview.hiddenImages === 1
                                ? 'pdf_preview_images_hidden_one'
                                : 'pdf_preview_images_hidden_many')
                                .replace('{count}', String(preview.hiddenImages)));
                        }
                        const shown = notes.length
                            ? `${preview.markdown}\n\n*${notes.join(' ')}*`
                            : preview.markdown;
                        const html = stripUnsafeMarkup(parseWithFootnotes(shown));
                        // No scripts, network requests, forms or parent access in the preview.
                        await setPreview(`<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';"><style>body{font:16px/1.5 system-ui;padding:16px;color:#182536;background:#fff;overflow-wrap:anywhere}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #94a3b8;padding:6px}pre{white-space:pre-wrap}a{pointer-events:none}.footnotes{margin-top:2.5rem;padding-top:.8rem;border-top:1px solid #cbd5e1;color:#475569;font-size:.82em}.footnotes hr{display:none}.footnotes ol{margin:0;padding-left:1.5rem}.footnotes li+li{margin-top:.45rem}.footnotes p{display:inline;margin:0}.footnote-back{margin-left:.35rem;color:#2563eb;font-weight:700;text-decoration:none}</style>${html}`);
                        if (closed || !busy) return;
                        const usedOcr = Array.isArray(data.result.ocrPages) && data.result.ocrPages.length > 0 && $('#pdf-ocr').checked;
                        $('#pdf-import-status').textContent = t(
                            usedOcr ? 'pdf_ocr_ready' : data.result.textPages < data.result.pages ? 'pdf_partial' : 'pdf_ready'
                        );
                        setBusy(false);
                    } catch (error) {
                        if (!closed) {
                            console.error('No se pudo aplicar OCR al PDF:', error);
                            fail('pdf_ocr_error');
                        }
                    }
                }
            };
            return worker;
        }
        dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
        $('#pdf-cancel').onclick = () => finish(null);
        $('#pdf-accept').onclick = async () => {
            if (busy || !markdown) return;
            // Only the pictures the text still points at: a page whose OCR
            // reading won leaves its own image behind.
            const used = new Set(Array.from(markdown.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/g), m => m[1]));
            const result = {
                markdown,
                images: Array.from(images).filter(([path]) => used.has(path))
                    .map(([path, bytes]) => ({ relativePath: path, bytes })),
            };
            if (!accept) { finish(result); return; }
            /*
              Crear el documento, escribir sus imágenes y abrir la pestaña
              lleva su tiempo con un informe entero, y el diálogo se cerraba
              antes de empezar: la aplicación se quedaba quieta sin decir nada.
              Ahora espera aquí, a la vista, y se cierra cuando está hecho.
            */
            setBusy(true);
            await announce('pdf_importing');
            try {
                // Guardar las imágenes lleva segundos y la base de datos va
                // confirmándolas: contarlas es la diferencia entre una espera
                // y una espera que se ve avanzar.
                /*
                  Guardar las imágenes se cuenta, pero montar el documento en
                  su pestaña —el texto en el editor y la hoja pintada— es otro
                  tramo largo que pasaba entero bajo el mismo mensaje: en un
                  informe de trescientas páginas el diálogo parecía detenido.
                  Ahora dice en qué anda, y `announce` cede dos fotogramas para
                  que el aviso llegue a la pantalla antes del trabajo que la
                  bloquea.
                */
                finish(await accept(
                    result,
                    (done, total) => setProgress('saving', done, total),
                    announce,
                ) ?? result);
            } catch (error) {
                if (!closed) {
                    console.error('No se pudo abrir el PDF importado:', error);
                    fail('pdf_error');
                }
            }
        };
        for (const input of dialog.querySelectorAll('input, select')) input.addEventListener('input', () => {
            markdown = null;
            syncActionState();
            syncOcrLanguage();
            setPreview();
            $('#pdf-import-status').textContent = t('pdf_changed');
        });
        $('#pdf-preview').onclick = async () => {
            if (busy) return;
            markdown = null;
            images.clear();
            setPreview();
            if (file.size > 50 * 1024 * 1024) return fail('pdf_size_limit');
            setBusy(true);
            $('#pdf-import-status').textContent = t('pdf_loading');
            setProgress('loading', 0, 0);
            try {
                ensureWorker();
                const bytes = await file.arrayBuffer();
                if (closed) return;
                worker.postMessage({ operation: 'convert', bytes, options: {
                    assetFolder,
                    pages: $('#pdf-pages').value,
                    removeHeaders: $('#pdf-remove-headers').checked,
                    keepImages: $('#pdf-keep-images').checked,
                    ocr: $('#pdf-ocr').checked,
                    ocrLanguage: $('#pdf-ocr-language').value,
                } }, [bytes]);
            } catch (_) { if (!closed) fail('pdf_error'); }
        };
        dialog.showModal();
        $('#pdf-preview').focus();
        (async () => {
            if (file.size > 50 * 1024 * 1024) { fail('pdf_size_limit'); return; }
            setBusy(true);
            $('#pdf-import-status').textContent = t('pdf_inspecting');
            setProgress('loading', 0, 0);
            try {
                ensureWorker();
                const bytes = await file.arrayBuffer();
                if (closed) return;
                worker.postMessage({ operation: 'inspect', bytes }, [bytes]);
            } catch (_) { if (!closed) fail('pdf_error'); }
        })();
    });
}
