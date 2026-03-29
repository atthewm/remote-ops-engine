/**
 * Rules Engine.
 *
 * Loads rule implementations, evaluates them on schedule or on demand,
 * generates NotificationEvent objects, applies cooldown and dedup logic,
 * and routes alerts to the appropriate handler (formatter, task creator, logger).
 */
import { logger } from '../util/logger.js';
import { isInCooldown, recordFired, loadCooldowns } from '../util/cooldown.js';
const DEFAULT_OPTIONS = {
    parallel: false,
    mode: 'shadow',
    skipCooldown: false,
};
// ── Engine ──
export class RulesEngine {
    handlers = [];
    options;
    config;
    constructor(config, options) {
        this.config = config;
        this.options = { ...DEFAULT_OPTIONS, ...options };
        loadCooldowns();
    }
    /**
     * Register a single rule handler.
     */
    registerRule(handler) {
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
    registerRules(handlers) {
        for (const handler of handlers) {
            this.registerRule(handler);
        }
    }
    /**
     * List all registered rule IDs.
     */
    listRules() {
        return this.handlers.map(h => h.id);
    }
    /**
     * Run all registered rules for the given store.
     * Returns the full run result including emitted and suppressed alerts.
     */
    async run(storeId, ruleIds) {
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
        let results;
        if (this.options.parallel) {
            results = await this.runParallel(handlersToRun, storeId);
        }
        else {
            results = await this.runSequential(handlersToRun, storeId);
        }
        // Process alerts through cooldown and dedup filters
        const emittedAlerts = [];
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
        const runResult = {
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
            }
            catch (err) {
                logger.error('onComplete handler failed', { error: String(err) });
            }
        }
        return runResult;
    }
    /**
     * Run a single rule by ID. Useful for on demand evaluation.
     */
    async runSingle(storeId, ruleId) {
        return this.run(storeId, [ruleId]);
    }
    // ── Private helpers ──
    async runSequential(handlers, storeId) {
        const results = [];
        for (const handler of handlers) {
            const result = await this.safeEvaluate(handler, storeId);
            results.push(result);
        }
        return results;
    }
    async runParallel(handlers, storeId) {
        const promises = handlers.map(handler => this.safeEvaluate(handler, storeId));
        return Promise.all(promises);
    }
    /**
     * Wraps rule evaluation in a try/catch so one failing rule does not
     * block the entire engine run.
     */
    async safeEvaluate(handler, storeId) {
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
        }
        catch (err) {
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
    getCooldownMinutes(ruleId) {
        const ruleOverride = this.config.rules.cooldowns?.[ruleId];
        if (ruleOverride !== undefined)
            return ruleOverride;
        return this.config.rules.globalCooldownMinutes;
    }
    /**
     * Route an alert to the configured handler (e.g., Teams message, Planner task).
     */
    async routeAlert(alert) {
        if (this.options.onAlert) {
            try {
                await this.options.onAlert(alert);
            }
            catch (err) {
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
    logAlert(alert, mode) {
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
export function buildAlert(fields) {
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
//# sourceMappingURL=engine.js.map