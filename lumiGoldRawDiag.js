
// lumiGoldRawDiag.js - Diagnostic RAW path for LumiGold
// Clean, no nested backticks, keeps existing JPEG path intact

window.LumiGoldRawDiag = {
  worker: null,
  ready: false,
  hasWasm: false,
  lastMeta: null,
  lastStats: null
};

function isRawFile(file) {
  if (!file || !file.name) return false;
  var ext = file.name.split('.').pop().toLowerCase();
  var RAW = ['cr2','cr3','nef','arw','dng','orf','rw2','raf','pef','iiq','3fr'];
  return RAW.indexOf(ext) !== -1;
}

function initDiagWorker() {
  if (window.LumiGoldRawDiag.worker) return window.LumiGoldRawDiag.worker;
  // Worker code is in separate file lumiGoldRawWorker_v2.js, but we also create inline fallback
  try {
    // Try external worker v2 if present
    var worker = new Worker('./lumiGoldRawWorker_v2.js', { type: 'module' });
    worker.onmessage = handleWorkerMessage;
    window.LumiGoldRawDiag.worker = worker;
    return worker;
  } catch(e) {
    console.warn('[RAW DIAG] external worker failed, using inline mock', e);
    // Inline mock worker for UI testing without WASM
    var code = "self.onmessage=function(e){var b=e.data.buffer; postMessage({type:'needWasm', fileName:e.data.fileName, size:b.byteLength});}; postMessage({type:'ready', hasWasm:false});";
    var blob = new Blob([code], {type:'application/javascript'});
    var worker2 = new Worker(URL.createObjectURL(blob));
    worker2.onmessage = handleWorkerMessage;
    window.LumiGoldRawDiag.worker = worker2;
    return worker2;
  }
}

function handleWorkerMessage(e) {
  var msg = e.data;
  if (msg.type === 'ready') {
    window.LumiGoldRawDiag.ready = true;
    window.LumiGoldRawDiag.hasWasm = !!msg.hasWasm;
    console.log('[RAW DIAG] ready hasWasm=' + msg.hasWasm);
    return;
  }
  if (msg.type === 'needWasm') {
    showDiag({ fileName: msg.fileName, width:0, height:0, black:'— (build WASM)', white:'—', data_maximum:'—', linear_max:['—','—','—','—'], cam_mul:['—','—','—','—'], size: msg.size }, null, true);
    // fallback to JPEG preview path
    if (window.LumiGoldRawDiag._pendingFile) {
      fallbackToJpeg(window.LumiGoldRawDiag._pendingFile);
    }
    return;
  }
  if (msg.type === 'decoded') {
    showDiag(msg.meta, msg.stats, false);
    uploadFloat32(msg);
    return;
  }
  if (msg.type === 'error') {
    console.error('[RAW DIAG] error', msg.message);
    var panel = document.getElementById('rawDiagContent');
    if (panel) panel.innerHTML = '<div style="color:#f87171">Error: ' + msg.message + '</div>';
  }
}

function showDiag(meta, stats, needWasm) {
  var panel = document.getElementById('rawDiagPanel');
  var content = document.getElementById('rawDiagContent');
  var fstats = document.getElementById('rawDiagFloatStats');
  if (!panel || !content) return;
  panel.classList.remove('hidden');
  if (meta.error) {
    content.innerHTML = '<div style="color:#f87171">' + meta.error + '</div>';
    return;
  }
  var camName = meta.fileName ? meta.fileName : 'RAW';
  var wh = meta.width && meta.height ? meta.width + ' × ' + meta.height : (needWasm ? 'WASM not built' : '—');
  var lm = (meta.linear_max||[]).join(' / ');
  var cm = (meta.cam_mul||[]).map(function(v){ return typeof v==='number' ? v.toFixed(3) : v; }).join(' / ');
  content.innerHTML = 
    '<div style="color:#fde68a;font-weight:bold">' + (needWasm ? 'RAW detected (mock)' : 'RAW / LibRaw') + '</div>' +
    '<div style="color:#d4d4d8">' + camName + '</div>' +
    '<div style="color:#a1a1aa">' + wh + '</div>' +
    '<div style="margin-top:8px">' +
      '<div><span style="color:#71717a">Black:</span> <span style="color:#e4e4e7">' + (meta.black!==undefined?meta.black:'—') + '</span></div>' +
      '<div><span style="color:#71717a">Maximum:</span> <span style="color:#e4e4e7">' + (meta.white!==undefined?meta.white:meta.maximum||'—') + '</span></div>' +
      '<div><span style="color:#71717a">Data maximum:</span> <span style="color:#e4e4e7">' + (meta.data_maximum!==undefined?meta.data_maximum:'—') + '</span></div>' +
      '<div><span style="color:#71717a">Linear max:</span> <span style="color:#e4e4e7">' + lm + '</span></div>' +
      '<div><span style="color:#71717a">Cam mul:</span> <span style="color:#e4e4e7">' + cm + '</span></div>' +
      (needWasm ? '<div style="margin-top:8px;color:rgba(251,191,36,0.8)">Build wasm/lumiGoldRaw.js from lumiGoldRawWrapper.cpp to enable linear Float32</div>' : '') +
    '</div>';

  if (stats && fstats) {
    var sane = (stats.min>=0 && stats.max<=1.05 && stats.mean>0.01 && stats.mean<0.9) ? '✓ sane normalized linear' : '⚠ check scaling';
    fstats.innerHTML = 'min: ' + stats.min.toFixed(6) + ' • max: ' + stats.max.toFixed(6) + '<br>' +
      'mean: ' + stats.mean.toFixed(6) + '<br>' +
      'R mean: ' + stats.rMean.toFixed(6) + ' • G mean: ' + stats.gMean.toFixed(6) + ' • B mean: ' + stats.bMean.toFixed(6) + '<br>' +
      '<span style="font-size:8px;color:#71717a">' + sane + '</span>';
  } else if (fstats) {
    fstats.textContent = needWasm ? 'WASM not built yet' : '—';
  }
}

