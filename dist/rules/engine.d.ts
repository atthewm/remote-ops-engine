/**
 * Rules Engine.
 *
 * Loads rule implementations, evaluates them on schedule or on demand,
 * generates NotificationEvent objects, applies cooldown and dedup logic,
 * and routes alerts to the appropriate handler (formatter, task creator, logger).
 */
import type { AppConfig } from '../util/config.js';
import type { NotificationEvent, AlertMode, Severity } from '../models/normalized.js';
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
export declare class RulesEngine {
    private handlers;
    private options;
    private config;
    constructor(config: AppConfig, options?: Partial<EngineOptions>);
    /**
     * Register a single rule handler.
     */
    registerRule(handler: RuleHandler): void;
    /**
     * Register multiple rule handlers at once.
     */
    registerRules(handlers: RuleHandler[]): void;
    /**
     * List all registered rule IDs.
     */
    listRules(): string[];
    /**
     * Run all registered rules for the given store.
     * Returns the full run result including emitted and suppressed alerts.
     */
    run(storeId: string, ruleIds?: string[]): Promise<EngineRunResult>;
    /**
     * Run a single rule by ID. Useful for on demand evaluation.
     */
    runSingle(storeId: string, ruleId: string): Promise<EngineRunResult>;
    private runSequential;
    private runParallel;
    /**
     * Wraps rule evaluation in a try/catch so one failing rule does not
     * block the entire engine run.
     */
    private safeEvaluate;
    /**
     * Get the cooldown period for a rule. Uses rule specific overrides
     * if configured, otherwise falls back to the global default.
     */
    private getCooldownMinutes;
    /**
     * Route an alert to the configured handler (e.g., Teams message, Planner task).
     */
    private routeAlert;
    /**
     * Log the alert with metadata appropriate for the current mode.
     */
    private logAlert;
}
/**
 * Creates a NotificationEvent with auto generated ID and timestamps.
 * Callers provide the rule specific fields; this function fills in
 * structural defaults so rule implementations stay concise.
 */
export declare function buildAlert(fields: {
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
}): NotificationEvent;
