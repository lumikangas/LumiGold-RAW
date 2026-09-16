#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <libraw/libraw.h>

struct LumiHandle {
  LibRaw* raw;
  int width;
  int height;
};

static int g_last_error = 0;

extern "C" {

// Open buffer - returns handle id (pointer as int) or 0 on failure
int lg_open(uint8_t* data, int size) {
  if(!data || size <= 0) return 0;
  LibRaw* lr = new LibRaw();
  int ret = lr->open_buffer(data, size);
  if(ret != LIBRAW_SUCCESS) {
    g_last_error = ret;
    delete lr;
    return 0;
  }
  ret = lr->unpack();
  if(ret != LIBRAW_SUCCESS) {
    g_last_error = ret;
    lr->recycle();
    delete lr;
    return 0;
  }
  LumiHandle* h = new LumiHandle();
  h->raw = lr;
  h->width = lr->imgdata.sizes.iwidth;
  h->height = lr->imgdata.sizes.iheight;
  g_last_error = 0;
  return (int)(uintptr_t)h;
}

int lg_get_width(int handle) {
  if(!handle) return 0;
  LumiHandle* h = (LumiHandle*)(uintptr_t)handle;
  return h->raw ? h->raw->imgdata.sizes.iwidth : 0;
}
int lg_get_height(int handle) {
  if(!handle) return 0;
  LumiHandle* h = (LumiHandle*)(uintptr_t)handle;
  return h->raw ? h->raw->imgdata.sizes.iheight : 0;
}
int lg_get_black(int handle) {
  if(!handle) return 0;
  LumiHandle* h = (LumiHandle*)(uintptr_t)handle;
  return h->raw ? h->raw->imgdata.color.black : 0;
}
int lg_get_white(int handle) {
  if(!handle) return 0;
  LumiHandle* h = (LumiHandle*)(uintptr_t)handle;
  return h->raw ? h->raw->imgdata.color.maximum : 0;
}
int lg_get_data_maximum(int handle) {
  if(!handle) return 0;
  LumiHandle* h = (LumiHandle*)(uintptr_t)handle;
  return h->raw ? h->raw->imgdata.color.data_maximum : 0;
}
float lg_get_linear_max(int handle) {
  if(!handle) return 0;
  LumiHandle* h = (LumiHandle*)(uintptr_t)handle;
  return h->raw ? (float)h->raw->imgdata.color.maximum : 0;
}
float* lg_get_cam_mul(int handle) {
  if(!handle) return nullptr;
  LumiHandle* h = (LumiHandle*)(uintptr_t)handle;
  return h->raw ? h->raw->imgdata.color.cam_mul : nullptr;
}

// NEW: output buffer allocated in JS, not inside wrapper
// Returns 0 on success, non-zero on failure
// output must be width*height*3 floats allocated via _malloc
int lg_extract_rgb(int handle, float* output) {
  if(!handle || !output) return -1;
  LumiHandle* h = (LumiHandle*)(uintptr_t)handle;
  LibRaw* lr = h->raw;
  if(!lr) return -2;

  lr->imgdata.params.use_camera_wb = 1;
  lr->imgdata.params.use_auto_wb = 0;
  lr->imgdata.params.no_auto_bright = 1;
  lr->imgdata.params.output_bps = 16;
  lr->imgdata.params.gamm[0] = 1.0;
  lr->imgdata.params.gamm[1] = 1.0;

  int ret = lr->dcraw_process();
  if(ret != LIBRAW_SUCCESS) {
    g_last_error = ret;
    return ret;
  }

  libraw_processed_image_t* img = lr->dcraw_make_mem_image(&ret);
  if(!img || ret != LIBRAW_SUCCESS) {
    g_last_error = ret;
    return ret ? ret : -3;
  }

  int w = img->width;
  int hh = img->height;
  size_t num = (size_t)w * hh * 3;

  // Directly write into JS-allocated buffer, no extra malloc
  if(img->bits == 16) {
    uint16_t* src = (uint16_t*)img->data;
    for(size_t i=0;i<num;i++) {
      output[i] = src[i] / 65535.0f;
    }
  } else {
    uint8_t* src = img->data;
    for(size_t i=0;i<num;i++) {
      output[i] = src[i] / 255.0f;
    }
  }

  libraw_dcraw_clear_mem(img);
  return 0; // success
}

void lg_close(int handle) {
  if(!handle) return;
  LumiHandle* h = (LumiHandle*)(uintptr_t)handle;
  if(h->raw) { h->raw->recycle(); delete h->raw; }
  delete h;
}

int lg_get_last_error() { return g_last_error; }

} // extern C
