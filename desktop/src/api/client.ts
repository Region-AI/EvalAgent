import axios, { AxiosError } from "axios";
import * as fs from "fs";
import * as path from "path";
import FormData from "form-data";
import { AgentExecutionContext } from "../core/context";
import { API_BASE_URL } from "../config";
import { Logger } from "../core/logger";
import { EvaluationSummary } from "../types/evaluations";

type Job = { id: number; [key: string]: any };

export type VisionActionPayload = {
  thought: string;
  action: {
    tool_name: string;
    parameters: Record<string, any>;
  };
  // Human-readable description of the executed/selected action.
  description?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type NormalizedTestCaseStatus =
  | "pending"
  | "assigned"
  | "in_progress"
  | "completed"
  | "failed"
  | "unknown";

export interface DesktopTestCase {
  id: number;
  plan_id: number;
  evaluation_id: number;
  name: string;
  description?: string | null;
  input_data?: any;
  status: NormalizedTestCaseStatus;
  execution_order?: number | null;
  assigned_executor_id?: string | null;
}

export interface TestCaseCreatePayload {
  evaluation_id: number;
  plan_id: number;
  name: string;
  description?: string;
  input_data?: Record<string, any>;
  execution_order?: number;
  assigned_executor_id?: string;
}

export interface TestCaseUpdatePayload {
  name?: string;
  description?: string | null;
  input_data?: Record<string, any>;
  execution_order?: number | null;
  assigned_executor_id?: string | null;
  status?: NormalizedTestCaseStatus | string;
}

export interface AppRead {
  id: number;
  name: string;
  app_type: "desktop_app" | "web_app";
  created_at?: string;
}

export interface AppVersionRead {
  id: number;
  app_id: number;
  version: string;
  artifact_uri?: string | null;
  app_url?: string | null;
  app_path?: string | null;
  previous_version_id?: number | null;
  previous_version_ids?: number[] | null;
  release_date?: string | null;
  change_log?: string | null;
  created_at?: string;
}

export interface AppVersionGraphNode {
  id: number;
  version: string;
  previous_version_id?: number | null;
  previous_version_ids?: number[];
  release_date?: string | null;
  change_log?: string | null;
  [key: string]: any;
}

export interface AppVersionGraphEdge {
  from_id: number;
  to_id: number;
}

export interface AppVersionGraph {
  nodes: AppVersionGraphNode[];
  edges: AppVersionGraphEdge[];
  warnings?: string[];
}

export interface AppCreatePayload {
  name: string;
  app_type: "desktop_app" | "web_app";
}

export interface AppVersionCreatePayload {
  version: string;
  appUrl?: string | null;
  appPath?: string | null;
  filePath?: string | null;
  previousVersionId?: number | null;
  previousVersionIds?: number[] | null;
  releaseDate?: string | null;
  changeLog?: string | null;
}

export interface AppVersionUpdatePayload {
  version?: string;
  artifactUri?: string | null;
  appUrl?: string | null;
  previousVersionId?: number | null;
  previousVersionIds?: number[] | null;
  releaseDate?: string | null;
  changeLog?: string | null;
}

export interface BugRead {
  id: number;
  app_id: number;
  title: string;
  description?: string | null;
  severity_level?: string | null;
  priority?: number | null;
  status?: string | null;
  discovered_version_id?: number | null;
  fingerprint?: string | null;
  environment?: Record<string, any> | null;
  reproduction_steps?: Record<string, any> | null;
  occurrence_count?: number | null;
  fix_count?: number | null;
  created_at?: string;
  updated_at?: string;
}

export interface BugOccurrenceRead {
  id: number;
  bug_id: number;
  evaluation_id?: number | null;
  test_case_id?: number | null;
  app_version_id?: number | null;
  step_index?: number | null;
  action?: Record<string, any> | null;
  expected?: string | null;
  actual?: string | null;
  screenshot_uri?: string | null;
  log_uri?: string | null;
  raw_model_coords?: Record<string, any> | null;
  observed_at?: string | null;
  executor_id?: string | null;
  created_at?: string;
}

export interface BugFixRead {
  id: number;
  bug_id: number;
  fixed_in_version_id: number;
  verified_by_evaluation_id?: number | null;
  note?: string | null;
  created_at?: string;
}

const normalizeTestCaseStatus = (value: any): NormalizedTestCaseStatus => {
  if (typeof value !== "string") return "unknown";
  const lower = value.trim().toLowerCase();
  if (
    lower === "pending" ||
    lower === "assigned" ||
    lower === "in_progress" ||
    lower === "completed" ||
    lower === "failed"
  ) {
    return lower;
  }
  return "unknown";
};

const toBackendStatus = (status: string): string => {
  const normalized = typeof status === "string" ? status.trim() : "";
  return normalized ? normalized.toUpperCase() : normalized;
};

export class APIClient {
  private client = axios.create({
    baseURL: API_BASE_URL,
    timeout: 30000,
  });
  public readonly baseUrl = API_BASE_URL;

  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /**
   * Fetch a single evaluation summary by id.
   */
  async getEvaluation(evaluationId: number): Promise<EvaluationSummary> {
    try {
      const res = await this.client.get<EvaluationSummary>(
        `/api/v1/evaluations/${evaluationId}`
      );
      return res.data;
    } catch (error) {
      const err = error as AxiosError;
      const message =
        err.response?.status === 404
          ? `Evaluation ${evaluationId} not found`
          : `Failed to fetch evaluation ${evaluationId}: ${err.message}`;
      this.logger.error(message);
      throw new Error(message);
    }
  }

  /**
   * Re-run final summary generation for a completed evaluation.
   */
  async regenerateEvaluationSummary(
    evaluationId: number
  ): Promise<EvaluationSummary> {
    try {
      const res = await this.client.post<EvaluationSummary>(
        `/api/v1/evaluations/${evaluationId}/regenerate-summary`
      );
      this.logger.system(
        `Regenerating summary for evaluation ${evaluationId}`
      );
      return res.data;
    } catch (error) {
      const err = error as AxiosError;
      const status = err.response?.status;
      let detail = "";
      try {
        detail =
          typeof err.response?.data === "string"
            ? err.response.data
            : err.response?.data
              ? JSON.stringify(err.response.data)
              : "";
      } catch {
        detail = "";
      }

      const message =
        status === 404
          ? `Evaluation ${evaluationId} not found`
          : status === 400
            ? `Evaluation ${evaluationId} is not completed`
            : `Failed to regenerate summary for evaluation ${evaluationId}: ${err.message}`;

      this.logger.warn(`${message}${detail ? ` | ${detail}` : ""}`);
      throw new Error(message);
    }
  }

  /**
   * Replace the evaluation summary without changing status.
   */
  async updateEvaluationSummary(
    evaluationId: number,
    summary: string
  ): Promise<EvaluationSummary> {
    try {
      const res = await this.client.patch<EvaluationSummary>(
        `/api/v1/evaluations/${evaluationId}/summary`,
        { summary }
      );
      this.logger.system(`Updated summary for evaluation ${evaluationId}`);
      return res.data;
    } catch (error) {
      const err = error as AxiosError;
      const status = err.response?.status;
      let detail = "";
      try {
        detail =
          typeof err.response?.data === "string"
            ? err.response.data
            : err.response?.data
              ? JSON.stringify(err.response.data)
              : "";
      } catch {
        detail = "";
      }

      const message =
        status === 404
          ? `Evaluation ${evaluationId} not found`
          : `Failed to update summary for evaluation ${evaluationId}: ${err.message}`;

      this.logger.warn(`${message}${detail ? ` | ${detail}` : ""}`);
      throw new Error(message);
    }
  }

  /**
   * List apps (top-level entity for evaluations).
   */
  async getApps(params?: {
    app_type?: "desktop_app" | "web_app";
    search?: string;
    limit?: number;
    offset?: number;
  }): Promise<AppRead[]> {
    try {
      const res = await this.client.get<AppRead[]>("/api/v1/apps", {
        params,
      });
      return Array.isArray(res.data) ? res.data : [];
    } catch (error) {
      const err = error as AxiosError;
      const message = `Failed to fetch apps: ${err.message}`;
      this.logger.error(message);
      throw new Error(message);
    }
  }

  /**
   * Delete an app and its versions/evaluations.
   */
  async deleteApp(appId: number): Promise<boolean> {
    try {
      await this.client.delete(`/api/v1/apps/${appId}`);
      this.logger.system(`Deleted app ${appId}`);
      return true;
    } catch (error) {
      const err = error as AxiosError;
      const message =
        err.response?.status === 404
          ? `App ${appId} not found`
          : `Failed to delete app ${appId}: ${err.message}`;
      this.logger.error(message);
      return false;
    }
  }

  /**
   * Delete a single app version and its evaluations.
   */
  async deleteAppVersion(
    appId: number,
    versionId: number
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      await this.client.delete(
        `/api/v1/apps/${appId}/versions/${versionId}`
      );
      this.logger.system(`Deleted app ${appId} version ${versionId}`);
      return { ok: true };
    } catch (error) {
      const err = error as AxiosError;
      const message =
        err.response?.status === 404
          ? `Version ${versionId} not found`
          : `Failed to delete app ${appId} version ${versionId}: ${err.message}`;
      this.logger.error(message);
      return { ok: false, error: message };
    }
  }

  /**
   * Create a new app.
   */
  async createApp(payload: AppCreatePayload): Promise<AppRead> {
    try {
      const res = await this.client.post<AppRead>("/api/v1/apps", payload);
      return res.data;
    } catch (error) {
      const err = error as AxiosError;
      const message = `Failed to create app: ${err.message}`;
      this.logger.error(message);
      throw new Error(message);
    }
  }

  /**
   * Create a version for an existing app.
   */
  async createAppVersion(
    appId: number,
    payload: AppVersionCreatePayload
  ): Promise<AppVersionRead> {
    try {
    const form = new FormData();
    form.append("version", payload.version);
    if (Array.isArray(payload.previousVersionIds)) {
      payload.previousVersionIds.forEach((id) => {
        if (Number.isFinite(id) && id > 0) {
          form.append("previous_version_ids", String(id));
        }
      });
    } else if (payload.previousVersionId) {
      form.append("previous_version_id", String(payload.previousVersionId));
    }
      if (payload.releaseDate) {
        form.append("release_date", payload.releaseDate);
      }
      if (payload.changeLog) {
        form.append("change_log", payload.changeLog);
      }
      if (payload.appUrl) {
        form.append("app_url", payload.appUrl);
      }
      if (payload.appPath) {
        form.append("app_path", payload.appPath);
      }
      if (payload.filePath) {
        form.append("file", fs.createReadStream(payload.filePath), {
          filename: path.basename(payload.filePath),
        });
      }

      const res = await this.client.post<AppVersionRead>(
        `/api/v1/apps/${appId}/versions`,
        form,
        {
          headers: form.getHeaders(),
          timeout: 120000,
        }
      );
      return res.data;
    } catch (error) {
      const err = error as AxiosError;
      const message = `Failed to create app version for ${appId}: ${err.message}`;
      this.logger.error(message);
      throw new Error(message);
    }
  }

  /**
   * List versions for a given app.
   */
  async getAppVersions(
    appId: number,
    params?: { limit?: number; offset?: number }
  ): Promise<AppVersionRead[]> {
    try {
      const res = await this.client.get<AppVersionRead[]>(
        `/api/v1/apps/${appId}/versions`,
        { params }
      );
      return Array.isArray(res.data) ? res.data : [];
    } catch (error) {
      const err = error as AxiosError;
      const message = `Failed to fetch app versions for ${appId}: ${err.message}`;
      this.logger.error(message);
      throw new Error(message);
    }
  }

  /**
   * Update a version for an existing app.
   */
  async updateAppVersion(
    appId: number,
    versionId: number,
    payload: AppVersionUpdatePayload
  ): Promise<AppVersionRead> {
    try {
      const res = await this.client.patch<AppVersionRead>(
        `/api/v1/apps/${appId}/versions/${versionId}`,
        {
          version: payload.version,
          artifact_uri: payload.artifactUri,
          app_url: payload.appUrl,
          previous_version_id: payload.previousVersionId,
          previous_version_ids: payload.previousVersionIds,
          release_date: payload.releaseDate,
          change_log: payload.changeLog,
        }
      );
      return res.data;
    } catch (error) {
      const err = error as AxiosError;
      const message = `Failed to update app version ${versionId} for ${appId}: ${err.message}`;
      this.logger.error(message);
      throw new Error(message);
    }
  }

  /**
   * Fetch a lineage graph for all versions in an app.
   */
  async getAppVersionGraph(appId: number): Promise<AppVersionGraph> {
    try {
      const res = await this.client.get<AppVersionGraph>(
        `/api/v1/apps/${appId}/versions/graph`
      );
      const data = res.data || { nodes: [], edges: [], warnings: [] };
      return {
        nodes: Array.isArray(data.nodes) ? data.nodes : [],
        edges: Array.isArray(data.edges) ? data.edges : [],
        warnings: Array.isArray(data.warnings) ? data.warnings : [],
      };
    } catch (error) {
      const err = error as AxiosError;
      const message = `Failed to fetch app version graph for ${appId}: ${err.message}`;
      this.logger.error(message);
      throw new Error(message);
    }
  }

  /**
   * List evaluations for a given app version.
   */
  async getAppVersionEvaluations(
    appId: number,
    versionId: number,
    params?: { limit?: number; offset?: number }
  ): Promise<any[]> {
    try {
      const res = await this.client.get<any[]>(
        `/api/v1/apps/${appId}/versions/${versionId}/evaluations`,
        { params }
      );
      return Array.isArray(res.data) ? res.data : [];
    } catch (error) {
      const err = error as AxiosError;
      const message = `Failed to fetch evaluations for app ${appId} version ${versionId}: ${err.message}`;
      this.logger.error(message);
      throw new Error(message);
    }
  }

  /**
   * Delete an evaluation and its artifacts.
   */
  async deleteEvaluation(evaluationId: number): Promise<boolean> {
    try {
      await this.client.delete(`/api/v1/evaluations/${evaluationId}`);
      this.logger.system(`Deleted evaluation ${evaluationId}`);
      return true;
    } catch (error) {
      const err = error as AxiosError;
      const message =
        err.response?.status === 404
          ? `Evaluation ${evaluationId} not found`
          : `Failed to delete evaluation ${evaluationId}: ${err.message}`;
      this.logger.error(message);
      return false;
    }
  }

  /**
   * Non-streaming vision analysis (replacement for /vision/analyze/stream)
   */
  async analyzeImageAndContext(
    context: AgentExecutionContext,
    screenshotBuffer: Buffer,
    opts?: { signal?: AbortSignal }
  ): Promise<VisionActionPayload | null> {
    const form = new FormData();
    form.append("context_json", JSON.stringify(context));
    form.append("image", screenshotBuffer, {
      filename: "screenshot.png",
      contentType: "image/png",
    });

    const maxRetries = 2;
    const isTransient = (err: any) => {
      const msg = (err?.message || "").toLowerCase();
      return (
        msg.includes("socket hang up") ||
        msg.includes("econnreset") ||
        msg.includes("connection aborted") ||
        msg.includes("stream error") ||
        msg.includes("timeout")
      );
    };

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const response = await this.client.post<VisionActionPayload>(
          "/api/v1/vision/analyze",
          form,
          {
            headers: form.getHeaders(),
            responseType: "json",
            signal: opts?.signal,
            timeout: 45000,
          }
        );
        return response.data;
      } catch (error) {
        const err = error as AxiosError;
        if (err.code === "ERR_CANCELED") {
          this.logger.warn("Vision analyze request canceled.");
          return null;
        }

        const transient = isTransient(err);
        const status = err.response?.status;
        let detail = "";
        try {
          detail =
            typeof err.response?.data === "string"
              ? err.response.data
              : err.response?.data
                ? JSON.stringify(err.response.data)
                : "";
        } catch {
          detail = "";
        }

        this.logger.error(
          `Vision analyze failed${
            status ? ` (status ${status})` : ""
          }: ${err.message}${detail ? ` | ${detail}` : ""}`
        );

        if (attempt <= maxRetries && transient) {
          await sleep(400);
          continue;
        }
        throw err;
      }
    }

    return null;
  }

  async createEvaluationWithUpload(
    filePath: string,
    executorId: string,
    highLevelGoal?: string | null,
    appName?: string | null,
    appVersion?: string | null,
    appType?: "desktop_app" | "web_app"
  ): Promise<Job | null> {
    if (!fs.existsSync(filePath)) {
      this.logger.error(`File not found for upload: ${filePath}`);
      return null;
    }

    const form = new FormData();
    form.append("file", fs.createReadStream(filePath), {
      filename: path.basename(filePath),
    });
    form.append("execution_mode", "local");
    form.append("assigned_executor_id", executorId);
    form.append("application_path", filePath);
    form.append("executor_ids", JSON.stringify([executorId]));
    if (appType) {
      form.append("app_type", appType);
    }
    if (appName) {
      form.append("app_name", appName);
    }
    if (appVersion) {
      form.append("app_version", appVersion);
    }
    const trimmedGoal = (highLevelGoal ?? "").trim();
    if (trimmedGoal) {
      form.append("high_level_goal", trimmedGoal);
    }

    try {
      const response = await this.client.post<Job>(
        "/api/v1/evaluations/upload",
        form,
        {
          headers: form.getHeaders(),
          timeout: 120000,
        }
      );
      this.logger.system(
        `Successfully created new evaluation job: ${response.data.id}`
      );
      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      this.logger.error(`File upload failed: ${err.message}`);
      return null;
    }
  }

  async createEvaluationFromURL(
    targetUrl: string,
    executorId: string,
    highLevelGoal?: string | null,
    appName?: string | null,
    appVersion?: string | null,
    appType?: "desktop_app" | "web_app"
  ): Promise<Job | null> {
    if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
      this.logger.error(`Invalid target_url: ${targetUrl}`);
      return null;
    }

    const form = new FormData();
    form.append("target_url", targetUrl);
    form.append("execution_mode", "local");
    form.append("assigned_executor_id", executorId);
    form.append("executor_ids", JSON.stringify([executorId]));
    if (appType) {
      form.append("app_type", appType);
    }
    if (appName) {
      form.append("app_name", appName);
    }
    if (appVersion) {
      form.append("app_version", appVersion);
    }
    const trimmedGoal = (highLevelGoal ?? "").trim();
    if (trimmedGoal) {
      form.append("high_level_goal", trimmedGoal);
    }

    try {
      const response = await this.client.post<Job>(
        "/api/v1/evaluations/url",
        form,
        {
          headers: form.getHeaders(),
        }
      );

      this.logger.system(
        `Successfully created web-app evaluation job: ${response.data.id}`
      );
      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      this.logger.error(`Web URL job creation failed: ${err.message}`);
      return null;
    }
  }

  async createLiveEvaluation(
    executorId: string,
    highLevelGoal?: string | null,
    appType: "desktop_app" | "web_app" = "desktop_app",
    appName?: string | null,
    appVersion?: string | null
  ): Promise<Job | null> {
    const form = new FormData();
    form.append("execution_mode", "local");
    form.append("assigned_executor_id", executorId);
    form.append("app_type", appType);
    form.append("executor_ids", JSON.stringify([executorId]));
    if (appName) {
      form.append("app_name", appName);
    }
    if (appVersion) {
      form.append("app_version", appVersion);
    }

    const trimmedGoal = (highLevelGoal ?? "").trim();
    if (trimmedGoal) {
      form.append("high_level_goal", trimmedGoal);
    }

    try {
      const response = await this.client.post<Job>(
        "/api/v1/evaluations/live",
        form,
        {
          headers: form.getHeaders(),
        }
      );

      this.logger.system(
        `Successfully created live evaluation job: ${response.data.id}`
      );
      return response.data;
    } catch (error) {
      const err = error as AxiosError;
      this.logger.error(`Live evaluation creation failed: ${err.message}`);
      return null;
    }
  }

  async getAssignedEvaluations(
    executorId: string,
    limit = 50,
    offset = 0
  ): Promise<any[]> {
    try {
      const response = await this.client.get<any[]>(
        "/api/v1/evaluations/assigned",
        {
          params: {
            executor_id: executorId,
            limit,
            offset,
          },
        }
      );
      return Array.isArray(response.data) ? response.data : [];
    } catch (error) {
      const err = error as AxiosError;
      this.logger.error(`Failed to fetch assigned evaluations: ${err.message}`);
      return [];
    }
  }

  /**
   * GET /api/v1/testcases/next?executor_id=...
   * Returns the next TestCase or null if 204.
   */
  async requestNextTestCase(
    executorId: string
  ): Promise<DesktopTestCase | null> {
    try {
      const url = `${this.baseUrl}/api/v1/testcases/next?executor_id=${encodeURIComponent(
        executorId
      )}`;

      const res = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      if (res.status === 204) {
        this.logger.system("No available TestCase (204).");
        return null;
      }

      if (!res.ok) {
        const text = await res.text();
        this.logger.error(
          `Failed to fetch next TestCase (${res.status}): ${text}`
        );
        return null;
      }

      const data = (await res.json()) as DesktopTestCase;
      return {
        ...data,
        status: normalizeTestCaseStatus((data as any)?.status),
      };
    } catch (err: any) {
      this.logger.error(`requestNextTestCase error: ${err.message}`);
      return null;
    }
  }

  /**
   * PATCH /api/v1/testcases/{id}
   *
   * Body:
   * {
   *   "status": "COMPLETED" | "FAILED" | "IN_PROGRESS",
   *   "result": {...}
   * }
   */
  async updateTestCaseStatus(
    id: number,
    status: string,
    result?: object
  ): Promise<void> {
    try {
      const backendStatus = toBackendStatus(status);
      if (!backendStatus) {
        this.logger.error(
          `updateTestCaseStatus missing status for TestCase ${id}`
        );
        return;
      }

      const url = `${this.baseUrl}/api/v1/testcases/${id}`;

      const body: any = { status: backendStatus };
      if (result) body.result = result;

      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        this.logger.error(
          `Failed to update TestCase ${id} (${res.status}): ${text}`
        );
      }
    } catch (err: any) {
      this.logger.error(`updateTestCaseStatus error: ${err.message}`);
    }
  }

  /**
   * POST /api/v1/testcases
   */
  async createTestCase(
    payload: TestCaseCreatePayload
  ): Promise<DesktopTestCase | null> {
    try {
      const url = `${this.baseUrl}/api/v1/testcases`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const text = await res.text();
        this.logger.error(`Failed to create TestCase (${res.status}): ${text}`);
        return null;
      }

      const data = (await res.json()) as DesktopTestCase;
      return {
        ...data,
        status: normalizeTestCaseStatus((data as any)?.status),
      };
    } catch (err: any) {
      this.logger.error(`createTestCase error: ${err.message}`);
      return null;
    }
  }

  /**
   * PATCH /api/v1/testcases/{id}
   */
  async updateTestCase(
    id: number,
    payload: TestCaseUpdatePayload
  ): Promise<DesktopTestCase | null> {
    try {
      const url = `${this.baseUrl}/api/v1/testcases/${id}`;
      const body: any = { ...payload };
      if (body.status) {
        const normalized = toBackendStatus(body.status);
        if (normalized) body.status = normalized;
      }

      const res = await fetch(url, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const text = await res.text();
        this.logger.error(
          `Failed to update TestCase ${id} (${res.status}): ${text}`
        );
        return null;
      }

      const data = (await res.json()) as DesktopTestCase;
      return {
        ...data,
        status: normalizeTestCaseStatus((data as any)?.status),
      };
    } catch (err: any) {
      this.logger.error(`updateTestCase error: ${err.message}`);
      return null;
    }
  }

  /**
   * DELETE /api/v1/testcases/{id}
   */
  async deleteTestCase(id: number): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/api/v1/testcases/${id}`;
      const res = await fetch(url, {
        method: "DELETE",
      });
      if (res.status === 204 || res.status === 200) return true;
      const text = await res.text();
      this.logger.error(
        `Failed to delete TestCase ${id} (${res.status}): ${text}`
      );
      return false;
    } catch (err: any) {
      this.logger.error(`deleteTestCase error: ${err.message}`);
      return false;
    }
  }

  /**
   * --- Bugs ---
   */
  async getBugsForApp(
    appId: number,
    params?: {
      status?: string;
      severity_level?: string;
      app_version_id?: number;
      evaluation_id?: number;
      test_case_id?: number;
      limit?: number;
      offset?: number;
    }
  ): Promise<BugRead[]> {
    try {
      const res = await this.client.get<BugRead[]>(
        `/api/v1/apps/${appId}/bugs`,
        { params }
      );
      return Array.isArray(res.data) ? res.data : [];
    } catch (error) {
      const err = error as AxiosError;
      const message = `Failed to fetch bugs for app ${appId}: ${err.message}`;
      this.logger.error(message);
      throw new Error(message);
    }
  }

  async getBug(bugId: number): Promise<BugRead> {
    try {
      const res = await this.client.get<BugRead>(`/api/v1/bugs/${bugId}`);
      return res.data;
    } catch (error) {
      const err = error as AxiosError;
      const message =
        err.response?.status === 404
          ? `Bug ${bugId} not found`
          : `Failed to fetch bug ${bugId}: ${err.message}`;
      this.logger.error(message);
      throw new Error(message);
    }
  }

  async createBug(payload: Record<string, any>): Promise<BugRead> {
    try {
      const res = await this.client.post<BugRead>("/api/v1/bugs/", payload);
      return res.data;
    } catch (error) {
      const err = error as AxiosError;
      const message = `Failed to create bug: ${err.message}`;
      this.logger.error(message);
      throw new Error(message);
    }
  }

  async updateBug(bugId: number, payload: Record<string, any>): Promise<BugRead> {
    try {
      const res = await this.client.patch<BugRead>(
        `/api/v1/bugs/${bugId}`,
        payload
      );
      return res.data;
    } catch (error) {
      const err = error as AxiosError;
      const message =
        err.response?.status === 404
          ? `Bug ${bugId} not found`
          : `Failed to update bug ${bugId}: ${err.message}`;
      this.logger.error(message);
      throw new Error(message);
    }
  }

  async deleteBug(bugId: number): Promise<boolean> {
    try {
      await this.client.delete(`/api/v1/bugs/${bugId}`);
      this.logger.system(`Deleted bug ${bugId}`);
      return true;
    } catch (error) {
      const err = error as AxiosError;
      const message =
        err.response?.status === 404
          ? `Bug ${bugId} not found`
          : `Failed to delete bug ${bugId}: ${err.message}`;
      this.logger.error(message);
      return false;
    }
  }

  async listBugOccurrences(
    bugId: number,
    params?: {
      evaluation_id?: number;
      test_case_id?: number;
      app_version_id?: number;
      limit?: number;
      offset?: number;
    }
  ): Promise<BugOccurrenceRead[]> {
    try {
      const res = await this.client.get<BugOccurrenceRead[]>(
        `/api/v1/bugs/${bugId}/occurrences`,
        { params }
      );
      return Array.isArray(res.data) ? res.data : [];
    } catch (error) {
      const err = error as AxiosError;
      const message = `Failed to fetch occurrences for bug ${bugId}: ${err.message}`;
      this.logger.error(message);
      throw new Error(message);
    }
  }

  async createBugOccurrence(
    bugId: number,
    payload: Record<string, any>
  ): Promise<BugOccurrenceRead> {
    try {
      const res = await this.client.post<BugOccurrenceRead>(
        `/api/v1/bugs/${bugId}/occurrences`,
        payload
      );
      return res.data;
    } catch (error) {
      const err = error as AxiosError;
      const message = `Failed to create bug occurrence for ${bugId}: ${err.message}`;
      this.logger.error(message);
      throw new Error(message);
    }
  }

  async listBugFixes(bugId: number): Promise<BugFixRead[]> {
    try {
      const res = await this.client.get<BugFixRead[]>(
        `/api/v1/bugs/${bugId}/fixes`
      );
      return Array.isArray(res.data) ? res.data : [];
    } catch (error) {
      const err = error as AxiosError;
      const message = `Failed to fetch fixes for bug ${bugId}: ${err.message}`;
      this.logger.error(message);
      throw new Error(message);
    }
  }

  async createBugFix(
    bugId: number,
    payload: Record<string, any>
  ): Promise<BugFixRead> {
    try {
      const res = await this.client.post<BugFixRead>(
        `/api/v1/bugs/${bugId}/fixes`,
        payload
      );
      return res.data;
    } catch (error) {
      const err = error as AxiosError;
      const message = `Failed to create bug fix for ${bugId}: ${err.message}`;
      this.logger.error(message);
      throw new Error(message);
    }
  }

  async deleteBugFix(bugId: number, fixId: number): Promise<boolean> {
    try {
      await this.client.delete(`/api/v1/bugs/${bugId}/fixes/${fixId}`);
      this.logger.system(`Deleted bug fix ${fixId} for bug ${bugId}`);
      return true;
    } catch (error) {
      const err = error as AxiosError;
      const message =
        err.response?.status === 404
          ? `Bug fix ${fixId} not found`
          : `Failed to delete bug fix ${fixId} for bug ${bugId}: ${err.message}`;
      this.logger.error(message);
      return false;
    }
  }
}
