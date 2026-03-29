/**
 * Task creation for red alerts.
 *
 * When a red severity alert fires, this module creates a Planner task
 * via the M365 MCP server, assigns it to the configured owner, and
 * posts a follow up notice to the Teams channel.
 */

import type { NotificationEvent } from '../models/normalized.js';
import type { AppConfig } from '../util/config.js';
import { getOwner } from '../util/config.js';
import { createPlannerTask, sendTeamsMessage } from '../mcp/m365.js';
import { formatTaskCreatedNotice } from '../routing/formatter.js';
import { logger } from '../util/logger.js';

// ── Types ──

export interface TaskCreationResult {
  created: boolean;
  taskId: string | null;
  taskUrl: string | null;
  error: string | null;
}

// ── Main Entry Point ──

/**
 * Creates a Planner task for a red alert and posts a follow up notice
 * to the originating Teams channel.
 *
 * Updates the alert's taskId and taskUrl fields in place if creation
 * succeeds. Handles all failure modes gracefully so that the calling
 * pipeline never throws due to task creation issues.
 */
export async function createTaskForAlert(
  alert: NotificationEvent,
  planId: string | null,
  config: AppConfig,
  channelInfo?: { teamId: string; channelId: string },
): Promise<TaskCreationResult> {
  // Guard: plan ID must be configured
  if (!planId) {
    logger.warn('Planner plan ID is not configured. Skipping task creation.', {
      alertId: alert.id,
      ruleId: alert.ruleId,
    });
    return { created: false, taskId: null, taskUrl: null, error: 'No plan ID configured' };
  }

  // Resolve assignee from owner config
  const assigneeId = resolveAssigneeId(alert.owner, config);
  if (!assigneeId) {
    logger.warn('Owner has no m365UserId. Task will be created unassigned.', {
      alertId: alert.id,
      owner: alert.owner,
    });
  }

  // Build task title and notes
  const title = buildTaskTitle(alert);
  const notes = buildTaskNotes(alert);
  const dueDate = alert.dueTime ?? null;

  // Attempt task creation
  try {
    const taskResult = await createPlannerTask(
      planId,
      title,
      assigneeId,
      dueDate,
      notes,
    );

    if (!taskResult) {
      logger.error('Planner task creation returned null. Continuing without task.', {
        alertId: alert.id,
        planId,
      });
      return { created: false, taskId: null, taskUrl: null, error: 'Task creation returned null' };
    }

    const taskId = taskResult.id;
    const taskUrl = taskResult.webUrl ?? null;

    // Update the alert record with task references
    alert.taskId = taskId;
    alert.taskUrl = taskUrl;

    logger.info('Planner task created for red alert', {
      alertId: alert.id,
      taskId,
      taskUrl,
      planId,
      owner: alert.owner,
      assigneeId,
    });

    // Post a follow up notice to the Teams channel
    if (channelInfo) {
      await postTaskCreatedNotice(alert, taskId, taskUrl, channelInfo);
    }

    return { created: true, taskId, taskUrl, error: null };
  } catch (err) {
    logger.error('Failed to create Planner task for alert. Continuing without task.', {
      alertId: alert.id,
      ruleId: alert.ruleId,
      planId,
      error: String(err),
    });
    return { created: false, taskId: null, taskUrl: null, error: String(err) };
  }
}

/**
 * Processes a batch of alerts, creating tasks only for red severity alerts.
 * Returns task creation results keyed by alert ID.
 */
export async function createTasksForAlerts(
  alerts: NotificationEvent[],
  planId: string | null,
  config: AppConfig,
  channelInfoByAlert?: Map<string, { teamId: string; channelId: string }>,
): Promise<Map<string, TaskCreationResult>> {
  const results = new Map<string, TaskCreationResult>();

  for (const alert of alerts) {
    if (alert.severity !== 'red') {
      results.set(alert.id, { created: false, taskId: null, taskUrl: null, error: null });
      continue;
    }

    const channelInfo = channelInfoByAlert?.get(alert.id);
    const result = await createTaskForAlert(alert, planId, config, channelInfo);
    results.set(alert.id, result);
  }

  return results;
}

// ── Private Helpers ──

/**
 * Resolves the M365 user ID for the given owner name.
 * Returns null if the owner is not found or has no m365UserId.
 */
function resolveAssigneeId(ownerName: string, config: AppConfig): string | null {
  // Try matching by owner ID first, then by name
  for (const owner of config.owners.owners) {
    if (owner.id === ownerName || owner.name === ownerName) {
      return owner.m365UserId;
    }
  }

  logger.debug('Owner not found in config', { ownerName });
  return null;
}

/**
 * Builds the task title from the alert's topic and severity.
 */
function buildTaskTitle(alert: NotificationEvent): string {
  const severityTag = alert.severity.toUpperCase();
  return `[${severityTag}] ${alert.topic}`;
}

/**
 * Builds the task notes / description from alert details.
 */
function buildTaskNotes(alert: NotificationEvent): string {
  const metricLines = Object.entries(alert.keyMetrics)
    .map(([key, value]) => `  ${key}: ${value}`)
    .join('\n');

  return [
    `Rule: ${alert.ruleName}`,
    `Store: ${alert.storeId}`,
    `Date Window: ${alert.dateWindow}`,
    '',
    `What Happened: ${alert.whatHappened}`,
    '',
    `Why It Matters: ${alert.whyItMatters}`,
    '',
    'Key Metrics:',
    metricLines,
    '',
    `Recommended Action: ${alert.recommendedAction}`,
    '',
    `Alert ID: ${alert.id}`,
    `Created: ${alert.createdAt}`,
  ].join('\n');
}

/**
 * Posts a follow up message to the Teams channel indicating that
 * a Planner task was created for this alert.
 */
async function postTaskCreatedNotice(
  alert: NotificationEvent,
  taskId: string,
  taskUrl: string | null,
  channelInfo: { teamId: string; channelId: string },
): Promise<void> {
  try {
    const html = formatTaskCreatedNotice(alert, taskId, taskUrl);
    await sendTeamsMessage(channelInfo.teamId, channelInfo.channelId, html);
    logger.info('Task created notice posted to Teams', {
      alertId: alert.id,
      taskId,
      teamId: channelInfo.teamId,
      channelId: channelInfo.channelId,
    });
  } catch (err) {
    // Non fatal: log and continue. The task itself was already created.
    logger.error('Failed to post task created notice to Teams', {
      alertId: alert.id,
      taskId,
      error: String(err),
    });
  }
}
