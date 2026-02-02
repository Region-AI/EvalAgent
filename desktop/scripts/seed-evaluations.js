#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const API_ROOT = process.env.API_BASE_URL;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SAMPLES_FILE =
  process.env.EVAL_SAMPLES_FILE ||
  path.join(__dirname, "evaluation-samples.json");
const MAP_FILE =
  process.env.EVAL_SEED_MAP_FILE ||
  path.join(__dirname, "evaluation-seed-map.json");
const SKIP_EXISTING = parseBoolean(process.env.EVALS_SKIP_EXISTING);
const APP_NAME = "Example App";
const APP_TYPE = "web_app";

function parseBoolean(value) {
  if (typeof value !== "string") return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function fatal(msg, extra) {
  console.error("ERROR:", msg);
  if (extra) console.error(extra);
  process.exit(1);
}

function assertApiRoot() {
  if (!API_ROOT) {
    fatal("Missing API_BASE_URL in environment (.env).");
  }
}

function readSamples() {
  if (!fs.existsSync(SAMPLES_FILE)) {
    fatal(`evaluation-samples.json not found at ${SAMPLES_FILE}`);
  }
  const raw = fs.readFileSync(SAMPLES_FILE, "utf-8");
  let samples;
  try {
    samples = JSON.parse(raw);
  } catch (err) {
    fatal("evaluation-samples.json is not valid JSON", err.message);
  }
  if (!Array.isArray(samples)) {
    fatal("evaluation-samples.json must contain a JSON array");
  }
  return samples;
}

function readExistingMap() {
  if (!fs.existsSync(MAP_FILE)) return {};
  try {
    const raw = fs.readFileSync(MAP_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object") return data;
  } catch (err) {
    fatal(`Failed to parse evaluation map at ${MAP_FILE}`, err.message);
  }
  return {};
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

async function fetchAllVersions(appId) {
  const versions = [];
  const limit = 100;
  let offset = 0;
  while (true) {
    let res;
    try {
      res = await axios.get(`${API_ROOT}/api/v1/apps/${appId}/versions`, {
        params: { limit, offset },
      });
    } catch (err) {
      const status = err?.response?.status ?? "unknown";
      const details = err?.response?.data ?? err?.message ?? err;
      fatal(`Failed to fetch app versions (HTTP ${status})`, details);
    }
    const batch = Array.isArray(res?.data) ? res.data : [];
    versions.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return versions;
}

function buildVersionMap(versions) {
  const map = new Map();
  versions.forEach((version) => {
    if (version?.version && version?.id != null) {
      map.set(version.version, version.id);
    }
  });
  return map;
}

function resolveVersionId(value, versionMap, label, evalIndex) {
  if (value == null || value === "") {
    fatal(`Missing ${label} for evaluation #${evalIndex}`);
  }
  if (Number.isFinite(value)) return Number(value);
  if (typeof value !== "string") {
    fatal(`Invalid ${label} for evaluation #${evalIndex}: must be string or number`);
  }
  const id = versionMap.get(value);
  if (!id) {
    fatal(`Unknown ${label} for evaluation #${evalIndex}: ${value}`);
  }
  return id;
}

async function fetchEvaluation(evaluationId) {
  try {
    const res = await axios.get(`${API_ROOT}/api/v1/evaluations/${evaluationId}`);
    return res?.data ?? null;
  } catch (err) {
    const status = err?.response?.status;
    if (status === 404) return null;
    const details = err?.response?.data ?? err?.message ?? err;
    fatal(`Failed to fetch evaluation ${evaluationId}`, details);
  }
}

async function createEvaluation(appId, versionId, sample, evalIndex) {
  const payload = {
    execution_mode: sample.execution_mode || "cloud",
    assigned_executor_id: sample.assigned_executor_id || "runner-01",
    local_application_path:
      sample.local_application_path !== undefined
        ? sample.local_application_path
        : null,
    high_level_goal: sample.high_level_goal,
    run_on_current_screen: Boolean(sample.run_on_current_screen),
    executor_ids:
      Array.isArray(sample.executor_ids) && sample.executor_ids.length
        ? sample.executor_ids
        : sample.assigned_executor_id
        ? [sample.assigned_executor_id]
        : [],
  };

  if (!payload.high_level_goal) {
    fatal(`Missing high_level_goal for evaluation #${evalIndex}`);
  }

  try {
    const res = await axios.post(
      `${API_ROOT}/api/v1/apps/${appId}/versions/${versionId}/evaluations`,
      payload
    );
    const created = res?.data ?? null;
    if (!created?.id) {
      fatal(`Missing id in evaluation response for evaluation #${evalIndex}`);
    }
    console.log(
      `Created evaluation #${evalIndex}: ${sample.key} (id ${created.id})`
    );
    return created.id;
  } catch (err) {
    const status = err?.response?.status ?? "unknown";
    const details = err?.response?.data ?? err?.message ?? err;
    fatal(`Failed to create evaluation #${evalIndex} (HTTP ${status})`, details);
  }
}

async function main() {
  assertApiRoot();
  const samples = readSamples();
  const appId = await ensureAppId(APP_NAME, APP_TYPE);
  const versions = await fetchAllVersions(appId);
  const versionMap = buildVersionMap(versions);
  const existingMap = SKIP_EXISTING ? readExistingMap() : {};
  const outputMap = {};

  console.log("Seeding evaluations");
  console.log(
    "API:",
    `${API_ROOT}/api/v1/apps/${appId}/versions/{version_id}/evaluations`
  );
  console.log("Input:", SAMPLES_FILE);
  console.log("Output map:", MAP_FILE);
  console.log();

  let evalIndex = 0;
  for (const sample of samples) {
    evalIndex += 1;
    if (!sample?.key) {
      fatal(`Missing 'key' for evaluation #${evalIndex}`);
    }

    if (SKIP_EXISTING && existingMap?.[sample.key]) {
      const existingId = Number(existingMap[sample.key]);
      if (Number.isFinite(existingId) && existingId > 0) {
        const evaluation = await fetchEvaluation(existingId);
        if (evaluation?.id) {
          console.log(
            `Skipping evaluation #${evalIndex} (map exists): ${sample.key} -> ${existingId}`
          );
          outputMap[sample.key] = existingId;
          continue;
        }
      }
    }

    const versionId = resolveVersionId(
      sample.version ?? sample.version_id,
      versionMap,
      "version",
      evalIndex
    );

    const createdId = await createEvaluation(
      appId,
      versionId,
      sample,
      evalIndex
    );
    outputMap[sample.key] = createdId;
  }

  fs.writeFileSync(MAP_FILE, JSON.stringify(outputMap, null, 2) + "\n");
  console.log();
  console.log("All evaluations successfully created.");
}

main().catch((err) => {
  fatal("Unhandled error", err);
});
