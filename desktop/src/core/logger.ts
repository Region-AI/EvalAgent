export type LogLevel =
  | "SYSTEM"
  | "JOB"
  | "AGENT"
  | "TOOL"
  | "CAPTURE"
  | "WARN"
  | "ERROR";

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string; // ISO 8601 format
  divider?: boolean;
  label?: string;
}

/**
 * A callback function that the Logger uses to broadcast
 * structured log entries to an external handler, like the main process UI bridge.
 */
type LogBroadcastCallback = (entry: LogEntry) => void;

/**
 * A centralized logger that provides semantic logging levels for the agent.
 * It creates structured log entries and broadcasts them for the UI.
 */
export class Logger {
  private broadcastCallback: LogBroadcastCallback;

  constructor(broadcastCallback: LogBroadcastCallback) {
    this.broadcastCallback = broadcastCallback;
  }

  private log(
    level: LogLevel,
    message: string,
    extra: Partial<LogEntry> = {}
  ): void {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...extra,
    };

    // Log to the console for backend debugging
    console.log(`[${entry.timestamp}] [${level}] ${message}`);

    // Broadcast the structured entry to the UI
    this.broadcastCallback(entry);
  }

  public system(message: string, extra?: Partial<LogEntry>): void {
    this.log("SYSTEM", message, extra);
  }
  public job(message: string, extra?: Partial<LogEntry>): void {
    this.log("JOB", message, extra);
  }
  public agent(message: string, extra?: Partial<LogEntry>): void {
    this.log("AGENT", message, extra);
  }
  public tool(message: string, extra?: Partial<LogEntry>): void {
    this.log("TOOL", message, extra);
  }
  public capture(message: string, extra?: Partial<LogEntry>): void {
    this.log("CAPTURE", message, extra);
  }
  public warn(message: string, extra?: Partial<LogEntry>): void {
    this.log("WARN", message, extra);
  }
  public error(message: string, extra?: Partial<LogEntry>): void {
    this.log("ERROR", message, extra);
  }
  public divider(label: string, level: LogLevel = "JOB"): void {
    this.log(level, label, { divider: true, label });
  }
}
