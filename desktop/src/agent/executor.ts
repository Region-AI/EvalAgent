import { keyboard, mouse, Point, Button, Key } from "@nut-tree-fork/nut-js";
import { clipboard, NativeImage } from "electron";
import jimp from "jimp";
import { Logger } from "../core/logger";
import { NativeCapture } from "./capture/native";

const { MIME_PNG } = jimp;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const CLICK_DELAY_MS = 120;

// Build a case-insensitive lookup for nut-js keys, plus common aliases.
const KEY_MAP: Map<string, Key> = (() => {
  const map = new Map<string, Key>();

  const slug = (name: string) => name.toLowerCase().replace(/[\s_-]+/g, "");

  Object.keys(Key).forEach((name) => {
    const value = (Key as any)[name];
    if (value != null) {
      map.set(slug(name), value);
    }
  });

  // Common aliases
  map.set("ctrl", Key.LeftControl);
  map.set("control", Key.LeftControl);
  map.set("cmd", Key.LeftSuper);
  map.set("command", Key.LeftSuper);
  map.set("meta", Key.LeftSuper);
  map.set("win", Key.LeftSuper);
  map.set("windows", Key.LeftSuper);
  map.set("alt", Key.LeftAlt);
  map.set("option", Key.LeftAlt);
  map.set("opt", Key.LeftAlt);
  map.set("enter", Key.Enter);
  map.set("return", Key.Enter);
  map.set("esc", Key.Escape);
  map.set("escape", Key.Escape);
  map.set("space", Key.Space);
  map.set("spacebar", Key.Space);
  map.set("del", Key.Delete);
  map.set("delete", Key.Delete);
  map.set("backspace", Key.Backspace);
  map.set("tab", Key.Tab);
  map.set("shift", Key.LeftShift);
  map.set("altgr", Key.RightAlt);
  map.set("pgup", Key.PageUp);
  map.set("pageup", Key.PageUp);
  map.set("pgdn", Key.PageDown);
  map.set("pagedown", Key.PageDown);
  map.set("home", Key.Home);
  map.set("end", Key.End);
  map.set("up", Key.Up);
  map.set("down", Key.Down);
  map.set("left", Key.Left);
  map.set("right", Key.Right);

  return map;
})();

const resolveKey = (token: string): Key | undefined => {
  const cleaned = (token || "").toString().trim();
  if (!cleaned) return undefined;
  const normalized = cleaned.toLowerCase().replace(/[\s+_-]+/g, "");
  return KEY_MAP.get(normalized);
};

export type ToolName =
  | "single_click"
  | "double_click"
  | "right_click"
  | "hover"
  | "drag"
  | "simulate_text_entry"
  | "direct_text_entry"
  | "keyboard_shortcut"
  | "scroll"
  | "wait"
  | "finish_task";

export interface ToolLifecycleEvent {
  tool: ToolName;
  phase: "start" | "end";
}

export class Executor {
  constructor(
    private readonly logger: Logger,
    private readonly onToolLifecycle?: (event: ToolLifecycleEvent) => void
  ) {}

  private notifyToolLifecycle(tool: ToolName, phase: "start" | "end") {
    try {
      this.onToolLifecycle?.({ tool, phase });
    } catch (err) {
      this.logger.warn(`Tool lifecycle hook failed: ${err}`);
    }
  }

  private async withLifecycle<T>(
    tool: ToolName,
    fn: () => Promise<T>
  ): Promise<T> {
    this.notifyToolLifecycle(tool, "start");
    try {
      return await fn();
    } finally {
      this.notifyToolLifecycle(tool, "end");
    }
  }

  /**
   * Capture a screenshot via the native addon and return PNG + metadata.
   * Vision analysis is handled by the backend; no local parser is bundled.
   */
  public async takeScreenSnapshot(): Promise<{
    png: Buffer;
    width: number;
    height: number;
    originX: number;
    originY: number;
  } | null> {
    this.logger.capture("Capturing screen via native addon...");

    try {
      const snap = NativeCapture.captureMonitorByIndex(0);
      if (!snap || !snap.buffer || snap.width <= 0 || snap.height <= 0) {
        this.logger.error("Native capture returned empty or invalid data.");
        return null;
      }

      const { buffer: bgra, width, height, originX, originY } = snap;
      const pixelCount = width * height;
      const rgba = Buffer.allocUnsafe(pixelCount * 4);

      // Convert BGRA -> RGBA
      for (let i = 0; i < pixelCount; i++) {
        const b = bgra[i * 4 + 0];
        const g = bgra[i * 4 + 1];
        const r = bgra[i * 4 + 2];
        const a = bgra[i * 4 + 3];
        rgba[i * 4 + 0] = r;
        rgba[i * 4 + 1] = g;
        rgba[i * 4 + 2] = b;
        rgba[i * 4 + 3] = a;
      }

      const img = await new jimp({ data: rgba, width, height });
      const png = await img.getBufferAsync(MIME_PNG);

      this.logger.capture(
        `Snapshot captured successfully (${width}x${height}).`
      );

      return { png, width, height, originX, originY };
    } catch (error) {
      this.logger.error(`Failed to take screen snapshot: ${error}`);
      return null;
    }
  }

