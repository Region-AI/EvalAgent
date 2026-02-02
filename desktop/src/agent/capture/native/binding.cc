#include <napi.h>
#include "exclude.h"
#include "capture.h"

static Napi::Value jsIsExcludeSupported(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  return Napi::Boolean::New(env, IsWdaExcludeSupported());
}

static Napi::Value jsSetExcludedFromCapture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || (!info[0].IsNumber() && !info[0].IsBigInt()) || !info[1].IsBoolean()) {
    Napi::TypeError::New(env, "Expected (hwnd:number|bigint, enable:boolean)").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  bool lossless = false;
  uint64_t hwnd64 = info[0].IsBigInt()
    ? info[0].As<Napi::BigInt>().Uint64Value(&lossless)
    : static_cast<uint64_t>(info[0].As<Napi::Number>().Int64Value());

  HWND hwnd = (HWND)(uintptr_t)hwnd64;
  bool enable = info[1].As<Napi::Boolean>().Value();

  DWORD lastError = 0;
  bool ok = SetExcludedFromCapture(hwnd, enable, &lastError);
  Napi::Object res = Napi::Object::New(env);
  res.Set("ok", Napi::Boolean::New(env, ok));
  res.Set("error", Napi::Number::New(env, (double)lastError));
  return res;
}

static Napi::Value jsGetMonitors(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::vector<MonitorInfo> mons;
  if (!ListMonitors(mons)) return env.Null();

  Napi::Array arr = Napi::Array::New(env, mons.size());
  for (size_t i = 0; i < mons.size(); ++i) {
    Napi::Object o = Napi::Object::New(env);
    o.Set("index", Napi::Number::New(env, mons[i].index));
    o.Set("name", Napi::String::New(env, mons[i].name));
    o.Set("originX", Napi::Number::New(env, mons[i].x));
    o.Set("originY", Napi::Number::New(env, mons[i].y));
    o.Set("width", Napi::Number::New(env, mons[i].width));
    o.Set("height", Napi::Number::New(env, mons[i].height));
    arr.Set((uint32_t)i, o);
  }
  return arr;
}

static Napi::Value jsCaptureMonitorByIndex(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  int idx = 0;
  if (info.Length() >= 1 && info[0].IsNumber()) idx = info[0].As<Napi::Number>().Int32Value();

  std::vector<unsigned char> bgra;
  int w=0,h=0,ox=0,oy=0;
  if (!CaptureMonitorByIndexBGRA(idx, bgra, w, h, ox, oy)) return env.Null();

  Napi::Object ret = Napi::Object::New(env);
  Napi::Buffer<unsigned char> buf = Napi::Buffer<unsigned char>::Copy(env, bgra.data(), bgra.size());
  ret.Set("buffer", buf);
  ret.Set("width", Napi::Number::New(env, w));
  ret.Set("height", Napi::Number::New(env, h));
  ret.Set("originX", Napi::Number::New(env, ox));
  ret.Set("originY", Napi::Number::New(env, oy));
  return ret;
}

static Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("isExcludeSupported", Napi::Function::New(env, jsIsExcludeSupported));
  exports.Set("setExcludedFromCapture", Napi::Function::New(env, jsSetExcludedFromCapture));
  exports.Set("getMonitors", Napi::Function::New(env, jsGetMonitors));
  exports.Set("captureMonitorByIndex", Napi::Function::New(env, jsCaptureMonitorByIndex));
  return exports;
}

NODE_API_MODULE(native_capture, Init)
