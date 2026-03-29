/**
 * Stockout / 86'd / Disabled Item Rule.
 *
 * Fetches the full Toast menu, detects items that are currently
 * disabled or hidden, filters to high margin or high velocity items,
 * and generates an alert if significant items are offline with an
 * estimate of the revenue impact.
 */
import type { RuleHandler, RuleResult } from './engine.js';
import type { AppConfig } from '../util/config.js';
export declare class StockoutRule implements RuleHandler {
    readonly id = "stockout";
    readonly name = "Stockout and Disabled Item Monitor";
    readonly family = "menu";
    evaluate(storeId: string, config: AppConfig): Promise<RuleResult>;
}
