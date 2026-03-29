# Architecture Overview

Remote Coffee Operations Engine: a proactive alerting and digest system that integrates MarginEdge, Toast, and Microsoft 365 via MCP (Model Context Protocol) servers.


## System Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     Remote Ops Engine (Node.js)                     │
│                                                                     │
│  ┌───────────┐   ┌─────────────┐   ┌──────────┐   ┌────────────┐  │
│  │ Scheduler  │──>│ Rules Engine │──>│ Cooldown │──>│  Router    │  │
│  │ (croner)   │   │ (8 families) │   │ & Dedup  │   │ (channel)  │  │
│  └───────────┘   └──────┬──────┘   └──────────┘   └─────┬──────┘  │
│                         │                                 │         │
│              ┌──────────┴──────────┐            ┌────────┴───────┐ │
│              │  Normalized Models   │            │   Formatter    │ │
│              │  (TypeScript types)  │            │   (HTML)       │ │
│              └──────────┬──────────┘            └────────┬───────┘ │
│                         │                                 │         │
│         ┌───────────────┼───────────────┐                 │         │
│         │               │               │                 │         │
│    ┌────┴────┐    ┌─────┴────┐   ┌──────┴──┐    ┌───────┴──────┐ │
│    │ ME MCP  │    │Toast MCP │   │M365 MCP │    │ Persistence  │ │
│    │ Client  │    │ Client   │   │ Client  │    │ (JSON + SP)  │ │
│    └────┬────┘    └─────┬────┘   └────┬────┘    └──────────────┘ │
└─────────┼───────────────┼─────────────┼──────────────────────────┘
          │               │             │
          ▼               ▼             ▼
   ┌──────────┐    ┌──────────┐   ┌──────────────────────────┐
   │MarginEdge│    │  Toast   │   │     Microsoft 365        │
   │   API    │    │   API    │   │  Teams · Planner · SP    │
   └──────────┘    └──────────┘   └──────────────────────────┘
