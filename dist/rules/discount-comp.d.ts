/**
 * Discount / Comp / Void / Refund Anomaly Rule.
 *
 * Fetches prior day orders from Toast, computes void, refund, comp,
 * and discount metrics, compares each against configured thresholds,
 * and flags spikes versus trailing averages.
 */
import type { RuleHandler, RuleResult } from './engine.js';
import type { AppConfig } from '../util/config.js';
export declare class DiscountCompRule implements RuleHandler {
    readonly id = "discount_comp_void";
    readonly name = "Discount, Comp, Void, and Refund Anomaly";
    readonly family = "exceptions";
    evaluate(storeId: string, config: AppConfig): Promise<RuleResult>;
    /**
     * Fetches orders and computes exception metrics for a single business date.
     */
    private fetchMetrics;
    /**
     * Computes a trailing average of exception metrics over the specified
     * number of prior days. Returns averaged VoidsRefundsComps and DiscountSummary.
     */
    private fetchTrailingAverage;
}
