/**
 * Monday Morning Executive Weekly Digest.
 *
 * Computes a high level summary of the past week including wins, misses,
 * key metrics table, and trend direction. Posts to the Teams #finance
 * webhook for leadership review.
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

// ── Types ──

interface WeekMetrics {
  totalRevenue: number;
  avgDailyRevenue: number;
  totalOrders: number;
  avgTicket: number;
  totalVoids: number;
  voidRate: number;
  avgLaborPercent: number | null;
  laborDays: number;
  bestDay: { date: string; sales: number } | null;
  worstDay: { date: string; sales: number } | null;
}

interface TrendDirection {
  direction: 'improving' | 'stable' | 'declining';
  reason: string;
}

// ── Computations ──

function computeWeekMetrics(snapshots: DaySnapshot[]): WeekMetrics {
  if (snapshots.length === 0) {
    return {
      totalRevenue: 0,
      avgDailyRevenue: 0,
      totalOrders: 0,
      avgTicket: 0,
      totalVoids: 0,
      voidRate: 0,
      avgLaborPercent: null,
      laborDays: 0,
      bestDay: null,
      worstDay: null,
    };
  }

  let totalRevenue = 0;
  let totalOrders = 0;
  let totalVoids = 0;
  let laborSum = 0;
  let laborDays = 0;
  let bestDay: { date: string; sales: number } | null = null;
  let worstDay: { date: string; sales: number } | null = null;

  for (const snap of snapshots) {
    totalRevenue += snap.totalSales;
    totalOrders += snap.totalOrders;
    totalVoids += snap.voidCount;

    if (snap.labor && snap.labor.laborPercent > 0) {
      laborSum += snap.labor.laborPercent;
      laborDays++;
    }

    if (!bestDay || snap.totalSales > bestDay.sales) {
      bestDay = { date: snap.date, sales: snap.totalSales };
    }
    if (!worstDay || snap.totalSales < worstDay.sales) {
      worstDay = { date: snap.date, sales: snap.totalSales };
    }
  }

  return {
    totalRevenue: Math.round(totalRevenue * 100) / 100,
    avgDailyRevenue: Math.round((totalRevenue / snapshots.length) * 100) / 100,
    totalOrders,
    avgTicket: totalOrders > 0 ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
    totalVoids,
    voidRate: (totalOrders + totalVoids) > 0
      ? totalVoids / (totalOrders + totalVoids)
      : 0,
    avgLaborPercent: laborDays > 0 ? laborSum / laborDays : null,
    laborDays,
    bestDay,
    worstDay,
  };
}

function determineTrend(
  current: WeekMetrics,
  prior: WeekMetrics | null,
): TrendDirection {
  if (!prior || prior.totalRevenue === 0) {
    return { direction: 'stable', reason: 'Insufficient prior data for comparison' };
  }

  const revenueChange = pctChange(current.totalRevenue, prior.totalRevenue);
  const orderChange = pctChange(current.totalOrders, prior.totalOrders);
  const ticketChange = pctChange(current.avgTicket, prior.avgTicket);

  if (revenueChange === null) {
    return { direction: 'stable', reason: 'No revenue change data available' };
  }

  // Score: positive means improving
  let score = 0;
  const reasons: string[] = [];

  if (revenueChange > 0.03) {
    score += 2;
    reasons.push(`Revenue up ${(revenueChange * 100).toFixed(1)}%`);
  } else if (revenueChange < -0.03) {
    score -= 2;
    reasons.push(`Revenue down ${(revenueChange * 100).toFixed(1)}%`);
  }

  if (orderChange !== null) {
    if (orderChange > 0.03) {
      score += 1;
      reasons.push(`Orders up ${(orderChange * 100).toFixed(1)}%`);
    } else if (orderChange < -0.03) {
      score -= 1;
      reasons.push(`Orders down ${(orderChange * 100).toFixed(1)}%`);
    }
  }

  if (ticketChange !== null) {
    if (ticketChange > 0.03) {
      score += 1;
      reasons.push(`Avg ticket up ${(ticketChange * 100).toFixed(1)}%`);
    } else if (ticketChange < -0.03) {
      score -= 1;
      reasons.push(`Avg ticket down ${(ticketChange * 100).toFixed(1)}%`);
    }
  }

  const direction = score >= 2 ? 'improving' : score <= -2 ? 'declining' : 'stable';
  return {
    direction,
    reason: reasons.length > 0 ? reasons.join('; ') : 'All metrics within normal range',
  };
}

function identifyWins(current: WeekMetrics, prior: WeekMetrics | null): string[] {
  const wins: string[] = [];

  if (prior && prior.totalRevenue > 0) {
    const revChange = pctChange(current.totalRevenue, prior.totalRevenue);
    if (revChange !== null && revChange > 0.05) {
      wins.push(`Revenue grew ${(revChange * 100).toFixed(1)}% week over week`);
    }
  }

  if (current.bestDay) {
    wins.push(`Best day: ${current.bestDay.date} with ${dollars(current.bestDay.sales)}`);
  }

  if (current.voidRate < 0.02) {
    wins.push(`Low void rate at ${pct(current.voidRate)}`);
  }

  if (current.avgLaborPercent !== null && current.avgLaborPercent < 0.30) {
    wins.push(`Labor % well controlled at ${pct(current.avgLaborPercent)}`);
  }

  return wins;
}

function identifyMisses(current: WeekMetrics, prior: WeekMetrics | null): string[] {
  const misses: string[] = [];

  if (prior && prior.totalRevenue > 0) {
    const revChange = pctChange(current.totalRevenue, prior.totalRevenue);
    if (revChange !== null && revChange < -0.05) {
      misses.push(`Revenue declined ${(revChange * 100).toFixed(1)}% week over week`);
    }
  }

  if (current.voidRate > 0.05) {
    misses.push(`High void rate at ${pct(current.voidRate)}`);
  }

  if (current.avgLaborPercent !== null && current.avgLaborPercent > 0.35) {
    misses.push(`Labor % elevated at ${pct(current.avgLaborPercent)}`);
  }

  if (current.worstDay && current.bestDay) {
    const spread = current.bestDay.sales > 0
      ? (current.bestDay.sales - current.worstDay.sales) / current.bestDay.sales
      : 0;
    if (spread > 0.40) {
      misses.push(`High daily variance: ${dollars(current.worstDay.sales)} to ${dollars(current.bestDay.sales)}`);
    }
  }

  return misses;
}

// ── Runner ──

/**
 * Runs the Monday morning executive summary.
 * Computes wins, misses, metrics, and trend direction for the past week.
 * Posts to the #finance webhook.
 */
