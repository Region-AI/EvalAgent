#pragma once
#include <windows.h>

bool SetExcludedFromCapture(HWND hwnd, bool enable, DWORD* lastError);
bool IsWdaExcludeSupported();
