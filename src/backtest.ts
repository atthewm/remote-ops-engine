/**
 * Backtest runner for the ops engine.
 *
 * Replays historical date ranges against the rules engine
 * to evaluate which alerts would have fired, identify false positives,
 * and tune thresholds.
 *
 * Usage:
 *   tsx src/backtest.ts --start 2026-03-01 --end 2026-03-24
 *   tsx src/backtest.ts --days 14
 */

import { loadConfig, getStore, AppConfig } from './util/config.js';
import { logger } from './util/logger.js';
import { loadCooldowns } from './util/cooldown.js';
import { RulesEngine } from './rules/engine.js';
import { ReadinessRule } from './rules/readiness.js';
import { PrimeCostRule } from './rules/prime-cost.js';
import { ItemMarginRule } from './rules/item-margin.js';
import { VendorPriceRule } from './rules/vendor-price.js';
import { SalesPaceRule } from './rules/sales-pace.js';
import { LaborRule } from './rules/labor.js';
import { DiscountCompRule } from './rules/discount-comp.js';
import { StockoutRule } from './rules/stockout.js';
import { disconnectAll } from './mcp/client.js';
import { NotificationEvent } from './models/normalized.js';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface BacktestResult {
  dateRange: { start: string; end: string };
  daysProcessed: number;
  totalAlertsFired: number;
  alertsByRule: Record<string, number>;
  alertsBySeverity: Record<string, number>;
  alerts: NotificationEvent[];
  falsePositiveCandidates: string[];
  noisyRules: string[];
  highValueRules: string[];
  recommendations: string[];
}

function parseArgs(): { startDate: string; endDate: string } {
  const args = process.argv.slice(2);

  let startDate: string | null = null;
  let endDate: string | null = null;

  const startIdx = args.indexOf('--start');
  if (startIdx !== -1 && args[startIdx + 1]) {
    startDate = args[startIdx + 1];
  }

  const endIdx = args.indexOf('--end');
  if (endIdx !== -1 && args[endIdx + 1]) {
    endDate = args[endIdx + 1];
  }

  const daysIdx = args.indexOf('--days');
  if (daysIdx !== -1 && args[daysIdx + 1]) {
    const days = parseInt(args[daysIdx + 1], 10);
    const end = new Date();
    end.setDate(end.getDate() - 1); // yesterday
    const start = new Date(end);
    start.setDate(start.getDate() - days + 1);
    startDate = start.toISOString().split('T')[0];
    endDate = end.toISOString().split('T')[0];
  }

  if (!startDate || !endDate) {
    console.error('Usage: tsx src/backtest.ts --start YYYY-MM-DD --end YYYY-MM-DD');
    console.error('   or: tsx src/backtest.ts --days 14');
    process.exit(1);
  }

  return { startDate, endDate };
}