  /** Single click at given coordinates. */
  public async singleClick({ x, y }: { x: number; y: number }): Promise<void> {
    return this.withLifecycle("single_click", async () => {
      this.logger.tool(`Executing single click at coordinates (${x}, ${y})`);
      try {
        await mouse.setPosition(new Point(x, y));
        await mouse.click(Button.LEFT);
        await sleep(CLICK_DELAY_MS);
      } catch (error) {
        this.logger.error(`Mouse click failed: ${error}`);
      }
    });
  }

  /** Double-click at given coordinates. */
  public async doubleClick({ x, y }: { x: number; y: number }): Promise<void> {
    return this.withLifecycle("double_click", async () => {
      this.logger.tool(`Executing double click at (${x}, ${y})`);
      try {
        await mouse.setPosition(new Point(x, y));
        await mouse.doubleClick(Button.LEFT);
        await sleep(CLICK_DELAY_MS);
      } catch (error) {
        this.logger.error(`Double click failed: ${error}`);
      }
    });
  }

  /** Right-click at given coordinates. */
  public async rightClick({ x, y }: { x: number; y: number }): Promise<void> {
    return this.withLifecycle("right_click", async () => {
      this.logger.tool(`Executing right click at (${x}, ${y})`);
      try {
        await mouse.setPosition(new Point(x, y));
        await mouse.click(Button.RIGHT);
        await sleep(CLICK_DELAY_MS);
      } catch (error) {
        this.logger.error(`Right click failed: ${error}`);
      }
    });
  }

  /** Move cursor to coordinates and pause briefly. */
  public async hover({ x, y }: { x: number; y: number }): Promise<void> {
    return this.withLifecycle("hover", async () => {
      this.logger.tool(`Executing hover at (${x}, ${y})`);
      try {
        await mouse.setPosition(new Point(x, y));
        await sleep(CLICK_DELAY_MS);
      } catch (error) {
        this.logger.error(`Hover failed: ${error}`);
      }
    });
  }

  /** Drag from a start point to an end point. */
  public async drag({
    from,
    to,
  }: {
    from: { x: number; y: number };
    to: { x: number; y: number };
  }): Promise<void> {
    return this.withLifecycle("drag", async () => {
      this.logger.tool(
        `Executing drag from (${from?.x}, ${from?.y}) to (${to?.x}, ${to?.y})`
      );
      if (!from || !to) {
        this.logger.error("Drag missing 'from' or 'to' coordinates.");
        return;
      }

      try {
        await mouse.setPosition(new Point(from.x, from.y));
        await mouse.pressButton(Button.LEFT);
        await mouse.move([new Point(to.x, to.y)]);
        await mouse.releaseButton(Button.LEFT);
        await sleep(CLICK_DELAY_MS);
      } catch (error) {
        this.logger.error(`Drag failed: ${error}`);
      }
    });
  }

  /** Simulate keystroke-by-keystroke text entry. */
  public async simulateTextEntry({
    text_to_type,
  }: {
    text_to_type: string;
  }): Promise<void> {
    return this.withLifecycle("simulate_text_entry", async () => {
      const preview =
        text_to_type.length > 15
          ? `${text_to_type.substring(0, 15)}...`
          : text_to_type;
      this.logger.tool(`Executing simulateTextEntry: "${preview}"`);
      try {
        await keyboard.type(text_to_type);
      } catch (error) {
        this.logger.error(`Keyboard type failed: ${error}`);
      }
    });
  }

