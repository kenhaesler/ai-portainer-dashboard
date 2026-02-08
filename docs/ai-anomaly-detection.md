# AI & Anomaly Detection Techniques

The monitoring pipeline runs a multi-phase analysis on every cycle (default: every 5 minutes). Each technique operates independently and degrades gracefully when its prerequisites are unavailable.

## Statistical Anomaly Detection

Three statistical methods detect anomalies on a per-container, per-metric basis using historical time-series data:

| Method | Algorithm | Best For |
|--------|-----------|----------|
| **Z-Score** | Deviation from rolling mean / std. dev. | Stable workloads with low variance |
| **Bollinger Bands** | Price-channel approach (mean +/- k x sigma) | Workloads with natural oscillation |
| **Adaptive** | Auto-selects best method per container | General-purpose (default) |

Configuration: `ANOMALY_DETECTION_METHOD` (default: `adaptive`), plus threshold and window settings in the [configuration reference](configuration.md#anomaly-detection).

## Isolation Forest (ML)

A from-scratch implementation of the Isolation Forest algorithm (zero external dependencies). Isolation Forest detects anomalies by recursively partitioning data — anomalous points require fewer splits to isolate and thus have shorter average path lengths.

**How it works:**
1. Training data is built from 7 days of `[cpu, memory]` metric pairs per container (minimum 50 samples required)
2. A forest of randomized isolation trees is constructed, each using a random subsample
3. For each new data point, the anomaly score is computed as `2^(-E(h(x)) / c(n))` where `c(n)` is the expected path length of an unsuccessful BST search
4. Points scoring above the contamination threshold are flagged as anomalous

**Key properties:**
- Multivariate: considers CPU and memory simultaneously, catching correlated anomalies that per-metric methods miss
- Per-container model caching with configurable retrain interval (default: 6 hours)
- Skips containers already flagged by statistical detection to avoid duplicates
- Falls back silently when insufficient training data is available

Configuration: `ISOLATION_FOREST_ENABLED`, `ISOLATION_FOREST_TREES`, `ISOLATION_FOREST_SAMPLE_SIZE`, `ISOLATION_FOREST_CONTAMINATION`, `ISOLATION_FOREST_RETRAIN_INTERVAL`.

## Predictive Alerting

Linear regression on recent metric trends forecasts when resource usage will hit critical thresholds. Generates predictive insights with severity based on time-to-threshold:

| Time to Threshold | Severity |
|-------------------|----------|
| < 6 hours | Critical |
| 6-12 hours | Warning |
| 12-24 hours | Info |

Only fires for increasing trends with medium or high confidence. Configuration: `PREDICTIVE_ALERTING_ENABLED`, `PREDICTIVE_ALERT_THRESHOLD_HOURS`.

## Anomaly Explanations (LLM)

When anomalies are detected and Ollama is available, the system sends anomaly context (metric values, container info, historical baseline) to the LLM for a plain-English explanation. The AI analysis is appended to the insight description.

Configuration: `ANOMALY_EXPLANATION_ENABLED`, `ANOMALY_EXPLANATION_MAX_PER_CYCLE`.

## NLP Log Analysis (LLM)

During each monitoring cycle, the system can analyze container logs using the LLM to detect error patterns, warnings, and concerning trends that metric-based detection would miss.

**How it works:**
1. Fetches the most recent log lines from running containers via the Portainer API
2. Sends logs to the LLM with a structured prompt requesting JSON output: `{ severity, summary, errorPatterns[] }`
3. Generates `log-analysis` category insights for containers with detected issues

Processing is sequential to avoid overwhelming the LLM backend. Skipped entirely when Ollama is unavailable. Configuration: `NLP_LOG_ANALYSIS_ENABLED`, `NLP_LOG_ANALYSIS_MAX_PER_CYCLE`, `NLP_LOG_ANALYSIS_TAIL_LINES`.

## Root Cause Investigation (LLM)

Triggered automatically when critical anomalies are detected. The investigation service collects comprehensive context (metrics, logs, container config) and sends it to the LLM for deep-dive root cause analysis. Results are stored as investigations linked to the triggering insight.

Configuration: `INVESTIGATION_ENABLED`, `INVESTIGATION_COOLDOWN_MINUTES`, `INVESTIGATION_MAX_CONCURRENT`.

## Smart Alert Grouping

Alerts are correlated into incidents using three strategies:

| Strategy | Algorithm | Trigger |
|----------|-----------|---------|
| **Dedup** | Same container ID | Multiple anomalies on one container |
| **Cascade** | Same endpoint, multiple containers | Host-level or network-level issue |
| **Semantic** | Jaccard text similarity on alert titles/descriptions | Alerts with similar wording across containers |

The semantic grouping pass uses union-find clustering with path compression. Insights with Jaccard similarity above the threshold are merged into incident groups.

When Ollama is available and `INCIDENT_SUMMARY_ENABLED` is on, grouped incidents receive an LLM-generated summary explaining the likely relationship between the alerts. Otherwise, a rule-based summary is generated.

Configuration: `SMART_GROUPING_ENABLED`, `SMART_GROUPING_SIMILARITY_THRESHOLD`, `INCIDENT_SUMMARY_ENABLED`.

## Graceful Degradation

All AI features degrade gracefully based on available infrastructure:

| Feature | Ollama Down | Insufficient Data |
|---------|-------------|-------------------|
| Statistical detection | Works (no LLM needed) | Falls back to fewer methods |
| Isolation Forest | Works (no LLM needed) | Skipped (< 50 samples) |
| Predictive alerting | Works (no LLM needed) | Skipped (low confidence) |
| Anomaly explanations | Skipped | N/A |
| NLP log analysis | Skipped entirely | Skipped (empty logs) |
| Root cause investigation | Skipped | N/A |
| Smart alert grouping | Text similarity still works | N/A |
| Incident summaries | Rule-based fallback | N/A |
