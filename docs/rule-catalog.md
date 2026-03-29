# Rule Catalog

Plain English documentation for every rule family in the Remote Coffee Operations Engine. Each rule evaluates operational data from MCP servers and produces alerts at green, yellow, or red severity.


## A. MarginEdge Readiness Score

**Rule ID:** `readiness`
**What it checks:** Whether MarginEdge data is complete enough to produce accurate food cost and margin reporting. The score is a weighted composite of six components: invoices captured (25%), recipe coverage (25%), product mapping (20%), inventory recency (15%), vendor mapping (10%), and unmapped ingredients (5%).

**Data sources:** MarginEdge MCP (invoices, products, categories, vendors), Toast MCP (menu items for cross reference)

**Schedule:** Daily at 7:00 AM Central (first check), with escalation at 10:00 AM if still below threshold

**Thresholds:**
| Level | Condition |
|-------|-----------|
| Green | Score >= 85 |
| Yellow | Score between 70 and 84 |
| Red | Score below 70 |

**Who receives the alert:** Ops channel (yellow), Exec channel (red, or if still yellow at 10 AM escalation)

**Recommended action:** Review the readiness breakdown to identify which components are pulling the score down. Common fixes include: processing pending invoices in MarginEdge, mapping new products to categories, and verifying vendor assignments for recently added items.

**Cooldown:** 720 minutes (12 hours)

**Current limitations:**
- Recipe data is not exposed by the MarginEdge API. Recipe coverage is approximated by checking whether Toast menu items have corresponding MarginEdge product mappings.
- Inventory count recency cannot be determined from the API. This component defaults to a neutral score until manual input or a future API endpoint is available.


## B. Daily Prime Cost Control

**Rule ID:** `prime_cost`
**What it checks:** Whether the previous day's prime cost (COGS + labor as a percentage of net sales) is within acceptable bounds. Also checks COGS and labor individually, plus net sales vs. the daily target.

**Data sources:** Toast MCP (orders for net sales), MarginEdge MCP (invoices as a COGS proxy)

**Schedule:** Daily at 7:00 AM Central

**Thresholds:**
| Metric | Yellow | Red |
|--------|--------|-----|
| COGS % of sales | > 33% | > 38% |
| Labor % of sales | > 33% | > 38% |
| Prime cost % | > 63% | > 68% |
| Sales deviation vs. 28 day trailing avg | > 15% below | > 25% below |

**Who receives the alert:** Finance channel (yellow), Finance + Exec channels (red)

**Recommended action:**
- High COGS: Review recent invoices for price increases, check for waste or overportioning, verify invoice accuracy in MarginEdge
- High labor: Review shift schedules vs. traffic patterns, check for overtime, compare staffing to sales pace
- Low sales: Investigate whether the shortfall is traffic related (fewer orders) or ticket related (lower average check)

**Cooldown:** 1,440 minutes (24 hours)

**Current limitations:**
- Labor data depends on Toast labor API access, which is not yet available. When unavailable, labor is estimated or flagged as incomplete.
- COGS is approximated from MarginEdge invoice totals rather than true theoretical food cost, since recipe data is not accessible.
- The 28 day trailing average does not yet account for holidays or seasonal patterns.


## C. Item Margin Watchlist

**Rule ID:** `item_margin`
**What it checks:** Whether individual menu items have margins below the 65% target, with special attention to high volume items (top 10 sellers, or items exceeding 20 units/day).

**Data sources:** Toast MCP (menu prices, order volumes), MarginEdge MCP (product costs)

**Schedule:** Weekly on Monday at 8:00 AM Central

**Thresholds:**
| Level | Condition |
|-------|-----------|
| Green | All tracked items above 65% margin |
| Yellow | Any tracked item below 65% margin, or margin compressed by > 5 percentage points since last check |
| Red | Any top 10 seller below 65% margin, or margin compressed by > 5 points on a high volume item |

**Who receives the alert:** Finance channel (yellow), Finance + Exec channels (red)

