/**
 * Labor Efficiency Rule.
 *
 * NOTE: The Toast API does not expose labor or scheduling data in the
 * currently available MCP tools. This rule is structured to work once
 * labor data becomes available from a future integration (e.g., direct
 * Toast labor API, 7shifts, Homebase, or manual entry).
 *
 * Until real data is available, the rule checks for data availability,
 * generates an informational note rather than a false alert, and uses
 * the LaborSummary model with estimated=true.
 */

import { logger } from '../util/logger.js';
import { generateFingerprint } from '../util/cooldown.js';
import { getOwnerForDomain } from '../util/config.js';
import { fetchDailySales, fetchLaborSummary } from '../mcp/toast.js';
import { buildAlert } from './engine.js';
import type { RuleHandler, RuleResult } from './engine.js';
import type { AppConfig } from '../util/config.js';
import type {
  Severity,
  Audience,
  NotificationEvent,
  LaborSummary,
} from '../models/normalized.js';

const RULE_ID = 'labor';
const RULE_NAME = 'Labor Efficiency';
const RULE_FAMILY = 'labor';

/**
 * Fetches labor data from the Toast MCP server's toast_list_shifts tool.
 * Also fetches sales to compute labor as a percentage of revenue.
 */
async function fetchLaborData(storeId: string, businessDate: string): Promise<LaborSummary | null> {
  try {
    // Fetch sales first so we can compute labor percent
    let netSales = 0;
    try {
      const sales = await fetchDailySales(storeId, businessDate);
      netSales = sales.netSales;
    } catch {
      logger.warn('Could not fetch sales for labor percent calculation', { storeId, businessDate });
    }

    const labor = await fetchLaborSummary(storeId, businessDate, netSales);

    // If the data came back as estimated (no real entries), treat as unavailable
    if (labor.estimated) {
      logger.info('Labor data returned as estimated (no time entries)', { storeId, businessDate });
      return null;
    }

    return labor;
  } catch (err) {
    logger.error('Failed to fetch labor data from Toast', {
      storeId,
      businessDate,
      error: String(err),
    });
    return null;
  }
}

export class LaborRule implements RuleHandler {
  readonly id = RULE_ID;
  readonly name = RULE_NAME;
  readonly family = RULE_FAMILY;

