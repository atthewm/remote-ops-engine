/**
 * Vendor Price Spike Rule.
 *
 * Compares recent MarginEdge invoice line item prices against the
 * previous period to detect significant price increases. Uses the
 * detectVendorPriceChanges helper from the MarginEdge MCP layer
 * and applies configured spike thresholds.
 */
import type { RuleHandler, RuleResult } from './engine.js';
import type { AppConfig } from '../util/config.js';
export declare class VendorPriceRule implements RuleHandler {
    readonly id = "vendor_price";
    readonly name = "Vendor Price Spike";
    readonly family = "purchasing";
    evaluate(storeId: string, config: AppConfig): Promise<RuleResult>;
}
