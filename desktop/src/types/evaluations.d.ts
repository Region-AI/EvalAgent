/**
 * Frontend domain models for evaluations and test plans.
 * These mirror the backend intent so renderer/main can type against them as the UI evolves.
 */
type EvaluationStatus =
  | "PENDING"
  | "GENERATING"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "READY"
  | "COMPLETED"
  | "FAILED"
  | "pending"
  | "generating"
  | "assigned"
  | "in_progress"
  | "ready"
  | "completed"
  | "failed";

export interface EvaluationSummary {
  id: number;
  status: EvaluationStatus;
  app_type: "desktop_app" | "web_app";
  app_name?: string | null;
  app_version?: string | null;
  app_version_id?: number | null;
  app_path?: string | null;
  app_url?: string | null;
  execution_mode: "cloud" | "local";
  assigned_executor_id?: string | null;
  results?: any;
  local_application_path?: string | null;
}

type TestCaseStatus =
  | "PENDING"
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED"
  | "pending"
  | "assigned"
  | "in_progress"
  | "completed"
  | "failed";

export interface TestCaseSummary {
  id: string;
  name: string;
  description?: string;
  status:
    | TestCaseStatus
    | "RUNNING"
    | "PASSED"
    | "SKIPPED"
    | "running"
    | "passed"
    | "skipped";
  tags?: string[];
  lastRunAt?: string;
  lastResultSummary?: string;
}

type TestPlanStatus =
  | "PENDING"
  | "GENERATING"
  | "READY"
  | "COMPLETED"
  | "FAILED"
  | "pending"
  | "generating"
  | "ready"
  | "completed"
  | "failed";

export interface TestPlanNode {
  id: string;
  title: string;
  status: TestPlanStatus | "RUNNING" | "PASSED" | "FAILED" | "MIXED" | "running" | "passed" | "failed" | "mixed";
  children?: TestPlanNode[];
  testCaseId?: string; // leaf nodes map to test cases
}
