
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <libraw/libraw.h>

struct LumiHandle {
  LibRaw* raw;
  uint8_t* fileData; // keep original buffer alive
  size_t fileSize;
  int width;
  int height;
  float* rgbFloat; // allocated linear RGB
};

// Global last error for debugging
static int g_last_error = 0;
static char g_last_msg[256] = {0};

extern "C" {

// Open buffer - returns handle id (pointer as int) or 0 on failure
int lg_open(uint8_t* data, int size) {
  if(!data || size <= 0) return 0;
  LibRaw* lr = new LibRaw();
  // Important: LibRaw needs to copy or keep buffer, open_buffer does not take ownership
  int ret = lr->open_buffer(data, size);
  if(ret != LIBRAW_SUCCESS) {
    g_last_error = ret;
    snprintf(g_last_msg, sizeof(g_last_msg), "open_buffer failed %d", ret);
    delete lr;
    return 0;
  }
  // Unpack to check if valid RAW (optional but validates)
  // We don't unpack full image here, just check metadata
  ret = lr->unpack();
  if(ret != LIBRAW_SUCCESS) {
    g_last_error = ret;
    snprintf(g_last_msg, sizeof(g_last_msg), "unpack failed %d", ret);
    lr->recycle();
    delete lr;
    return 0;
  }
  
  LumiHandle* h = new LumiHandle();
  h->raw = lr;
  h->fileData = nullptr; // we don't own the JS buffer
  h->fileSize = size;
  h->width = lr->imgdata.sizes.iwidth;
  h->height = lr->imgdata.sizes.iheight;
  h->rgbFloat = nullptr;
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
  if(!h->raw) return 0;
  // Use maximum, but also check linear_max if available
  return (float)h->raw->imgdata.color.maximum;
}
float* lg_get_cam_mul(int handle) {
  if(!handle) return nullptr;
  LumiHandle* h = (LumiHandle*)(uintptr_t)handle;
  if(!h->raw) return nullptr;
  return h->raw->imgdata.color.cam_mul;
}
float* lg_get_cmatrix(int handle) {
  if(!handle) return nullptr;
  LumiHandle* h = (LumiHandle*)(uintptr_t)handle;
  if(!h->raw) return nullptr;
  // cmatrix is [3][4]
  return &h->raw->imgdata.color.cmatrix[0][0];
}
float* lg_get_rgb_cam(int handle) {
  if(!handle) return nullptr;
  LumiHandle* h = (LumiHandle*)(uintptr_t)handle;
  if(!h->raw) return nullptr;
  return &h->raw->imgdata.color.rgb_cam[0][0];
}
float* lg_get_cam_xyz(int handle) {
  if(!handle) return nullptr;
  LumiHandle* h = (LumiHandle*)(uintptr_t)handle;
  if(!h->raw) return nullptr;
  return &h->raw->imgdata.color.cam_xyz[0][0];
}

float* lg_extract_rgb(int handle) {
  if(!handle) return nullptr;
  LumiHandle* h = (LumiHandle*)(uintptr_t)handle;
  LibRaw* lr = h->raw;
  if(!lr) return nullptr;
  
  // Already unpacked in lg_open, now dcraw_process + make_mem_image
  // Use half-size? No, full linear
  lr->imgdata.params.use_camera_wb = 1;
  lr->imgdata.params.use_auto_wb = 0;
  lr->imgdata.params.no_auto_bright = 1;
  lr->imgdata.params.output_bps = 16;
  lr->imgdata.params.gamm[0] = 1.0;
  lr->imgdata.params.gamm[1] = 1.0;
  
  int ret = lr->dcraw_process();
  if(ret != LIBRAW_SUCCESS) {
    g_last_error = ret;
    return nullptr;
  }
  
  libraw_processed_image_t* img = lr->dcraw_make_mem_image(&ret);
  if(!img || ret != LIBRAW_SUCCESS) {
    g_last_error = ret;
    return nullptr;
  }
  
  int w = img->width;
  int hh = img->height;
  int colors = img->colors;
  int bps = img->bits;
  
  // Allocate float buffer
  size_t num = (size_t)w * hh * 3;
  if(h->rgbFloat) free(h->rgbFloat);
  h->rgbFloat = (float*)malloc(num * sizeof(float));
  
  if(bps == 16) {
    uint16_t* src = (uint16_t*)img->data;
    for(size_t i=0;i<num;i++) {
      h->rgbFloat[i] = src[i] / 65535.0f;
    }
  } else {
    uint8_t* src = img->data;
    for(size_t i=0;i<num;i++) {
      h->rgbFloat[i] = src[i] / 255.0f;
    }
  }
  
  libraw_dcraw_clear_mem(img);
  return h->rgbFloat;
}

void lg_close(int handle) {
  if(!handle) return;
  LumiHandle* h = (LumiHandle*)(uintptr_t)handle;
  if(h->rgbFloat) free(h->rgbFloat);
  if(h->raw) { h->raw->recycle(); delete h->raw; }
  delete h;
}

int lg_get_last_error() { return g_last_error; }

}
