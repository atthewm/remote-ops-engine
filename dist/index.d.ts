/**
 * Remote Coffee Operations Engine
 *
 * Proactive alerting and digest system for operational excellence.
 * Integrates MarginEdge, Toast, and Microsoft 365 via MCP servers.
 *
 * Modes:
 *   shadow (default): Evaluate rules and log results without posting live
 *   live: Post messages to Teams, create tasks, full operation
 *   test: Run against historical data if available
 *
 * Usage:
 *   ALERT_MODE=shadow node dist/index.js          # scheduled shadow mode
 *   ALERT_MODE=shadow node dist/index.js --run-all # one shot, all rules
 *   ALERT_MODE=shadow node dist/index.js --family readiness  # one rule family
 *   ALERT_MODE=live node dist/index.js             # scheduled live mode
 */
export {};
