# Remote Coffee Operations Engine

Proactive, config driven alerting and digest system for Remote Coffee. Integrates MarginEdge (cost accounting), Toast (sales and orders), and Microsoft 365 (Teams messaging, Planner tasks, SharePoint logging) via MCP servers.

## What It Does

Evaluates operational rules on a schedule and generates actionable alerts routed to the correct Teams channels. Reduces profit leakage and operational blind spots by surfacing issues before they compound.

**Rule families:**

| Rule | What It Checks | Schedule |
|------|---------------|----------|
| MarginEdge Readiness | Invoice capture, product mapping, vendor mapping completeness | Daily 7 AM, escalation 10 AM |
| Daily Prime Cost | COGS %, labor %, prime cost %, sales vs target, avg ticket | Daily 7 AM |
| Item Margin Watchlist | Menu items below margin target, cost mapping gaps | Weekly Monday 8 AM |
| Vendor Price Spikes | Unit cost increases vs trailing median | Daily 7 AM |
| Sales Pace | Intraday sales vs trailing same weekday average | 1 PM, 4 PM |
| Labor Efficiency | Labor % vs target (requires future data source) | Daily 7 AM |
| Discount/Comp/Void | Exception amounts and counts vs thresholds | Daily 7 AM |
| Stockout/Disabled Items | High value items removed from menu | Daily 9 AM |

## Architecture

```
MarginEdge MCP ─┐
                 ├─> Normalized Models ─> Rules Engine ─> Channel Router ─> Teams
Toast MCP ───────┤                              │                              │
                 │                              ├─> Task Creator ──────> Planner
M365 MCP ────────┘                              └─> Alert Log ─────> SharePoint
```

**Modes:**
- `shadow` (default): Evaluate rules, log results, do not post to Teams
- `live`: Post messages, create tasks, full operation
- `test`: Backtest against historical date ranges

## Quick Start

### Prerequisites

1. Node.js 18+
2. MCP servers built locally:
   - `~/marginedge-mcp-server` (built with `npm run build`)
   - `~/toast-mcp-server` (built with `npm run build`)
   - `~/remote-m365-mcp` (built with `npm run build`)
3. Environment variables (see below)

### Install and Build

```bash
cd ~/remote-ops-engine
npm install
npm run build
```

### Environment Variables

Create a `.env` file or export these:

```bash
# MarginEdge
MARGINEDGE_API_KEY=your_api_key
MARGINEDGE_RESTAURANT_ID=945747948

# Toast
TOAST_CLIENT_ID=your_client_id
TOAST_CLIENT_SECRET=your_client_secret
TOAST_RESTAURANT_GUID=c227349d-7778-4ec2-af27-e386eb2ec52e

# M365
REMOTE_M365_CLIENT_ID=your_app_client_id

# Engine
ALERT_MODE=shadow   # shadow | live | test
LOG_LEVEL=info

# Optional: Planner task creation
PLANNER_PLAN_ID=your_plan_id

# Optional: SharePoint alert logging
SHAREPOINT_SITE_ID=your_site_id
SHAREPOINT_ALERT_LIST_ID=your_list_id
```

### Run

```bash
# Shadow mode, scheduled (runs as daemon)
npm start

# Shadow mode, one shot (all rules)
ALERT_MODE=shadow node dist/index.js --run-all

# Run a single rule family
node dist/index.js --family readiness

# Health check (verify MCP connectivity)
node dist/index.js --health

# Show open alerts
node dist/index.js --status

# Backtest last 14 days
npm run run:backtest -- --days 14

# Backtest specific date range
npm run run:backtest -- --start 2026-03-01 --end 2026-03-24
```

## Configuration

All thresholds, routing, owners, and store settings live in `config/`. No business logic is hardcoded.

| File | Purpose |
|------|---------|
| `config/stores.json` | Store IDs, Toast GUIDs, MarginEdge IDs |
| `config/teams.json` | Team ID, channel IDs, audience routing rules |
| `config/owners.json` | Alert owners, email addresses, M365 user IDs |
| `config/rules.json` | Thresholds, schedules, cooldowns, watchlists |

