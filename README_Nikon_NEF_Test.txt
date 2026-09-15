LumiGold - Nikon NEF First-Test Package
========================================

Purpose:
First real test: Nikon NEF -> LibRaw -> Float32 linear RGB -> existing LumiGold GLSL
No Adobe/DNG matrices, no extra RAW processing yet.

Contents:
- LumiGold_Nikon_NEF_DIAG.html : Main diagnostic app (Nikon NEF explicit)
- lumiGoldRawDiag.js           : Diagnostic decision point & UI (A/B test)
- lumiGoldRawWorker_v2.js      : Worker - reads black/maximum/data_maximum/linear_max/cam_mul inside WASM
- lumiGoldRawWrapper.cpp       : Tiny C++ wrapper - no hard-coded struct offsets
- build_nikon.sh               : Build script producing wasm/lumiGoldRaw.js + .wasm
- LumiGold_Photo_Session_exp_RAW_DIAG_FIXED.html : Generic fixed version (ARW/NEF/CR2)

Directory layout you need:
--------------------------------
your-project/
  LumiGold_Nikon_NEF_DIAG.html
  lumiGoldRawDiag.js
  lumiGoldRawWorker_v2.js
  lumiGoldRawWrapper.cpp
  build_nikon.sh
  libraw/                      <- PUT LibRaw SOURCE HERE (you downloaded)
    libraw/
      libraw.h
      libraw_version.h
    src/
      *.cpp
  wasm/                        <- GENERATED HERE by build_nikon.sh
    lumiGoldRaw.js             <- generated
    lumiGoldRaw.wasm           <- generated

Where to put LibRaw source:
----------------------------
1. Download LibRaw 0.21.3 from https://www.libraw.org/download
2. tar xzf LibRaw-0.21.3.tar.gz
3. mv LibRaw-0.21.3 libraw
4. Place so that libraw/libraw.h exists:
   ./libraw/libraw/libraw.h
   If you have it elsewhere: ./build_nikon.sh /path/to/libraw

Where WASM files appear:
-------------------------
After successful build, you MUST have:
  ./wasm/lumiGoldRaw.js
  ./wasm/lumiGoldRaw.wasm

build_nikon.sh creates ./wasm automatically and reports clear error if emcc or libraw missing.

Build:
------
chmod +x build_nikon.sh
./build_nikon.sh
# or with explicit path
./build_nikon.sh ./libraw

Run test:
---------
1. Open LumiGold_Nikon_NEF_DIAG.html in browser (via http:// localhost, not file:// for WASM)
   e.g. python3 -m http.server 8000
   then http://localhost:8000/LumiGold_Nikon_NEF_DIAG.html

2. Drop a Nikon NEF file.

Expected diagnostic readout (top-right):
  Nikon NEF / LibRaw
  DSC_1234.NEF
  6000 x 4000
  Black: 0 / 512 / etc.
  Maximum: 16383
  Data maximum: 16383 / 15892
  Linear max: 16383 / 16383 / 16383 / 16383
  Cam mul: 1.xxx / 1.000 / 1.xxx / 1.000

  Float32:
  min / max / mean
  R mean / G mean / B mean

  If sane: min >=0, max <=1.05, mean 0.05-0.5

Fallback:
---------
If LibRaw decode fails or WASM not built, panel shows "WASM not built" or error,
and app automatically falls back to existing embedded-JPEG preview path (interceptRawIfNeeded).
Existing GLSL pipeline (-2..+2 EV, zones, etc.) is never altered.

Architecture (unchanged):
--------------------------
.ARW / NEF / CR2 -> LibRaw WASM -> unpack RAW -> black/white/data_maximum/linear_max/cam_mul/rgb_cam
-> Float32 linear RGB (R,G,B,R,G,B...) no sRGB encoding -> u_image -> EXISTING LumiGold GLSL -> display

Notes:
------
- Do not add Adobe DNG matrices yet - first test is just establishing linear Float32 path.
- LibRaw fields used: color.black, color.maximum, color.data_maximum, color.linear_max[4], color.cam_mul[4]
- Normalization in C++: float x = (raw - black) / (white - black); clamp 0-1; but data_maximum and linear_max exposed for decision.
