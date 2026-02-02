import { APIClient, VisionActionPayload } from "../api/client";
import { AgentExecutionContext } from "./context";
import {
  Executor,
  makeToolRegistry,
  ToolLifecycleEvent,
  ToolName,
} from "../agent/executor";
import { makeImageToScreenMapper } from "../agent/coord-mapper";
import { EXECUTOR_ID } from "../config";
import { spawn, ChildProcess } from "child_process";
import { BrowserWindow } from "electron";
import { Logger } from "./logger";
import { EvaluationSummary } from "../types/evaluations";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Shape of a TestCase as returned by /api/v1/testcases/next
 * (aligned with ENDPOINTS.md v2.1)
 */
interface DesktopTestCase {
  id: number;
  plan_id: number;
  evaluation_id: number;
  name: string;
  description?: string | null;
  input_data?: any;
  status:
    | "pending"
    | "assigned"
    | "in_progress"
    | "completed"
    | "failed"
    | "unknown";
  execution_order?: number | null;
  assigned_executor_id?: string | null;
}

export class Orchestrator {
  private apiClient: APIClient;

  private _isRunning = false;
  private _isPaused = false;

  private mainWindow: BrowserWindow | null;
  private logger: Logger;

  private executor!: Executor;
  private tools!: ReturnType<typeof makeToolRegistry>;
  private visionAbortController: AbortController | null = null;

  private lastFocusScreen: { x: number; y: number } | null = null;
  private lastFocusRawModel: {
    x: number;
    y: number;
    normalized?: boolean;
  } | null = null;

  private initialHighLevelGoal: string | null = null;

  private onAutoStop?: (reason: "no_jobs") => void;

  private clickThroughRefCount = 0;

  private currentEvaluation: EvaluationSummary | null = null;
  private currentTestCaseId: string | null = null;
  private launchedProcess: ChildProcess | null = null;

  private readonly RUN_TIMELINE_EVENT = "run-timeline-entry";
  private readonly ANALYSIS_IMAGE_SIZE = 1000;

  private broadcastEvaluationAttached(evaluation: EvaluationSummary | null) {
    try {
      BrowserWindow.getAllWindows().forEach((win) =>
        win.webContents.send("evaluation-attached", evaluation)
      );
    } catch (err) {
      this.logger.warn(`Failed to broadcast evaluation attachment: ${err}`);
    }
  }

  private pushRunTimelineEntry(entry: {
    stepIndex: number;
    thought: string;
    action: { tool_name: string; parameters: Record<string, any> };
    screenshot?: string | null;
    timestamp: string;
    evaluationId?: number | null;
    testCaseId?: string | null;
  }) {
    try {
      BrowserWindow.getAllWindows().forEach((win) =>
        win.webContents.send(this.RUN_TIMELINE_EVENT, entry)
      );
    } catch (err) {
      this.logger.warn(`Failed to push run timeline entry: ${err}`);
    }
  }

  private readonly CLICK_THROUGH_TOOLS = new Set<ToolName>([
    "single_click",
    "double_click",
    "right_click",
    "hover",
    "drag",
    "scroll",
  ]);

  private broadcastContext(ctx: AgentExecutionContext) {
    try {
      const payload = { ...ctx };
      BrowserWindow.getAllWindows().forEach((win) =>
        win.webContents.send("agent-context-updated", payload)
      );
    } catch (err) {
      this.logger.warn(`Failed to broadcast context: ${err}`);
    }
  }

  constructor(
    logger: Logger,
    mainWindow: BrowserWindow | null,
    hooks?: { onAutoStop?: (reason: "no_jobs") => void }
  ) {
    this.logger = logger;
    this.mainWindow = mainWindow;
    this.apiClient = new APIClient(this.logger);
    this.onAutoStop = hooks?.onAutoStop;

    this.logger.system("Orchestrator initialized (TestCase runner mode).");

    if (this.mainWindow) {
      this.executor = new Executor(this.logger, this.handleToolLifecycle);
      this.tools = makeToolRegistry(this.executor);
    }
  }

