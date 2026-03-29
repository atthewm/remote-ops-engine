/**
 * Weekly Trends Comparison.
 *
 * Compares the past 7 days vs the prior 7 days across: revenue, orders,
 * average ticket, void rate, labor % (if available), and drive thru speed
 * (if available). Flags any metric that moved 10%+ in either direction.
 * Posts the results to the Teams #finance webhook.
 */

import {
  fetchDayRange,
  todayStr,
  parseDate,
  formatDate,
  dollars,
  pct,
  pctChange,
  type DaySnapshot,
} from './base.js';
import { postToTeamsWebhook } from '../routing/teams-webhook.js';
import { logger } from '../util/logger.js';

// ── Aggregation ──

interface WeekAggregate {
  totalRevenue: number;
  totalOrders: number;
  avgTicket: number;
  voidRate: number;
  laborPercent: number | null;
  dtAvgSeconds: number | null;
  days: number;
}

function aggregateWeek(snapshots: DaySnapshot[]): WeekAggregate {
  if (snapshots.length === 0) {
    return {
      totalRevenue: 0,
      totalOrders: 0,
      avgTicket: 0,
      voidRate: 0,
      laborPercent: null,
      dtAvgSeconds: null,
      days: 0,
    };
  }

  let totalRevenue = 0;
  let totalOrders = 0;
  let totalVoids = 0;
  let laborSum = 0;
  let laborDays = 0;
  let dtSecondsSum = 0;
  let dtDays = 0;

  for (const snap of snapshots) {
    totalRevenue += snap.totalSales;
    totalOrders += snap.totalOrders;
    totalVoids += snap.voidCount;

    if (snap.labor && snap.labor.laborPercent > 0) {
      laborSum += snap.labor.laborPercent;
      laborDays++;
    }

    if (snap.driveThru && snap.driveThru.avgSeconds > 0) {
      dtSecondsSum += snap.driveThru.avgSeconds;
      dtDays++;
    }
  }

  const avgTicket = totalOrders > 0 ? totalRevenue / totalOrders : 0;
  const voidRate = (totalOrders + totalVoids) > 0
    ? totalVoids / (totalOrders + totalVoids)
    : 0;

  return {
    totalRevenue,
    totalOrders,
    avgTicket,
    voidRate,
    laborPercent: laborDays > 0 ? laborSum / laborDays : null,
    dtAvgSeconds: dtDays > 0 ? dtSecondsSum / dtDays : null,
    days: snapshots.length,
  };
}

// ── Trend Detection ──

interface TrendItem {
  metric: string;
  current: string;
  previous: string;
  change: number;
  direction: 'up' | 'down';
  flagged: boolean;
}

const THRESHOLD = 0.10; // 10% change triggers a flag

