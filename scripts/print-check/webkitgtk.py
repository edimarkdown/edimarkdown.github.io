"""Carga EdiMarkdown en WebKitGTK (el motor de la aplicación de Linux), sin
ventana en pantalla, espera al reparto en páginas, anota dónde empieza cada
página en la hoja e imprime a PDF por el mismo camino que la aplicación
(PrintOperation con el PageSetup del documento).

Uso: python3 webkitgtk.py <url> <salida.pdf> <datos.json> [código JS previo]
Necesita python3-gi y gir1.2-webkit2-4.1. Ver LEEME.md."""
import sys, json, gi
gi.require_version('Gtk', '3.0'); gi.require_version('WebKit2', '4.1')
from gi.repository import Gtk, WebKit2, GLib
url, pdf, datos = sys.argv[1], sys.argv[2], sys.argv[3]
previo = sys.argv[4] if len(sys.argv) > 4 else ''   # JS que se ejecuta antes de medir
ctx = WebKit2.WebContext.new_ephemeral()
view = WebKit2.WebView.new_with_context(ctx)
win = Gtk.OffscreenWindow(); win.set_default_size(2700, 1100); win.add(view); win.show_all()
est = {'iguales': 0, 'ultimo': None, 'info': None, 'vueltas': 0}

def js(code, cb):
    def hecho(v, res):
        try: cb(v.evaluate_javascript_finish(res).to_string())
        except Exception as e: print('error JS:', e); cb(None)
    view.evaluate_javascript(code, -1, None, None, None, hecho)

MEDIR = open(__import__('os').path.join(__import__('os').path.dirname(__import__('os').path.abspath(__file__)), 'medir.js')).read()

def sondea():
    est['vueltas'] += 1
    def visto(r):
        if r and r != 'null':
            d = json.loads(r); clave = (d['paginas'], d['alto'])
            est['iguales'] = est['iguales'] + 1 if clave == est['ultimo'] and d['paginas'] > 1 and d['listo'] else 0
            est['ultimo'] = clave
            if est['iguales'] >= 4:
                est['info'] = d; open(datos, 'w').write(json.dumps(d, ensure_ascii=False, indent=1))
                js("document.getElementById('print-btn').click(); 'ok'", lambda _: None)
                return
        if est['vueltas'] > 80: print('no se llegó a paginar', r); Gtk.main_quit(); return
        GLib.timeout_add(1000, sondea)
    js(MEDIR, visto)
    return False

def al_imprimir(v, op):
    p = est['info']['pagina'] or {}
    s = Gtk.PrintSettings(); s.set_printer(GLib.dgettext('gtk30', 'Print to File'))  # el nombre va en el idioma del sistema
    s.set(Gtk.PRINT_SETTINGS_OUTPUT_URI, 'file://' + pdf); s.set(Gtk.PRINT_SETTINGS_OUTPUT_FILE_FORMAT, 'pdf')
    op.set_print_settings(s)
    ps = Gtk.PageSetup()
    mm = {'a4': (210.0, 297.0), 'letter': (215.9, 279.4)}[p.get('paperSize') or 'a4']
    if p.get('orientation') == 'landscape': ps.set_paper_size(Gtk.PaperSize.new_custom('apaisado', 'apaisado', mm[1], mm[0], Gtk.Unit.MM))
    else: ps.set_paper_size(Gtk.PaperSize.new('na_letter' if p.get('paperSize') == 'letter' else 'iso_a4'))
    for lado, f in (('marginTop', ps.set_top_margin), ('marginBottom', ps.set_bottom_margin), ('marginLeft', ps.set_left_margin), ('marginRight', ps.set_right_margin)):
        if p.get(lado) is not None: f(p[lado] * 10, Gtk.Unit.MM)
    op.set_page_setup(ps)
    op.connect('finished', lambda o: (print('impreso'), Gtk.main_quit()))
    op.connect('failed', lambda o, e: (print('fallo', e), Gtk.main_quit()))
    op.print_()
    return True

def cargado(v, ev):
    if ev != WebKit2.LoadEvent.FINISHED: return
    if previo: js(previo, lambda _: GLib.timeout_add(1500, sondea))
    else: GLib.timeout_add(1500, sondea)
view.connect('print', al_imprimir); view.connect('load-changed', cargado); view.load_uri(url)
GLib.timeout_add_seconds(150, lambda: (print('tiempo agotado'), Gtk.main_quit()))
Gtk.main()
