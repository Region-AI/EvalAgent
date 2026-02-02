Generate a **deep, structured Markdown evaluation report** based on the completed test run.

This report should read like a **senior QA + product + engineering review**.

────────────────────────────────
CORE VISUALIZATION RULE (CRITICAL)
────────────────────────────────

Use **tables ONLY when summarizing repeated entities**.

A table MUST be used when:
- There are multiple comparable entities (e.g., test cases, categories, defects)
- Each entity shares the same attributes
- Comparison or pattern recognition adds value

A table MUST NOT be used when:
- The content is a single judgment or decision
- The value comes from reasoning, causality, or synthesis
- Each item requires unique narrative explanation

Tables summarize **state**.
Narrative explains **cause and impact**.

Do NOT add tables unless explicitly instructed below.

---

## 1. Executive Summary (NARRATIVE ONLY)

This section contains a **single overall judgment**.

Include:
- Overall evaluation outcome (PASS / PARTIAL PASS / FAIL)
- High-level assessment of application readiness
- One concise paragraph explaining the decision

❌ Do NOT use tables in this section.

---

## 2. Evaluation Coverage Analysis

This section summarizes **repeated evaluation categories**.

### [TABLE REQUIRED] Coverage Matrix by Category

Use a table because categories are repeated and comparable.

| Category | Fully Evaluated | Partially Evaluated | Not Evaluated | Blocked |
|---------|-----------------|---------------------|---------------|---------|

Include all evaluation categories.

---

### Coverage Interpretation (NARRATIVE ONLY)

Explain:
- Why certain categories are partial or blocked
- Which gaps introduce the highest risk
- Which gaps are acceptable vs unacceptable

❌ Do NOT use tables here.

---

## 3. Test Case Outcome Analysis

This section analyzes **repeated test cases**.

### [TABLE REQUIRED] Test Case Outcome Matrix

Use a table to summarize outcomes **across identical dimensions** for each test case.

| Test Case | Navigable | Feature Available | Data Correct | Permission Correct | Stable |
|----------|-----------|-------------------|--------------|--------------------|--------|

Use:
- Yes / No / Not evaluated

This table is intended for pattern detection (e.g., navigation failures).

---

### Per-Test Case Findings (NARRATIVE ONLY)

For **each test case**, describe:
- Observed behavior
- Expected behavior
- What failed or succeeded
- Evidence (UI state, errors, outputs)

Do NOT restate information already captured in the table.
❌ Do NOT use tables here.

---

## 4. Defect Analysis

This section summarizes **repeated defects**, then explains them.

### [TABLE REQUIRED] Defect Severity Distribution

| Severity | Count |
|---------|-------|

---

### [TABLE REQUIRED] Defects by Functional Area

| Area | Issue Count |
|-----|-------------|

---

### Defect Descriptions (NARRATIVE ONLY)

For each defect:
- Description
- Severity
- Impact
- Related test cases

❌ Do NOT use tables here.

---

## 5. UX & Accessibility Evaluation

### [TABLE REQUIRED] UX & Accessibility Coverage Matrix

Use a table to summarize **coverage state**, not detailed findings.

| Dimension | Evaluated | Issue Observed |
|----------|-----------|----------------|

---

### UX & Accessibility Findings (NARRATIVE ONLY)

Describe concrete usability and accessibility issues, user impact, and examples.

❌ Do NOT use tables here.

---

## 6. Performance & Stability Evaluation

### [TABLE REQUIRED] Stability Signals Across the System

Use a small checklist-style table.

| Signal | Observed |
|------|----------|

---

### Performance Interpretation (NARRATIVE ONLY)

Explain risks, instability patterns, and evaluation limitations.

❌ Do NOT use tables here.

---

## 7. Security & Data Integrity Evaluation

### [TABLE REQUIRED] Security Risk Surface

Use a table to summarize **repeated security domains**.

| Area | Evaluated | Issue Detected |
|-----|-----------|----------------|

---

### Security Interpretation (NARRATIVE ONLY)

Explain ambiguity, risk implications, and missing evidence.

❌ Do NOT use tables here.

---

## 8. Inferred Insights & Systemic Risks (NARRATIVE ONLY)

This section contains **hypotheses and inferences**, not observations.

- Architectural weaknesses
- Likely failure modes
- Integration risks

❌ Do NOT use tables or charts in this section.

---

## 9. Recommended Follow-Up Tests

### [TABLE REQUIRED] Follow-Up Test Plan

Use a table because this is a **repeated planning list**, not analysis.

| Area | Priority | Rationale |
|-----|----------|-----------|

Do NOT convert this table into charts.

---

## 10. Final Assessment (NARRATIVE ONLY)

Provide:
- Overall confidence
- Primary blocking risks
- Clear Go / No-Go recommendation

❌ Do NOT use tables in this section.

---

## Rules
- Output **Markdown only**
- Do NOT include JSON
- Do NOT invent data
- Use tables **only** where explicitly required
- Narrative everywhere else

---

## Inputs

### Test Plan Summary
{plan_summary}

### Executed Test Cases (JSON)
{test_cases}
