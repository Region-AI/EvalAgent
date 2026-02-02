#!/usr/bin/env bash
set -euo pipefail

LOG_DIR="app_evaluation_agent/logs"

if [ ! -d "$LOG_DIR" ]; then
  echo "No log directory at $LOG_DIR"
  exit 0
fi

# Remove common log artifacts and report what was deleted.
find "$LOG_DIR" -type f \( -name "*.log" -o -name "*.log.*" -o -name "*.jsonl" \) -print -delete

echo "Log cleanup complete under $LOG_DIR"
