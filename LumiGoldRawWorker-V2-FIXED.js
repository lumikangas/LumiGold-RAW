
// lumiGoldRawWorker_v2.js - Fixed for GitHub Pages, with error reporting
let Module = null;

async function init() {
  try {
    console.log('[WORKER] Importing ./wasm/lumiGoldRaw.js');
    const mod = await import('./wasm/lumiGoldRaw.js');
    console.log('[WORKER] WASM JS loaded, initializing Module...');
    Module = await mod.default({
      locateFile: (p) => {
        console.log('[WORKER] locateFile: ' + p + ' -> ./wasm/' + p);
        return './wasm/' + p;
      }
    });
    console.log('[WORKER] Module ready, has _lg_open=' + (typeof Module._lg_open));
    postMessage({ type: 'ready', hasWasm: true });
  } catch(e) {
    console.error('[WORKER] Init failed', e);
    postMessage({ type: 'ready', hasWasm: false, error: e.message, stack: e.stack });
  }
}

self.onmessage = async (e) => {
  const { id, buffer, fileName } = e.data;
  console.log('[WORKER] Received file', fileName, buffer.byteLength);
  try {
    if (!Module) {
      console.log('[WORKER] Module not ready, calling init()');
      await init();
      if (!Module) {
        console.log('[WORKER] No Module after init, needWasm fallback');
        postMessage({ id, type: 'needWasm', fileName, size: buffer.byteLength });
        return;
      }
    }
    console.log('[WORKER] Allocating', buffer.byteLength);
    const ptr = Module._malloc(buffer.byteLength);
    Module.HEAPU8.set(new Uint8Array(buffer), ptr);
    console.log('[WORKER] Calling _lg_open');
    const ret = Module._lg_open(ptr, buffer.byteLength);
    console.log('[WORKER] _lg_open ret=' + ret);
    if (ret !== 0) throw new Error('lg_open failed: ' + ret);

    const width = Module._lg_get_width();
    const height = Module._lg_get_height();
    console.log('[WORKER] Decoded w=' + width + ' h=' + height);
    
    const black = Module._lg_get_black();
    const white = Module._lg_get_white();
    const data_maximum = Module._lg_get_data_maximum();
    
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

    const rgb_cam = [];
    const cam_xyz = [];
    for (let r=0;r<3;r++) {
      for (let c=0;c<4;c++) rgb_cam.push(Module._lg_get_rgb_cam(r,c));
    }
    for (let r=0;r<4;r++) {
      for (let c=0;c<3;c++) cam_xyz.push(Module._lg_get_cam_xyz(r,c));
    }

    const numFloats = width * height * 3;
    const outBytes = numFloats * 4;
    console.log('[WORKER] Allocating out ' + outBytes);
    const outPtr = Module._malloc(outBytes);
    
    const extractRet = Module._lg_extract_rgb(outPtr);
    console.log('[WORKER] extract ret=' + extractRet);
    if (extractRet !== 0) throw new Error('lg_extract_rgb failed ' + extractRet);

    const floatView = new Float32Array(Module.HEAPF32.buffer, outPtr / 4, numFloats);
    const result = new Float32Array(floatView);

    let min=Infinity, max=-Infinity, sum=0, sumR=0, sumG=0, sumB=0;
    for (let i=0;i<result.length;i+=3){ 
      const r=result[i], g=result[i+1], b=result[i+2]; 
      if(r<min)min=r; if(g<min)min=g; if(b<min)min=b; 
      if(r>max)max=r; if(g>max)max=g; if(b>max)max=b; 
      sum+=r+g+b; sumR+=r; sumG+=g; sumB+=b; 
    }
    const total = result.length/3;
    const stats = { min, max, mean: sum/(total*3), rMean: sumR/total, gMean: sumG/total, bMean: sumB/total };

    Module._free(outPtr);
    Module._free(ptr);
    Module._lg_close();

    console.log('[WORKER] Posting decoded', width, height, stats);
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
        rgb_cam,
        cam_xyz,
        fileName,
        width,
        height,
        fileType: fileName.toLowerCase().endsWith('.nef') ? 'Nikon NEF / LibRaw' : 'RAW / LibRaw'
      },
      stats
    }, [result.buffer]);

  } catch (err) {
    console.error('[WORKER] Error', err);
    postMessage({ id, type: 'error', message: err.message, stack: err.stack });
  }
};

init();
