#!/bin/bash
# Imprime EdiMarkdown a PDF desde Firefox, sin ventana, y anota dónde empieza
# cada página en la hoja. Usa el Firefox del sistema con un perfil temporal.
# Uso: firefox.sh <url> <salida.pdf> <datos.json> [previo.js]
set -u
AQUI=$(dirname "$(readlink -f "$0")")
PERFIL=$(mktemp -d)
PUERTO=${EDIMARK_BIDI_PORT:-9377}
(firefox --headless --no-remote --profile "$PERFIL" --remote-debugging-port "$PUERTO" >/dev/null 2>&1 &)
for i in $(seq 1 30); do ss -ltn | grep -q ":$PUERTO " && break; sleep 1; done
node "$AQUI/firefox.mjs" "$PUERTO" "$@"
# Solo el Firefox de esta prueba: el que lleva el perfil temporal.
for pid in $(pgrep -x firefox-bin; pgrep -x firefox); do
  tr '\0' ' ' < /proc/$pid/cmdline | grep -q "$PERFIL" && kill "$pid"
done
sleep 1; rm -rf "$PERFIL"
