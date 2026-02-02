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
  process.env.BUG_SAMPLES_FILE || path.join(__dirname, "bug-samples.json");
const EVAL_MAP_FILE =
  process.env.EVAL_SEED_MAP_FILE ||
  path.join(__dirname, "evaluation-seed-map.json");
const SKIP_EXISTING = parseBoolean(process.env.BUGS_SKIP_EXISTING);
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
    fatal(`bug-samples.json not found at ${SAMPLES_FILE}`);
  }
  const raw = fs.readFileSync(SAMPLES_FILE, "utf-8");
  let samples;
  try {
    samples = JSON.parse(raw);
  } catch (err) {
    fatal("bug-samples.json is not valid JSON", err.message);
  }
  if (!Array.isArray(samples)) {
    fatal("bug-samples.json must contain a JSON array");
  }
  return samples;
}

function readEvaluationMap() {
  if (!fs.existsSync(EVAL_MAP_FILE)) return {};
  try {
    const raw = fs.readFileSync(EVAL_MAP_FILE, "utf-8");
    const data = JSON.parse(raw);
    if (data && typeof data === "object") return data;
  } catch (err) {
    fatal(`Failed to parse evaluation map at ${EVAL_MAP_FILE}`, err.message);
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

async function fetchAllBugs(appId) {
  const bugs = [];
  const limit = 100;
  let offset = 0;
  while (true) {
    let res;
    try {
      res = await axios.get(`${API_ROOT}/api/v1/apps/${appId}/bugs`, {
        params: { limit, offset },
      });
    } catch (err) {
      const status = err?.response?.status ?? "unknown";
      const details = err?.response?.data ?? err?.message ?? err;
      fatal(`Failed to fetch bugs (HTTP ${status})`, details);
    }
    const batch = Array.isArray(res?.data) ? res.data : [];
    bugs.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  return bugs;
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

function resolveVersionId(value, versionMap, label, bugIndex) {
  if (value == null || value === "") return undefined;
  if (Number.isFinite(value)) return Number(value);
  if (typeof value !== "string") {
    fatal(`Invalid ${label} for bug #${bugIndex}: must be string or number`);
  }
  const id = versionMap.get(value);
  if (!id) {
    fatal(`Unknown ${label} for bug #${bugIndex}: ${value}`);
  }
  return id;
}

async function createBug(appId, bug, versionMap, bugIndex, existingByFingerprint) {
  if (!bug?.title) {
    fatal(`Missing 'title' for bug #${bugIndex}`);
  }

  if (bug.fingerprint && existingByFingerprint?.has(bug.fingerprint)) {
    const existing = existingByFingerprint.get(bug.fingerprint);
    console.log(
      `Skipping bug #${bugIndex} (fingerprint exists): ${bug.title} -> ${existing.id}`
    );
    return { id: existing.id, skipped: true };
  }

  const payload = {
    app_id: appId,
    title: bug.title,
  };

  if (bug.description !== undefined) payload.description = bug.description;
  if (bug.severity_level !== undefined) payload.severity_level = bug.severity_level;
  if (bug.priority !== undefined) payload.priority = bug.priority;
  if (bug.status !== undefined) payload.status = bug.status;
  if (bug.fingerprint !== undefined) payload.fingerprint = bug.fingerprint;
  if (bug.environment !== undefined) payload.environment = bug.environment;
  if (bug.reproduction_steps !== undefined)
    payload.reproduction_steps = bug.reproduction_steps;

  const discoveredVersionId = resolveVersionId(
    bug.discovered_version ?? bug.discovered_version_id,
    versionMap,
    "discovered_version",
    bugIndex
  );
  if (discoveredVersionId !== undefined) {
    payload.discovered_version_id = discoveredVersionId;
  }

  try {
    const res = await axios.post(`${API_ROOT}/api/v1/bugs`, payload);
    const created = res?.data ?? null;
    console.log(`Created bug #${bugIndex}: ${bug.title}`);
    return created;
  } catch (err) {
    const status = err?.response?.status ?? "unknown";
    const details = err?.response?.data ?? err?.message ?? err;
    fatal(`Failed to create bug #${bugIndex} (HTTP ${status})`, details);
  }
}

async function createOccurrence(
  bugId,
  occurrence,
  versionMap,
  evaluationMap,
  bugIndex,
  occIndex
) {
  const payload = {};
  const appVersionId = resolveVersionId(
    occurrence.app_version ?? occurrence.app_version_id,
    versionMap,
    `occurrence.app_version (bug #${bugIndex} occurrence #${occIndex})`,
    bugIndex
  );
  if (appVersionId !== undefined) payload.app_version_id = appVersionId;

  if (occurrence.evaluation_id !== undefined) {
    payload.evaluation_id = occurrence.evaluation_id;
  } else if (occurrence.evaluation_ref) {
    const evalId = evaluationMap?.[occurrence.evaluation_ref];
    if (!evalId) {
      fatal(
        `Missing evaluation_ref '${occurrence.evaluation_ref}' for bug #${bugIndex} occurrence #${occIndex}. ` +
          `Run seed-evaluations to generate ${EVAL_MAP_FILE}.`
      );
    }
    payload.evaluation_id = evalId;
  }

  const fields = [
    "test_case_id",
    "step_index",
    "action",
    "expected",
    "actual",
    "screenshot_uri",
    "log_uri",
    "raw_model_coords",
    "observed_at",
    "executor_id",
  ];

  fields.forEach((key) => {
    if (occurrence[key] !== undefined) payload[key] = occurrence[key];
  });

  try {
    await axios.post(`${API_ROOT}/api/v1/bugs/${bugId}/occurrences`, payload);
    console.log(
      `  Added occurrence #${occIndex} for bug #${bugIndex} (bug id ${bugId})`
    );
  } catch (err) {
    const status = err?.response?.status ?? "unknown";
    const details = err?.response?.data ?? err?.message ?? err;
    fatal(
      `Failed to create occurrence #${occIndex} for bug #${bugIndex} (HTTP ${status})`,
      details
    );
  }
}

async function createFix(
  bugId,
  fix,
  versionMap,
  evaluationMap,
  bugIndex,
  fixIndex
) {
  const payload = {};
  const fixedInVersionId = resolveVersionId(
    fix.fixed_in_version ?? fix.fixed_in_version_id,
    versionMap,
    `fix.fixed_in_version (bug #${bugIndex} fix #${fixIndex})`,
    bugIndex
  );
  if (fixedInVersionId === undefined) {
    fatal(`Missing fixed_in_version for bug #${bugIndex} fix #${fixIndex}`);
  }
  payload.fixed_in_version_id = fixedInVersionId;

  if (fix.verified_by_evaluation_id !== undefined) {
    payload.verified_by_evaluation_id = fix.verified_by_evaluation_id;
  } else if (fix.verified_by_evaluation_ref) {
    const evalId = evaluationMap?.[fix.verified_by_evaluation_ref];
    if (!evalId) {
      fatal(
        `Missing verified_by_evaluation_ref '${fix.verified_by_evaluation_ref}' for bug #${bugIndex} fix #${fixIndex}. ` +
          `Run seed-evaluations to generate ${EVAL_MAP_FILE}.`
      );
    }
    payload.verified_by_evaluation_id = evalId;
  }
  if (fix.note !== undefined) payload.note = fix.note;

  try {
    await axios.post(`${API_ROOT}/api/v1/bugs/${bugId}/fixes`, payload);
    console.log(`  Added fix #${fixIndex} for bug #${bugIndex} (bug id ${bugId})`);
  } catch (err) {
    const status = err?.response?.status ?? "unknown";
    const details = err?.response?.data ?? err?.message ?? err;
    fatal(
      `Failed to create fix #${fixIndex} for bug #${bugIndex} (HTTP ${status})`,
      details
    );
  }
}

async function main() {
  assertApiRoot();
  const samples = readSamples();
  const evaluationMap = readEvaluationMap();
  const appId = await ensureAppId(APP_NAME, APP_TYPE);
  const versions = await fetchAllVersions(appId);
  const versionMap = buildVersionMap(versions);
  const existingByFingerprint = SKIP_EXISTING
    ? new Map(
        (await fetchAllBugs(appId))
          .filter((bug) => bug?.fingerprint)
          .map((bug) => [bug.fingerprint, bug])
      )
    : null;

  console.log("Seeding bugs");
  console.log("API:", `${API_ROOT}/api/v1/bugs`);
  console.log("Input:", SAMPLES_FILE);
  console.log();

  let bugIndex = 0;
  for (const bug of samples) {
    bugIndex += 1;
    const createdBug = await createBug(
      appId,
      bug,
      versionMap,
      bugIndex,
      existingByFingerprint
    );
    if (!createdBug?.id) {
      fatal(`Missing bug id for bug #${bugIndex}`);
    }
    if (createdBug?.skipped) {
      continue;
    }

    if (Array.isArray(bug.occurrences)) {
      let occIndex = 0;
      for (const occurrence of bug.occurrences) {
        occIndex += 1;
        await createOccurrence(
          createdBug.id,
          occurrence,
          versionMap,
          evaluationMap,
          bugIndex,
          occIndex
        );
      }
    }

    if (Array.isArray(bug.fixes)) {
      let fixIndex = 0;
      for (const fix of bug.fixes) {
        fixIndex += 1;
        await createFix(
          createdBug.id,
          fix,
          versionMap,
          evaluationMap,
          bugIndex,
          fixIndex
        );
      }
    }
  }

  console.log();
  console.log("All bugs successfully created.");
}

main().catch((err) => {
  fatal("Unhandled error", err);
});
