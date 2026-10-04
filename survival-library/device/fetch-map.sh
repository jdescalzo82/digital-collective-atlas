#!/usr/bin/env bash
# Download a detailed offline map (streets, paths, rivers, terrain labels) for one area from the
# daily OpenStreetMap build published by Protomaps, as a single .pmtiles file the library can show.
# Run while you still have internet:
#
#   ./device/fetch-map.sh "Springfield County" -89.9,39.6,-89.4,40.0          # bbox: minLon,minLat,maxLon,maxLat
#   ./device/fetch-map.sh "Wales" -5.4,51.3,-2.6,53.5 13                      # optional max zoom (default 14)
#
# Find a bounding box: open the library's Maps page and tap the corners of your area,
# or use https://boundingbox.klokantech.com (CSV format).
# Size guide at zoom 14: a county ~20-150 MB, a small country 0.5-2 GB. Zoom 13 is ~1/3 the size.
set -euo pipefail

NAME="${1:-}"; BBOX="${2:-}"; MAXZOOM="${3:-14}"
if [[ -z "$NAME" || -z "$BBOX" ]]; then sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 1; fi
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="$HERE/web/maps/regions"
OUT="$OUT_DIR/$(echo "$NAME" | tr ' /' '__').pmtiles"
mkdir -p "$OUT_DIR"

PMTILES="$(command -v pmtiles || true)"
if [[ -z "$PMTILES" ]]; then
  echo "-- Downloading the pmtiles tool"
  case "$(uname -m)" in
    aarch64|arm64) ARCH=arm64 ;; x86_64|amd64) ARCH=x86_64 ;; armv7l|armv6l) ARCH=armv6 ;; *) echo "Unsupported CPU $(uname -m)"; exit 1 ;;
  esac
  OS="$(uname -s)"
  URL="$(curl -fsSL https://api.github.com/repos/protomaps/go-pmtiles/releases/latest |
    python3 -c "import json,sys; a=json.load(sys.stdin)['assets']; print(next(x['browser_download_url'] for x in a if '${OS}_${ARCH}' in x['name']))")"
  TMP="$(mktemp -d)"
  curl -fsSL "$URL" -o "$TMP/pm.tar.gz"
  tar -xzf "$TMP/pm.tar.gz" -C "$TMP"
  install -m 755 "$TMP/pmtiles" "$HERE/device/pmtiles"
  PMTILES="$HERE/device/pmtiles"
fi

echo "-- Finding the latest OpenStreetMap build"
BUILD="$(curl -fsSL https://build-metadata.protomaps.dev/builds.json |
  python3 -c "import json,sys; b=json.load(sys.stdin); print(sorted(x['key'] for x in b)[-1])" 2>/dev/null || true)"
[[ -n "$BUILD" ]] || BUILD="$(date -u -d yesterday +%Y%m%d 2>/dev/null || date -u +%Y%m%d).pmtiles"
echo "   using $BUILD"

echo "-- Extracting $NAME ($BBOX, zoom 0-$MAXZOOM). This can take a while."
"$PMTILES" extract "https://build.protomaps.com/$BUILD" "$OUT" --bbox="$BBOX" --maxzoom="$MAXZOOM"

python3 "$HERE/tools/build.py" --no-render >/dev/null
echo "-- Saved $OUT ($(du -h "$OUT" | cut -f1)). It now appears in the Maps page layer menu."
echo "   Map data © OpenStreetMap contributors (ODbL)."
