#!/usr/bin/env bash
# Arma los editores incrustados (documento, planilla, presentación y PDF) en public/editors/.
#
# Son apps Rust que corren en el navegador como WebAssembly. Para cada una: clona el código
# en .editors-src/ al commit fijado abajo, aplica nuestro parche (editors/patches/<nombre>.patch:
# sin marcas de terceros y con el puente postMessage que usa src/views/editor-view.tsx),
# compila con trunk y copia el resultado con sus licencias.
#
# Requisitos: git, Rust con el target wasm32-unknown-unknown y trunk.
#   rustup target add wasm32-unknown-unknown
#   cargo install trunk   (o el binario de https://github.com/trunk-rs/trunk/releases)
#
# Uso: bash scripts/build-editors.sh [doc] [sheet] [deck] [pdf]   (sin argumentos, los cuatro)

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/.editors-src"
OUT="$ROOT/public/editors"

# tipo  repositorio                                commit
EDITORS="
doc   https://github.com/storytold/wordcraft.git  dd2a6510932b92c40f79cef0ada920dffda8851b
sheet https://github.com/storytold/gridcraft.git  e1604d17915fe5a1f8d75fe9a5eef449226ec867
deck  https://github.com/storytold/deckcraft.git  8ec4f6cabbbe8def6b92068b60396b45f49a0b63
pdf   https://github.com/storytold/pdfcraft.git   661ded72bbc255d87ceb9bb5a913396a3daa6010
"

want="${*:-doc sheet deck pdf}"
mkdir -p "$SRC" "$OUT"

echo "$EDITORS" | while read -r kind url commit; do
  [ -z "$kind" ] && continue
  case " $want " in *" $kind "*) ;; *) continue ;; esac
  name="$(basename "$url" .git)"
  dir="$SRC/$name"
  echo "== $kind ($name @ ${commit:0:8})"
  if [ ! -d "$dir/.git" ]; then git clone --quiet "$url" "$dir"; fi
  git -C "$dir" fetch --quiet --depth 1 origin "$commit" 2>/dev/null || git -C "$dir" fetch --quiet origin
  git -C "$dir" checkout --quiet --force "$commit"
  git -C "$dir" clean --quiet -fd -e target -e dist
  git -C "$dir" apply --whitespace=nowarn "$ROOT/editors/patches/$name.patch"
  (cd "$dir/apps/$name-web" && trunk build --release)
  rm -rf "$OUT/$kind"
  mkdir -p "$OUT/$kind/licencias"
  cp -r "$dir/dist/web/." "$OUT/$kind/"
  # MIT y Apache-2.0 piden distribuir el aviso de copyright y las licencias junto al programa.
  cp "$dir/LICENSE-MIT" "$dir/LICENSE-APACHE" "$dir/NOTICE" "$OUT/$kind/licencias/"
  [ -f "$dir/ATTRIBUTION.md" ] && cp "$dir/ATTRIBUTION.md" "$OUT/$kind/licencias/"
done

echo "Listo: $OUT"