  async evaluate(storeId: string, config: AppConfig): Promise<RuleResult> {
    logger.info('Evaluating labor efficiency rule', { storeId });

    const thresholds = config.rules.thresholds.labor;
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const businessDate = yesterday.toISOString().slice(0, 10);

    // Attempt to fetch labor data
    const laborData = await fetchLaborData(storeId, businessDate);

    if (!laborData) {
      // No labor data available. Generate informational result
      // but do NOT fire a false alert.
      logger.info('No labor data available; generating informational note only', {
        storeId,
        businessDate,
      });

      return buildDataUnavailableResult(storeId, businessDate, config);
    }

    // If we reach this point, real labor data is available.
    // Proceed with threshold evaluation.

    // Fetch sales to compute labor as percentage of revenue
    let netSales = 0;
    try {
      const sales = await fetchDailySales(storeId, businessDate);
      netSales = sales.netSales;
    } catch (err) {
      logger.error('Failed to fetch sales for labor calculation', {
        storeId,
        businessDate,
        error: String(err),
      });
    }

    // Recompute labor percent against actual sales if available
    const laborPercent = netSales > 0
      ? laborData.totalLaborCost / netSales
      : laborData.laborPercent;

    // Determine severity
    let severity: Severity = 'green';
    const breaches: string[] = [];

    if (laborPercent >= thresholds.laborPercentRed) {
      severity = 'red';
      breaches.push(`Labor at ${pct(laborPercent)} exceeds red threshold of ${pct(thresholds.laborPercentRed)}`);
    } else if (laborPercent >= thresholds.laborPercentYellow) {
      severity = 'yellow';
      breaches.push(`Labor at ${pct(laborPercent)} exceeds yellow threshold of ${pct(thresholds.laborPercentYellow)}`);
    }

    // Check overtime
    if (laborData.overtimeHours > thresholds.overtimeHoursThreshold) {
      if (severity === 'green') severity = 'yellow';
      breaches.push(
        `Overtime hours (${laborData.overtimeHours.toFixed(1)}) exceed threshold of ${thresholds.overtimeHoursThreshold}`,
      );
    }

    if (severity === 'green') {
      logger.info('Labor metrics within acceptable range', {
        storeId,
        laborPercent,
        overtimeHours: laborData.overtimeHours,
      });
      return { ruleId: RULE_ID, fired: false, alerts: [] };
    }

    // Build alert
    const alerts: NotificationEvent[] = [];
    const owner = getOwnerForDomain(config, 'labor');
    const fingerprint = generateFingerprint(RULE_ID, storeId, businessDate);

    const keyMetrics: Record<string, string | number> = {
      businessDate,
      totalLaborCost: `$${laborData.totalLaborCost.toFixed(2)}`,
      totalLaborHours: laborData.totalLaborHours.toFixed(1),
      laborPercent: pct(laborPercent),
      overtimeHours: laborData.overtimeHours.toFixed(1),
      netSales: netSales > 0 ? `$${netSales.toFixed(2)}` : 'N/A',
      laborPercentYellow: pct(thresholds.laborPercentYellow),
      laborPercentRed: pct(thresholds.laborPercentRed),
      dataSource: laborData.source,
      estimated: laborData.estimated ? 'yes' : 'no',
    };

    const whatParts: string[] = [];
    whatParts.push(`Labor efficiency report for ${businessDate}.`);
    whatParts.push(
      `Total labor cost: $${laborData.totalLaborCost.toFixed(2)} across ${laborData.totalLaborHours.toFixed(1)} hours.`,
    );
    if (netSales > 0) {
      whatParts.push(`Labor as percentage of $${netSales.toFixed(2)} net sales: ${pct(laborPercent)}.`);
    }
    if (breaches.length > 0) {
      whatParts.push(`Thresholds breached: ${breaches.join('; ')}.`);
    }
    if (laborData.estimated) {
      whatParts.push('Note: labor data is estimated, not from a verified source.');
    }

    // Daypart breakdown if available
    if (laborData.dayparts.length > 0) {
      const dpSummary = laborData.dayparts
        .filter(dp => dp.laborCost > 0)
        .map(dp => `${dp.daypart}: $${dp.laborCost.toFixed(2)} (${pct(dp.laborPercent)})`)
        .join(', ');
      if (dpSummary) {
        whatParts.push(`Daypart breakdown: ${dpSummary}.`);
      }
    }

    const audiences: Audience[] = severity === 'red'
      ? ['exec', 'ops']
      : ['ops'];

    const alert = buildAlert({
      ruleId: RULE_ID,
      ruleName: RULE_NAME,
      storeId,
      severity,
      topic: `Labor Efficiency: ${pct(laborPercent)} on ${businessDate}`,
      dateWindow: businessDate,
      whatHappened: whatParts.join(' '),
      whyItMatters: 'Elevated labor costs directly compress margins. Overtime in particular carries a premium that compounds quickly if not managed.',
      keyMetrics,
      recommendedAction: buildRecommendedAction(breaches, laborData, thresholds),
      owner,
      audiences,
      channels: ['ops'],
      fingerprint,
    });

    alerts.push(alert);

    return {
      ruleId: RULE_ID,
      fired: true,
      alerts,
    };
  }
}

// ── Helper for when labor data is not available ──

function buildDataUnavailableResult(
  storeId: string,
  businessDate: string,
  config: AppConfig,
): RuleResult {
  // Create a placeholder summary for logging purposes
  const placeholder: LaborSummary = {
    storeId,
    businessDate,
    totalLaborCost: 0,
    totalLaborHours: 0,
    laborPercent: 0,
    dayparts: [],
    overtimeHours: 0,
    source: 'manual',
    fetchedAt: new Date().toISOString(),
    estimated: true,
  };

  logger.info('Labor rule returning informational result (no data source)', {
    storeId,
    businessDate,
    placeholder: true,
  });

  // Return as not fired. We do not generate an alert for missing data
  // to avoid alert fatigue. The readiness rule already covers data gaps.
  return {
    ruleId: RULE_ID,
    fired: false,
    alerts: [],
  };
}

// ── Helpers ──

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function buildRecommendedAction(
  breaches: string[],
  laborData: LaborSummary,
  thresholds: { laborPercentYellow: number; laborPercentRed: number; overtimeHoursThreshold: number },
): string {
  const actions: string[] = [];

  if (breaches.some(b => b.toLowerCase().includes('overtime'))) {
    actions.push(`Review scheduling to reduce overtime (currently ${laborData.overtimeHours.toFixed(1)} hours, threshold is ${thresholds.overtimeHoursThreshold}).`);
  }

  if (breaches.some(b => b.toLowerCase().includes('labor at'))) {
    actions.push('Evaluate shift coverage against sales volume. Consider adjusting staffing levels for lower volume periods.');
  }

  if (laborData.dayparts.length > 0) {
    const worstDp = laborData.dayparts
      .filter(dp => dp.laborPercent > 0)
      .sort((a, b) => b.laborPercent - a.laborPercent)[0];
    if (worstDp) {
      actions.push(`Focus on the ${worstDp.daypart} daypart where labor is ${pct(worstDp.laborPercent)} of sales.`);
    }
  }

  if (actions.length === 0) {
    actions.push('Review labor scheduling and compare against sales volume by daypart.');
  }

  return actions.join(' ');
}
