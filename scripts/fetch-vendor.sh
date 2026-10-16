#!/usr/bin/env bash
# Baja las piezas de código abierto que la app usa sin conexión y que no van en git:
#
#   geo      Geometría y gráficos (paquete descargable de las apps matemáticas de GeoGebra, uso no comercial)
#            → public/editors/geo/ con nuestro index.html (editors/geo/index.html, el puente con UniCore)
#   opencv   OpenCV.js para el escáner (detectar la hoja y enderezarla) → public/vendor/opencv/opencv.js
#
# Uso: bash scripts/fetch-vendor.sh [geo] [opencv]   (sin argumentos, todo)

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
want="${*:-geo opencv}"

GEO_URL="https://download.geogebra.org/installers/5.4/geogebra-math-apps-bundle-5-4-932-1.zip"
OPENCV_URL="https://docs.opencv.org/4.9.0/opencv.js"

case " $want " in *" geo "*)
  echo "== geo"
  OUT="$ROOT/public/editors/geo"
  curl -fsSL -A "Mozilla/5.0" -o "$TMP/geo.zip" "$GEO_URL"
  unzip -q "$TMP/geo.zip" -d "$TMP/geo"
  rm -rf "$OUT"
  mkdir -p "$OUT/HTML5/5.0"
  cp "$TMP/geo/GeoGebra/deployggb.js" "$OUT/"
  # Sólo hace falta el módulo completo (2D, 3D, CAS, planilla) y sus estilos.
  cp -r "$TMP/geo/GeoGebra/HTML5/5.0/web3d" "$TMP/geo/GeoGebra/HTML5/5.0/css" "$OUT/HTML5/5.0/"
  cp "$ROOT/editors/geo/index.html" "$OUT/index.html"
  mkdir -p "$OUT/licencias"
  cp "$TMP/geo/README.txt" "$OUT/licencias/LEEME.txt"
  cp -r "$TMP/geo/GeoGebra/HTML5/5.0/web3d/fonts/licences/." "$OUT/licencias/"
  ;;
esac

case " $want " in *" opencv "*)
  echo "== opencv"
  mkdir -p "$ROOT/public/vendor/opencv"
  curl -fsSL -o "$ROOT/public/vendor/opencv/opencv.js" "$OPENCV_URL"
  ;;
esac

echo "Listo."
