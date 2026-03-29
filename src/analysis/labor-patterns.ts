/**
 * Labor Staffing Pattern Analysis.
 *
 * Fetches 28 days of data, filters to days with labor data, and groups
 * by day of week and staffing level (employeesWorked). Compares average
 * sales at different staffing levels to surface insights about optimal
 * staffing. Posts to the Teams #ops webhook.
 *
 * Only activates when 14+ days of labor data are available to ensure
 * statistical relevance.
 */

import {
  fetchDayRange,
  todayStr,
  parseDate,
  formatDate,
  dayName,
  dollars,
  type DaySnapshot,
} from './base.js';
import { postToTeamsWebhook } from '../routing/teams-webhook.js';
import { logger } from '../util/logger.js';

// ── Types ──

interface StaffingBucket {
  staffingLevel: number;
  dayCount: number;
  avgSales: number;
  avgLaborPercent: number;
  salesPerEmployee: number;
}

interface DowStaffingInsight {
  dayOfWeek: number;
  name: string;
  buckets: StaffingBucket[];
  optimalStaffing: number;
  currentAvgStaffing: number;
}

// ── Analysis ──

/**
 * Groups days with labor data by DOW and staffing level.
 * Computes average sales, labor %, and sales per employee at each level.
 */
function analyzeStaffingPatterns(snapshots: DaySnapshot[]): DowStaffingInsight[] {
  // Filter to days with valid labor data
  const withLabor = snapshots.filter(
    s => s.labor !== null && s.labor.employeesWorked > 0
  );

  // Group by DOW
  const dowMap = new Map<number, DaySnapshot[]>();
  for (const snap of withLabor) {
    const dow = snap.dayOfWeek;
    const existing = dowMap.get(dow) ?? [];
    existing.push(snap);
    dowMap.set(dow, existing);
  }

  const insights: DowStaffingInsight[] = [];

  for (const [dow, days] of dowMap) {
    if (days.length < 2) continue; // Need at least 2 data points per DOW

    // Group by staffing level
    const staffMap = new Map<number, { sales: number[]; laborPct: number[] }>();
    let totalStaff = 0;

    for (const d of days) {
      const level = d.labor!.employeesWorked;
      totalStaff += level;
      const existing = staffMap.get(level) ?? { sales: [], laborPct: [] };
      existing.sales.push(d.totalSales);
      existing.laborPct.push(d.labor!.laborPercent);
      staffMap.set(level, existing);
    }

    const buckets: StaffingBucket[] = [];
    for (const [level, data] of staffMap) {
      const avgSales = data.sales.reduce((a, b) => a + b, 0) / data.sales.length;
      const avgLaborPct = data.laborPct.reduce((a, b) => a + b, 0) / data.laborPct.length;
      buckets.push({
        staffingLevel: level,
        dayCount: data.sales.length,
        avgSales: Math.round(avgSales * 100) / 100,
        avgLaborPercent: Math.round(avgLaborPct * 10000) / 10000,
        salesPerEmployee: level > 0 ? Math.round((avgSales / level) * 100) / 100 : 0,
      });
    }

    // Sort by staffing level
    buckets.sort((a, b) => a.staffingLevel - b.staffingLevel);

    // Optimal staffing = level with highest sales per employee (min 2 data points)
    const qualifying = buckets.filter(b => b.dayCount >= 2);
    const optimal = qualifying.length > 0
      ? qualifying.reduce((a, b) => a.salesPerEmployee > b.salesPerEmployee ? a : b).staffingLevel
      : buckets[0]?.staffingLevel ?? 0;

    insights.push({
      dayOfWeek: dow,
      name: dayName(dow),
      buckets,
      optimalStaffing: optimal,
      currentAvgStaffing: Math.round((totalStaff / days.length) * 10) / 10,
    });
  }

  // Sort by DOW
  insights.sort((a, b) => a.dayOfWeek - b.dayOfWeek);
  return insights;
}

// ── Runner ──

/**
 * Runs the labor staffing patterns analysis.
 * Requires 14+ days of labor data to activate.
 * Posts insights to the #ops webhook.
 */
export async function runLaborPatterns(timezone: string): Promise<void> {
  logger.info('Running labor patterns analysis');

  const today = todayStr(timezone);
  const todayDate = parseDate(today);
  const startDate = new Date(todayDate);
  startDate.setUTCDate(startDate.getUTCDate() - 28);

  const snapshots = await fetchDayRange(formatDate(startDate), 28);
  const withLabor = snapshots.filter(s => s.labor !== null && s.labor.employeesWorked > 0);

  if (withLabor.length < 14) {
    logger.info('Insufficient labor data for patterns analysis', {
      daysWithLabor: withLabor.length,
      required: 14,
    });
    return;
  }

  const insights = analyzeStaffingPatterns(snapshots);

  if (insights.length === 0) {
    logger.info('No staffing pattern insights to report');
    return;
  }

  // Build message
  const lines = [
    `**Period:** Past 28 days (${formatDate(startDate)} to ${today})`,
    `**Days with labor data:** ${withLabor.length}`,
    '',
  ];

  for (const insight of insights) {
    lines.push(`**${insight.name}** (avg staffing: ${insight.currentAvgStaffing})`);

    if (insight.buckets.length > 1) {
      lines.push('| Staff | Days | Avg Sales | Sales/Employee | Labor % |');
      lines.push('|-------|------|-----------|----------------|---------|');

      for (const b of insight.buckets) {
        const marker = b.staffingLevel === insight.optimalStaffing ? ' *' : '';
        lines.push(
          `| ${b.staffingLevel}${marker} | ${b.dayCount} | ${dollars(b.avgSales)} | ${dollars(b.salesPerEmployee)} | ${(b.avgLaborPercent * 100).toFixed(1)}% |`
        );
      }

      lines.push(`  Optimal: ${insight.optimalStaffing} employees (highest sales/employee)`);
    } else {
      lines.push(`  Only one staffing level observed (${insight.buckets[0]?.staffingLevel ?? 0} employees)`);
    }
    lines.push('');
  }

  const title = `Labor Staffing Patterns: ${withLabor.length} Day Analysis`;
  const body = lines.join('\n');

  logger.info('Labor pattern insights computed', { dowCount: insights.length });

  await postToTeamsWebhook('ops', title, body);
}
