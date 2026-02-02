#include "exclude.h"
#include <windows.h>
#include <winternl.h>   // For RTL_OSVERSIONINFOW
#include <cstdio>

// Some older SDKs may not define these:
#ifndef WDA_NONE
#define WDA_NONE 0x00000000
#endif
#ifndef WDA_MONITOR
#define WDA_MONITOR 0x00000001
#endif
#ifndef WDA_EXCLUDEFROMCAPTURE
#define WDA_EXCLUDEFROMCAPTURE 0x00000011
#endif

// Minimal declaration to avoid import library dependency
typedef LONG (WINAPI *RtlGetVersion_t)(PRTL_OSVERSIONINFOW);

// Return true if OS build >= 19041 (Windows 10, version 2004) — where WDA_EXCLUDEFROMCAPTURE is supported.
static bool IsBuildAtLeast19041() {
  HMODULE ntdll = ::GetModuleHandleW(L"ntdll.dll");
  if (!ntdll) return false;

  auto pRtlGetVersion = reinterpret_cast<RtlGetVersion_t>(::GetProcAddress(ntdll, "RtlGetVersion"));
  if (!pRtlGetVersion) {
    // Fallback: GetVersionEx is deprecated and can be affected by manifest; better return true on Win11/10 modern
    OSVERSIONINFOW osvi = {};
    osvi.dwOSVersionInfoSize = sizeof(osvi);
    if (::GetVersionExW(&osvi)) {
      // Heuristic: if major > 10 we are fine; if == 10, assume recent
      if (osvi.dwMajorVersion > 10) return true;
      if (osvi.dwMajorVersion == 10) {
        // When manifest is missing, GetVersionExW might report build < 19041 incorrectly.
        // Prefer conservative 'true' on Win10 to avoid false negatives.
        return true;
      }
    }
    return false;
  }

  RTL_OSVERSIONINFOW ver = {};
  ver.dwOSVersionInfoSize = sizeof(ver);
  if (pRtlGetVersion(&ver) != 0) {
    return false;
  }

  // Windows 11 reports dwMajorVersion=10, dwMinorVersion=0, with larger build numbers.
  // Official support begins at build 19041 (Win10 2004).
  return (ver.dwMajorVersion > 10) ||
         (ver.dwMajorVersion == 10 && ver.dwBuildNumber >= 19041);
}

bool IsWdaExcludeSupported() {
  // Use manifest-independent detection so Node/Electron apps don't get version-lied to.
  return IsBuildAtLeast19041();
}

bool SetExcludedFromCapture(HWND hwnd, bool enable, DWORD* lastError) {
  if (lastError) *lastError = 0;

  if (!::IsWindow(hwnd)) {
    if (lastError) *lastError = ERROR_INVALID_WINDOW_HANDLE;
    return false;
  }

  // NOTE: DWM composition must be enabled for SetWindowDisplayAffinity to work.
  // On modern Win10/11 that’s essentially always on, but we leave this as an FYI.

  UINT affinity = enable ? WDA_EXCLUDEFROMCAPTURE : WDA_NONE;

  ::SetLastError(0);
  BOOL ok = ::SetWindowDisplayAffinity(hwnd, affinity);
  if (!ok) {
    if (lastError) *lastError = ::GetLastError();
    return false;
  }

  return true;
}
