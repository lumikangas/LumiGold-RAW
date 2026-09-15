# LumiGold-RAW

Clean-room RAW decoder for LumiGold Studio - first test: Nikon NEF → LibRaw → Float32 linear RGB → LumiGold GLSL.

**No Rawnd code. No Adobe matrices yet. Existing engine untouched.**

## Architecture (your design)

```
Nikon NEF (.nef)
      ↓
LibRaw WASM (your lumiGoldRawWrapper.cpp)
  - color.black / color.maximum / color.data_maximum / linear_max[4] / cam_mul[4]
  - color.rgb_cam[3][4] / cam_xyz / cmatrix
      ↓
Float32 linear RGB (R,G,B,R,G,B... no sRGB, no JPEG)
      ↓
u_image → EXISTING LumiGold GLSL (-2..+2 EV, zones, highlight recovery)
```

## What this repo builds

GitHub Actions builds:
- `wasm/lumiGoldRaw.js`
- `wasm/lumiGoldRaw.wasm`

From:
- `lumiGoldRawWrapper.cpp` (tiny C API: lg_open, lg_get_black, lg_get_white, etc.)
- LibRaw 0.21.3 source (downloaded in CI)

## Local build

```bash
# Put LibRaw source here:
./libraw/libraw/libraw.h

# Or download:
wget https://www.libraw.org/data/LibRaw-0.21.3.tar.gz
tar xzf LibRaw-0.21.3.tar.gz && mv LibRaw-0.21.3 libraw

chmod +x build_nikon.sh
./build_nikon.sh
# or explicit path
./build_nikon.sh ./libraw
```

Outputs:
```
wasm/lumiGoldRaw.js
wasm/lumiGoldRaw.wasm
```

## First Nikon NEF test

```bash
python3 -m http.server 8000
# open http://localhost:8000/LumiGold_Nikon_NEF_DIAG.html
# Drop a Nikon NEF
```

Expected diagnostic (top-right):
```
Nikon NEF / LibRaw
DSC_1234.NEF
6000 × 4000
Black: 0 / 512
Maximum: 16383
Data maximum: 16383
Linear max: 16383 / ...
Float32: min / max / mean / R/G/B means
```

If LibRaw fails → automatic fallback to embedded JPEG preview (`interceptRawIfNeeded`), existing JPEG path intact.

## GitHub Actions

On push to `main`:
1. Installs Emscripten (latest)
2. Downloads LibRaw 0.21.3 if not present
3. Runs `build_nikon.sh`
4. Uploads WASM artifacts
5. (Optional) Deploys diagnostic HTML to GitHub Pages

Enable Pages in repo settings → Pages → Source: GitHub Actions.

## Files

- `LumiGold_Nikon_NEF_DIAG.html` - Diagnostic app (Nikon explicit)
- `lumiGoldRawDiag.js` - Decision point: `if(isRaw) decodeRawWithLibRaw() else decodeExistingImage()`
- `lumiGoldRawWorker_v2.js` - Worker, no hard-coded struct offsets
- `lumiGoldRawWrapper.cpp` - C++ wrapper reading `libraw_data_t.color.*` inside WASM
- `build_nikon.sh` - Tiny build script with clear error messages
