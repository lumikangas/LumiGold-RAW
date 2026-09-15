#!/bin/bash
# build_nikon.sh - Tiny build for first Nikon NEF test
# Produces: wasm/lumiGoldRaw.js + wasm/lumiGoldRaw.wasm
# From: lumiGoldRawWrapper.cpp + LibRaw source you downloaded
# No Adobe/DNG matrices, no extra RAW processing - just linear Float32

set -e

echo "=== LumiGold Nikon NEF Diagnostic Build ==="
echo "Target: wasm/lumiGoldRaw.js + wasm/lumiGoldRaw.wasm"
echo ""

# 1. Check emcc
if ! command -v emcc &> /dev/null; then
  echo "ERROR: emcc not found"
  echo "  Install Emscripten SDK:"
  echo "    git clone https://github.com/emscripten-core/emsdk.git"
  echo "    cd emsdk && ./emsdk install latest && ./emsdk activate latest && source ./emsdk_env.sh"
  echo ""
  exit 1
fi

EMCC_VER=$(emcc --version | head -n1)
echo "Found: $EMCC_VER"

# 2. Find LibRaw source directory
# Try argument $1, then common locations
LIBRAW_DIR=""

if [ -n "$1" ]; then
  if [ -d "$1" ]; then
    LIBRAW_DIR="$1"
  else
    echo "ERROR: Provided LibRaw path does not exist: $1"
    exit 1
  fi
else
  for cand in "./libraw" "./LibRaw" "../libraw" "../LibRaw" "./libraw-0.21.3" "./libraw-0.21.2" "./libraw-0.21.1" "./LibRaw-0.21.3"; do
    if [ -d "$cand" ] && [ -f "$cand/libraw/libraw.h" ]; then
      LIBRAW_DIR="$cand"
      break
    fi
  done
fi

if [ -z "$LIBRAW_DIR" ]; then
  echo "ERROR: LibRaw source directory not found"
  echo "  Expected to find libraw/libraw.h in one of:"
  echo "    ./libraw"
  echo "    ./LibRaw"
  echo "    ../libraw"
  echo "  Or pass path explicitly:"
  echo "    ./build_nikon.sh /path/to/libraw"
  echo ""
  echo "  Download LibRaw:"
  echo "    https://www.libraw.org/download  (get LibRaw-0.21.3.tar.gz)"
  echo "    tar xzf LibRaw-*.tar.gz && mv LibRaw-* libraw"
  echo ""
  exit 1
fi

if [ ! -f "$LIBRAW_DIR/libraw/libraw.h" ]; then
  echo "ERROR: libraw.h not found in $LIBRAW_DIR"
  echo "  Found directory but missing libraw/libraw.h - incomplete download?"
  exit 1
fi

echo "Found LibRaw: $LIBRAW_DIR"
echo "  Version: $(grep -r "LIBRAW_VERSION" $LIBRAW_DIR/libraw/libraw_version.h 2>/dev/null | head -n1 || echo "unknown")"
echo ""

# 3. Check wrapper
if [ ! -f "./lumiGoldRawWrapper.cpp" ]; then
  echo "ERROR: lumiGoldRawWrapper.cpp not found in current directory"
  echo "  Run this script from the folder containing lumiGoldRawWrapper.cpp"
  exit 1
fi

# 4. Create wasm output dir
mkdir -p wasm

# 5. Collect LibRaw sources - keep strictly to what Nikon NEF needs for first test
# For first test we compile core + all decoders/demosaic to avoid missing symbols
# This is still tiny and strictly for Nikon NEF diagnostic, no redesign

LIBRAW_SRC=$(find "$LIBRAW_DIR/src" -name "*.cpp" 2>/dev/null | tr '\n' ' ')
if [ -z "$LIBRAW_SRC" ]; then
  echo "ERROR: No .cpp files found in $LIBRAW_DIR/src"
  exit 1
fi

echo "LibRaw sources: $(echo $LIBRAW_SRC | wc -w) files"
echo ""

# 6. Build - Emscripten emits WASM by default, no special WASM mode needed
echo "Building wasm/lumiGoldRaw.js ..."
echo ""

emcc $LIBRAW_SRC \
  ./lumiGoldRawWrapper.cpp \
  -I"$LIBRAW_DIR" \
  -I"$LIBRAW_DIR/src" \
  -I"$LIBRAW_DIR/internal" \
  -I"$LIBRAW_DIR/libraw" \
  -DLIBRAW_NO_WARNS \
  -s WASM=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="LumiGoldRawModule" \
  -s EXPORTED_FUNCTIONS='["_lg_open","_lg_get_width","_lg_get_height","_lg_get_black","_lg_get_white","_lg_get_data_maximum","_lg_get_linear_max","_lg_get_cam_mul","_lg_get_cmatrix","_lg_get_rgb_cam","_lg_get_cam_xyz","_lg_extract_rgb","_lg_close","_malloc","_free"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPU8","HEAPF32","HEAPU8","HEAP32","HEAPF32"]' \
  -s INITIAL_MEMORY=32MB \
  -s STACK_SIZE=2MB \
  -s ENVIRONMENT=web,worker \
  -O2 \
  -o wasm/lumiGoldRaw.js

BUILD_STATUS=$?

if [ $BUILD_STATUS -ne 0 ]; then
  echo ""
  echo "ERROR: Build failed with exit code $BUILD_STATUS"
  exit $BUILD_STATUS
fi

# 7. Verify outputs
if [ ! -f "wasm/lumiGoldRaw.js" ] || [ ! -f "wasm/lumiGoldRaw.wasm" ]; then
  echo "ERROR: Expected outputs not found:"
  echo "  wasm/lumiGoldRaw.js exists? $( [ -f wasm/lumiGoldRaw.js ] && echo yes || echo no )"
  echo "  wasm/lumiGoldRaw.wasm exists? $( [ -f wasm/lumiGoldRaw.wasm ] && echo yes || echo no )"
  exit 1
fi

SIZE_JS=$(du -h wasm/lumiGoldRaw.js | cut -f1)
SIZE_WASM=$(du -h wasm/lumiGoldRaw.wasm | cut -f1)

echo ""
echo "=== Build OK ==="
echo "  wasm/lumiGoldRaw.js ($SIZE_JS)"
echo "  wasm/lumiGoldRaw.wasm ($SIZE_WASM)"
echo ""
echo "Next: Drop a Nikon NEF into LumiGold_Nikon_NEF_DIAG.html"
echo "  Expected diagnostic:"
echo "    camera/file type: Nikon NEF"
echo "    width × height"
echo "    black / maximum / data maximum / linear_max[4]"
echo "    Float32 min/max/mean / R/G/B means"
echo ""
echo "  If decode fails, JPEG preview fallback is kept."
echo "  Architecture unchanged: NEF -> LibRaw -> Float32 linear -> existing LumiGold GLSL"
