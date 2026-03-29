/**
 * Daily Prime Cost Control Rule.
 *
 * Computes the prior day's COGS %, labor %, and prime cost % by
 * combining Toast sales data with MarginEdge invoice data.
 * Labor data is not available from current APIs and uses a
 * placeholder with an estimated flag.
 *
 * Always generates a daily digest (green, yellow, or red status).
 * Generates an escalation alert when any metric exceeds its threshold.
 */

import { logger } from '../util/logger.js';
import { generateFingerprint } from '../util/cooldown.js';
import { getOwnerForDomain } from '../util/config.js';
import { fetchDailySales, fetchLaborSummary } from '../mcp/toast.js';
import { fetchInvoiceStatus } from '../mcp/marginedge.js';
import { buildAlert } from './engine.js';
import { buildQuickChartUrl } from '../routing/formatter.js';
import type { RuleHandler, RuleResult } from './engine.js';
import type { AppConfig } from '../util/config.js';
import type {
  Severity,
  Audience,
  NotificationEvent,
  LaborSummary,
  PrimeCostSummary,
} from '../models/normalized.js';

const RULE_ID = 'prime_cost';
const RULE_NAME = 'Daily Prime Cost Control';
const RULE_FAMILY = 'profitability';

export class PrimeCostRule implements RuleHandler {
  readonly id = RULE_ID;
  readonly name = RULE_NAME;
  readonly family = RULE_FAMILY;

