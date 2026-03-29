/**
 * Scheduler for the ops engine.
 * Uses croner for cron based job scheduling.
 * Runs rule evaluations on configured schedules.
 */
import { RulesEngine } from './rules/engine.js';
import { AppConfig } from './util/config.js';
export declare class Scheduler {
    private jobs;
    private engine;
    private config;
    private storeId;
    constructor(engine: RulesEngine, config: AppConfig, storeId: string);
    /**
     * Register all scheduled jobs from config.
     * Each schedule entry maps a schedule name to a cron expression.
     * Rule IDs are matched by convention: the schedule name maps to the rule family.
     */
    start(): void;
    stop(): void;
    /**
     * Run all rules immediately (for testing or manual trigger).
     */
    runAll(): Promise<void>;
    /**
     * Run a specific rule family immediately.
     */
    runFamily(family: string): Promise<void>;
    getStatus(): {
        name: string;
        nextRun: string | null;
        ruleIds: string[];
    }[];
    private buildScheduleToRuleMap;
}
