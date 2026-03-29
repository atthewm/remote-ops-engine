/**
 * Sales Pace Rule.
 *
 * Compares the current day's accumulated sales (partial day) against
 * the trailing same weekday average at the same hour. Alerts if sales
 * are materially below or above the expected pace.
 *
 * Designed to run multiple times per day at configured check hours.
 */

import { logger } from '../util/logger.js';
import { generateFingerprint } from '../util/cooldown.js';
import { getOwnerForDomain } from '../util/config.js';
import { fetchDailySales } from '../mcp/toast.js';
import { buildAlert } from './engine.js';
import type { RuleHandler, RuleResult } from './engine.js';
import type { AppConfig } from '../util/config.js';
import type { Severity, Audience, NotificationEvent } from '../models/normalized.js';

const RULE_ID = 'sales_pace';
const RULE_NAME = 'Sales Pace Tracker';
const RULE_FAMILY = 'revenue';

export class SalesPaceRule implements RuleHandler {
  readonly id = RULE_ID;
  readonly name = RULE_NAME;
  readonly family = RULE_FAMILY;

  async evaluate(storeId: string, config: AppConfig): Promise<RuleResult> {
    logger.info('Evaluating sales pace rule', { storeId });

    const thresholds = config.rules.thresholds.salesPace;
    const now = new Date();
    const currentHour = now.getHours();
    const todayStr = now.toISOString().slice(0, 10);
    const currentDayOfWeek = now.getDay(); // 0=Sun, 1=Mon, etc.

    // Fetch current day partial sales
    let currentSales = 0;
    let currentOrders = 0;

    try {
      const sales = await fetchDailySales(storeId, todayStr);
      currentSales = sales.netSales;
      currentOrders = sales.orderCount;
      logger.info('Current day sales fetched', {
        storeId,
        currentSales,
        currentOrders,
        asOfHour: currentHour,
      });
    } catch (err) {
      logger.error('Failed to fetch current day sales', {
        storeId,
        error: String(err),
      });
      return { ruleId: RULE_ID, fired: false, alerts: [] };
    }

    // Fetch trailing same weekday sales for comparison
    const trailingCount = thresholds.trailingWeekdayCount;
    const trailingSales: number[] = [];
    const trailingDates: string[] = [];

    for (let weeksBack = 1; weeksBack <= trailingCount + 2; weeksBack++) {
      if (trailingSales.length >= trailingCount) break;

      const trailingDate = new Date(now);
      trailingDate.setDate(trailingDate.getDate() - (weeksBack * 7));
      const trailingDateStr = trailingDate.toISOString().slice(0, 10);

      // Verify it is the same day of week (should always be true for 7 day multiples)
      if (trailingDate.getDay() !== currentDayOfWeek) continue;

      try {
        const sales = await fetchDailySales(storeId, trailingDateStr);
        if (sales.netSales > 0) {
          trailingSales.push(sales.netSales);
          trailingDates.push(trailingDateStr);
        }
      } catch (err) {
        logger.warn('Could not fetch trailing day sales', {
          storeId,
          trailingDateStr,
          error: String(err),
        });
      }
    }

    if (trailingSales.length === 0) {
      logger.warn('No trailing weekday data available for pace comparison', {
        storeId,
        dayOfWeek: currentDayOfWeek,
      });
      return { ruleId: RULE_ID, fired: false, alerts: [] };
    }

    // Compute trailing average
    // NOTE: Ideally we would compare partial day sales at the same hour.
    // Since we are comparing full day trailing totals to partial day current,
    // we estimate the expected pace by prorating the trailing average by
    // the fraction of the business day elapsed.
    //
    // Assumes business hours from 6:00 to 18:00 (12 hours).
    const businessStart = 6;
    const businessEnd = 18;
    const businessDuration = businessEnd - businessStart;
    const elapsedHours = Math.max(0, Math.min(currentHour - businessStart, businessDuration));
    const dayFraction = businessDuration > 0 ? elapsedHours / businessDuration : 0;

    if (dayFraction <= 0) {
      logger.info('Before business hours; skipping pace check', { storeId, currentHour });
      return { ruleId: RULE_ID, fired: false, alerts: [] };
    }

    const trailingAvgFullDay = trailingSales.reduce((a, b) => a + b, 0) / trailingSales.length;
    const expectedPaceNow = trailingAvgFullDay * dayFraction;

    // Compute variance
    const variance = expectedPaceNow > 0
      ? (currentSales - expectedPaceNow) / expectedPaceNow
      : 0;

    logger.info('Sales pace comparison', {
      storeId,
      currentSales,
      expectedPaceNow: round2(expectedPaceNow),
      trailingAvgFullDay: round2(trailingAvgFullDay),
      dayFraction: Math.round(dayFraction * 100) / 100,
      variance: Math.round(variance * 10000) / 10000,
      trailingSampleCount: trailingSales.length,
    });

    // Determine if alert is needed
    let severity: Severity = 'green';
    let direction = '';

    if (variance <= -thresholds.belowPaceRed) {
      severity = 'red';
      direction = 'below';
    } else if (variance <= -thresholds.belowPaceYellow) {
      severity = 'yellow';
      direction = 'below';
    } else if (variance >= thresholds.abovePaceNotable) {
      // Above pace is notable but not necessarily bad
      severity = 'green';
      direction = 'above';
    }

    // No alert if pace is within normal range and not notably above
    if (severity === 'green' && direction !== 'above') {
      logger.info('Sales pace within normal range', { storeId, variance });
      return { ruleId: RULE_ID, fired: false, alerts: [] };
    }

    // Build alert
    const alerts: NotificationEvent[] = [];
    const owner = getOwnerForDomain(config, 'revenue');
    const fingerprint = generateFingerprint(
      RULE_ID,
      storeId,
      todayStr,
      `hour_${currentHour}`,
    );

    const keyMetrics: Record<string, string | number> = {
      currentSales: `$${currentSales.toFixed(2)}`,
      expectedPace: `$${round2(expectedPaceNow).toFixed(2)}`,
      trailingAvgFullDay: `$${round2(trailingAvgFullDay).toFixed(2)}`,
      variancePercent: pct(variance),
      dayFractionElapsed: pct(dayFraction),
      currentHour,
      trailingSampleCount: trailingSales.length,
      currentOrders,
    };

    const whatParts: string[] = [];
    if (direction === 'below') {
      whatParts.push(
        `Sales are tracking ${pct(Math.abs(variance))} below the trailing ${trailingSales.length} week average for this day at ${currentHour}:00.`,
      );
      whatParts.push(
        `Current: $${currentSales.toFixed(2)}. Expected at this point: $${round2(expectedPaceNow).toFixed(2)}.`,
      );
      whatParts.push(
        `Trailing full day average: $${round2(trailingAvgFullDay).toFixed(2)}.`,
      );
    } else {
      whatParts.push(
        `Sales are tracking ${pct(Math.abs(variance))} above the trailing ${trailingSales.length} week average for this day at ${currentHour}:00.`,
      );
      whatParts.push(
        `Current: $${currentSales.toFixed(2)}. Expected at this point: $${round2(expectedPaceNow).toFixed(2)}.`,
      );
    }

    const whyItMatters = direction === 'below'
      ? 'Below pace sales may indicate operational issues, staffing gaps, weather impact, or marketing shortfalls. Early awareness allows for corrective action during the remaining business hours.'
      : 'Above pace sales are positive but may require attention to ensure staffing and inventory can support higher than expected volume.';

    const recommendedAction = direction === 'below'
      ? 'Investigate potential causes: check staffing levels, review any known events or weather impacts, and consider promotional activity for remaining hours.'
      : 'Ensure staffing and inventory are adequate for continued above average volume.';

    const audiences: Audience[] = severity === 'red'
      ? ['exec', 'ops', 'finance']
      : ['ops', 'finance'];

    const alert = buildAlert({
      ruleId: RULE_ID,
      ruleName: RULE_NAME,
      storeId,
      severity: direction === 'above' ? 'green' : severity,
      topic: `Sales Pace: ${pct(Math.abs(variance))} ${direction} at ${currentHour}:00`,
      dateWindow: todayStr,
      whatHappened: whatParts.join(' '),
      whyItMatters,
      keyMetrics,
      recommendedAction,
      owner,
      audiences,
      channels: ['finance', 'ops'],
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

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