**Recommended action:** Review the flagged items. If the cost increase is from a vendor price change, evaluate whether to renegotiate, substitute, or adjust menu pricing. For high volume items, even small margin changes have outsized P&L impact.

**Cooldown:** 10,080 minutes (7 days)

**Current limitations:**
- Item level cost is computed by matching Toast menu items to MarginEdge products. Items without a product mapping show as "cost incomplete" and are excluded from margin calculations.
- Recipe based costing is not available; cost reflects the latest invoice price for the primary ingredient, not a full bill of materials.


## D. Vendor Price Spike Alerts

**Rule ID:** `vendor_price`
**What it checks:** Whether any vendor item has had a price increase exceeding 10% vs. its 30 day trailing median, or a 5%+ increase week over week.

**Data sources:** MarginEdge MCP (orders/invoices with line item pricing)

**Schedule:** Daily at 7:00 AM Central

**Thresholds:**
| Level | Condition |
|-------|-----------|
| Green | All vendor item prices within normal range |
| Yellow | Any item up 5%+ week over week |
| Red | Any item up 10%+ vs. 30 day trailing median, or any item on the key ingredients watchlist spiked |

**Who receives the alert:** Finance channel (yellow), Finance + Exec channels (red)

**Recommended action:** Contact the vendor to verify the price change. If confirmed, compare against other suppliers. For key ingredients (espresso beans, milk, tortillas, eggs, etc.), even small increases should be escalated. Update the MarginEdge product record if the new price is expected to persist.

**Cooldown:** 1,440 minutes (24 hours)

**Current limitations:**
- Price history is derived from invoice line items. If invoices are not captured promptly, spike detection may be delayed.
- The 90 day volatility window is used for context but does not yet adjust thresholds dynamically for seasonal commodities.


## E. Sales Pace Alerts

**Rule ID:** `sales_pace`
**What it checks:** Whether intraday sales are tracking above or below the same day of week average from the prior four weeks.

**Data sources:** Toast MCP (orders by business date)

**Schedule:** Twice daily at 1:00 PM and 4:00 PM Central

**Thresholds:**
| Level | Condition |
|-------|-----------|
| Green | Within 15% of trailing same day average |
| Yellow | 15% to 25% below pace |
| Red | More than 25% below pace |
| Notable (info) | More than 20% above pace (positive signal, logged but not alerted) |

**Who receives the alert:** Ops channel (yellow), Ops + Exec channels (red)

**Recommended action:**
- Below pace: Check for external factors (weather, road closures, nearby events). If no external cause, consider activating a promotion or social media push. Adjust afternoon staffing if the shortfall is significant.
- Above pace: Ensure inventory and staffing can handle higher than expected volume.

**Cooldown:** 240 minutes (4 hours)

**Current limitations:**
- The trailing comparison uses only four same day of week data points. Early in operation, the baseline will be thin.
- The engine cannot yet distinguish between traffic driven shortfalls (fewer orders) and ticket driven shortfalls (lower average check) in real time. Daily analysis in the digest provides this breakdown.


## F. Labor Efficiency Alerts

**Rule ID:** `labor`
**What it checks:** Whether labor cost as a percentage of net sales exceeds thresholds, and whether overtime hours are accumulating.

**Data sources:** Toast MCP (orders for net sales, labor data when available)

**Schedule:** Daily at 7:00 AM Central

**Thresholds:**
| Level | Condition |
|-------|-----------|
| Green | Labor % <= 33% and overtime < 4 hours |
| Yellow | Labor % between 33% and 38%, or overtime approaching 4 hours |
| Red | Labor % > 38%, or overtime exceeding threshold |

**Who receives the alert:** Ops channel (yellow), Ops + Exec channels (red). Red alerts also generate a Planner task.

**Recommended action:** Review the shift schedule vs. actual sales. Identify whether overstaffing occurred during a slow period or if overtime was avoidable. For persistent labor overruns, revisit scheduling templates and break compliance.

**Cooldown:** 480 minutes (8 hours)

