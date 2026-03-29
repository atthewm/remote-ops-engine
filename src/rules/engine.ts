/**
 * Rules Engine.
 *
 * Loads rule implementations, evaluates them on schedule or on demand,
 * generates NotificationEvent objects, applies cooldown and dedup logic,
 * and routes alerts to the appropriate handler (formatter, task creator, logger).
 */

import { logger } from '../util/logger.js';
import { isInCooldown, recordFired, loadCooldowns } from '../util/cooldown.js';
import type { AppConfig } from '../util/config.js';
import type { NotificationEvent, AlertMode, Severity } from '../models/normalized.js';

// ── Interfaces ──

export interface RuleResult {
  ruleId: string;
  fired: boolean;
  alerts: NotificationEvent[];
}

export interface RuleHandler {
  id: string;
  name: string;
  family: string;
  evaluate(storeId: string, config: AppConfig): Promise<RuleResult>;
}

export interface EngineOptions {
  /** Run rules in parallel when true, sequentially when false. Default: false. */
  parallel: boolean;
  /** Alert mode: shadow logs only, live routes to handlers, test does both. */
  mode: AlertMode;
  /** Override the cooldown check when true (useful for testing). */
  skipCooldown: boolean;
  /** Handler called for each alert that passes all filters. */
  onAlert?: (alert: NotificationEvent) => Promise<void>;
  /** Handler called after all rules complete for summary logging. */
  onComplete?: (results: EngineRunResult) => Promise<void>;
}

export interface EngineRunResult {
  ranAt: string;
  storeId: string;
  mode: AlertMode;
  totalRulesEvaluated: number;
  totalRulesFired: number;
  totalAlerts: number;
  alertsSuppressed: number;
  alertsEmitted: number;
  results: RuleResult[];
  emittedAlerts: NotificationEvent[];
}

const DEFAULT_OPTIONS: EngineOptions = {
  parallel: false,
  mode: 'shadow',
  skipCooldown: false,
};

// ── Engine ──

export class RulesEngine {
  private handlers: RuleHandler[] = [];
  private options: EngineOptions;
  private config: AppConfig;

  constructor(config: AppConfig, options?: Partial<EngineOptions>) {
    this.config = config;
    this.options = { ...DEFAULT_OPTIONS, ...options };
    loadCooldowns();
  }

  /**
   * Register a single rule handler.
   */
  registerRule(handler: RuleHandler): void {
    const existing = this.handlers.find(h => h.id === handler.id);
    if (existing) {
      logger.warn(`Rule handler already registered, replacing: ${handler.id}`);
      this.handlers = this.handlers.filter(h => h.id !== handler.id);
    }
    this.handlers.push(handler);
    logger.info(`Registered rule: ${handler.id} (${handler.name})`);
  }

  /**
   * Register multiple rule handlers at once.
   */
  registerRules(handlers: RuleHandler[]): void {
    for (const handler of handlers) {
      this.registerRule(handler);
    }
  }

  /**
   * List all registered rule IDs.
   */
  listRules(): string[] {
    return this.handlers.map(h => h.id);
  }

  /**
   * Run all registered rules for the given store.
   * Returns the full run result including emitted and suppressed alerts.
   */
  async run(storeId: string, ruleIds?: string[]): Promise<EngineRunResult> {
    const ranAt = new Date().toISOString();
    const mode = this.options.mode;

    logger.info('Engine run starting', {
      storeId,
      mode,
      ruleCount: this.handlers.length,
      parallel: this.options.parallel,
      filterRules: ruleIds ?? 'all',
    });

    // Filter to requested rules or run all
    const handlersToRun = ruleIds
      ? this.handlers.filter(h => ruleIds.includes(h.id))
      : this.handlers;

    if (handlersToRun.length === 0) {
      logger.warn('No rule handlers to run', { storeId, filterRules: ruleIds });
    }

    // Evaluate rules
    let results: RuleResult[];

    if (this.options.parallel) {
      results = await this.runParallel(handlersToRun, storeId);
    } else {
      results = await this.runSequential(handlersToRun, storeId);
    }

    // Process alerts through cooldown and dedup filters
    const emittedAlerts: NotificationEvent[] = [];
    let alertsSuppressed = 0;
    let totalAlerts = 0;

    for (const result of results) {
      for (const alert of result.alerts) {
        totalAlerts += 1;

        // Apply shadow mode flag
        alert.shadowMode = mode === 'shadow';

        // Check cooldown unless skipped
        if (!this.options.skipCooldown) {
          const cooldownMinutes = this.getCooldownMinutes(alert.ruleId);
          if (isInCooldown(alert.fingerprint, cooldownMinutes)) {
            alertsSuppressed += 1;
            logger.debug('Alert suppressed by cooldown', {
              ruleId: alert.ruleId,
              fingerprint: alert.fingerprint,
            });
            continue;
          }
        }

        // Record the alert firing for future cooldown checks
        recordFired(alert.fingerprint, alert.ruleId);

        // Route to handler based on mode
        if (mode === 'live' || mode === 'test') {
          await this.routeAlert(alert);
        }

        // Always log the alert
        this.logAlert(alert, mode);

        emittedAlerts.push(alert);
      }
    }

    const totalRulesFired = results.filter(r => r.fired).length;

    const runResult: EngineRunResult = {
      ranAt,
      storeId,
      mode,
      totalRulesEvaluated: handlersToRun.length,
      totalRulesFired,
      totalAlerts,
      alertsSuppressed,
      alertsEmitted: emittedAlerts.length,
      results,
      emittedAlerts,
    };

    logger.info('Engine run complete', {
      storeId,
      mode,
      rulesEvaluated: handlersToRun.length,
      rulesFired: totalRulesFired,
      totalAlerts,
      suppressed: alertsSuppressed,
      emitted: emittedAlerts.length,
    });

    // Notify completion handler if registered
    if (this.options.onComplete) {
      try {
        await this.options.onComplete(runResult);
      } catch (err) {
        logger.error('onComplete handler failed', { error: String(err) });
      }
    }

    return runResult;
  }

