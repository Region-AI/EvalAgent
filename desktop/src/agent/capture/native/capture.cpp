#include "capture.h"
#include <windows.h>
#include <vector>
#include <string>

struct EnumData {
  int idx = 0;
  std::vector<MonitorInfo>* list = nullptr;
};

static BOOL CALLBACK EnumMonProc(HMONITOR hMon, HDC, LPRECT, LPARAM lParam) {
  MONITORINFOEXA mi;
  mi.cbSize = sizeof(mi);
  if (!GetMonitorInfoA(hMon, &mi)) return TRUE;

  EnumData* data = reinterpret_cast<EnumData*>(lParam);
  MonitorInfo info;
  info.index = data->idx++;
  info.name = mi.szDevice;
  info.x = mi.rcMonitor.left;
  info.y = mi.rcMonitor.top;
  info.width = mi.rcMonitor.right - mi.rcMonitor.left;
  info.height = mi.rcMonitor.bottom - mi.rcMonitor.top;
  data->list->push_back(info);
  return TRUE;
}

bool ListMonitors(std::vector<MonitorInfo>& out) {
  EnumData data;
  data.list = &out;
  return EnumDisplayMonitors(NULL, NULL, EnumMonProc, reinterpret_cast<LPARAM>(&data)) != 0;
}

static bool CaptureRectBGRA(const RECT& rc, std::vector<unsigned char>& outBGRA, int& width, int& height) {
  width = rc.right - rc.left;
  height = rc.bottom - rc.top;
  if (width <= 0 || height <= 0) return false;

  HDC hScreen = GetDC(NULL);
  if (!hScreen) return false;

  HDC hMem = CreateCompatibleDC(hScreen);
  if (!hMem) { ReleaseDC(NULL, hScreen); return false; }

  BITMAPINFO bi{};
  bi.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
  bi.bmiHeader.biWidth = width;
  bi.bmiHeader.biHeight = -height; // top-down
  bi.bmiHeader.biPlanes = 1;
  bi.bmiHeader.biBitCount = 32;
  bi.bmiHeader.biCompression = BI_RGB;

  void* pBits = nullptr;
  HBITMAP hDib = CreateDIBSection(hScreen, &bi, DIB_RGB_COLORS, &pBits, NULL, 0);
  if (!hDib || !pBits) {
    if (hDib) DeleteObject(hDib);
    DeleteDC(hMem);
    ReleaseDC(NULL, hScreen);
    return false;
  }

  HGDIOBJ old = SelectObject(hMem, hDib);
  BOOL ok = BitBlt(hMem, 0, 0, width, height, hScreen, rc.left, rc.top, SRCCOPY | CAPTUREBLT);

  bool success = false;
  if (ok) {
    // pBits is BGRA (well, BGRX). We’ll normalize to BGRA with A=255.
    size_t num = static_cast<size_t>(width) * static_cast<size_t>(height);
    outBGRA.resize(num * 4);
    unsigned char* src = reinterpret_cast<unsigned char*>(pBits);
    for (size_t i = 0; i < num; ++i) {
      unsigned char B = src[i*4 + 0];
      unsigned char G = src[i*4 + 1];
      unsigned char R = src[i*4 + 2];
      outBGRA[i*4 + 0] = B;
      outBGRA[i*4 + 1] = G;
      outBGRA[i*4 + 2] = R;
      outBGRA[i*4 + 3] = 255;
    }
    success = true;
  }

  SelectObject(hMem, old);
  DeleteObject(hDib);
  DeleteDC(hMem);
  ReleaseDC(NULL, hScreen);
  return success;
}

bool CaptureMonitorByIndexBGRA(int index, std::vector<unsigned char>& outBGRA,
                               int& width, int& height, int& originX, int& originY) {
  std::vector<MonitorInfo> mons;
  if (!ListMonitors(mons) || mons.empty()) return false;
  if (index < 0 || index >= (int)mons.size()) index = 0;
  const MonitorInfo& m = mons[index];
  originX = m.x; originY = m.y;

  RECT rc{ m.x, m.y, m.x + m.width, m.y + m.height };
  return CaptureRectBGRA(rc, outBGRA, width, height);
}
