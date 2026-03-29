/**
 * Task creation for red alerts.
 *
 * When a red severity alert fires, this module creates a Planner task
 * via the M365 MCP server, assigns it to the configured owner, and
 * posts a follow up notice to the Teams channel.
 */
import type { NotificationEvent } from '../models/normalized.js';
import type { AppConfig } from '../util/config.js';
export interface TaskCreationResult {
    created: boolean;
    taskId: string | null;
    taskUrl: string | null;
    error: string | null;
}
/**
 * Creates a Planner task for a red alert and posts a follow up notice
 * to the originating Teams channel.
 *
 * Updates the alert's taskId and taskUrl fields in place if creation
 * succeeds. Handles all failure modes gracefully so that the calling
 * pipeline never throws due to task creation issues.
 */
export declare function createTaskForAlert(alert: NotificationEvent, planId: string | null, config: AppConfig, channelInfo?: {
    teamId: string;
    channelId: string;
}): Promise<TaskCreationResult>;
/**
 * Processes a batch of alerts, creating tasks only for red severity alerts.
 * Returns task creation results keyed by alert ID.
 */
export declare function createTasksForAlerts(alerts: NotificationEvent[], planId: string | null, config: AppConfig, channelInfoByAlert?: Map<string, {
    teamId: string;
    channelId: string;
}>): Promise<Map<string, TaskCreationResult>>;