**Current limitations:**
- Toast labor API access is not yet provisioned. Until available, labor data must come from manual input or estimation. The rule will fire with an "estimated" flag when labor data is not available from the API.
- Overtime tracking requires clock in/clock out detail that may not be available in the current Toast API scope.


## G. Discount / Comp / Void / Refund Anomalies

**Rule ID:** `discount_comp_void`
**What it checks:** Whether discounts, comps, voids, or refunds as a percentage of net sales exceed acceptable levels, or whether the total exception rate spikes relative to recent history.

**Data sources:** Toast MCP (orders with discount, void, comp, and refund detail)

**Schedule:** Daily at 7:00 AM Central

**Thresholds:**
| Metric | Yellow | Red |
|--------|--------|-----|
| Discounts % of net sales | > 5% | > 10% |
| Voids % of net sales | > 2% | > 5% |
| Comps % of net sales | > 3% | > 5% |
| Refunds % of net sales | > 2% | > 4% |
| Total exception % | > 5% | > 8% |
| Spike vs. trailing average | 2x trailing average in any category | 2x trailing average in any category (red if multiple categories spike) |

**Who receives the alert:** Ops channel (yellow), Ops + Exec channels (red). Red alerts also generate a Planner task.

**Recommended action:** Pull the specific orders with exceptions. Determine whether the pattern is training related (new staff), policy related (excessive manager comps), or operational (wrong items prepared). For voids, check whether they cluster around a specific time of day or employee.

**Cooldown:** 1,440 minutes (24 hours)

**Current limitations:**
- The engine aggregates exceptions from raw order data. If orders are not fully synced for the prior day by the 7 AM evaluation window, numbers may be incomplete.
- Employee level attribution is not yet implemented. The alert identifies the aggregate anomaly but does not break down exceptions by staff member.


## H. Stockout / 86'd / Disabled Item Alerts

**Rule ID:** `stockout`
**What it checks:** Whether any menu items have been disabled, hidden, or 86'd in the Toast POS, with prioritization based on margin and sales velocity.

**Data sources:** Toast MCP (full menus with visibility and availability flags)

**Schedule:** Daily at 9:00 AM Central

**Thresholds:**
| Level | Condition |
|-------|-----------|
| Green | No high value items disabled |
| Yellow | Any item disabled with estimated daily revenue loss < $50 |
| Red | Any item disabled with margin > 70% or daily velocity > 15 units, or estimated revenue loss > $50/day |

**Who receives the alert:** Ops channel (yellow and red)

**Recommended action:** Verify the stockout is intentional. If an item was 86'd due to an ingredient shortage, check the MarginEdge vendor order timeline. If a high margin item is disabled, prioritize restocking. Re enable items in Toast once inventory is confirmed.

**Cooldown:** 240 minutes (4 hours)

**Current limitations:**
- Revenue loss estimates are based on recent order history. For new menu items without sales history, the estimate may undercount impact.
- The engine detects disabled/hidden status via the menu endpoint but cannot determine the reason for the change. Manual investigation is required to distinguish between deliberate removals and accidental disabling.


## Summary: Scheduled Runs

| Schedule | Cron | Rules |
|----------|------|-------|
| Morning readiness | `0 7 * * *` | readiness |
| Readiness escalation | `0 10 * * *` | readiness (escalation) |
| Daily prime cost | `0 7 * * *` | prime_cost |
| Item margin (weekly) | `0 8 * * 1` | item_margin |
| Vendor price (daily) | `0 7 * * *` | vendor_price |
| Sales pace (midday) | `0 13 * * *` | sales_pace |
| Sales pace (afternoon) | `0 16 * * *` | sales_pace |
| Labor efficiency | `0 7 * * *` | labor |
| Discount/comp/void | `0 7 * * *` | discount_comp_void |
| Stockout check | `0 9 * * *` | stockout |
| Daily ops digest | `0 18 * * *` | daily_ops_digest |
| Weekly exec summary | `0 8 * * 1` | weekly_exec_summary |

All times are Central (America/Chicago). Cooldown purge runs at midnight daily.
