/**
 * Microsoft 365 MCP action layer.
 * Posts Teams messages, creates Planner tasks, logs alerts to SharePoint,
 * and provides discovery functions for teams, channels, and plans.
 */
interface TeamsMessageResult {
    id: string;
    webUrl?: string;
    createdDateTime?: string;
    [key: string]: unknown;
}
interface PlannerTaskResult {
    id: string;
    title: string;
    webUrl?: string;
    createdDateTime?: string;
    [key: string]: unknown;
}
interface SharePointListItemResult {
    id: string;
    webUrl?: string;
    createdDateTime?: string;
    [key: string]: unknown;
}
interface TeamEntry {
    id: string;
    displayName: string;
    description?: string;
    [key: string]: unknown;
}
interface ChannelEntry {
    id: string;
    displayName: string;
    description?: string;
    membershipType?: string;
    [key: string]: unknown;
}
interface PlanEntry {
    id: string;
    title: string;
    owner?: string;
    [key: string]: unknown;
}
interface AlertPayload {
    title: string;
    severity: string;
    ruleId: string;
    ruleName: string;
    storeId: string;
    topic: string;
    whatHappened: string;
    whyItMatters: string;
    recommendedAction: string;
    createdAt: string;
    [key: string]: unknown;
}
/**
 * Sends an HTML formatted message to a Teams channel.
 * Returns the message result on success, or null on failure.
 */
export declare function sendTeamsMessage(teamId: string, channelId: string, htmlContent: string): Promise<TeamsMessageResult | null>;
/**
 * Creates a task in Microsoft Planner with the given details.
 * Returns the created task result on success, or null on failure.
 */
export declare function createPlannerTask(planId: string, title: string, assigneeId: string | null, dueDate: string | null, notes: string | null): Promise<PlannerTaskResult | null>;
/**
 * Logs an alert to a SharePoint list for audit and historical tracking.
 * Returns the created list item result on success, or null on failure.
 */
export declare function logAlertToSharePoint(siteId: string, listId: string, alert: AlertPayload): Promise<SharePointListItemResult | null>;
/**
 * Lists all Teams the authenticated user has access to.
 * Returns an array of team entries, or an empty array on failure.
 */
export declare function listTeams(): Promise<TeamEntry[]>;
/**
 * Lists all channels for a given Team.
 * Returns an array of channel entries, or an empty array on failure.
 */
export declare function listChannels(teamId: string): Promise<ChannelEntry[]>;
/**
 * Lists all Planner plans accessible to the authenticated user.
 * Returns an array of plan entries, or an empty array on failure.
 */
export declare function listPlans(): Promise<PlanEntry[]>;
export {};