  /**
   * Paste text directly via the system clipboard instead of key-by-key typing.
   * Falls back to the platform paste shortcut (Ctrl/Cmd + V).
   */
  public async directTextEntry({
    text,
    text_to_enter,
    text_to_type,
  }: {
    text?: string;
    text_to_enter?: string;
    text_to_type?: string;
  }): Promise<void> {
    return this.withLifecycle("direct_text_entry", async () => {
      const rawText =
        typeof text === "string" && text.length > 0
          ? text
          : typeof text_to_enter === "string" && text_to_enter.length > 0
            ? text_to_enter
            : typeof text_to_type === "string"
              ? text_to_type
              : "";

      if (!rawText) {
        this.logger.error("enterText called with empty text.");
        return;
      }

      const preview =
        rawText.length > 30 ? `${rawText.substring(0, 30)}...` : rawText;
      this.logger.tool(
        `Executing directTextEntry (clipboard paste): "${preview}"`
      );

      const formats = new Set(clipboard.availableFormats());
      const previousText = formats.has("text/plain")
        ? clipboard.readText()
        : null;
      const previousHtml = formats.has("text/html")
        ? clipboard.readHTML()
        : null;
      const previousRtf = formats.has("text/rtf")
        ? clipboard.readRTF()
        : null;
      const previousImage: NativeImage | null =
        formats.has("image/png") ||
        formats.has("image/jpg") ||
        formats.has("image/jpeg") ||
        formats.has("image/bmp")
          ? clipboard.readImage()
          : null;

      const pasteModifier =
        process.platform === "darwin" ? Key.LeftSuper : Key.LeftControl;

      try {
        clipboard.writeText(rawText);
        await sleep(50);
        await keyboard.pressKey(pasteModifier, Key.V);
        await keyboard.releaseKey(pasteModifier, Key.V);
      } catch (error) {
        this.logger.error(`Direct text entry failed: ${error}`);
      } finally {
        try {
          const restorePayload: {
            text?: string;
            html?: string;
            rtf?: string;
            image?: NativeImage;
          } = {};

          if (previousText !== null) restorePayload.text = previousText;
          if (previousHtml !== null) restorePayload.html = previousHtml;
          if (previousRtf !== null) restorePayload.rtf = previousRtf;
          if (previousImage && !previousImage.isEmpty()) {
            restorePayload.image = previousImage;
          }

          if (Object.keys(restorePayload).length > 0) {
            clipboard.write(restorePayload);
          }
        } catch (err) {
          this.logger.warn(`Failed to restore clipboard: ${err}`);
        }
      }
    });
  }

  /** Send a keyboard shortcut (press + release). */
  public async keyboardShortcut({
    keys,
  }: {
    keys: string[] | string;
  }): Promise<void> {
    return this.withLifecycle("keyboard_shortcut", async () => {
      const keysArray = Array.isArray(keys)
        ? keys
        : `${keys}`.split("+").map((k) => k.trim());
      const resolvedKeys: Key[] = [];
      const invalid: string[] = [];

      keysArray.forEach((k) => {
        const keyEnum = resolveKey(k);
        if (keyEnum) {
          resolvedKeys.push(keyEnum);
        } else {
          invalid.push(k);
        }
      });

      if (!resolvedKeys.length) {
        this.logger.error(`No valid keys provided for shortcut: ${keys}`);
        return;
      }

      const shortcutLabel = keysArray
        .filter(Boolean)
        .map((k) => k.toUpperCase())
        .join(" + ");
      if (invalid.length) {
        this.logger.warn(
          `Ignoring unrecognized shortcut keys: ${invalid.join(", ")}`
        );
      }

      this.logger.tool(`Executing keyboard shortcut: ${shortcutLabel}`);
      try {
        await keyboard.pressKey(...resolvedKeys);
        await keyboard.releaseKey(...resolvedKeys);
      } catch (error) {
        this.logger.error(`Keyboard shortcut failed: ${error}`);
      }
    });
  }

  /** Scroll vertically. Positive values scroll down, negative scroll up. */
  public async scroll({ amount }: { amount: number }): Promise<void> {
    return this.withLifecycle("scroll", async () => {
      const delta = Number.isFinite(amount) ? amount : 0;
      this.logger.tool(`Executing scroll by ${delta}`);
      try {
        if (delta > 0) {
          await mouse.scrollDown(delta);
        } else if (delta < 0) {
          await mouse.scrollUp(Math.abs(delta));
        }
      } catch (error) {
        this.logger.error(`Scroll failed: ${error}`);
      }
    });
  }

  /** Wait for a given duration in milliseconds. */
  public async wait({ milliseconds }: { milliseconds: number }): Promise<void> {
    return this.withLifecycle("wait", async () => {
      const ms = Math.max(0, Math.floor(milliseconds || 0));
      this.logger.tool(`Waiting for ${ms} ms`);
      await sleep(ms);
    });
  }
}

// --- Tool Registry ---
type ToolFunction = (params: any) => Promise<void>;

export function makeToolRegistry(
  executor: Executor
): Partial<Record<ToolName, ToolFunction>> {
  return {
    single_click: (p) => executor.singleClick(p),
    double_click: (p) => executor.doubleClick(p),
    right_click: (p) => executor.rightClick(p),
    hover: (p) => executor.hover(p),
    drag: (p) => executor.drag(p),
    simulate_text_entry: (p) => executor.simulateTextEntry(p),
    direct_text_entry: (p) => executor.directTextEntry(p),
    keyboard_shortcut: (p) => executor.keyboardShortcut(p),
    scroll: (p) => executor.scroll(p),
    wait: (p) => executor.wait(p),
  };
}
