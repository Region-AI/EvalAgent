#pragma once
#include <windows.h>
#include <vector>
#include <string>

struct MonitorInfo {
  int index;
  std::string name;
  int x, y, width, height;
};

bool ListMonitors(std::vector<MonitorInfo>& out);
bool CaptureMonitorByIndexBGRA(int index, std::vector<unsigned char>& outBGRA,
                               int& width, int& height, int& originX, int& originY);
