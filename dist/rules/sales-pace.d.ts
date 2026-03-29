/**
 * Sales Pace Rule.
 *
 * Compares the current day's accumulated sales (partial day) against
 * the trailing same weekday average at the same hour. Alerts if sales
 * are materially below or above the expected pace.
 *
 * Designed to run multiple times per day at configured check hours.
 */
import type { RuleHandler, RuleResult } from './engine.js';
import type { AppConfig } from '../util/config.js';
export declare class SalesPaceRule implements RuleHandler {
    readonly id = "sales_pace";
    readonly name = "Sales Pace Tracker";
    readonly family = "revenue";
    evaluate(storeId: string, config: AppConfig): Promise<RuleResult>;
}
