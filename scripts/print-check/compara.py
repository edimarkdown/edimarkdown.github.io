"""Compara dónde empieza cada página en la hoja (datos.json) y en el papel (PDF).
Uso: python3 compara.py <datos.json> <salida.pdf>. Necesita poppler-utils.

Avisa de más cuando la página empieza por una línea horizontal, un diagrama o
la cabecera repetida de una tabla: allí el texto de la hoja y el del PDF no
coinciden aunque el corte sea el mismo."""
import sys, json, re, subprocess
d = json.load(open(sys.argv[1])); pdf = sys.argv[2]
n = int(re.search(r'Pages:\s+(\d+)', subprocess.run(['pdfinfo', pdf], capture_output=True, text=True).stdout).group(1))
print(f"hoja en pantalla: {d['paginas']} páginas | papel: {n} páginas | márgenes {d['pagina']}")
norm = lambda s: re.sub(r'\W+', '', s).lower()
inicios = [norm(x)[:25] for x in d['inicios']]
bien = 0; cortas = []
for p in range(1, n + 1):
    t = subprocess.run(['pdftotext', '-f', str(p), '-l', str(p), '-layout', pdf, '-'], capture_output=True, text=True).stdout
    lineas = [l for l in t.split('\n') if l.strip()]
    primera = norm(''.join(lineas[:3]))
    es_inicio = p == 1 or any(i and primera.startswith(i[:18]) for i in inicios)
    bien += es_inicio
    if len(lineas) <= 12: cortas.append((p, len(lineas)))
    if not lineas: print(f'  pág {p} del papel: EN BLANCO'); continue
    if not es_inicio: print(f'  pág {p} del papel empieza donde la hoja NO cortaba: «{" ".join(lineas[0].split())[:60]}» ({len(lineas)} líneas)')
print(f'páginas del papel que empiezan donde la hoja: {bien} de {n} | páginas con 12 líneas o menos: {cortas}')