  private setClickThrough(enabled: boolean) {
    BrowserWindow.getAllWindows().forEach((win) => {
      try {
        win.setIgnoreMouseEvents(enabled, { forward: true });
      } catch (err) {
        this.logger.warn(
          `Failed to ${enabled ? "enable" : "disable"} click-through: ${err}`
        );
      }
    });
  }

  private enableClickThrough() {
    this.clickThroughRefCount++;
    if (this.clickThroughRefCount === 1) {
      this.logger.system("Enabling click-through for tool execution.");
      this.setClickThrough(true);
    }
  }

  private disableClickThrough(force = false) {
    if (force) {
      this.clickThroughRefCount = 0;
    } else {
      this.clickThroughRefCount = Math.max(0, this.clickThroughRefCount - 1);
    }

    if (this.clickThroughRefCount === 0) {
      this.setClickThrough(false);
      this.logger.system("Click-through disabled.");
    }
  }

  private extractRawModelPoint(raw: any): {
    x: number;
    y: number;
    normalized?: boolean;
  } | null {
    if (!raw || typeof raw !== "object") return null;
    const x = Number(raw.x);
    const y = Number(raw.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const normalized = raw.normalized === true;
    return normalized ? { x, y, normalized } : { x, y };
  }

  private mapLastFocusToAnalysis(
    snapshot: {
      width: number;
      height: number;
      originX: number;
      originY: number;
    },
    analysisSize: number
  ): AgentExecutionContext["last_focus"] {
    if (!this.lastFocusScreen) return null;

    const captureX = Math.round(this.lastFocusScreen.x - snapshot.originX);
    const captureY = Math.round(this.lastFocusScreen.y - snapshot.originY);

    const insideBounds =
      captureX >= 0 &&
      captureY >= 0 &&
      captureX < snapshot.width &&
      captureY < snapshot.height;

    if (!insideBounds) return null;

    const scaleX = analysisSize / snapshot.width;
    const scaleY = analysisSize / snapshot.height;
    const analysisX = Math.min(
      analysisSize - 1,
      Math.max(0, Math.round(captureX * scaleX))
    );
    const analysisY = Math.min(
      analysisSize - 1,
      Math.max(0, Math.round(captureY * scaleY))
    );

    return {
      x: analysisX,
      y: analysisY,
      normalized: false,
      raw_model_coords: this.lastFocusRawModel ?? undefined,
    };
  }

  private async resizeForAnalysis(png: Buffer): Promise<Buffer> {
    const jimp = await import("jimp");
    const img = await jimp.default.read(png);
    if (
      img.bitmap.width === this.ANALYSIS_IMAGE_SIZE &&
      img.bitmap.height === this.ANALYSIS_IMAGE_SIZE
    ) {
      return png;
    }
    const resized = img.resize(
      this.ANALYSIS_IMAGE_SIZE,
      this.ANALYSIS_IMAGE_SIZE
    );
    return resized.getBufferAsync(jimp.default.MIME_PNG);
  }

  private handleToolLifecycle = ({ tool, phase }: ToolLifecycleEvent) => {
    if (!this.CLICK_THROUGH_TOOLS.has(tool)) return;
    if (phase === "start") {
      this.enableClickThrough();
    } else {
      this.disableClickThrough();
    }
  };

  // ======================================================
  // PUBLIC CONTROL METHODS (CALLED BY main.ts)
  // ======================================================

  /** Starts the agent workflow with optional initial human prompt. */
  public async start(initialPrompt: string | null = null): Promise<void> {
    this.initialHighLevelGoal = initialPrompt ?? null;
    return this._startInternal();
  }

  /** Pauses the agent workflow between steps. */
  public pauseWorkflow(): void {
    if (!this._isRunning) return;
    this._isPaused = true;
    this.logger.system("Workflow paused.");
    // Abort any in-flight vision request so we drop partial responses.
    if (this.visionAbortController) {
      this.logger.system("Aborting active vision request due to pause.");
      this.visionAbortController.abort();
    }
  }

  /** Resumes the agent workflow. */
  public resumeWorkflow(): void {
    if (!this._isRunning) return;
    this._isPaused = false;
    this.logger.system("Workflow resumed.");
  }

  /** Stops the orchestrator entirely. */
  public stop(): void {
    if (!this._isRunning) return;
    this.logger.system("Stopping orchestrator...");
    this._isRunning = false;
    this._isPaused = false;
    this.lastFocusScreen = null;
    this.lastFocusRawModel = null;
    this.currentEvaluation = null;
    this.currentTestCaseId = null;
    this.disableClickThrough(true);
    // Cancel any in-flight vision request to halt actions immediately.
    this.visionAbortController?.abort();
    this.broadcastEvaluationAttached(null);
  }

  private handleAutoStop(reason: "no_jobs") {
    if (!this._isRunning) return;
    this._isRunning = false;
    this._isPaused = false;
    this.currentEvaluation = null;
    this.currentTestCaseId = null;
    this.broadcastEvaluationAttached(null);
    this.onAutoStop?.(reason);
  }

  // ======================================================
  // INTERNAL MAIN LOOP (TESTCASE-RUNNER)
  // ======================================================

  private async _startInternal(): Promise<void> {
    if (this._isRunning) {
      this.logger.warn("Orchestrator already running.");
      return;
    }

    this._isRunning = true;
    this._isPaused = false;

    this.logger.system(
      `Started for executor_id='${EXECUTOR_ID}' (TestCase runner). Polling for testcases...`
    );

    while (this._isRunning) {
      try {
        // NEW: poll /api/v1/testcases/next
        const testCase: DesktopTestCase | null =
          await this.apiClient.requestNextTestCase(EXECUTOR_ID);

        if (!testCase) {
          this.logger.system(
            "No pending test cases. Auto-stopping orchestrator."
          );
          this.handleAutoStop("no_jobs");
          break;
        }

        // Fetch owning evaluation for UI display and app launch metadata
        let evaluation: EvaluationSummary | null = null;
        try {
          evaluation = await this.apiClient.getEvaluation(
            testCase.evaluation_id
          );
        } catch (err) {
          this.logger.warn(
            `Failed to fetch evaluation ${testCase.evaluation_id} for testcase ${testCase.id}: ${err}`
          );
        }

        this.currentEvaluation = evaluation;
        this.currentTestCaseId = String(testCase.id);

        this.logger.job(
          `Attached to TestCase ${testCase.id} (plan ${testCase.plan_id}, evaluation ${testCase.evaluation_id})`
        );
        this.broadcastEvaluationAttached(evaluation);

        await this.runTestCase(testCase, evaluation);
      } catch (err) {
        this.logger.error(`Error during testcase polling: ${err}`);
      }

      await sleep(4000);
    }

    this.logger.system("Orchestrator stopped.");
  }

  // ======================================================
  // APPLICATION LAUNCHING HELPERS
  // ======================================================

  private async launchApplication(filePath: string): Promise<void> {
    this.logger.system(`Launching desktop app: ${filePath}`);
    try {
      const proc = spawn(filePath, [], { detached: true, stdio: "ignore" });
      this.launchedProcess = proc;
      proc.unref();
      await sleep(5000);
    } catch (e) {
      this.logger.error(`Failed to launch application: ${e}`);
      throw e;
    }
  }

  private async launchWebURL(url: string): Promise<void> {
    this.logger.system(`Launching URL: ${url}`);

    const launch = (proc: ChildProcess, label: string) => {
      this.launchedProcess = proc;
      proc.unref();
      this.logger.system(`Browser launched via ${label}`);
    };

    try {
      if (process.platform === "win32") {
        const proc = spawn(
          "cmd",
          ["/c", "start", "", "msedge", "-inprivate", url],
          { detached: true, stdio: "ignore" }
        );

        proc.once("error", (err) => {
          this.logger.error(`Failed to launch Edge via start: ${err}`);
        });

        launch(proc, "start msedge -inprivate");
        return;
      }

      if (process.platform === "darwin") {
        // Prefer Edge InPrivate; fallback to default browser
        const edge = spawn(
          "open",
          ["-a", "Microsoft Edge", "--args", "-inprivate", url],
          { detached: true, stdio: "ignore" }
        );

        edge.once("error", () => {
          this.logger.warn(
            "Edge not available on macOS; using default browser"
          );
          const fallback = spawn("open", [url], {
            detached: true,
            stdio: "ignore",
          });
          launch(fallback, "macOS default browser");
        });

        launch(edge, "Microsoft Edge (InPrivate)");
        return;
      }

      // Linux
      const edge = spawn("microsoft-edge", ["-inprivate", url], {
        detached: true,
        stdio: "ignore",
      });

      edge.once("error", () => {
        this.logger.warn("Edge not available on Linux; trying fallbacks");

        const fallbacks: [string, string[]][] = [
          ["google-chrome", ["--incognito", url]],
          ["chromium", ["--incognito", url]],
          ["chromium-browser", ["--incognito", url]],
          ["xdg-open", [url]],
        ];

        for (const [cmd, args] of fallbacks) {
          try {
            const p = spawn(cmd, args, { detached: true, stdio: "ignore" });
            p.once("error", () => {});
            launch(p, cmd);
            return;
          } catch {
            /* try next */
          }
        }

        this.logger.error("No available browser found on Linux");
      });

      launch(edge, "Microsoft Edge (InPrivate)");
    } catch (err) {
      this.logger.error(`Failed to open URL: ${err}`);
    }
  }

  // ======================================================
  // TESTCASE EXECUTION
  // ======================================================

  private async runTestCase(
    testCase: DesktopTestCase,
    evaluation: EvaluationSummary | null
  ): Promise<void> {
    const testCaseId = testCase.id;
    let finalStatus: "completed" | "failed" = "failed";
    let finalResults: Record<string, any> | null = null;
    let context: AgentExecutionContext | null = null;

    this.lastFocusScreen = null;
    this.lastFocusRawModel = null;
    this.currentTestCaseId = String(testCaseId);

    this.logger.divider(`Start TestCase ${testCaseId}`, "JOB");

    try {
      // ----------------------------------------------
      // Launch target environment (from evaluation)
      // ----------------------------------------------
      const targetUrl = evaluation?.app_url || null;
      const localAppPath =
        evaluation?.local_application_path ||
        (evaluation as any)?.application_path ||
        evaluation?.app_path ||
        null;

      if (targetUrl) {
        await this.launchWebURL(targetUrl);
      } else if (localAppPath) {
        await this.launchApplication(localAppPath);
      } else {
        this.logger.job(
          "No target provided on evaluation; assuming environment is already open."
        );
      }

      // Mark testcase in_progress
      await this.apiClient.updateTestCaseStatus(testCaseId, "in_progress");

      // ----------------------------------------------
      // Build initial context for this TestCase
      // ----------------------------------------------
      const evalHighLevelGoal =
        (evaluation as any)?.high_level_goal &&
        typeof (evaluation as any).high_level_goal === "string"
          ? String((evaluation as any).high_level_goal)
          : null;

      const derivedGoal =
        (testCase.description && testCase.description.trim()) ||
        (testCase.name && testCase.name.trim()) ||
        (evalHighLevelGoal && evalHighLevelGoal.trim()) ||
        this.initialHighLevelGoal ||
        "Execute the assigned test case.";

      context = {
        high_level_goal: derivedGoal,
        description: derivedGoal,
        test_case_description: derivedGoal,
        scratchpad: "",
        action_history: [],
        action_history_descriptions: [],
        variables: {},
        last_focus: null,
        test_case_id: testCaseId,
      };

      this.broadcastContext(context);

      // ==================================================
      // MAIN STEP LOOP (per TestCase, max 40 steps)
      // ==================================================
      for (let step = 1; step <= 40; step++) {
        if (!this._isRunning) break;

        // Pause gate
        while (this._isPaused && this._isRunning) {
          await sleep(200);
        }

        this.logger.divider(`Step ${step}`);

        // ----------------------------------------------
        // SCREENSHOT + BRIGHTNESS CHECK
        // ----------------------------------------------
        let snapshot: {
          png: Buffer;
          width: number;
          height: number;
          originX: number;
          originY: number;
        } | null = null;

        for (let retry = 1; retry <= 3; retry++) {
          snapshot = await this.executor.takeScreenSnapshot();

          if (!snapshot) {
            this.logger.capture(`Screenshot failed (retry ${retry})`);
            await sleep(300);
            continue;
          }

          const jimp = await import("jimp");
          const img = await jimp.default.read(snapshot.png);
          const sample = img.clone().resize(20, 20);

          let avg = 0;
          for (let y = 0; y < 20; y++) {
            for (let x = 0; x < 20; x++) {
              const { r, g, b } = jimp.default.intToRGBA(
                sample.getPixelColor(x, y)
              );
              avg += (r + g + b) / 3;
            }
          }
          avg /= 400;

          if (avg < 8) {
            this.logger.capture(
              `Capture too dark (avg ${avg.toFixed(1)}). Retrying...`
            );
            await sleep(300);
            continue;
          }

          break;
        }

        if (!snapshot) {
          this.logger.error("No usable screenshot. Aborting testcase.");
          break;
        }

        // Display screenshot
        const screenshotDataUrl = `data:image/png;base64,${snapshot.png.toString("base64")}`;
        this.mainWindow?.webContents.send(
          "agent-view-update",
          screenshotDataUrl
        );

        // Map last click (if any) into the current capture space for context_json.
        context.last_focus = this.mapLastFocusToAnalysis(
          snapshot,
          this.ANALYSIS_IMAGE_SIZE
        );

        // ----------------------------------------------
        // VISION ANALYSIS (LLM - non-streaming)
        // ----------------------------------------------
        this.logger.agent(
          `Running vision analysis for TestCase ${testCaseId}...`
        );

        let analysis: VisionActionPayload | null = null;
        const maxAnalysisRetries = 2;
        const isTransientAnalysisError = (err: any) => {
          const msg = (err?.message || "").toLowerCase();
          return (
            msg.includes("socket hang up") ||
            msg.includes("econnreset") ||
            msg.includes("connection aborted") ||
            msg.includes("stream error") ||
            msg.includes("timeout")
          );
        };

        for (let attempt = 1; attempt <= maxAnalysisRetries + 1; attempt++) {
          // Prepare abort controller for this request
          this.visionAbortController = new AbortController();

          try {
            const { action_history_descriptions, ...restContext } = context;
            const sanitizedContext: AgentExecutionContext = {
              ...restContext,
              action_history: action_history_descriptions?.length
                ? action_history_descriptions
                : context.action_history,
            };

            const analysisPng = await this.resizeForAnalysis(snapshot.png);
            analysis = await this.apiClient.analyzeImageAndContext(
              sanitizedContext,
              analysisPng,
              { signal: this.visionAbortController.signal }
            );
            break;
          } catch (err: any) {
            const message = err?.message || String(err);
            const transient = isTransientAnalysisError(err);
            this.logger.error(
              `Vision analysis failed (attempt ${attempt}): ${message}`
            );

            if (
              attempt <= maxAnalysisRetries &&
              transient &&
              this._isRunning &&
              !this._isPaused
            ) {
              this.logger.system(
                "Retrying vision analysis after transient error..."
              );
              await sleep(400);
              continue;
            }
          } finally {
            // Clear controller after request completes or aborts
            this.visionAbortController = null;
          }

          // Non-transient or exhausted retries; exit loop.
          break;
        }

        // If paused mid-request, drop the response and retry on resume.
        if (this._isPaused) {
          this.logger.warn(
            "Workflow paused mid-analysis; dropping action and retrying after resume."
          );
          while (this._isPaused && this._isRunning) {
            await sleep(200);
          }
          // Retry this step after resume.
          step--;
          continue;
        }

        // If we were stopped during analysis, exit early.
        if (!this._isRunning) {
          this.logger.warn(
            "Orchestrator stopped mid-analysis. Exiting testcase loop."
          );
          break;
        }

        const streamedThoughtRaw = analysis?.thought ?? "";
        const streamedThought = streamedThoughtRaw.trim();
        const streamedAction = analysis?.action;

        if (!streamedAction) {
          if (this._isRunning) {
            this.logger.error("Vision analysis returned no action.");
          }
          break;
        }

        if (streamedThought) {
          // Keep a running scratchpad so prior reasoning remains visible.
          context.scratchpad = context.scratchpad
            ? `${context.scratchpad}\n\n${streamedThought}`
            : streamedThought;
        }
        const actionDescription =
          typeof analysis?.description === "string" &&
          analysis.description.trim().length > 0
            ? analysis.description.trim()
            : streamedAction.tool_name
              ? streamedAction.tool_name
              : `Step ${step}`;

        const detailedEntry = `Step ${step}: ${streamedAction.tool_name}(${JSON.stringify(
          streamedAction.parameters
        )})`;

        context.action_history.push(detailedEntry);
        context.action_history_descriptions?.push(actionDescription);

        this.broadcastContext(context);

        this.pushRunTimelineEntry({
          stepIndex: step,
          thought: streamedThoughtRaw,
          action: {
            tool_name: streamedAction.tool_name,
            parameters: streamedAction.parameters ?? {},
          },
          screenshot: screenshotDataUrl,
          timestamp: new Date().toISOString(),
          evaluationId: this.currentEvaluation?.id ?? evaluation?.id ?? null,
          testCaseId: this.currentTestCaseId,
        });

        const toolName = streamedAction.tool_name as ToolName;
        const params = streamedAction.parameters ?? {};

        // ----------------------------------------------
        // FINISH TASK => end TestCase
        // ----------------------------------------------
        if (toolName === "finish_task") {
          const summary =
            typeof params?.summary === "string"
              ? params.summary
              : params?.summary != null
                ? JSON.stringify(params.summary)
                : null;

          const maybeResult =
            params && typeof params.result === "object" ? params.result : null;

          const resultPayload: Record<string, any> = {};
          if (summary) {
            resultPayload.summary = summary;
          }
          if (maybeResult) {
            Object.assign(resultPayload, maybeResult);
          } else if (typeof params?.message === "string") {
            resultPayload.message = params.message;
          } else {
            const { status, summary: _s, result: _r, ...rest } = params ?? {};
            if (rest && Object.keys(rest).length > 0) {
              Object.assign(resultPayload, rest);
            }
          }

          if (Object.keys(resultPayload).length > 0) {
            finalResults = resultPayload;
          }

          finalStatus = params.status === "success" ? "completed" : "failed";
          break;
        }

        // ----------------------------------------------
        // TOOL EXECUTION (click / drag / keyboard / etc)
        // ----------------------------------------------
        const mapPointToScreen = (pt: { x: number; y: number }) => {
          const normalized = params.normalized === true;
          const space = params.space;

          if (space === "capture") {
            return {
              x: snapshot.originX + pt.x,
              y: snapshot.originY + pt.y,
            };
          }

          if (space === "screen") {
            return pt;
          }

          const mapper = makeImageToScreenMapper({
            capture: {
              width: snapshot.width,
              height: snapshot.height,
              originX: snapshot.originX,
              originY: snapshot.originY,
            },
            analysis: {
              width: this.ANALYSIS_IMAGE_SIZE,
              height: this.ANALYSIS_IMAGE_SIZE,
            },
            normalized,
            stretch: true,
          });

          return mapper.toScreenPoint({ x: pt.x, y: pt.y });
        };

        if (
          toolName === "single_click" ||
          toolName === "double_click" ||
          toolName === "right_click" ||
          toolName === "hover"
        ) {
          try {
            const pt = mapPointToScreen({ x: params.x, y: params.y });
            await this.tools[toolName]?.(pt);
            this.lastFocusScreen = pt;
            this.lastFocusRawModel = this.extractRawModelPoint(
              params?.raw_model_coords
            );
          } catch (e) {
            this.logger.error(`Mapping failed: ${e}`);
          }
        } else if (toolName === "drag") {
          try {
            const from = mapPointToScreen(params.from || params.start || {});
            const to = mapPointToScreen(params.to || params.end || {});
            await this.tools.drag?.({ from, to });
            this.lastFocusScreen = to;
            const rawTo =
              this.extractRawModelPoint(
                params?.raw_model_coords?.to ?? params?.raw_model_coords
              ) ?? null;
            this.lastFocusRawModel = rawTo;
          } catch (e) {
            this.logger.error(`Mapping failed: ${e}`);
          }
        } else if (this.tools[toolName]) {
          await this.tools[toolName]?.(params);
        } else {
          this.logger.error(`Unknown tool: ${toolName}`);
          break;
        }

        await sleep(900);
      }
    } catch (e) {
      this.logger.error(`Unexpected testcase error: ${e}`);
      finalStatus = "failed";
    } finally {
      this.logger.divider(
        `TestCase ${testCaseId} finished (${finalStatus})`,
        "JOB"
      );

      // Build TestCase result payload
      const resultPayload: Record<string, any> = finalResults
        ? { ...finalResults }
        : {};

      // Always attach steps and success flag
      resultPayload.steps = context?.action_history ?? [];
      if (resultPayload.success === undefined) {
        resultPayload.success = finalStatus === "completed";
      }
      if (
        finalStatus === "failed" &&
        resultPayload.failure_reason === undefined
      ) {
        resultPayload.failure_reason =
          "Agent ended without an explicit success signal.";
      }

      await this.apiClient.updateTestCaseStatus(
        testCaseId,
        finalStatus,
        resultPayload
      );

      // Notify renderers to refresh task history for latest status/results
      BrowserWindow.getAllWindows().forEach((win) =>
        win.webContents.send("history:refresh")
      );

      this.lastFocusScreen = null;
      this.lastFocusRawModel = null;
      this.disableClickThrough(true);
      this.currentEvaluation = null;
      this.currentTestCaseId = null;
      this.broadcastEvaluationAttached(null);
      await this.closeLaunchedApplication();
    }
  }

  private async closeLaunchedApplication(): Promise<void> {
    const proc = this.launchedProcess;
    this.launchedProcess = null;
    if (!proc || proc.killed) return;

    const pid = proc.pid;
    try {
      if (process.platform === "win32" && pid) {
        // taskkill to close the window tree on Windows.
        spawn("taskkill", ["/PID", String(pid), "/T", "/F"], {
          detached: true,
          stdio: "ignore",
        });
      } else if (pid) {
        proc.kill("SIGTERM");
      } else {
        proc.kill();
      }
      this.logger.system("Closed launched application after testcase.");
    } catch (err) {
      this.logger.warn(`Failed to close launched application: ${err}`);
    }
  }

  // ======================================================
  // JOB CREATION HELPERS (still Evaluation-level)
  // ======================================================

  public async createNewEvaluation(
    filePath: string,
    highLevelGoal?: string | null,
    appName?: string | null,
    appVersion?: string | null,
    appType?: "desktop_app" | "web_app" | null
  ): Promise<number | null> {
    try {
      const result = await this.apiClient.createEvaluationWithUpload(
        filePath,
        EXECUTOR_ID,
        highLevelGoal,
        appName,
        appVersion,
        appType || undefined
      );
      if (result) {
        this.logger.job(`Created evaluation job ${result.id}`);
        return result.id;
      } else {
        this.logger.error("Failed to create evaluation job.");
        return null;
      }
    } catch (e) {
      this.logger.error(`Unexpected error: ${e}`);
      return null;
    }
  }

  public async createNewUrlEvaluation(
    url: string,
    highLevelGoal?: string | null,
    appName?: string | null,
    appVersion?: string | null,
    appType?: "desktop_app" | "web_app" | null
  ): Promise<number | null> {
    try {
      const result = await this.apiClient.createEvaluationFromURL(
        url,
        EXECUTOR_ID,
        highLevelGoal,
        appName,
        appVersion,
        appType || undefined
      );
      if (result) {
        this.logger.job(`Created URL job ${result.id}`);
        return result.id;
      } else {
        this.logger.error("Failed to create URL job.");
        return null;
      }
    } catch (e) {
      this.logger.error(`Unexpected error: ${e}`);
      return null;
    }
  }

  public async createNewLiveEvaluation(
    highLevelGoal?: string | null,
    appType: "desktop_app" | "web_app" | null = "desktop_app",
    appName?: string | null,
    appVersion?: string | null
  ): Promise<number | null> {
    try {
      const result = await this.apiClient.createLiveEvaluation(
        EXECUTOR_ID,
        highLevelGoal,
        appType || "desktop_app",
        appName,
        appVersion
      );
      if (result) {
        this.logger.job(`Created live job ${result.id}`);
        return result.id;
      } else {
        this.logger.error("Failed to create live evaluation.");
        return null;
      }
    } catch (e) {
      this.logger.error(`Unexpected error: ${e}`);
      return null;
    }
  }
}
