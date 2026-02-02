import { app } from "electron";
import * as path from "path";
import * as fs from "fs";

// Resolve path for native addon in all environments

function resolveNativePath(): string {
  //
  // DEV MODE:
  // __dirname = dist/agent/capture/native
  //
  const devCandidate = path.resolve(
    __dirname,
    "build",
    "Release",
    "native_capture.node"
  );
  if (fs.existsSync(devCandidate)) {
    return devCandidate;
  }

  //
  // PACKAGED MODE: ASAR unpack
  // .node files CANNOT live inside app.asar
  // Electron extracts them into:
  //   app.asar.unpacked/<same relative tree>
  //
  const unpackedCandidate = path.resolve(
    app.getAppPath(), // points to ...\app.asar in prod
    "..", // go to app.asar parent
    "app.asar.unpacked",
    "dist",
    "agent",
    "capture",
    "native",
    "build",
    "Release",
    "native_capture.node"
  );
  if (fs.existsSync(unpackedCandidate)) {
    return unpackedCandidate;
  }

  //
  // PACKAGED MODE: custom resources folder (recommended)
  // Some packagers place native addons under:
  //   resources/native/native_capture.node
  //
  const resourcesCandidate = path.resolve(
    process.resourcesPath,
    "native",
    "native_capture.node"
  );
  if (fs.existsSync(resourcesCandidate)) {
    return resourcesCandidate;
  }

  //
  // FALLBACK: direct load via process.cwd()
  //
  const cwdCandidate = path.resolve(process.cwd(), "native_capture.node");
  if (fs.existsSync(cwdCandidate)) {
    return cwdCandidate;
  }

  //
  // NOTHING FOUND → CRASH with diagnostic info
  //
  throw new Error(
    [
      "Unable to locate native_capture.node.",
      "Paths tried:",
      `  DEV:       ${devCandidate}`,
      `  UNPACKED:  ${unpackedCandidate}`,
      `  RESOURCES: ${resourcesCandidate}`,
      `  CWD:       ${cwdCandidate}`,
      "",
      "Ensure native binary is copied to dist and included in Electron Forge packaging.",
    ].join("\n")
  );
}

// Try loading the module

const nativeAddonPath = resolveNativePath();
let addon: any = null;

try {
  addon = require(nativeAddonPath);
  console.log(`[NativeCapture] Loaded addon from: ${nativeAddonPath}`);
} catch (err) {
  console.error(
    `[NativeCapture] Failed to load addon from: ${nativeAddonPath}`,
    err
  );
  throw err;
}

// Typed wrapper API for TypeScript consumers

export const NativeCapture = {
  /**
   * Returns true if OS & hardware support native exclusion from capture
   */
  isExcludeSupported(): boolean {
    return !!addon?.isExcludeSupported?.();
  },

  /**
   * Mark/unmark a window as excluded from screen capture
   */
  setExcludedFromCapture(
    hwnd: number | bigint,
    enable: boolean
  ): { ok: boolean; error: number } {
    return addon.setExcludedFromCapture(hwnd as any, !!enable);
  },

  /**
   * Enumerate available monitors
   */
  getMonitors(): Array<{
    index: number;
    name: string;
    originX: number;
    originY: number;
    width: number;
    height: number;
  }> {
    return addon.getMonitors();
  },

  /**
   * Capture pixel buffer from selected monitor
   */
  captureMonitorByIndex(index: number): {
    buffer: Buffer;
    width: number;
    height: number;
    originX: number;
    originY: number;
  } | null {
    return addon.captureMonitorByIndex(index);
  },
};