  async evaluate(storeId: string, config: AppConfig): Promise<RuleResult> {
    logger.info('Evaluating prime cost rule', { storeId });

    const alerts: NotificationEvent[] = [];
    const thresholds = config.rules.thresholds.primeCost;

    // Compute prior business date
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const businessDate = yesterday.toISOString().slice(0, 10);

    // Fetch sales from Toast
    let netSales = 0;
    let orderCount = 0;
    let avgTicket = 0;
    let salesAvailable = false;

    try {
      const sales = await fetchDailySales(storeId, businessDate);
      netSales = sales.netSales;
      orderCount = sales.orderCount;
      avgTicket = sales.avgTicket;
      salesAvailable = true;
      logger.info('Sales data fetched for prime cost', {
        storeId,
        businessDate,
        netSales,
        orderCount,
      });
    } catch (err) {
      logger.error('Failed to fetch sales for prime cost', {
        storeId,
        businessDate,
        error: String(err),
      });
    }

    if (!salesAvailable || netSales <= 0) {
      logger.warn('No sales data available for prime cost calculation', { storeId, businessDate });
      return { ruleId: RULE_ID, fired: false, alerts: [] };
    }

    // Fetch COGS estimate from MarginEdge invoices
    let cogs = 0;
    let cogsAvailable = false;

    try {
      const invoiceStatus = await fetchInvoiceStatus(storeId, businessDate, businessDate);
      // Use total invoice value as COGS proxy
      cogs = invoiceStatus.totalValue;
      cogsAvailable = invoiceStatus.totalInvoices > 0;
      logger.info('COGS data fetched from invoices', {
        storeId,
        businessDate,
        cogs,
        invoiceCount: invoiceStatus.totalInvoices,
      });
    } catch (err) {
      logger.error('Failed to fetch invoice data for COGS', {
        storeId,
        businessDate,
        error: String(err),
      });
    }

    // Fetch labor data from Toast
    let labor: LaborSummary;
    let laborAvailable = false;

    try {
      labor = await fetchLaborSummary(storeId, businessDate, netSales);
      laborAvailable = !labor.estimated;
      if (laborAvailable) {
        logger.info('Labor data fetched for prime cost', {
          storeId,
          businessDate,
          laborCost: labor.totalLaborCost,
          laborPercent: labor.laborPercent,
          overtimeHours: labor.overtimeHours,
        });
      }
    } catch (err) {
      logger.error('Failed to fetch labor data for prime cost', {
        storeId,
        businessDate,
        error: String(err),
      });
      labor = {
        storeId,
        businessDate,
        totalLaborCost: 0,
        totalLaborHours: 0,
        laborPercent: 0,
        dayparts: [],
        overtimeHours: 0,
        source: 'toast',
        fetchedAt: new Date().toISOString(),
        estimated: true,
      };
    }

    // Compute percentages
    const cogsPercent = netSales > 0 ? cogs / netSales : 0;
    const laborPercent = labor.laborPercent;
    const primeCost = cogs + labor.totalLaborCost;
    const primeCostPercent = netSales > 0 ? primeCost / netSales : 0;

    // Build the summary model
    const summary: PrimeCostSummary = {
      storeId,
      businessDate,
      netSales,
      cogs: Math.round(cogs * 100) / 100,
      cogsPercent: Math.round(cogsPercent * 10000) / 10000,
      laborCost: labor.totalLaborCost,
      laborPercent: Math.round(laborPercent * 10000) / 10000,
      primeCost: Math.round(primeCost * 100) / 100,
      primeCostPercent: Math.round(primeCostPercent * 10000) / 10000,
      avgTicket,
      orderCount,
      varianceVsTarget: {
        cogsVariance: Math.round((cogsPercent - thresholds.cogsTarget) * 10000) / 10000,
        laborVariance: Math.round((laborPercent - thresholds.laborTarget) * 10000) / 10000,
        primeCostVariance: Math.round((primeCostPercent - thresholds.primeCostTarget) * 10000) / 10000,
        salesVariance: netSales > 0
          ? Math.round(((netSales - thresholds.dailySalesTarget) / thresholds.dailySalesTarget) * 10000) / 10000
          : 0,
      },
      varianceVsTrailing: null, // Trailing comparison requires historical data store
      source: 'computed',
      fetchedAt: new Date().toISOString(),
    };

    // Determine severity
    const breaches: string[] = [];
    let severity: Severity = 'green';

    // COGS check
    if (cogsAvailable) {
      if (cogsPercent >= thresholds.cogsRedThreshold) {
        severity = escalate(severity, 'red');
        breaches.push(`COGS at ${pct(cogsPercent)} exceeds red threshold of ${pct(thresholds.cogsRedThreshold)}`);
      } else if (cogsPercent >= thresholds.cogsYellowThreshold) {
        severity = escalate(severity, 'yellow');
        breaches.push(`COGS at ${pct(cogsPercent)} exceeds yellow threshold of ${pct(thresholds.cogsYellowThreshold)}`);
      }
    }

    // Labor check (only if real data is available)
    if (laborAvailable) {
      if (laborPercent >= thresholds.laborRedThreshold) {
        severity = escalate(severity, 'red');
        breaches.push(`Labor at ${pct(laborPercent)} exceeds red threshold of ${pct(thresholds.laborRedThreshold)}`);
      } else if (laborPercent >= thresholds.laborYellowThreshold) {
        severity = escalate(severity, 'yellow');
        breaches.push(`Labor at ${pct(laborPercent)} exceeds yellow threshold of ${pct(thresholds.laborYellowThreshold)}`);
      }
    }

    // Prime cost check (meaningful only when both components available)
    if (cogsAvailable && laborAvailable) {
      if (primeCostPercent >= thresholds.primeCostRedThreshold) {
        severity = escalate(severity, 'red');
        breaches.push(`Prime cost at ${pct(primeCostPercent)} exceeds red threshold of ${pct(thresholds.primeCostRedThreshold)}`);
      } else if (primeCostPercent >= thresholds.primeCostYellowThreshold) {
        severity = escalate(severity, 'yellow');
        breaches.push(`Prime cost at ${pct(primeCostPercent)} exceeds yellow threshold of ${pct(thresholds.primeCostYellowThreshold)}`);
      }
    }

    // Sales deviation check
    const salesDeviation = Math.abs((netSales - thresholds.dailySalesTarget) / thresholds.dailySalesTarget);
    if (netSales < thresholds.dailySalesTarget) {
      if (salesDeviation >= thresholds.salesDeviationRed) {
        severity = escalate(severity, 'red');
        breaches.push(`Net sales of $${netSales.toFixed(2)} are ${pct(salesDeviation)} below the daily target of $${thresholds.dailySalesTarget}`);
      } else if (salesDeviation >= thresholds.salesDeviationYellow) {
        severity = escalate(severity, 'yellow');
        breaches.push(`Net sales of $${netSales.toFixed(2)} are ${pct(salesDeviation)} below the daily target of $${thresholds.dailySalesTarget}`);
      }
    }

    // Build the daily digest alert (always generated)
    const owner = getOwnerForDomain(config, 'profitability');
    const fingerprint = generateFingerprint(RULE_ID, storeId, businessDate);

    const keyMetrics: Record<string, string | number> = {
      businessDate,
      netSales: `$${netSales.toFixed(2)}`,
      orderCount,
      avgTicket: `$${avgTicket.toFixed(2)}`,
      cogsPercent: cogsAvailable ? pct(cogsPercent) : 'N/A (no invoices)',
      laborPercent: laborAvailable ? pct(laborPercent) : 'N/A (estimated)',
      primeCostPercent: (cogsAvailable && laborAvailable) ? pct(primeCostPercent) : 'Partial',
      cogsTarget: pct(thresholds.cogsTarget),
      laborTarget: pct(thresholds.laborTarget),
      primeCostTarget: pct(thresholds.primeCostTarget),
    };

    // Fetch last 5 days of revenue for trend chart
    try {
      const trendLabels: string[] = [];
      const trendValues: number[] = [];

      for (let daysBack = 5; daysBack >= 1; daysBack--) {
        const d = new Date(now);
        d.setDate(d.getDate() - daysBack);
        const dStr = d.toISOString().slice(0, 10);
        try {
          const daySales = await fetchDailySales(storeId, dStr);
          if (daySales.netSales > 0) {
            // Use short day name as label (Mon, Tue, etc.)
            const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
            trendLabels.push(dayName);
            trendValues.push(Math.round(daySales.netSales));
          }
        } catch {
          // Skip days with no data
        }
      }

      if (trendLabels.length >= 2) {
        const chartUrl = buildQuickChartUrl(trendLabels, trendValues, 'Net Revenue ($)', {
          borderColor: 'rgb(46, 204, 113)',
          backgroundColor: 'rgba(46, 204, 113, 0.15)',
        });
        keyMetrics['_chartRevenueTrend'] = chartUrl;
      }
    } catch (err) {
      logger.warn('Failed to build revenue trend chart', { error: String(err) });
    }

    // Build the "what happened" narrative
    const dataNotes: string[] = [];
    if (!cogsAvailable) {
      dataNotes.push('COGS data unavailable (no invoices for this date).');
    }
    if (!laborAvailable) {
      dataNotes.push('Labor data unavailable (no time entries for this date).');
    }

    const whatParts: string[] = [];
    whatParts.push(`Daily prime cost report for ${businessDate}.`);
    whatParts.push(`Net sales: $${netSales.toFixed(2)} across ${orderCount} orders (avg ticket $${avgTicket.toFixed(2)}).`);

    if (cogsAvailable) {
      whatParts.push(`COGS: $${cogs.toFixed(2)} (${pct(cogsPercent)} of sales).`);
    }

    if (breaches.length > 0) {
      whatParts.push(`Thresholds breached: ${breaches.join('; ')}.`);
    }

    if (dataNotes.length > 0) {
      whatParts.push(`Data notes: ${dataNotes.join(' ')}`);
    }

    const audiences: Audience[] = severity === 'red'
      ? ['exec', 'ops', 'finance']
      : severity === 'yellow'
        ? ['ops', 'finance']
        : ['finance'];

    const whyItMatters = severity === 'green'
      ? 'Daily performance snapshot for operational awareness.'
      : 'Cost metrics have exceeded acceptable thresholds. Early correction prevents cumulative margin erosion over the week.';

    const recommendedAction = buildRecommendedAction(breaches, cogsAvailable, laborAvailable, summary);

    const alert = buildAlert({
      ruleId: RULE_ID,
      ruleName: RULE_NAME,
      storeId,
      severity,
      topic: `Daily Prime Cost: ${businessDate}`,
      dateWindow: businessDate,
      whatHappened: whatParts.join(' '),
      whyItMatters,
      keyMetrics,
      recommendedAction,
      owner,
      audiences,
      channels: ['ops', 'finance'],
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

// ── Helpers ──

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const SEVERITY_RANK: Record<Severity, number> = { green: 0, yellow: 1, red: 2 };

function escalate(current: Severity, candidate: Severity): Severity {
  return SEVERITY_RANK[candidate] > SEVERITY_RANK[current] ? candidate : current;
}

function buildRecommendedAction(
  breaches: string[],
  cogsAvailable: boolean,
  laborAvailable: boolean,
  summary: PrimeCostSummary,
): string {
  const actions: string[] = [];

  if (breaches.length === 0) {
    actions.push('No action needed. All metrics within target ranges.');
  } else {
    if (summary.varianceVsTarget.cogsVariance > 0) {
      actions.push('Review recent invoices in MarginEdge for unusual purchasing or price increases.');
    }
    if (summary.varianceVsTarget.salesVariance < 0) {
      actions.push('Investigate low sales volume. Check for operational issues, weather, or scheduling gaps.');
    }
    if (summary.varianceVsTarget.laborVariance > 0 && laborAvailable) {
      actions.push('Review labor schedule for overstaffing or overtime.');
    }
  }

  if (!cogsAvailable) {
    actions.push('Ensure invoices for this business date are entered and closed in MarginEdge.');
  }

  if (!laborAvailable) {
    actions.push('No labor time entries found for this date. Check that employees clocked in/out in Toast.');
  }

  return actions.join(' ');
}
