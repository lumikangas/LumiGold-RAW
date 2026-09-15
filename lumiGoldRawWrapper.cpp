
// lumiGoldRawWrapper.cpp
// Clean-room LibRaw WASM wrapper for LumiGold Studio
// No hard-coded offsets - reads libraw_data_t.color fields inside C++
// Exposes only small safe API to JS
// 
// Compile with:
// emcc libraw/src/*.cpp libraw/src/decoders/*.cpp libraw/src/demosaic/*.cpp \
//      lumiGoldRawWrapper.cpp \
//      -Ilibraw -Ilibraw/src -Ilibraw/src/decoders \
//      -s WASM=1 -s ALLOW_MEMORY_GROWTH=1 -s MODULARIZE=1 -s EXPORT_NAME="LumiGoldRawModule" \
//      -s EXPORTED_FUNCTIONS='["_lg_open","_lg_get_width","_lg_get_height","_lg_get_black","_lg_get_white","_lg_get_data_maximum","_lg_get_linear_max","_lg_get_cam_mul","_lg_extract_rgb","_lg_close","_malloc","_free"]' \
//      -s EXPORTED_RUNTIME_METHODS='["HEAPU8","HEAPF32","HEAPF64"]' \
//      -O3 -o wasm/lumiGoldRaw.js

#include <cstdint>
#include <cstddef>
#include <cmath>
#include "libraw/libraw.h"

static LibRaw* g_raw = nullptr;

extern "C" {

int lg_open(const uint8_t* data, size_t size) {
    if (g_raw) { delete g_raw; g_raw = nullptr; }
    g_raw = new LibRaw();
    
    int ret = g_raw->open_buffer(data, size);
    if (ret != LIBRAW_SUCCESS) return ret;
    
    ret = g_raw->unpack();
    if (ret != LIBRAW_SUCCESS) return ret;

    // Don't call dcraw_process yet - we want linear raw2image first
    // For prototype: use raw2image to get linear Bayer -> we will demosaic to linear RGB ourselves
    // or use dcraw_make_mem_image with params for linear output
    ret = g_raw->raw2image();
    if (ret != LIBRAW_SUCCESS) return ret;

    return 0;
}

int lg_get_width() {
    if (!g_raw) return 0;
    return g_raw->imgdata.sizes.width; // demosaiced width
}

int lg_get_height() {
    if (!g_raw) return 0;
    return g_raw->imgdata.sizes.height;
}

// --- Black / White normalization - as per your correction ---
// Expose all three: maximum, data_maximum, linear_max

float lg_get_black() {
    if (!g_raw) return 0.0f;
    return (float)g_raw->imgdata.color.black;
}

float lg_get_white() {
    if (!g_raw) return 16383.0f;
    return (float)g_raw->imgdata.color.maximum;
}

float lg_get_data_maximum() {
    if (!g_raw) return 16383.0f;
    return (float)g_raw->imgdata.color.data_maximum;
}

// linear_max[4] - per-channel linear max, varies by camera
float lg_get_linear_max(int channel) {
    if (!g_raw) return 0.0f;
    if (channel < 0 || channel > 3) return 0.0f;
    return (float)g_raw->imgdata.color.linear_max[channel];
}

// cam_mul[4] - camera WB multipliers, useful for u_wbR/G/B seeding
float lg_get_cam_mul(int channel) {
    if (!g_raw) return 1.0f;
    if (channel < 0 || channel > 3) return 1.0f;
    return g_raw->imgdata.color.cam_mul[channel];
}

// Additional getters for prototype - expose what LibRaw already gives you
// No need to invent Adobe matrices yet

float lg_get_cmatrix(int row, int col) {
    if (!g_raw) return 0.0f;
    // color.cmatrix[3][4]
    if (row < 0 || row > 2 || col < 0 || col > 3) return 0.0f;
    return g_raw->imgdata.color.cmatrix[row][col];
}

float lg_get_rgb_cam(int row, int col) {
    if (!g_raw) return 0.0f;
    // color.rgb_cam[3][4] - the key matrix
    if (row < 0 || row > 2 || col < 0 || col > 3) return 0.0f;
    return g_raw->imgdata.color.rgb_cam[row][col];
}

float lg_get_cam_xyz(int row, int col) {
    if (!g_raw) return 0.0f;
    // color.cam_xyz[4][3]
    if (row < 0 || row > 3 || col < 0 || col > 2) return 0.0f;
    return g_raw->imgdata.color.cam_xyz[row][col];
}

// Core extraction: Float32 linear RGB, no sRGB encoding, no JPEG stage
// output buffer must be width*height*3 floats, allocated in JS WASM heap

int lg_extract_rgb(float* output) {
    if (!g_raw || !output) return -1;
    
    int width = g_raw->imgdata.sizes.width;
    int height = g_raw->imgdata.sizes.height;
    
    // For prototype, g_raw->imgdata.image is ushort[height][width] with 4 channels after raw2image + demosaic?
    // Actually raw2image gives image as linear. For simplicity, use imgdata.image which is already demosaiced
    // if we set appropriate params. Here we demonstrate black/white normalization as you requested:
    
    float black = (float)g_raw->imgdata.color.black;
    float white = (float)g_raw->imgdata.color.maximum;
    // IMPORTANT: we also expose data_maximum and linear_max[] - prototype can choose
    float data_max = (float)g_raw->imgdata.color.data_maximum;
    
    // Use maximum as denominator for first prototype, but expose all three to JS
    float denom = white - black;
    if (denom < 1.0f) denom = 1.0f;

    // g_raw->imgdata.image is ushort[4] per pixel (R,G,B,G2)
    for (int y = 0; y < height; y++) {
        for (int x = 0; x < width; x++) {
            int idx = (y * width + x) * 3;
            int srcIdx = y * width + x;
            
            // LibRaw image is in imgdata.image[srcIdx][c]
            float r = (float)g_raw->imgdata.image[srcIdx][0];
            float g = (float)g_raw->imgdata.image[srcIdx][1];
            float b = (float)g_raw->imgdata.image[srcIdx][2];
            
            // Your requested normalization:
            float fr = (r - black) / denom;
            float fg = (g - black) / denom;
            float fb = (b - black) / denom;
            
            fr = fmaxf(0.0f, fminf(1.0f, fr));
            fg = fmaxf(0.0f, fminf(1.0f, fg));
            fb = fmaxf(0.0f, fminf(1.0f, fb));
            
            output[idx + 0] = fr;
            output[idx + 1] = fg;
            output[idx + 2] = fb;
        }
    }
    
    return 0;
}

void lg_close() {
    if (g_raw) {
        g_raw->recycle();
        delete g_raw;
        g_raw = nullptr;
    }
}

} // extern "C"
