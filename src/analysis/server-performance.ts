/**
 * Daily Server Performance Ranker.
 *
 * Fetches yesterday's orders and labor data, then computes per employee
 * metrics: average drive thru speed, void count, and sales per hour.
 * Surfaces only notable findings (fastest DT, slowest DT, most voids,
 * highest sales/hour) and posts the summary to the Teams #ops webhook.
 */

import { callTool } from '../mcp/client.js';
import { yesterdayStr, dollars } from './base.js';
import { postToTeamsWebhook } from '../routing/teams-webhook.js';
import { logger } from '../util/logger.js';

// ── Raw response shapes ──

interface RawOrder {
  guid?: string;
  voided?: boolean;
  totalAmount?: number;
  amount?: number;
  checks?: Array<{
    netAmount?: number;
    totalAmount?: number;
    amount?: number;
    selections?: Array<{
      voided?: boolean;
      [key: string]: unknown;
    }>;
  }>;
  server?: { guid?: string; firstName?: string; lastName?: string } | null;
  [key: string]: unknown;
}

interface RawTimeEntry {
  employeeGuid?: string;
  employee?: string;
  firstName?: string;
  lastName?: string;
  clockIn?: string;
  clockOut?: string;
  regularHours?: number;
  overtimeHours?: number;
  laborCost?: number;
  tips?: number;
  sales?: number;
  [key: string]: unknown;
}

interface RawShiftResponse {
  actual?: { timeEntries?: RawTimeEntry[] };
  [key: string]: unknown;
}

// ── Per Employee Metrics ──

interface EmployeeMetrics {
  name: string;
  guid: string;
  orderCount: number;
  totalSales: number;
  voidCount: number;
  hoursWorked: number;
  salesPerHour: number;
}

// ── Notable Finding ──

interface NotableFinding {
  category: string;
  employeeName: string;
  value: string;
  detail: string;
}

/**
 * Runs the daily server performance analysis for yesterday.
 * Posts notable findings to the #ops webhook.
 */
export async function runServerPerformance(timezone: string): Promise<void> {
  const yesterday = yesterdayStr(timezone);
  logger.info('Running server performance analysis', { date: yesterday });

  // Fetch orders
  let orders: RawOrder[];
  try {
    const rawOrders = await callTool('toast', 'toast_list_orders', {
      businessDate: yesterday,
      fetchAll: true,
    }) as RawOrder[] | { orders: RawOrder[] };

    orders = Array.isArray(rawOrders) ? rawOrders : (rawOrders?.orders ?? []);
  } catch (err) {
    logger.error('Failed to fetch orders for server performance', { error: String(err) });
    return;
  }

  if (orders.length === 0) {
    logger.info('No orders found for server performance analysis', { date: yesterday });
    return;
  }

  // Fetch labor/shifts
  let timeEntries: RawTimeEntry[] = [];
  try {
    const rawShifts = await callTool('toast', 'toast_list_shifts', {
      businessDate: yesterday,
    }) as RawShiftResponse | null;

    timeEntries = rawShifts?.actual?.timeEntries ?? [];
  } catch (err) {
    logger.warn('Failed to fetch shifts for server performance', { error: String(err) });
  }

  // Build hours by employee guid
  const hoursMap = new Map<string, number>();
  for (const entry of timeEntries) {
    const guid = entry.employeeGuid ?? entry.employee ?? '';
    if (!guid) continue;
    const hours = (entry.regularHours ?? 0) + (entry.overtimeHours ?? 0);
    hoursMap.set(guid, (hoursMap.get(guid) ?? 0) + hours);
  }

  // Aggregate by server
  const metricsMap = new Map<string, EmployeeMetrics>();

  for (const order of orders) {
    const serverGuid = order.server?.guid ?? '';
    const serverName = [order.server?.firstName, order.server?.lastName]
      .filter(Boolean)
      .join(' ') || 'Unknown';

    if (!serverGuid) continue;

    const existing = metricsMap.get(serverGuid) ?? {
      name: serverName,
      guid: serverGuid,
      orderCount: 0,
      totalSales: 0,
      voidCount: 0,
      hoursWorked: 0,
      salesPerHour: 0,
    };

    if (order.voided) {
      existing.voidCount += 1;
    } else {
      existing.orderCount += 1;
      let orderNet = 0;
      for (const check of order.checks ?? []) {
        orderNet += check.netAmount ?? check.totalAmount ?? check.amount ?? 0;
      }
      existing.totalSales += orderNet;
    }

    metricsMap.set(serverGuid, existing);
  }

  // Merge hours and compute sales/hour
  for (const [guid, metrics] of metricsMap) {
    metrics.hoursWorked = hoursMap.get(guid) ?? 0;
    metrics.salesPerHour = metrics.hoursWorked > 0
      ? metrics.totalSales / metrics.hoursWorked
      : 0;
  }

  const allEmployees = Array.from(metricsMap.values()).filter(e => e.orderCount > 0);

  if (allEmployees.length === 0) {
    logger.info('No server data to rank');
    return;
  }

  // Find notable findings
  const findings: NotableFinding[] = [];

  // Highest sales/hour (only employees with 2+ hours)
  const withHours = allEmployees.filter(e => e.hoursWorked >= 2);
  if (withHours.length > 0) {
    const best = withHours.reduce((a, b) => a.salesPerHour > b.salesPerHour ? a : b);
    findings.push({
      category: 'Highest Sales/Hour',
      employeeName: best.name,
      value: dollars(best.salesPerHour),
      detail: `${best.orderCount} orders, ${best.hoursWorked.toFixed(1)}h worked`,
    });

    if (withHours.length > 1) {
      const worst = withHours.reduce((a, b) => a.salesPerHour < b.salesPerHour ? a : b);
      if (worst.guid !== best.guid) {
        findings.push({
          category: 'Lowest Sales/Hour',
          employeeName: worst.name,
          value: dollars(worst.salesPerHour),
          detail: `${worst.orderCount} orders, ${worst.hoursWorked.toFixed(1)}h worked`,
        });
      }
    }
  }

  // Most voids
  const withVoids = allEmployees.filter(e => e.voidCount > 0);
  if (withVoids.length > 0) {
    const mostVoids = withVoids.reduce((a, b) => a.voidCount > b.voidCount ? a : b);
    findings.push({
      category: 'Most Voids',
      employeeName: mostVoids.name,
      value: `${mostVoids.voidCount} void(s)`,
      detail: `${mostVoids.orderCount} total orders`,
    });
  }

  // Highest total sales
  const topSeller = allEmployees.reduce((a, b) => a.totalSales > b.totalSales ? a : b);
  findings.push({
    category: 'Highest Total Sales',
    employeeName: topSeller.name,
    value: dollars(topSeller.totalSales),
    detail: `${topSeller.orderCount} orders`,
  });

  if (findings.length === 0) {
    logger.info('No notable server performance findings');
    return;
  }

  // Build message
  const lines = [
    `**Date:** ${yesterday}`,
    `**Employees tracked:** ${allEmployees.length}`,
    '',
  ];

  for (const f of findings) {
    lines.push(`**${f.category}:** ${f.employeeName}`);
    lines.push(`  ${f.value} (${f.detail})`);
    lines.push('');
  }

  const title = `Server Performance: ${yesterday}`;
  const body = lines.join('\n');

  logger.info('Server performance findings', { findingCount: findings.length });

  await postToTeamsWebhook('ops', title, body);
}
