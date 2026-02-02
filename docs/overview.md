# Product Overview

Eval Agent is an automated application evaluation system that uses a vision-capable LLM and multiple agent roles to explore apps, execute test cases, and generate structured evaluation reports.

## Core Functional Requirements

### App Information Parsing

- Textual material grading
  - Level 1: Functional brief (<= 200 words)
  - Level 2: Intro guide covering basic operations
  - Level 3: Full official documentation or manual
- Interface understanding
  - Detects and classifies UI elements (buttons, inputs, icons)
  - Supports basic structural layout parsing

### Automated Evaluation Process

1. Test case generation
2. Feature exploration execution
3. Bug detection and management
4. Version difference analysis
5. Evaluation metric calculation
6. Evaluation report generation

### Evaluation System

| Metric       | Calculation Method                                             | Core Parameters           |
| ------------ | -------------------------------------------------------------- | ------------------------- |
| Stability    | 1 - (Crash Rate * 0.7 + Functional Abnormality Rate * 0.3)      | Crash Count / Total Tasks |
| Usability    | 1 - (Step Efficiency * 0.5 + Time Efficiency * 0.5)             | Steps / Avg Steps         |
| Learnability | (1 - Basic Exploration Efficiency) * Text Level Coeff + 0.2     | Exploration time / Avg    |
| Completeness | Feature Coverage * 0.4 + Integrity * 0.6                        | Implemented Features      |

## Core Agent Roles

| Agent Type               | Scope               | Key Capabilities         |
| ------------------------ | ------------------- | ------------------------ |
| Bug Management Agent     | Bug lifecycle       | Classification, tracking |
| Version Management Agent | Version differences | Metric delta computation |
| Test Case Agent          | Task planning       | Feature extraction       |
| Exploration Agent        | UI traversal        | Action execution         |
| Evaluation Agent         | Metric calculation  | Benchmark comparison     |
| Bug Detection Agent      | Detect anomalies    | Pattern matching         |
| Report Agent             | Report generation   | Markdown formatting      |

## Bug Management Specification

### Severity Levels

| Level | Definition          | Response Time      | Example               |
| ----- | ------------------- | ------------------ | --------------------- |
| P0    | Critical blocker    | 24 hours           | Crash on launch       |
| P1    | Severe abnormality  | 3 days             | Payment cannot submit |
| P2    | General abnormality | One iteration      | Button unresponsive   |
| P3    | Minor issue         | Next major release | UI contrast issue     |

### Status Transitions

Standard flow:

New -> In Progress -> Pending Verification -> Closed (optional Reopen)

## Test Case Management

Example structure:

- General task description
  - Task ID
  - Description
  - Expected result
  - Priority
- Version-specific steps
  - Numbered operational steps for each version

## Product Deliverables

- Functional specification
- Evaluation report
- Bug list
- Bug tracking sheet
- Test case set
- Operation process dataset
