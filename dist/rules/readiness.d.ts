/**
 * MarginEdge Readiness Score Rule.
 *
 * Evaluates how complete and current the MarginEdge data setup is
 * for the store. Compares the weighted overall readiness score against
 * configured thresholds and generates alerts when quality drops below
 * acceptable levels.
 */
import type { RuleHandler, RuleResult } from './engine.js';
import type { AppConfig } from '../util/config.js';
export declare class ReadinessRule implements RuleHandler {
    readonly id = "readiness";
    readonly name = "MarginEdge Readiness Score";
    readonly family = "inventory";
    evaluate(storeId: string, config: AppConfig): Promise<RuleResult>;
}
