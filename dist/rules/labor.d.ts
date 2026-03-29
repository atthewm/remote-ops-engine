/**
 * Labor Efficiency Rule.
 *
 * NOTE: The Toast API does not expose labor or scheduling data in the
 * currently available MCP tools. This rule is structured to work once
 * labor data becomes available from a future integration (e.g., direct
 * Toast labor API, 7shifts, Homebase, or manual entry).
 *
 * Until real data is available, the rule checks for data availability,
 * generates an informational note rather than a false alert, and uses
 * the LaborSummary model with estimated=true.
 */
import type { RuleHandler, RuleResult } from './engine.js';
import type { AppConfig } from '../util/config.js';
export declare class LaborRule implements RuleHandler {
    readonly id = "labor";
    readonly name = "Labor Efficiency";
    readonly family = "labor";
    evaluate(storeId: string, config: AppConfig): Promise<RuleResult>;
}