function detectTrends(current: WeekAggregate, previous: WeekAggregate): TrendItem[] {
  const items: TrendItem[] = [];

  // Revenue
  const revChange = pctChange(current.totalRevenue, previous.totalRevenue);
  if (revChange !== null) {
    items.push({
      metric: 'Revenue',
      current: dollars(current.totalRevenue),
      previous: dollars(previous.totalRevenue),
      change: revChange,
      direction: revChange >= 0 ? 'up' : 'down',
      flagged: Math.abs(revChange) >= THRESHOLD,
    });
  }

  // Orders
  const ordChange = pctChange(current.totalOrders, previous.totalOrders);
  if (ordChange !== null) {
    items.push({
      metric: 'Orders',
      current: String(current.totalOrders),
      previous: String(previous.totalOrders),
      change: ordChange,
      direction: ordChange >= 0 ? 'up' : 'down',
      flagged: Math.abs(ordChange) >= THRESHOLD,
    });
  }

  // Avg Ticket
  const ticketChange = pctChange(current.avgTicket, previous.avgTicket);
  if (ticketChange !== null) {
    items.push({
      metric: 'Avg Ticket',
      current: dollars(current.avgTicket),
      previous: dollars(previous.avgTicket),
      change: ticketChange,
      direction: ticketChange >= 0 ? 'up' : 'down',
      flagged: Math.abs(ticketChange) >= THRESHOLD,
    });
  }

  // Void Rate
  const voidChange = pctChange(current.voidRate, previous.voidRate);
  if (voidChange !== null) {
    items.push({
      metric: 'Void Rate',
      current: pct(current.voidRate),
      previous: pct(previous.voidRate),
      change: voidChange,
      direction: voidChange >= 0 ? 'up' : 'down',
      flagged: Math.abs(voidChange) >= THRESHOLD,
    });
  }

  // Labor % (optional)
  if (current.laborPercent !== null && previous.laborPercent !== null) {
    const labChange = pctChange(current.laborPercent, previous.laborPercent);
    if (labChange !== null) {
      items.push({
        metric: 'Labor %',
        current: pct(current.laborPercent),
        previous: pct(previous.laborPercent),
        change: labChange,
        direction: labChange >= 0 ? 'up' : 'down',
        flagged: Math.abs(labChange) >= THRESHOLD,
      });
    }
  }

  // DT Speed (optional)
  if (current.dtAvgSeconds !== null && previous.dtAvgSeconds !== null) {
    const dtChange = pctChange(current.dtAvgSeconds, previous.dtAvgSeconds);
    if (dtChange !== null) {
      items.push({
        metric: 'DT Avg Seconds',
        current: `${current.dtAvgSeconds.toFixed(0)}s`,
        previous: `${previous.dtAvgSeconds.toFixed(0)}s`,
        change: dtChange,
        direction: dtChange >= 0 ? 'up' : 'down',
        flagged: Math.abs(dtChange) >= THRESHOLD,
      });
    }
  }

  return items;
}

// ── Runner ──

/**
 * Runs the weekly trends comparison (past 7 days vs prior 7 days).
 * Posts flagged metrics to the #finance webhook.
 */
export async function runWeeklyTrends(timezone: string): Promise<void> {
  logger.info('Running weekly trends analysis');

  const today = todayStr(timezone);
  const todayDate = parseDate(today);

  // Prior 7 days: days 14 through 8 ago
  const priorStart = new Date(todayDate);
  priorStart.setUTCDate(priorStart.getUTCDate() - 14);
  const priorSnapshots = await fetchDayRange(formatDate(priorStart), 7);

  // Current 7 days: days 7 through 1 ago
  const currentStart = new Date(todayDate);
  currentStart.setUTCDate(currentStart.getUTCDate() - 7);
  const currentSnapshots = await fetchDayRange(formatDate(currentStart), 7);

  if (currentSnapshots.length === 0 || priorSnapshots.length === 0) {
    logger.warn('Insufficient data for weekly trends', {
      currentDays: currentSnapshots.length,
      priorDays: priorSnapshots.length,
    });
    return;
  }

  const currentAgg = aggregateWeek(currentSnapshots);
  const priorAgg = aggregateWeek(priorSnapshots);
  const trends = detectTrends(currentAgg, priorAgg);
  const flagged = trends.filter(t => t.flagged);

  // Build message
  const lines = [
    `**Period:** ${formatDate(currentStart)} to ${today}`,
    `**Compared to:** ${formatDate(priorStart)} to ${formatDate(currentStart)}`,
    '',
    '| Metric | This Week | Prior Week | Change |',
    '|--------|-----------|------------|--------|',
  ];

  for (const t of trends) {
    const arrow = t.direction === 'up' ? '+' : '';
    const flag = t.flagged ? ' **' : '';
    lines.push(
      `| ${t.metric} | ${t.current} | ${t.previous} | ${arrow}${(t.change * 100).toFixed(1)}%${flag} |`
    );
  }

  if (flagged.length > 0) {
    lines.push('');
    lines.push(`**${flagged.length} metric(s) moved 10%+:**`);
    for (const f of flagged) {
      const arrow = f.direction === 'up' ? '+' : '';
      lines.push(`  ${f.metric}: ${arrow}${(f.change * 100).toFixed(1)}%`);
    }
  } else {
    lines.push('');
    lines.push('All metrics within normal range (under 10% change).');
  }

  const title = `Weekly Trends: ${formatDate(currentStart)} to ${today}`;
  const body = lines.join('\n');

  logger.info('Weekly trends computed', {
    totalMetrics: trends.length,
    flaggedMetrics: flagged.length,
  });

  await postToTeamsWebhook('finance', title, body);
}
