/**
 * Channel routing logic.
 *
 * Maps alerts to the correct Teams channels based on audience,
 * severity, and content type. The exec channel receives only red
 * alerts, executive daily summaries, and weekly summaries. Other
 * channels receive alerts that match their configured audiences.
 */
import { logger } from '../util/logger.js';
/**
 * Determines which Teams channels should receive the given alert,
 * whether a Planner task should be created, and which plan to use.
 */
export function routeAlert(alert, config) {
    const channelMap = config.teams.channels;
    const targetChannels = [];
    for (const audience of alert.audiences) {
        const channelKeys = resolveChannelKeys(audience, config);
        for (const key of channelKeys) {
            const channel = channelMap[key];
            if (!channel) {
                logger.warn('Channel key not found in teams config, skipping', {
                    channelKey: key,
                    ruleId: alert.ruleId,
                });
                continue;
            }
            // Exec channel gating: only red alerts, daily exec summaries,
            // and weekly exec summaries are routed here.
            if (key === 'exec' && !isExecEligible(alert)) {
                logger.debug('Alert filtered from exec channel (not red, not summary)', {
                    alertId: alert.id,
                    severity: alert.severity,
                    ruleId: alert.ruleId,
                });
                continue;
            }
            // Avoid duplicates when multiple audiences map to the same channel
            const alreadyAdded = targetChannels.some(c => c.channelKey === key);
            if (!alreadyAdded) {
                targetChannels.push({
                    channelKey: key,
                    channelId: channel.channelId,
                    teamId: channel.teamId ?? config.teams.teamId,
                });
            }
        }
    }
    // Task creation: red alerts always generate a Planner task
    const shouldCreateTask = alert.severity === 'red';
    const taskPlanId = shouldCreateTask
        ? resolvePlanId(config)
        : null;
    const decision = {
        alert,
        channels: targetChannels,
        shouldCreateTask,
        taskPlanId,
    };
    logger.info('Routing decision computed', {
        alertId: alert.id,
        ruleId: alert.ruleId,
        severity: alert.severity,
        audiences: alert.audiences,
        channelCount: targetChannels.length,
        channelKeys: targetChannels.map(c => c.channelKey),
        shouldCreateTask,
    });
    return decision;
}
/**
 * Routes a batch of alerts and returns all routing decisions.
 */
export function routeAlerts(alerts, config) {
    return alerts.map(alert => routeAlert(alert, config));
}
// ── Private Helpers ──
/**
 * Resolves an audience to the set of channel keys from the routing rules
 * in teams.json. Falls back to matching the audience name directly
 * if no routing rule is configured.
 */
function resolveChannelKeys(audience, config) {
    const routingRules = config.teams.routingRules;
    const keys = routingRules[audience];
    if (keys && keys.length > 0) {
        return keys;
    }
    // Fallback: use the audience name itself as a channel key
    if (config.teams.channels[audience]) {
        return [audience];
    }
    logger.warn('No routing rule or channel found for audience', { audience });
    return [];
}
/**
 * Checks whether an alert qualifies for the exec channel.
 * Eligible alerts:
 *   1. Severity is red
 *   2. Rule ID indicates a daily exec summary or weekly exec summary
 */
function isExecEligible(alert) {
    if (alert.severity === 'red')
        return true;
    // Summary rule IDs that should always reach exec
    const execSummaryRules = [
        'daily_exec_summary',
        'weekly_exec_summary',
        'executive_daily',
        'executive_weekly',
    ];
    if (execSummaryRules.includes(alert.ruleId))
        return true;
    return false;
}
/**
 * Resolves the Planner plan ID from environment or config.
 * Returns null if not configured.
 */
function resolvePlanId(config) {
    // Check environment variable first, then fall back to config
    const envPlanId = process.env.PLANNER_PLAN_ID;
    if (envPlanId)
        return envPlanId;
    // The plan ID could be stored in the teams config or rules config.
    // For now, rely on the environment variable.
    return null;
}
//# sourceMappingURL=channel-router.js.map