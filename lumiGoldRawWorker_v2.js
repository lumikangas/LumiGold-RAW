
// lumiGoldRawWorker_v2.js - Your architecture, corrected
// No struct offsets in JS. All LibRaw fields read inside WASM.

let Module = null;

async function init() {
  const mod = await import('./wasm/lumiGoldRaw.js');
  Module = await mod.default({
    locateFile: (p) => './wasm/' + p
  });
  postMessage({ type: 'ready' });
}

self.onmessage = async (e) => {
  const { id, buffer, fileName } = e.data;
  try {
    if (!Module) await init();

    const ptr = Module._malloc(buffer.byteLength);
    Module.HEAPU8.set(new Uint8Array(buffer), ptr);

    const ret = Module._lg_open(ptr, buffer.byteLength);
    if (ret !== 0) throw new Error('lg_open failed: ' + ret);

    const width = Module._lg_get_width();
    const height = Module._lg_get_height();
    
    const black = Module._lg_get_black();
    const white = Module._lg_get_white();
    const data_maximum = Module._lg_get_data_maximum();
    
    // linear_max[4] and cam_mul[4] for prototype inspection
    const linear_max = [
      Module._lg_get_linear_max(0),
      Module._lg_get_linear_max(1),
      Module._lg_get_linear_max(2),
      Module._lg_get_linear_max(3)
    ];
    
    const cam_mul = [
      Module._lg_get_cam_mul(0),
      Module._lg_get_cam_mul(1),
      Module._lg_get_cam_mul(2),
      Module._lg_get_cam_mul(3)
    ];

    // For first prototype: see exactly what LibRaw gives for your cameras
    const rgb_cam = [];
    const cam_xyz = [];
    for (let r=0;r<3;r++) {
      for (let c=0;c<4;c++) rgb_cam.push(Module._lg_get_rgb_cam(r,c));
    }
    for (let r=0;r<4;r++) {
      for (let c=0;c<3;c++) cam_xyz.push(Module._lg_get_cam_xyz(r,c));
    }

    // Allocate output Float32 RGB
    const numFloats = width * height * 3;
    const outBytes = numFloats * 4;
    const outPtr = Module._malloc(outBytes);
    
    const extractRet = Module._lg_extract_rgb(outPtr);
    if (extractRet !== 0) throw new Error('lg_extract_rgb failed');

    // Copy out - this is Float32 linear RGB, no sRGB, no JPEG
    const floatView = new Float32Array(Module.HEAPF32.buffer, outPtr / 4, numFloats);
    const result = new Float32Array(floatView); // copy

    Module._free(outPtr);
    Module._free(ptr);
    Module._lg_close();

    postMessage({
      id,
      type: 'decoded',
      width,
      height,
      buffer: result.buffer,
      meta: {
        black,
        white,
        data_maximum,
        linear_max,
        cam_mul,
        rgb_cam, // [3][4] flattened
        cam_xyz, // [4][3] flattened
        // For LumiGold: you can seed u_wbR/G/B from cam_mul
        // and decide later if you need own matrix layer
        fileName,
        // Denominator choice: expose all three so LumiGold can choose intelligently
        // As you noted: maximum vs data_maximum vs linear_max varies by camera/file
        normalization: {
          // Your preferred formula exposed
          // x = (raw - black) / (white - black), clamped 0-1
          black,
          white,
          data_maximum,
          formula: "(raw - black) / (white - black), clamp 0-1"
        }
      }
    }, [result.buffer]);

  } catch (err) {
    postMessage({ id, type: 'error', message: err.message, stack: err.stack });
  }
};