```


## Data Flow

### 1. Ingestion (MCP Servers to Normalized Models)

Each MCP server is spawned as a child process using stdio transport. The engine's MCP client manager (`src/mcp/client.ts`) maintains persistent connections to three servers:

| Server | Source | Transport |
|--------|--------|-----------|
| MarginEdge MCP | `~/marginedge-mcp-server` | stdio |
| Toast MCP | `~/toast-mcp-server` | stdio |
| M365 MCP | `~/remote-m365-mcp` | stdio |

Tool calls return raw JSON responses. Each rule's `evaluate()` method calls the specific tools it needs and transforms the raw data into normalized TypeScript models defined in `src/models/normalized.ts`. This decouples rule logic from API response shapes.

### 2. Rule Evaluation (Normalized Models to Alerts)

The `RulesEngine` (`src/rules/engine.ts`) runs registered rule handlers sequentially (or in parallel if configured). Each handler:

1. Fetches data via MCP tool calls
2. Transforms responses into normalized models
3. Evaluates thresholds from `config/rules.json`
4. Returns a `RuleResult` containing zero or more `NotificationEvent` objects

### 3. Filtering (Cooldown and Dedup)

Before an alert is emitted, the engine checks:

1. **Fingerprint dedup:** Each alert has a fingerprint composed of `ruleId::storeId::dateWindow[::discriminator]`. If the same fingerprint fired recently, the alert is suppressed.
2. **Cooldown window:** Each rule family has a configurable cooldown period (in minutes). An alert is suppressed if its fingerprint was recorded within the cooldown window.

Cooldown state is persisted to `data/cooldowns.json` and survives process restarts.

### 4. Routing (Alerts to Channels)

The channel router (`src/routing/channel-router.ts`) maps each alert to the correct Teams channels based on:

- **Audience tags** on the alert (exec, ops, finance, marketing)
- **Routing rules** in `config/teams.json` (audience to channel mapping)
- **Exec gating:** The exec channel only receives red alerts and executive summaries. Yellow and green alerts are filtered out.

### 5. Formatting and Delivery

The formatter (`src/routing/formatter.ts`) converts alerts and digests into HTML compatible with the Microsoft Graph Teams channel message API. Four formatters exist:

| Formatter | Purpose |
|-----------|---------|
| `formatAlert` | Single alert with severity badge, metrics table, action items |
| `formatDailyOpsDigest` | End of day summary with sales, cost, and exception breakdown |
| `formatWeeklyExecSummary` | Weekly rollup with wins, misses, trends, and owner scorecard |
| `formatTaskCreatedNotice` | Confirmation message when a Planner task is created |

### 6. Task Creation

Red severity alerts automatically create a Planner task via the M365 MCP server (`src/tasks/task-creator.ts`). Tasks include the alert topic, recommended action, owner assignment, and due date. The Planner plan ID is configured via the `PLANNER_PLAN_ID` environment variable.

### 7. Persistence

Alerts are persisted to two locations:

| Location | Purpose |
|----------|---------|
| `data/alert-log.json` | Local JSON file, always on, source of truth |
| SharePoint list | Optional, activated by setting `SHAREPOINT_SITE_ID` and `SHAREPOINT_ALERT_LIST_ID` |

Alerts older than 90 days are archived automatically to `data/archive/` with a date stamped filename. The archive process runs as part of the cooldown purge cycle.


## Config Driven Design

All thresholds, schedules, routing rules, and watchlists are externalized to JSON config files under `config/`:

| File | Contents |
|------|----------|
| `rules.json` | Mode (shadow/live), schedules, thresholds per rule family, cooldowns, watchlists, category targets |
| `stores.json` | Store definitions with Toast GUID, MarginEdge ID, and timezone |
| `owners.json` | Owner roster with roles, domains, and M365 user IDs |
| `teams.json` | Team ID, channel IDs, audience to channel routing rules |

No thresholds are hardcoded in rule implementations. Changing a threshold, adding a store, or adjusting a schedule requires only a config edit and a process restart.


## Shadow vs. Live Mode

The engine supports three operating modes, controlled by the `ALERT_MODE` environment variable or `config/rules.json`:

| Mode | Behavior |
|------|----------|
| `shadow` | Evaluates all rules, logs results, persists alerts locally. Does **not** post to Teams or create Planner tasks. Use this for initial tuning. |
| `live` | Full operation: evaluates rules, routes alerts to Teams channels, creates Planner tasks for red alerts, logs to SharePoint. |
| `test` | Used by the backtest runner. Evaluates rules against historical date ranges, collects alerts in memory, writes a JSON report. No external side effects. |

The recommended rollout sequence:

1. Run in shadow mode for 2+ weeks
2. Review the backtest report (`npm run run:backtest`)
3. Tune thresholds based on false positive and noise analysis
4. Switch to live mode


## Cooldown and Dedup Strategy

Alert fatigue is managed through a two layer filtering system:

**Fingerprinting:** Each alert is assigned a fingerprint string that uniquely identifies the specific issue. The fingerprint format is `ruleId::storeId::dateWindow[::discriminator]`, where the optional discriminator adds specificity (e.g., a vendor ID for price spike alerts).

**Cooldown windows:** After an alert fires, the same fingerprint is suppressed for a configurable number of minutes. Each rule family has its own cooldown:

| Rule Family | Cooldown |
|-------------|----------|
| Readiness | 12 hours |
| Prime cost | 24 hours |
| Item margin | 7 days |
| Vendor price | 24 hours |
| Sales pace | 4 hours |
| Labor | 8 hours |
| Discount/comp/void | 24 hours |
| Stockout | 4 hours |

A global fallback cooldown of 120 minutes applies when a rule specific override is not configured.

**Purge cycle:** Expired cooldown entries (older than 7 days) are purged daily at midnight to keep the state file manageable.


## Scheduling Approach

The engine uses [croner](https://github.com/Hexagon/croner) for cron based job scheduling. All schedules are defined in `config/rules.json` and run in the `America/Chicago` timezone.

The scheduler maps schedule names to rule IDs by convention:

```
morningReadiness     -> readiness
readinessEscalation  -> readiness_escalation
dailyPrimeCost       -> prime_cost
itemMarginWeekly     -> item_margin
vendorPriceDaily     -> vendor_price
salesPaceMidDay      -> sales_pace
salesPaceAfternoon   -> sales_pace
laborEfficiency      -> labor
discountCompVoid     -> discount_comp_void
stockoutCheck        -> stockout
dailyOpsDigest       -> daily_ops_digest
weeklyExecSummary    -> weekly_exec_summary
```

One shot execution is also supported via CLI flags:
- `--run-all`: Evaluate all rules immediately
- `--family readiness`: Evaluate a single rule family
- `--health`: Check MCP server connectivity
- `--status`: Show currently open alerts


## Persistence Strategy

The engine uses a lightweight, file based persistence model appropriate for a single store operation:

| Data | Format | Location |
|------|--------|----------|
| Alert log | JSON array | `data/alert-log.json` |
| Alert archive | JSON files, date stamped | `data/archive/` |
| Cooldown state | JSON map | `data/cooldowns.json` |
| Backtest reports | JSON | `reports/` |
| Application logs | JSON (winston) | `logs/` |

The local JSON file is the source of truth. SharePoint list integration is an optional write through layer for auditability and team visibility.

For multi store deployments, the persistence layer can be migrated to a database (PostgreSQL, SQLite) without changing the rule or routing logic, since all reads and writes go through the `alert-log.ts` and `cooldown.ts` modules.


## Multi Store Extensibility

The engine is designed for single store operation today (Remote Coffee, Garland Rd) but supports multi store expansion through:

1. **Store registry:** `config/stores.json` holds an array of stores. Each store has its own Toast GUID and MarginEdge restaurant ID.
2. **Store scoped evaluation:** The engine passes `storeId` to every rule evaluation. Rules fetch data for the specific store.
3. **Store scoped alerts:** All alerts carry a `storeId` field. Routing, cooldowns, and persistence are store aware.
4. **Store scoped scheduling:** The scheduler currently runs all stores on the same schedule. Per store scheduling can be added by extending the `Scheduler` class.

To add a second store:

1. Add the store entry to `config/stores.json`
2. Ensure the Toast and MarginEdge MCP servers can access the new store's data (may require additional credentials or GUID parameters)
3. Optionally add store specific threshold overrides in `config/rules.json`
4. Restart the engine
