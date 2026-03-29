/**
 * Day of Week Decay Detection.
 *
 * Fetches 28 days of data and groups by day of week. For each DOW that
 * has 3+ data points, checks whether sales have declined in 3 or more
 * consecutive weeks. Posts findings to the Teams #finance webhook.
 *
 * This helps identify patterns like "Mondays are declining steadily"
 * which may indicate a need for promotions, menu changes, or staffing
 * adjustments on specific days.
 */

import {
  fetchDayRange,
  todayStr,
  parseDate,
  formatDate,
  dayName,
  dollars,
  pctChange,
  type DaySnapshot,
} from './base.js';
import { postToTeamsWebhook } from '../routing/teams-webhook.js';
import { logger } from '../util/logger.js';

// ── Types ──

interface DayOfWeekSeries {
  dayOfWeek: number;
  name: string;
  /** Sales values ordered oldest to newest */
  salesByWeek: number[];
  /** Dates corresponding to each week's data point */
  dates: string[];
}

interface DecayFinding {
  dayName: string;
  consecutiveDeclines: number;
  oldestSales: number;
  newestSales: number;
  totalDeclinePercent: number;
  dates: string[];
}

// ── Analysis ──

/**
 * Groups snapshots by day of week and returns series for each DOW.
 */
function groupByDayOfWeek(snapshots: DaySnapshot[]): DayOfWeekSeries[] {
  const map = new Map<number, { sales: number; date: string }[]>();

  for (const snap of snapshots) {
    const dow = snap.dayOfWeek;
    const entries = map.get(dow) ?? [];
    entries.push({ sales: snap.totalSales, date: snap.date });
    map.set(dow, entries);
  }

  const series: DayOfWeekSeries[] = [];
  for (const [dow, entries] of map) {
    // Sort oldest to newest
    entries.sort((a, b) => a.date.localeCompare(b.date));
    series.push({
      dayOfWeek: dow,
      name: dayName(dow),
      salesByWeek: entries.map(e => e.sales),
      dates: entries.map(e => e.date),
    });
  }

  return series;
}

/**
 * Detects consecutive weekly sales declines for a given DOW series.
 * Returns a finding only if 3+ consecutive declines are detected.
 */
function detectDecay(series: DayOfWeekSeries): DecayFinding | null {
  if (series.salesByWeek.length < 3) return null;

  // Count consecutive declines from the most recent week backward
  let consecutiveDeclines = 0;
  for (let i = series.salesByWeek.length - 1; i > 0; i--) {
    if (series.salesByWeek[i] < series.salesByWeek[i - 1]) {
      consecutiveDeclines++;
    } else {
      break;
    }
  }

  if (consecutiveDeclines < 3) return null;

  const startIdx = series.salesByWeek.length - 1 - consecutiveDeclines;
  const oldestSales = series.salesByWeek[startIdx];
  const newestSales = series.salesByWeek[series.salesByWeek.length - 1];
  const change = pctChange(newestSales, oldestSales);

  return {
    dayName: series.name,
    consecutiveDeclines,
    oldestSales,
    newestSales,
    totalDeclinePercent: change ?? 0,
    dates: series.dates.slice(startIdx),
  };
}

// ── Runner ──

/**
 * Runs the day of week decay detection.
 * Fetches 28 days, groups by DOW, checks for 3+ consecutive weekly declines.
 * Posts findings to the #finance webhook.
 */
export async function runDayDecayDetection(timezone: string): Promise<void> {
  logger.info('Running day of week decay detection');

  const today = todayStr(timezone);
  const todayDate = parseDate(today);
  const startDate = new Date(todayDate);
  startDate.setUTCDate(startDate.getUTCDate() - 28);

  const snapshots = await fetchDayRange(formatDate(startDate), 28);

  if (snapshots.length < 7) {
    logger.warn('Insufficient data for day decay detection', { days: snapshots.length });
    return;
  }

  const series = groupByDayOfWeek(snapshots);
  const findings: DecayFinding[] = [];

  for (const s of series) {
    if (s.salesByWeek.length < 3) continue;
    const finding = detectDecay(s);
    if (finding) {
      findings.push(finding);
    }
  }

  if (findings.length === 0) {
    logger.info('No day of week decay detected');
    // Still post a clean bill of health
    await postToTeamsWebhook(
      'finance',
      'Day of Week Trends: No Decay Detected',
      `Analyzed ${snapshots.length} days over the past 4 weeks. No day of week shows 3+ consecutive weekly sales declines.`,
    );
    return;
  }

  // Build message
  const lines = [
    `**Period:** Past 28 days (${formatDate(startDate)} to ${today})`,
    `**Days analyzed:** ${snapshots.length}`,
    '',
  ];

  for (const f of findings) {
    const declinePct = (f.totalDeclinePercent * 100).toFixed(1);
    lines.push(`**${f.dayName}s:** ${f.consecutiveDeclines} consecutive weekly declines`);
    lines.push(`  From ${dollars(f.oldestSales)} to ${dollars(f.newestSales)} (${declinePct}%)`);
    lines.push(`  Dates: ${f.dates.join(', ')}`);
    lines.push('');
  }

  lines.push('**Recommendation:** Review promotions, menu specials, or staffing for these days.');

  const title = `Day Decay Alert: ${findings.length} Day(s) Declining`;
  const body = lines.join('\n');

  logger.info('Day decay findings', { count: findings.length });

  await postToTeamsWebhook('finance', title, body);
}