function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(start + 'T00:00:00');
  const endDate = new Date(end + 'T00:00:00');

  while (current <= endDate) {
    dates.push(current.toISOString().split('T')[0]);
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

async function main(): Promise<void> {
  const { startDate, endDate } = parseArgs();

  logger.info(`Backtest starting: ${startDate} to ${endDate}`);

  const config = loadConfig();
  config.rules.mode = 'test';
  loadCooldowns();

  const store = getStore(config);
  const dates = generateDateRange(startDate, endDate);

  logger.info(`Processing ${dates.length} days for store: ${store.name}`);

  // Collect all alerts
  const allAlerts: NotificationEvent[] = [];

  const engine = new RulesEngine(config, {
    mode: 'test',
    skipCooldown: true,
    onAlert: async (alert: NotificationEvent) => {
      allAlerts.push(alert);
    },
  });
  engine.registerRule(new ReadinessRule());
  engine.registerRule(new PrimeCostRule());
  engine.registerRule(new ItemMarginRule());
  engine.registerRule(new VendorPriceRule());
  engine.registerRule(new SalesPaceRule());
  engine.registerRule(new LaborRule());
  engine.registerRule(new DiscountCompRule());
  engine.registerRule(new StockoutRule());

  // Process each date
  for (const date of dates) {
    logger.info(`Backtesting: ${date}`);
    try {
      // Override the "current date" context for rules that use it
      process.env.BACKTEST_DATE = date;
      await engine.run(store.id);
    } catch (err) {
      logger.warn(`Error processing ${date}`, { error: String(err) });
    }
  }

  delete process.env.BACKTEST_DATE;

  // Analyze results
  const result = analyzeResults(allAlerts, dates);

  // Write report
  const reportDir = resolve(__dirname, '../reports');
  if (!existsSync(reportDir)) {
    mkdirSync(reportDir, { recursive: true });
  }

  const reportPath = resolve(reportDir, `backtest_${startDate}_${endDate}.json`);
  writeFileSync(reportPath, JSON.stringify(result, null, 2), 'utf-8');
  logger.info(`Backtest report written to: ${reportPath}`);

  // Print summary
  printSummary(result);

  await disconnectAll();
}

function analyzeResults(alerts: NotificationEvent[], dates: string[]): BacktestResult {
  const alertsByRule: Record<string, number> = {};
  const alertsBySeverity: Record<string, number> = {};

  for (const alert of alerts) {
    alertsByRule[alert.ruleId] = (alertsByRule[alert.ruleId] ?? 0) + 1;
    alertsBySeverity[alert.severity] = (alertsBySeverity[alert.severity] ?? 0) + 1;
  }

  // Identify noisy rules (firing > 70% of days)
  const noisyRules: string[] = [];
  for (const [ruleId, count] of Object.entries(alertsByRule)) {
    if (count / dates.length > 0.7) {
      noisyRules.push(ruleId);
    }
  }

  // Identify high value rules (red alerts that fired infrequently)
  const highValueRules: string[] = [];
  const redAlerts = alerts.filter(a => a.severity === 'red');
  const redByRule: Record<string, number> = {};
  for (const alert of redAlerts) {
    redByRule[alert.ruleId] = (redByRule[alert.ruleId] ?? 0) + 1;
  }
  for (const [ruleId, count] of Object.entries(redByRule)) {
    if (count / dates.length < 0.3) {
      highValueRules.push(ruleId);
    }
  }

  // False positive candidates: green alerts that fired most days
  const falsePositiveCandidates = alerts
    .filter(a => a.severity === 'green')
    .map(a => a.ruleId)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .filter(ruleId => {
      const count = alertsByRule[ruleId] ?? 0;
      return count / dates.length > 0.8;
    });

  const recommendations: string[] = [];
  if (noisyRules.length > 0) {
    recommendations.push(`Consider raising thresholds for noisy rules: ${noisyRules.join(', ')}`);
  }
  if (highValueRules.length > 0) {
    recommendations.push(`High value rules (infrequent red alerts): ${highValueRules.join(', ')}`);
  }
  if (alerts.length === 0) {
    recommendations.push('No alerts fired. Check if MCP servers are accessible and returning data.');
  }
  if (redAlerts.length / Math.max(alerts.length, 1) > 0.5) {
    recommendations.push('Red alerts dominate. Thresholds may be too tight for current operations.');
  }

  return {
    dateRange: { start: dates[0], end: dates[dates.length - 1] },
    daysProcessed: dates.length,
    totalAlertsFired: alerts.length,
    alertsByRule,
    alertsBySeverity,
    alerts,
    falsePositiveCandidates,
    noisyRules,
    highValueRules,
    recommendations,
  };
}

function printSummary(result: BacktestResult): void {
  console.log('\n========================================');
  console.log('         BACKTEST SUMMARY');
  console.log('========================================');
  console.log(`Period: ${result.dateRange.start} to ${result.dateRange.end}`);
  console.log(`Days processed: ${result.daysProcessed}`);
  console.log(`Total alerts: ${result.totalAlertsFired}`);
  console.log('');
  console.log('By severity:');
  for (const [sev, count] of Object.entries(result.alertsBySeverity)) {
    console.log(`  ${sev.toUpperCase()}: ${count}`);
  }
  console.log('');
  console.log('By rule:');
  for (const [rule, count] of Object.entries(result.alertsByRule)) {
    const perDay = (count / result.daysProcessed).toFixed(1);
    console.log(`  ${rule}: ${count} (${perDay}/day)`);
  }
  console.log('');
  if (result.noisyRules.length > 0) {
    console.log(`Noisy rules (>70% of days): ${result.noisyRules.join(', ')}`);
  }
  if (result.highValueRules.length > 0) {
    console.log(`High value rules: ${result.highValueRules.join(', ')}`);
  }
  console.log('');
  console.log('Recommendations:');
  for (const rec of result.recommendations) {
    console.log(`  * ${rec}`);
  }
  console.log('========================================\n');
}

main().catch(err => {
  logger.error('Backtest fatal error', { error: String(err) });
  process.exit(1);
});
