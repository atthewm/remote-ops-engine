/**
 * Channel routing logic.
 *
 * Maps alerts to the correct Teams channels based on audience,
 * severity, and content type. The exec channel receives only red
 * alerts, executive daily summaries, and weekly summaries. Other
 * channels receive alerts that match their configured audiences.
 */
import type { NotificationEvent } from '../models/normalized.js';
import type { AppConfig } from '../util/config.js';
export interface RoutingDecision {
    alert: NotificationEvent;
    channels: {
        channelKey: string;
        channelId: string;
        teamId: string;
    }[];
    shouldCreateTask: boolean;
    taskPlanId: string | null;
}
/**
 * Determines which Teams channels should receive the given alert,
 * whether a Planner task should be created, and which plan to use.
 */
export declare function routeAlert(alert: NotificationEvent, config: AppConfig): RoutingDecision;
/**
 * Routes a batch of alerts and returns all routing decisions.
 */
export declare function routeAlerts(alerts: NotificationEvent[], config: AppConfig): RoutingDecision[];