export async function runExecutiveSummary(timezone: string): Promise<void> {
  logger.info('Running executive weekly summary');

  const today = todayStr(timezone);
  const todayDate = parseDate(today);

  // Current week: 7 days ending yesterday
  const currentStart = new Date(todayDate);
  currentStart.setUTCDate(currentStart.getUTCDate() - 7);
  const currentSnapshots = await fetchDayRange(formatDate(currentStart), 7);

  // Prior week: 14 to 8 days ago
  const priorStart = new Date(todayDate);
  priorStart.setUTCDate(priorStart.getUTCDate() - 14);
  const priorSnapshots = await fetchDayRange(formatDate(priorStart), 7);

  if (currentSnapshots.length === 0) {
    logger.warn('No data for executive summary');
    return;
  }

  const current = computeWeekMetrics(currentSnapshots);
  const prior = priorSnapshots.length > 0 ? computeWeekMetrics(priorSnapshots) : null;
  const trend = determineTrend(current, prior);
  const wins = identifyWins(current, prior);
  const misses = identifyMisses(current, prior);

  // Build message
  const trendEmoji = trend.direction === 'improving' ? '📈'
    : trend.direction === 'declining' ? '📉'
    : '➡️';

  const lines = [
    `**Week:** ${formatDate(currentStart)} to ${today}`,
    `**Trend:** ${trendEmoji} ${trend.direction.charAt(0).toUpperCase() + trend.direction.slice(1)}`,
    `**Reason:** ${trend.reason}`,
    '',
    '**Key Metrics**',
    '',
    '| Metric | Value |',
    '|--------|-------|',
    `| Total Revenue | ${dollars(current.totalRevenue)} |`,
    `| Avg Daily Revenue | ${dollars(current.avgDailyRevenue)} |`,
    `| Total Orders | ${current.totalOrders} |`,
    `| Avg Ticket | ${dollars(current.avgTicket)} |`,
    `| Void Rate | ${pct(current.voidRate)} |`,
  ];

  if (current.avgLaborPercent !== null) {
    lines.push(`| Avg Labor % | ${pct(current.avgLaborPercent)} (${current.laborDays} days) |`);
  }

  if (current.bestDay) {
    lines.push(`| Best Day | ${current.bestDay.date}: ${dollars(current.bestDay.sales)} |`);
  }
  if (current.worstDay) {
    lines.push(`| Slowest Day | ${current.worstDay.date}: ${dollars(current.worstDay.sales)} |`);
  }

  // Prior week comparison
  if (prior && prior.totalRevenue > 0) {
    const revChange = pctChange(current.totalRevenue, prior.totalRevenue);
    if (revChange !== null) {
      const sign = revChange >= 0 ? '+' : '';
      lines.push(`| vs Prior Week | ${sign}${(revChange * 100).toFixed(1)}% revenue |`);
    }
  }

  lines.push('');

  // Wins
  if (wins.length > 0) {
    lines.push('**Wins**');
    for (const w of wins) {
      lines.push(`  * ${w}`);
    }
    lines.push('');
  }

  // Misses
  if (misses.length > 0) {
    lines.push('**Areas for Improvement**');
    for (const m of misses) {
      lines.push(`  * ${m}`);
    }
    lines.push('');
  }

  if (wins.length === 0 && misses.length === 0) {
    lines.push('Steady week with no major wins or misses to call out.');
    lines.push('');
  }

  const title = `Executive Weekly Digest: ${formatDate(currentStart)} to ${today}`;
  const body = lines.join('\n');

  logger.info('Executive summary computed', {
    trend: trend.direction,
    wins: wins.length,
    misses: misses.length,
  });

  await postToTeamsWebhook('finance', title, body);
}
