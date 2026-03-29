# Capability Map

What each MCP server provides to the Remote Coffee Operations Engine.

## MarginEdge MCP (13 tools, read only)

**Auth:** API key based (`X-Api-Key` header)
**Rate Limit:** 1 request/second, enforced client side
**Entity IDs:** restaurantUnitId `945747948`, orderId, vendorId, productId, categoryId

### Read Capabilities

| Tool | Returns |
|------|---------|
| Restaurants | List of restaurant units on the account |
| Orders/Invoices | Invoices with line items, status, vendor info, date range filtering |
| Products | Product catalog with latest price and category assignments |
| Categories | Category hierarchy for organizing products |
| Vendors | Vendor directory with contact and account details |
| Vendor Items | Per vendor item list with codes and pricing |
| Packaging | Packaging and unit of measure data |
| Groups | Product groups for aggregation and reporting |
| Group Categories | Category to group mappings |

### Write Capabilities

None. The MarginEdge public API is read only.

### Historical Data Access

Orders and invoices are queryable by date range with no explicit lookback limit documented. The engine uses a 28 day trailing window by default for trend analysis.

### Not Available via This API

| Capability | Notes |
|------------|-------|
| Recipes | No endpoint; cost mapping inferred from product/menu cross reference |
| Food cost calculations | Must be computed by the engine from invoice and sales data |
| Sales data | MarginEdge does not provide POS sales; use Toast instead |
| Labor data | Not in scope for MarginEdge |
| Inventory counts | No endpoint; must be populated manually or via future API access |
| Budget vs. actual | No endpoint; targets are set in `config/rules.json` |


## Toast MCP (14 tools: 11 read, 3 gated write)

**Auth:** OAuth client credentials (client ID + secret)
**Rate Limit:** 3 retries with exponential backoff
**Entity IDs:** restaurantGuid `c227349d-7778-4ec2-af27-e386eb2ec52e`, menuGuid, itemGuid, orderGuid

### Read Capabilities

| Tool | Returns |
|------|---------|
| Restaurant Info | Location details, name, address |
| Config: Revenue Centers | POS revenue center list |
| Config: Dining Options | Dine in, takeout, drive thru, delivery, etc. |
| Config: Service Areas | Service area configuration |
| Menu Metadata | High level menu listing (names, GUIDs) |
| Full Menus | Complete menu dump with items, prices, modifier groups |
| Menu Search | Keyword search across menu items |
| Orders by Business Date | All orders for a given date (YYYYMMDD format) |
| Order by GUID | Single order with full check and selection detail |

### Write Capabilities (Gated)

| Tool | Purpose | Gate |
|------|---------|------|
| Price Order | Calculate pricing for a hypothetical order | Requires confirmation |
| Create Order | Submit a new order to the POS | Requires confirmation |
| Update Order | Modify an existing open order | Requires confirmation |

Write tools are gated and require explicit confirmation before execution. The operations engine does not invoke write tools; they exist for interactive use via the MCP server.

### Historical Data Access

Orders are queryable by `businessDate` in YYYYMMDD format. Each order includes full check detail, selections, applied discounts, voids, and payment information.

### Not Available via This API

| Capability | Notes |
|------------|-------|
| Reporting / Analytics | No summary endpoints; must be computed from raw orders |
| Labor / Scheduling | Toast labor data requires a separate API scope not currently available |
| Discount summaries | Must be aggregated from individual order records |
| Item cost data | Toast has no cost model; use MarginEdge for ingredient costs |


## M365 MCP (59 tools across 9 modules)

**Auth:** Device code flow via MSAL, tokens cached at `~/.remote-m365-mcp/token-cache.json`
**Tenant:** `0a4f135c-c6da-4f4e-b12e-3981ff13d809` (remotecoffee.com)

### Module Breakdown

| Module | Tool Count | Key Capabilities |
|--------|------------|------------------|
| Teams | 6 | List teams, list channels, send message (HTML), list messages, list chats, send chat |
| Planner | 6 | List plans, get plan (with buckets/tasks), create task (assignee, due date, priority, notes), update task, delete task, list my tasks |
| To Do | 5 | List lists, list tasks, create task, update task, complete task |
| SharePoint | 5 | List sites, list lists, get list items, create list item, update list item |
| Files | 5 | List, search, get content, upload, share |
| Mail | 17 | Full email capabilities including multi mailbox, scheduled send, inbox rules |
| Calendar | 8 | Full calendar capabilities |
| Contacts | 4 | Contact management |
| User | 3 | Profile, presence, user lookup |

### Key Tools for the Operations Engine

The engine uses a subset of M365 tools for alert delivery and task management:

| Purpose | Tool | Details |
|---------|------|---------|
| Alert delivery | `teams_send_message` | Posts HTML formatted messages to Teams channels |
| Task creation | `planner_create_task` | Creates actionable tasks for red severity alerts |
| Alert archival | `sharepoint_create_list_item` | Optional: logs alerts to a SharePoint list for historical tracking |
| Digest delivery | `teams_send_message` | Daily ops digests and weekly executive summaries |

### Not Used by the Engine (Available for Interactive Use)

Mail, Calendar, Contacts, To Do, Files, and most SharePoint tools are available through the MCP server for interactive queries but are not invoked by the automated rules engine.


## Cross Reference: Data Flow by Rule Family

| Rule Family | MarginEdge | Toast | M365 |
|-------------|-----------|-------|------|
| A. Readiness Score | Invoices, products, categories, vendors | Menu items | Teams (alert) |
| B. Prime Cost Control | Invoices (COGS proxy) | Orders (sales), labor (future) | Teams, Planner |
| C. Item Margin Watchlist | Product prices | Menu prices, order volumes | Teams |
| D. Vendor Price Spikes | Orders/invoices (price history) | (none) | Teams, Planner |
| E. Sales Pace | (none) | Orders by date | Teams |
| F. Labor Efficiency | (none) | Orders (sales), labor (future) | Teams, Planner |
| G. Discount/Comp/Void | (none) | Orders (discount/void/comp detail) | Teams, Planner |
| H. Stockout/86'd Items | (none) | Full menus (visibility flags) | Teams |