function uploadFloat32(msg) {
  try {
    var float32RGB = new Float32Array(msg.buffer);
    var w = msg.width, h = msg.height;
    window.LumiGoldRawDiag.lastFloat32 = float32RGB;
    window.LumiGoldRawDiag.lastMeta = msg.meta;
    window.LumiGoldRawDiag.lastStats = msg.stats;

    // Create 8-bit preview for display via existing pipeline (tonemap linear -> sRGB)
    var canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var ctx = canvas.getContext('2d');
    var imgData = ctx.createImageData(w, h);
    for (var i=0, j=0; i<float32RGB.length; i+=3, j+=4) {
      var r = Math.pow(Math.min(1, Math.max(0, float32RGB[i])), 1/2.2) * 255;
      var g = Math.pow(Math.min(1, Math.max(0, float32RGB[i+1])), 1/2.2) * 255;
      var b = Math.pow(Math.min(1, Math.max(0, float32RGB[i+2])), 1/2.2) * 255;
      imgData.data[j]=r; imgData.data[j+1]=g; imgData.data[j+2]=b; imgData.data[j+3]=255;
    }
    ctx.putImageData(imgData,0,0);
    canvas.toBlob(function(blob){
      var cleanName = msg.meta.fileName ? msg.meta.fileName.replace(/\.[^/.]+$/, '') : 'RAW_linear';
      var file = new File([blob], cleanName + '_linear_preview.png', {type:'image/png'});
      file._isRawLinearPreview = true;
      file._rawFloat32 = float32RGB;
      file._rawMeta = msg.meta;
      if (window._originalHandleImageFile) {
        window._originalHandleImageFile(file);
      }
      console.log('[RAW DIAG] Float32 ready', w, h, 'first pixel', float32RGB[0], float32RGB[1], float32RGB[2]);
    }, 'image/png');
  } catch(err) {
    console.error('uploadFloat32 failed', err);
  }
}

async function decodeRawWithLibRaw(file) {
  initDiagWorker();
  window.LumiGoldRawDiag._pendingFile = file;
  var buf = await file.arrayBuffer();
  // Transfer buffer
  try {
    window.LumiGoldRawDiag.worker.postMessage({ id: Date.now(), buffer: buf, fileName: file.name }, [buf]);
  } catch(e) {
    // If transfer fails (mock worker), post without transfer
    window.LumiGoldRawDiag.worker.postMessage({ id: Date.now(), buffer: buf, fileName: file.name });
  }
  return null;
}

function decodeExistingImage(file) {
  return file;
}

async function fallbackToJpeg(file) {
  try {
    if (typeof interceptRawIfNeeded === 'function') {
      var processed = await interceptRawIfNeeded(file);
      if (processed && window._originalHandleImageFile) {
        window._originalHandleImageFile(processed);
      }
    }
  } catch(e) {
    console.warn('fallbackToJpeg failed', e);
  }
}

// Patch handleImageFile with explicit A/B decision
(function patchHandler(){
  // Wait for original to exist
  function doPatch() {
    var original = window.handleImageFile;
    if (!original && typeof handleImageFile !== 'function') {
      setTimeout(doPatch, 200);
      return;
    }
    var origFn = original || handleImageFile;
    window._originalHandleImageFile = origFn;

    var newHandler = async function(file) {
      if (!file) return;
      if (isRawFile(file)) {
        console.log('[LumiGold] RAW detected, diagnostic Float32 path', file.name);
        var res = await decodeRawWithLibRaw(file);
        if (res === null) return; // async handled by worker
        return res;
      }
      return window._originalHandleImageFile(file);
    };

    window.handleImageFile = newHandler;
    // Also try to overwrite global declaration if it exists
    try { handleImageFile = newHandler; } catch(e){}
    console.log('[RAW DIAG] handleImageFile patched - decision point active');
  }
  doPatch();
})();
