/**
 * Scheduler for the ops engine.
 * Uses croner for cron based job scheduling.
 * Runs rule evaluations on configured schedules.
 */

import { Cron } from 'croner';
import { RulesEngine } from './rules/engine.js';
import { AppConfig } from './util/config.js';
import { logger } from './util/logger.js';
import { purgeExpired } from './util/cooldown.js';

interface ScheduledJob {
  name: string;
  cron: Cron;
  ruleIds: string[];
}

export class Scheduler {
  private jobs: ScheduledJob[] = [];
  private engine: RulesEngine;
  private config: AppConfig;
  private storeId: string;

  constructor(engine: RulesEngine, config: AppConfig, storeId: string) {
    this.engine = engine;
    this.config = config;
    this.storeId = storeId;
  }

  /**
   * Register all scheduled jobs from config.
   * Each schedule entry maps a schedule name to a cron expression.
   * Rule IDs are matched by convention: the schedule name maps to the rule family.
   */
  start(): void {
    const schedules = this.config.rules.schedules;
    const ruleMap = this.buildScheduleToRuleMap();

    for (const [scheduleName, cronExpr] of Object.entries(schedules)) {
      const ruleIds = ruleMap[scheduleName] ?? [];
      if (ruleIds.length === 0) {
        logger.warn(`No rules mapped to schedule: ${scheduleName}`);
        continue;
      }

      const job = new Cron(cronExpr, { timezone: 'America/Chicago' }, async () => {
        logger.info(`Scheduled run: ${scheduleName}`, { ruleIds });
        try {
          await this.engine.run(this.storeId, ruleIds);
        } catch (err) {
          logger.error(`Scheduled run failed: ${scheduleName}`, { error: String(err) });
        }
      });

      this.jobs.push({ name: scheduleName, cron: job, ruleIds });
      logger.info(`Scheduled: ${scheduleName} at "${cronExpr}" with rules: ${ruleIds.join(', ')}`);
    }

    // Purge expired cooldowns daily at midnight
    const purgeJob = new Cron('0 0 * * *', { timezone: 'America/Chicago' }, () => {
      purgeExpired(7);
    });
    this.jobs.push({ name: 'cooldown_purge', cron: purgeJob, ruleIds: [] });

    logger.info(`Scheduler started with ${this.jobs.length} jobs`);
  }

  stop(): void {
    for (const job of this.jobs) {
      job.cron.stop();
    }
    this.jobs = [];
    logger.info('Scheduler stopped');
  }

  /**
   * Run all rules immediately (for testing or manual trigger).
   */
  async runAll(): Promise<void> {
    logger.info('Running all rules immediately');
    await this.engine.run(this.storeId);
  }

  /**
   * Run a specific rule family immediately.
   */
  async runFamily(family: string): Promise<void> {
    const allRules = this.engine.listRules();
    const ruleIds = allRules.filter(id => id.includes(family) || id === family);
    if (ruleIds.length === 0) {
      logger.warn(`No rules found for family: ${family}`);
      return;
    }
    logger.info(`Running rule family: ${family}`, { ruleIds });
    await this.engine.run(this.storeId, ruleIds);
  }

  getStatus(): { name: string; nextRun: string | null; ruleIds: string[] }[] {
    return this.jobs.map(j => ({
      name: j.name,
      nextRun: j.cron.nextRun()?.toISOString() ?? null,
      ruleIds: j.ruleIds,
    }));
  }

  private buildScheduleToRuleMap(): Record<string, string[]> {
    // Map schedule names to rule IDs by convention
    return {
      morningReadiness: ['readiness'],
      readinessEscalation: ['readiness_escalation'],
      dailyPrimeCost: ['prime_cost'],
      itemMarginWeekly: ['item_margin'],
      vendorPriceDaily: ['vendor_price'],
      salesPaceMorning: ['sales_pace'],
      salesPaceAfternoon: ['sales_pace'],
      laborEfficiency: ['labor'],
      discountCompVoid: ['discount_comp_void'],
      stockoutCheck: ['stockout'],
      dailyOpsDigest: ['daily_ops_digest'],
      weeklyExecSummary: ['weekly_exec_summary'],
    };
  }
}