  /**
   * Run a single rule by ID. Useful for on demand evaluation.
   */
  async runSingle(storeId: string, ruleId: string): Promise<EngineRunResult> {
    return this.run(storeId, [ruleId]);
  }

  // ── Private helpers ──

  private async runSequential(handlers: RuleHandler[], storeId: string): Promise<RuleResult[]> {
    const results: RuleResult[] = [];

    for (const handler of handlers) {
      const result = await this.safeEvaluate(handler, storeId);
      results.push(result);
    }

    return results;
  }

  private async runParallel(handlers: RuleHandler[], storeId: string): Promise<RuleResult[]> {
    const promises = handlers.map(handler => this.safeEvaluate(handler, storeId));
    return Promise.all(promises);
  }

  /**
   * Wraps rule evaluation in a try/catch so one failing rule does not
   * block the entire engine run.
   */
  private async safeEvaluate(handler: RuleHandler, storeId: string): Promise<RuleResult> {
    const startTime = Date.now();

    try {
      logger.info(`Evaluating rule: ${handler.id}`, { storeId, family: handler.family });
      const result = await handler.evaluate(storeId, this.config);
      const elapsed = Date.now() - startTime;

      logger.info(`Rule evaluation complete: ${handler.id}`, {
        storeId,
        fired: result.fired,
        alertCount: result.alerts.length,
        elapsedMs: elapsed,
      });

      return result;
    } catch (err) {
      const elapsed = Date.now() - startTime;

      logger.error(`Rule evaluation failed: ${handler.id}`, {
        storeId,
        error: String(err),
        elapsedMs: elapsed,
      });

      // Return a safe non firing result instead of propagating the error
      return {
        ruleId: handler.id,
        fired: false,
        alerts: [],
      };
    }
  }

  /**
   * Get the cooldown period for a rule. Uses rule specific overrides
   * if configured, otherwise falls back to the global default.
   */
  private getCooldownMinutes(ruleId: string): number {
    const ruleOverride = this.config.rules.cooldowns?.[ruleId];
    if (ruleOverride !== undefined) return ruleOverride;
    return this.config.rules.globalCooldownMinutes;
  }

  /**
   * Route an alert to the configured handler (e.g., Teams message, Planner task).
   */
  private async routeAlert(alert: NotificationEvent): Promise<void> {
    if (this.options.onAlert) {
      try {
        await this.options.onAlert(alert);
      } catch (err) {
        logger.error('Alert routing handler failed', {
          ruleId: alert.ruleId,
          alertId: alert.id,
          error: String(err),
        });
      }
    }
  }

  /**
   * Log the alert with metadata appropriate for the current mode.
   */
  private logAlert(alert: NotificationEvent, mode: AlertMode): void {
    const prefix = mode === 'shadow' ? '[SHADOW]' : '[LIVE]';

    logger.info(`${prefix} Alert emitted: ${alert.topic}`, {
      ruleId: alert.ruleId,
      severity: alert.severity,
      storeId: alert.storeId,
      dateWindow: alert.dateWindow,
      owner: alert.owner,
      audiences: alert.audiences,
      fingerprint: alert.fingerprint,
      shadowMode: alert.shadowMode,
    });
  }
}

// ── Helper: build a NotificationEvent with sensible defaults ──

let alertCounter = 0;

/**
 * Creates a NotificationEvent with auto generated ID and timestamps.
 * Callers provide the rule specific fields; this function fills in
 * structural defaults so rule implementations stay concise.
 */
export function buildAlert(fields: {
  ruleId: string;
  ruleName: string;
  storeId: string;
  severity: Severity;
  topic: string;
  dateWindow: string;
  whatHappened: string;
  whyItMatters: string;
  keyMetrics: Record<string, string | number>;
  recommendedAction: string;
  owner: string;
  audiences: NotificationEvent['audiences'];
  channels: string[];
  fingerprint: string;
  dueTime?: string | null;
}): NotificationEvent {
  alertCounter += 1;
  const now = new Date().toISOString();

  return {
    id: `alert_${Date.now()}_${alertCounter}`,
    ruleId: fields.ruleId,
    ruleName: fields.ruleName,
    storeId: fields.storeId,
    severity: fields.severity,
    topic: fields.topic,
    dateWindow: fields.dateWindow,
    whatHappened: fields.whatHappened,
    whyItMatters: fields.whyItMatters,
    keyMetrics: fields.keyMetrics,
    recommendedAction: fields.recommendedAction,
    owner: fields.owner,
    dueTime: fields.dueTime ?? null,
    audiences: fields.audiences,
    channels: fields.channels,
    status: 'open',
    createdAt: now,
    acknowledgedAt: null,
    resolvedAt: null,
    escalatedAt: null,
    taskId: null,
    taskUrl: null,
    teamsMessageId: null,
    teamsMessageUrl: null,
    fingerprint: fields.fingerprint,
    shadowMode: false,
  };
}
