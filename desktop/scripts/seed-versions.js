#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import FormData from "form-data";
import axios from "axios";

dotenv.config();

const API_ROOT = process.env.API_BASE_URL;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLES_FILE = path.join(__dirname, "samples.json");
const DEFAULT_APP_URL = process.env.SEED_APP_URL || "";
const DEFAULT_APP_PATH = process.env.SEED_APP_PATH || "";
const APP_NAME = "Example App";
const APP_TYPE = "web_app";

function fatal(msg, extra) {
  console.error("ERROR:", msg);
  if (extra) console.error(extra);
  process.exit(1);
}

function resolveSource(payload, index) {
  let appUrl = payload.app_url || "";
  let appPath = payload.app_path || "";
  let filePath = payload.file_path || "";

  if (!appUrl && !appPath && !filePath) {
    appUrl = DEFAULT_APP_URL;
    appPath = DEFAULT_APP_PATH;
  }

  const sources = [
    appUrl ? "app_url" : null,
    appPath ? "app_path" : null,
    filePath ? "file_path" : null,
  ].filter(Boolean);

  if (sources.length !== 1) {
    const hint =
      "Provide exactly one of app_url, app_path, or file_path in samples.json, " +
      "or set SEED_APP_URL/SEED_APP_PATH for a default.";
    fatal(
      `Invalid source fields at index ${index} (found: ${
        sources.join(", ") || "none"
      }). ${hint}`
    );
  }

  if (filePath && !fs.existsSync(filePath)) {
    fatal(`file_path does not exist at index ${index}: ${filePath}`);
  }

  return { appUrl, appPath, filePath };
}

async function postVersion(appId, payload, index) {
  const apiBase = `${API_ROOT}/api/v1/apps/${appId}/versions`;
  const form = new FormData();
  form.append("version", payload.version);
  if (Array.isArray(payload.previous_version_ids)) {
    payload.previous_version_ids.forEach((id) => {
      if (Number.isFinite(id) && id > 0) {
        form.append("previous_version_ids", String(id));
      }
    });
  } else if (payload.previous_version_id) {
    form.append("previous_version_id", String(payload.previous_version_id));
  }
  if (payload.release_date) {
    form.append("release_date", payload.release_date);
  }
  if (payload.change_log) {
    form.append("change_log", payload.change_log);
  }

  const { appUrl, appPath, filePath } = resolveSource(payload, index);
  if (appUrl) {
    form.append("app_url", appUrl);
  } else if (appPath) {
    form.append("app_path", appPath);
  } else if (filePath) {
    form.append("file", fs.createReadStream(filePath), {
      filename: path.basename(filePath),
    });
  }

  let data;
  try {
    const res = await axios.post(apiBase, form, {
      headers: form.getHeaders(),
      maxBodyLength: Infinity,
    });
    data = res.data ?? null;
  } catch (err) {
    const status = err?.response?.status ?? "unknown";
    const details = err?.response?.data ?? err?.message ?? err;
    fatal(`Failed to create version #${index} (HTTP ${status})`, details);
  }

  console.log(`Created version #${index}: ${payload.version}`);
  return data;
}

async function main() {
  if (!fs.existsSync(SAMPLES_FILE)) {
    fatal(`samples.json not found at ${SAMPLES_FILE}`);
  }

  const raw = fs.readFileSync(SAMPLES_FILE, "utf-8");
  let samples;
  try {
    samples = JSON.parse(raw);
  } catch (err) {
    fatal("samples.json is not valid JSON", err.message);
  }

  if (!Array.isArray(samples)) {
    fatal("samples.json must contain a JSON array");
  }

  const appId = await ensureAppId(APP_NAME, APP_TYPE);

  console.log("Seeding app versions");
  console.log("API:", `${API_ROOT}/api/v1/apps/${appId}/versions`);
  console.log("Input:", SAMPLES_FILE);
  console.log();

  let index = 0;
  for (const payload of samples) {
    index += 1;

    if (!payload.version) {
      fatal(`Missing 'version' field at index ${index}`);
    }

    await postVersion(appId, payload, index);
  }

  console.log();
  console.log("All versions successfully created.");
}

async function ensureAppId(appName, appType) {
  try {
    const res = await axios.get(`${API_ROOT}/api/v1/apps`, {
      params: {
        search: appName,
        limit: 50,
        offset: 0,
      },
    });
    const apps = Array.isArray(res.data) ? res.data : [];
    const match = apps.find((app) => app?.name === appName);
    if (match?.id) {
      return match.id;
    }
  } catch (err) {
    const status = err?.response?.status ?? "unknown";
    const details = err?.response?.data ?? err?.message ?? err;
    fatal(`Failed to look up app (HTTP ${status})`, details);
  }

  try {
    const res = await axios.post(`${API_ROOT}/api/v1/apps`, {
      name: appName,
      app_type: appType,
    });
    if (!res?.data?.id) {
      fatal("Failed to create app: missing id in response", res?.data);
    }
    return res.data.id;
  } catch (err) {
    const status = err?.response?.status ?? "unknown";
    const details = err?.response?.data ?? err?.message ?? err;
    fatal(`Failed to create app (HTTP ${status})`, details);
  }
}

main().catch((err) => {
  fatal("Unhandled error", err);
});
