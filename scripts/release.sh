#!/usr/bin/env bash
# Publica una versión nueva de UniCore para que las apps instaladas se actualicen con un clic.
#
# 1. Subí el número de versión en src-tauri/tauri.conf.json, src-tauri/Cargo.toml y package.json.
# 2. Corré: bash scripts/release.sh "Qué cambió en esta versión"
#    Antes de compilar trae las versiones nuevas de los editores incrustados (scripts/update-editors.sh).
#
# Compila el instalador firmado con la clave de ~/.tauri/unicore.key (nunca va al repo), arma latest.json
# y crea el release v<versión> en el repo público. La app busca ahí:
#   https://github.com/baninafra/unicore/releases/latest/download/latest.json
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="baninafra/unicore"
KEY="${UNICORE_KEY:-$HOME/.tauri/unicore.key}"
NOTES="${1:-Mejoras y correcciones.}"

cd "$ROOT"
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
[ -f "$KEY" ] || { echo "No encuentro la clave de firma en $KEY"; exit 1; }
if gh release view "v$VERSION" --repo "$REPO" >/dev/null 2>&1; then
  echo "La versión v$VERSION ya está publicada: subí el número de versión primero."; exit 1
fi

# Editores incrustados: si sus autores publicaron versiones nuevas y nuestro parche entra, se suben
# solos (UNICORE_SIN_EDITORES=1 para saltearlo). Lo que no se pueda actualizar sigue como estaba.
if [ -z "${UNICORE_SIN_EDITORES:-}" ]; then
  echo "== Buscando versiones nuevas de los editores"
  bash "$ROOT/scripts/update-editors.sh"
  if ! git diff --quiet -- scripts/build-editors.sh; then
    git add scripts/build-editors.sh
    git commit -q -m "Editores incrustados al día para la versión $VERSION"
    echo "   (commit hecho con las versiones nuevas de los editores; subilo con git push)"
  fi
fi

echo "== Compilando UniCore $VERSION"
export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
npx tauri build

BUNDLE="$ROOT/src-tauri/target/release/bundle/nsis"
EXE="UniCore_${VERSION}_x64-setup.exe"
[ -f "$BUNDLE/$EXE.sig" ] || { echo "Falta la firma $BUNDLE/$EXE.sig"; exit 1; }

echo "== Armando latest.json"
OUT="$ROOT/src-tauri/target/release/latest.json"
VERSION="$VERSION" NOTES="$NOTES" SIG="$(cat "$BUNDLE/$EXE.sig")" URL="https://github.com/$REPO/releases/download/v$VERSION/$EXE" node -e '
const e = process.env;
const json = { version: e.VERSION, notes: e.NOTES, pub_date: new Date().toISOString(),
  platforms: { "windows-x86_64": { signature: e.SIG, url: e.URL } } };
require("fs").writeFileSync(process.argv[1], JSON.stringify(json, null, 2));
' "$OUT"

echo "== Publicando v$VERSION en $REPO"
gh release create "v$VERSION" --repo "$REPO" --title "UniCore $VERSION" --notes "$NOTES" "$BUNDLE/$EXE" "$BUNDLE/$EXE.sig" "$OUT"
echo "Listo: las apps instaladas van a ver la versión $VERSION."