### Channel Routing

| Channel | Receives |
|---------|----------|
| Exec Alerts | Red alerts only, executive daily summary, weekly summary |
| Ops Daily | Daily digests, readiness issues, labor pacing, stockout risk |
| Finance / Cost Controls | Invoice/mapping/cost/margin alerts |
| Marketing / Growth | Sales pace, ticket, item mix signals |

**Setup:** Populate `config/teams.json` with actual Team and Channel IDs from your M365 tenant. Run `node dist/index.js --health` to discover available teams and channels.

### Default Thresholds

All defaults are clearly marked in `config/rules.json` and should be tuned after initial shadow mode observation.

| Metric | Yellow | Red | Notes |
|--------|--------|-----|-------|
| COGS % | 33% | 38% | Standard for coffee/taco concept |
| Labor % | 33% | 38% | Aggressive for drive thru; adjust after baseline |
| Prime Cost % | 63% | 68% | COGS + Labor combined |
| Sales deviation | 15% below | 25% below | vs trailing weekday average |
| Item margin | below 65% | n/a | Specialty coffee standard |
| Vendor price spike | 10% | n/a | vs 30 day trailing median |
| Discount % of sales | 5% | 10% | |
| Void % of sales | 2% | 5% | |

## Alert Format

Every alert includes:
- Severity (Green / Yellow / Red)
- Topic and store
- Date / time window
- What happened
- Why it matters
- Key metrics
- Recommended action
- Owner and due time

See `examples/messages/` for sample HTML payloads.

## Project Structure

```
remote-ops-engine/
  config/           # Editable JSON configuration files
  docs/             # Capability map, rule catalog, architecture
  examples/         # Sample Teams message HTML payloads
  src/
    models/         # Normalized TypeScript data models
    mcp/            # MCP client layer (MarginEdge, Toast, M365)
    rules/          # Rule implementations (8 families)
    routing/        # Channel routing and message formatting
    tasks/          # Planner task creation for red alerts
    persistence/    # Alert logging (local JSON + SharePoint)
    util/           # Config loader, cooldown manager, logger
    index.ts        # Entry point and CLI
    scheduler.ts    # Cron based job scheduler
    backtest.ts     # Historical backtest runner
  data/             # Runtime data (cooldowns, alert log, archives)
  logs/             # Application logs
  reports/          # Backtest output
```

## Current Limitations

These limitations are documented throughout the code and will resolve as data sources expand:

1. **Labor data**: Toast API does not expose labor/scheduling endpoints in current MCP tools. Labor rule is scaffolded but will not fire until a data source (7shifts, Homebase, or Toast Labor API) is connected.
2. **Recipe data**: MarginEdge API does not expose recipe details. Recipe coverage is estimated by cross referencing Toast menu items against MarginEdge product mappings.
3. **Inventory counts**: MarginEdge API does not expose inventory count data. The readiness score component uses a placeholder.
4. **Real time stockout**: Toast API does not push 86'd item events. Stockout detection relies on menu visibility flags at time of check.
5. **Reporting endpoints**: Toast reporting API requires specific scopes not available in standard credentials. Sales data is computed from individual order aggregation.

## Phase 2.5 Recommended Enhancements

- Forecast vs actual by daypart
- Menu engineering quadrant analysis (contribution vs popularity)
- Promo ROI alerts
- Ingredient purchase to sales mismatch detection
- Exception trend scoring by manager / shift / daypart
- Labor scheduler recommendations (requires 7shifts or similar integration)
- Automatic summary archive to SharePoint / OneDrive
- Adaptive Cards in Teams for interactive acknowledgment
- Owner acknowledgment workflow (respond to alert, mark resolved)
- Multi store aggregation and comparison
- Webhook ingestion for real time Toast events
- Trailing trend charts as image attachments
