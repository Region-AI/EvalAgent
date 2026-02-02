import path from "path";
import fs from "fs";
import { getWindows, Window } from "@nut-tree-fork/nut-js";

/**
 * Sleep helper
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Load the native addon
const addonPath = path.resolve(
  __dirname,
  "../src/agent/capture/native/build/Release/native_capture.node"
);
const addon = require(addonPath);

/**
 * Finds the most likely main window for a given app title.
 * Prefers visible, large windows and retries until valid.
 */
async function findBestWindowHandle(
  title: string,
  maxRetries = 10,
  delayMs = 1000
): Promise<{ hwnd: number | bigint; window: Window; title: string }> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const windows = await getWindows();
    const candidates: { w: Window; handle: any; region: any; title: string }[] =
      [];

    for (const w of windows) {
      const t = await w.title;
      if (!t || !t.toLowerCase().includes(title.toLowerCase())) continue;

      try {
        const region = await w.getRegion();
        const handle = (w as any).handle ?? (w as any).windowHandle;
        if (
          region.width > 100 &&
          region.height > 100 &&
          (typeof handle === "number" || typeof handle === "bigint")
        ) {
          candidates.push({ w, handle, region, title: t });
        }
      } catch {
        // skip invalid
      }
    }

    if (candidates.length > 0) {
      // Prefer exact title first, else largest window
      let chosen = candidates.find((c) => c.title === title);
      if (!chosen) {
        candidates.sort(
          (a, b) =>
            b.region.width * b.region.height - a.region.width * a.region.height
        );
        chosen = candidates[0];
      }

      console.log(
        `[DEBUG] Selected "${chosen.title}" (${chosen.region.width}x${chosen.region.height}) hwnd=${chosen.handle}`
      );
      return { hwnd: chosen.handle, window: chosen.w, title: chosen.title };
    }

    lastError = new Error(
      `No visible windows yet (attempt ${attempt}/${maxRetries})`
    );
    console.log(`[WAIT] Retrying... (${attempt}/${maxRetries})`);
    await sleep(delayMs);
  }

  throw lastError ?? new Error(`No window found with title "${title}"`);
}

/**
 * Tests capturing a window by title, verifying non-black capture.
 */
async function main() {
  const windowTitle = "WeChat";
  const outputPath = path.join(__dirname, `capture.png`);

  console.log(`[INFO] Searching for window titled "${windowTitle}"...`);
  const { hwnd, window, title } = await findBestWindowHandle(
    windowTitle,
    15,
    1000
  );
  console.log(`[INFO] Found handle ${hwnd} for "${title}"`);

  console.log(`[INFO] Capturing via native addon...`);
  const result = await addon.captureWindow(hwnd);

  if (!result || !result.buffer) {
    console.error("[ERROR] Native capture returned empty buffer.");
    return;
  }

  fs.writeFileSync(outputPath, result.buffer);
  console.log(
    `[SUCCESS] Saved window capture (${result.width}x${result.height}) -> ${outputPath}`
  );

  // Optional: quick pixel sanity check to detect all-black images
  const jimp = await import("jimp");
  const img = await jimp.default.read(outputPath);
  const sample = img.clone().resize(20, 20); // shrink for quick average
  let avg = 0;
  for (let y = 0; y < 20; y++) {
    for (let x = 0; x < 20; x++) {
      const { r, g, b } = jimp.default.intToRGBA(sample.getPixelColor(x, y));
      avg += (r + g + b) / 3;
    }
  }
  avg /= 400;
  if (avg < 5) {
    console.warn(
      "[WARN] Image appears nearly black — likely a splash or minimized window."
    );
  } else {
    console.log(
      `[OK] Capture brightness average = ${avg.toFixed(
        2
      )} — capture looks valid.`
    );
  }
}

main().catch((err) => console.error("[FATAL]", err));
