import * as dotenv from "dotenv";
import * as path from "path";
import * as os from "os";
import * as fs from "fs";
import * as crypto from "crypto";

// Load environment variables from .env file in the project root
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

export const API_BASE_URL = process.env.API_BASE_URL || "http://127.0.0.1:8000";
const normalizeMacForId = (mac: string | undefined): string | null => {
  if (!mac) return null;
  const cleaned = mac.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
  if (!cleaned || cleaned === "000000000000" || cleaned === "ffffffffffff") {
    return null;
  }
  return cleaned;
};

const getUserDataDir = (): string =>
  path.join(os.tmpdir(), "app_eval_desktop");

const getExecutorIdFilePath = (): string =>
  path.join(getUserDataDir(), "executor_id");

export const EXECUTOR_ID_PATH = getExecutorIdFilePath();

const readPersistedExecutorId = (): string | null => {
  try {
    const raw = fs.readFileSync(getExecutorIdFilePath(), "utf8").trim();
    return raw ? raw : null;
  } catch {
    return null;
  }
};

const writePersistedExecutorId = (id: string): void => {
  try {
    fs.mkdirSync(getUserDataDir(), { recursive: true });
    fs.writeFileSync(getExecutorIdFilePath(), id, "utf8");
  } catch (err) {
    console.warn("[Config] Failed to persist executor id:", err);
  }
};

const generateExecutorId = (): string => {
  if (typeof crypto.randomUUID === "function") {
    return `uuid-${crypto.randomUUID()}`;
  }
  return `uuid-${crypto.randomBytes(16).toString("hex")}`;
};

const getOrCreateExecutorId = (): string | null => {
  const existing = readPersistedExecutorId();
  if (existing) return existing;
  const created = generateExecutorId();
  writePersistedExecutorId(created);
  return created;
};

const getSystemMacExecutorId = (): string | null => {
  const interfaces = os.networkInterfaces();
  for (const details of Object.values(interfaces)) {
    if (!details) continue;
    for (const detail of details) {
      if (detail.internal) continue;
      const normalized = normalizeMacForId(detail.mac);
      if (normalized) {
        return `mac-${normalized}`;
      }
    }
  }
  return null;
};

export const EXECUTOR_ID =
  process.env.EXECUTOR_ID?.trim() ||
  getOrCreateExecutorId() ||
  getSystemMacExecutorId() ||
  "desktop-agent";

if (!process.env.API_BASE_URL) {
  console.warn(`
    Warning: API_BASE_URL is not set in the .env file.
    Using default value.
  `);
}
