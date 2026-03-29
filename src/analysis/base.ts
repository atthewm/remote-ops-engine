/**
 * Shared utilities for analysis modules.
 *
 * Provides data fetching, date manipulation, and formatting helpers
 * used across all analysis modules (server performance, weekly trends,
 * day decay, labor patterns, weather, executive summary).
 */

import { callTool } from '../mcp/client.js';
import { logger } from '../util/logger.js';

// ── Interfaces ──

export interface LaborSnapshot {
  totalHours: number;
  overtimeHours: number;
  totalLaborCost: number;
  totalTips: number;
  employeesWorked: number;
  laborPercent: number;
}

export interface PlatformEntry {
  name: string;
  orderCount: number;
  sales: number;
}

export interface DriveThruSnapshot {
  count: number;
  avgSeconds: number;
}

export interface DaySnapshot {
  date: string;
  dayOfWeek: number;
  totalOrders: number;
  totalSales: number;
  voidCount: number;
  averageOrderValue: number;
  labor: LaborSnapshot | null;
  driveThru: DriveThruSnapshot | null;
  platformBreakdown: PlatformEntry[];
}

// ── Raw response shapes ──

interface RawOrder {
  guid?: string;
  voided?: boolean;
  totalAmount?: number;
  amount?: number;
  diningOption?: { guid?: string; name?: string } | null;
  checks?: Array<{
    netAmount?: number;
    totalAmount?: number;
    amount?: number;
  }>;
  [key: string]: unknown;
}

interface RawLaborSummary {
  totalHours?: number;
  totalOvertimeHours?: number;
  totalLaborCost?: number;
  totalTips?: number;
  employeesWorked?: number;
}

interface RawShiftResponse {
  laborSummary?: RawLaborSummary;
  [key: string]: unknown;
}

// ── Date Helpers ──

/**
 * Parses a YYYY-MM-DD string into a Date (at midnight UTC).
 */
export function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Formats a Date as YYYY-MM-DD.
 */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns today's date as YYYY-MM-DD in the given IANA timezone.
 */
export function todayStr(tz: string): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const y = parts.find(p => p.type === 'year')!.value;
  const m = parts.find(p => p.type === 'month')!.value;
  const d = parts.find(p => p.type === 'day')!.value;
  return `${y}-${m}-${d}`;
}

/**
 * Returns yesterday's date as YYYY-MM-DD in the given IANA timezone.
 */
export function yesterdayStr(tz: string): string {
  const today = parseDate(todayStr(tz));
  today.setUTCDate(today.getUTCDate() - 1);
  return formatDate(today);
}

/**
 * Returns the day name (Mon, Tue, Wed, ...) for a numeric day of week.
 * 0 = Sunday, 1 = Monday, etc.
 */
export function dayName(dow: number): string {
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return names[dow] ?? 'N/A';
}

// ── Formatting Helpers ──

/**
 * Formats a decimal as a percentage string, e.g. 0.321 => "32.1%".
 */
export function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Formats a number as a USD dollar string, e.g. 1234.56 => "$1,234.56".
 */
export function dollars(value: number): string {
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Computes percentage change from previous to current.
 * Returns null if previous is zero.
 */
export function pctChange(current: number, previous: number): number | null {
  if (previous === 0) return null;
  return (current - previous) / previous;
}

// ── Data Fetching ──

/**
 * Fetches a single day's summary from Toast (orders + shifts).
 * Returns a DaySnapshot with sales, labor, drive thru, and platform breakdown.
 */
export async function fetchDaySummary(businessDate: string): Promise<DaySnapshot> {
  logger.info('Fetching day summary', { businessDate });

  // Fetch orders
  const rawOrders = await callTool('toast', 'toast_list_orders', {
    businessDate,
    fetchAll: true,
  }) as RawOrder[] | { orders: RawOrder[] };

  const orders: RawOrder[] = Array.isArray(rawOrders)
    ? rawOrders
    : (rawOrders?.orders ?? []);

  // Compute sales totals
  let totalSales = 0;
  let voidCount = 0;
  const platformMap = new Map<string, { name: string; orderCount: number; sales: number }>();

  for (const order of orders) {
    if (order.voided) {
      voidCount++;
      continue;
    }

    let orderNet = 0;
    for (const check of order.checks ?? []) {
      orderNet += check.netAmount ?? check.totalAmount ?? check.amount ?? 0;
    }
    totalSales += orderNet;

    // Platform breakdown
    const platName = order.diningOption?.name ?? 'Unknown';
    const existing = platformMap.get(platName) ?? { name: platName, orderCount: 0, sales: 0 };
    existing.orderCount += 1;
    existing.sales += orderNet;
    platformMap.set(platName, existing);
  }

  const nonVoidedOrders = orders.filter(o => !o.voided);
  const totalOrders = nonVoidedOrders.length;
  const averageOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

  // Fetch labor (shifts)
  let labor: LaborSnapshot | null = null;
  try {
    const rawShifts = await callTool('toast', 'toast_list_shifts', {
      businessDate,
    }) as RawShiftResponse | null;

    if (rawShifts?.laborSummary) {
      const ls = rawShifts.laborSummary;
      const totalLaborCost = ls.totalLaborCost ?? 0;
      labor = {
        totalHours: ls.totalHours ?? 0,
        overtimeHours: ls.totalOvertimeHours ?? 0,
        totalLaborCost,
        totalTips: ls.totalTips ?? 0,
        employeesWorked: ls.employeesWorked ?? 0,
        laborPercent: totalSales > 0 ? totalLaborCost / totalSales : 0,
      };
    }
  } catch (err) {
    logger.warn('Failed to fetch labor data', { businessDate, error: String(err) });
  }

  // Drive thru detection (look for "Drive Thru" or "DT" in dining options)
  let driveThru: DriveThruSnapshot | null = null;
  for (const [, plat] of platformMap) {
    const lower = plat.name.toLowerCase();
    if (lower.includes('drive') || lower.includes('dt')) {
      driveThru = {
        count: plat.orderCount,
        avgSeconds: 0, // Toast does not expose DT speed directly via orders
      };
      break;
    }
  }

  const parsed = parseDate(businessDate);

  return {
    date: businessDate,
    dayOfWeek: parsed.getUTCDay(),
    totalOrders,
    totalSales: Math.round(totalSales * 100) / 100,
    voidCount,
    averageOrderValue: Math.round(averageOrderValue * 100) / 100,
    labor,
    driveThru,
    platformBreakdown: Array.from(platformMap.values()).map(p => ({
      name: p.name,
      orderCount: p.orderCount,
      sales: Math.round(p.sales * 100) / 100,
    })),
  };
}

/**
 * Fetches N consecutive days of snapshots ending at startDate.
 * Fetches days in sequence: startDate, startDate+1, ..., startDate+(days-1).
 * To fetch the most recent N days, pass a start date N days ago.
 */
export async function fetchDayRange(startDate: string, days: number): Promise<DaySnapshot[]> {
  const snapshots: DaySnapshot[] = [];
  const start = parseDate(startDate);

  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(d.getUTCDate() + i);
    const dateStr = formatDate(d);

    try {
      const snapshot = await fetchDaySummary(dateStr);
      snapshots.push(snapshot);
    } catch (err) {
      logger.warn('Failed to fetch day summary', { date: dateStr, error: String(err) });
    }
  }

  return snapshots;
}
