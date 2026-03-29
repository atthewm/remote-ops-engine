/**
 * Daily Prime Cost Control Rule.
 *
 * Computes the prior day's COGS %, labor %, and prime cost % by
 * combining Toast sales data with MarginEdge invoice data.
 * Labor data is not available from current APIs and uses a
 * placeholder with an estimated flag.
 *
 * Always generates a daily digest (green, yellow, or red status).
 * Generates an escalation alert when any metric exceeds its threshold.
 */
import type { RuleHandler, RuleResult } from './engine.js';
import type { AppConfig } from '../util/config.js';
export declare class PrimeCostRule implements RuleHandler {
    readonly id = "prime_cost";
    readonly name = "Daily Prime Cost Control";
    readonly family = "profitability";
    evaluate(storeId: string, config: AppConfig): Promise<RuleResult>;
}
