/**
 * Item Margin Watchlist Rule.
 *
 * Cross references Toast menu items (with prices) against MarginEdge
 * products (with costs) to compute item level margins. Flags items
 * below the minimum margin threshold, high volume items with margin
 * compression, and top sellers missing cost mappings.
 *
 * Results are prioritized by volume and contribution to revenue.
 */
import type { RuleHandler, RuleResult } from './engine.js';
import type { AppConfig } from '../util/config.js';
export declare class ItemMarginRule implements RuleHandler {
    readonly id = "item_margin";
    readonly name = "Item Margin Watchlist";
    readonly family = "profitability";
    evaluate(storeId: string, config: AppConfig): Promise<RuleResult>;
}
