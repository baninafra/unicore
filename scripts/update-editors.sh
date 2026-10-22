#!/usr/bin/env bash
# Trae las versiones nuevas de los editores incrustados (documento, planilla, presentación y PDF).
#
# Para cada editor mira si su repositorio original tiene un commit más nuevo que el fijado en
# scripts/build-editors.sh. Si lo tiene, prueba nuestro parche encima y lo compila; sólo si las
# dos cosas salen bien, fija el commit nuevo. Si el parche no entra (los autores cambiaron mucho
# el código) o no compila, deja el editor como estaba y avisa: hay que adaptar el parche a mano.
#
# Uso: bash scripts/update-editors.sh   (lo corre también scripts/release.sh antes de compilar)
# Termina con código 0 aunque algún editor no se haya podido actualizar: nunca rompe una publicación.

set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BUILD="$ROOT/scripts/build-editors.sh"
SRC="$ROOT/.editors-src"
mkdir -p "$SRC"

updated=()
failed=()

while read -r kind url commit; do
  [ -z "$kind" ] && continue
  name="$(basename "$url" .git)"
  latest="$(git ls-remote "$url" HEAD 2>/dev/null | cut -f1)"
  if [ -z "$latest" ]; then
    echo "== $kind: no pude consultar $url (¿sin internet?); queda como está"
    continue
  fi
  if [ "$latest" = "$commit" ]; then
    echo "== $kind: al día (${commit:0:8})"
    continue
  fi

  echo "== $kind: hay una versión nueva (${commit:0:8} → ${latest:0:8})"
  dir="$SRC/$name"
  [ -d "$dir/.git" ] || git clone --quiet "$url" "$dir"
  git -C "$dir" fetch --quiet origin "$latest" 2>/dev/null || git -C "$dir" fetch --quiet origin
  git -C "$dir" checkout --quiet --force "$latest" && git -C "$dir" clean --quiet -fd -e target -e dist
  if ! git -C "$dir" apply --check --whitespace=nowarn "$ROOT/editors/patches/$name.patch" 2>/dev/null; then
    echo "   el parche no entra en la versión nueva: queda la anterior"
    failed+=("$kind (el parche no entra)")
    continue
  fi

  # Se fija el commit nuevo y se compila; si no compila, se vuelve al anterior y se recompila ése.
  sed -i "s/$commit/$latest/" "$BUILD"
  if bash "$BUILD" "$kind"; then
    echo "   listo: $kind actualizado"
    updated+=("$kind")
  else
    echo "   no compiló con la versión nueva: vuelvo a la anterior"
    sed -i "s/$latest/$commit/" "$BUILD"
    bash "$BUILD" "$kind" >/dev/null 2>&1 || echo "   ¡ojo! tampoco pude recompilar la versión anterior de $kind"
    failed+=("$kind (no compiló)")
  fi
done < <(sed -n '/^EDITORS="/,/^"/p' "$BUILD" | grep -E '^(doc|sheet|deck|pdf) ')

echo
[ ${#updated[@]} -gt 0 ] && echo "Editores actualizados: ${updated[*]}"
[ ${#failed[@]} -gt 0 ] && echo "No se pudieron actualizar (siguen con la versión anterior): ${failed[*]}"
[ ${#updated[@]} -eq 0 ] && [ ${#failed[@]} -eq 0 ] && echo "Los editores ya estaban al día."
exit 0
