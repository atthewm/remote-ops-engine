/**
 * Microsoft 365 MCP action layer.
 * Posts Teams messages, creates Planner tasks, logs alerts to SharePoint,
 * and provides discovery functions for teams, channels, and plans.
 */

import { callTool } from './client.js';
import { logger } from '../util/logger.js';

// ─── Response types ───

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

// ─── Teams Messages ───

/**
 * Sends an HTML formatted message to a Teams channel.
 * Returns the message result on success, or null on failure.
 */
export async function sendTeamsMessage(
  teamId: string,
  channelId: string,
  htmlContent: string,
): Promise<TeamsMessageResult | null> {
  logger.info('Sending Teams message', { teamId, channelId });

  try {
    const result = await callTool('m365', 'teams_send_channel_message', {
      teamId,
      channelId,
      content: htmlContent,
      contentType: 'html',
    }) as TeamsMessageResult;

    logger.info('Teams message sent successfully', { messageId: result?.id });
    return result;
  } catch (err) {
    logger.error('Failed to send Teams message', {
      teamId,
      channelId,
      error: String(err),
    });
    return null;
  }
}

// ─── Planner Tasks ───

/**
 * Creates a task in Microsoft Planner with the given details.
 * Returns the created task result on success, or null on failure.
 */
export async function createPlannerTask(
  planId: string,
  title: string,
  assigneeId: string | null,
  dueDate: string | null,
  notes: string | null,
): Promise<PlannerTaskResult | null> {
  logger.info('Creating Planner task', { planId, title });

  try {
    const args: Record<string, unknown> = {
      planId,
      title,
    };

    if (assigneeId) {
      args.assigneeId = assigneeId;
    }

    if (dueDate) {
      args.dueDateTime = dueDate;
    }

    if (notes) {
      args.notes = notes;
    }

    const result = await callTool('m365', 'planner_create_task', args) as PlannerTaskResult;

    logger.info('Planner task created', { taskId: result?.id, title });
    return result;
  } catch (err) {
    logger.error('Failed to create Planner task', {
      planId,
      title,
      error: String(err),
    });
    return null;
  }
}

// ─── SharePoint Alert Logging ───

/**
 * Logs an alert to a SharePoint list for audit and historical tracking.
 * Returns the created list item result on success, or null on failure.
 */
export async function logAlertToSharePoint(
  siteId: string,
  listId: string,
  alert: AlertPayload,
): Promise<SharePointListItemResult | null> {
  logger.info('Logging alert to SharePoint', { siteId, listId, ruleId: alert.ruleId });

  try {
    const fields: Record<string, string> = {
      Title: alert.title,
      Severity: alert.severity,
      RuleId: alert.ruleId,
      RuleName: alert.ruleName,
      StoreId: alert.storeId,
      Topic: alert.topic,
      WhatHappened: alert.whatHappened,
      WhyItMatters: alert.whyItMatters,
      RecommendedAction: alert.recommendedAction,
      CreatedAt: alert.createdAt,
    };

    const result = await callTool('m365', 'sharepoint_create_list_item', {
      siteId,
      listId,
      fields,
    }) as SharePointListItemResult;

    logger.info('Alert logged to SharePoint', { itemId: result?.id });
    return result;
  } catch (err) {
    logger.error('Failed to log alert to SharePoint', {
      siteId,
      listId,
      ruleId: alert.ruleId,
      error: String(err),
    });
    return null;
  }
}

// ─── Discovery: Teams ───

/**
 * Lists all Teams the authenticated user has access to.
 * Returns an array of team entries, or an empty array on failure.
 */
export async function listTeams(): Promise<TeamEntry[]> {
  logger.info('Listing Teams');

  try {
    const raw = await callTool('m365', 'teams_list', {}) as
      TeamEntry[] | { value: TeamEntry[] } | { teams: TeamEntry[] };

    if (Array.isArray(raw)) return raw;
    if ('value' in raw) return raw.value ?? [];
    if ('teams' in raw) return raw.teams ?? [];

    return [];
  } catch (err) {
    logger.error('Failed to list Teams', { error: String(err) });
    return [];
  }
}

// ─── Discovery: Channels ───

/**
 * Lists all channels for a given Team.
 * Returns an array of channel entries, or an empty array on failure.
 */
export async function listChannels(teamId: string): Promise<ChannelEntry[]> {
  logger.info('Listing channels for team', { teamId });

  try {
    const raw = await callTool('m365', 'teams_list_channels', {
      teamId,
    }) as ChannelEntry[] | { value: ChannelEntry[] } | { channels: ChannelEntry[] };

    if (Array.isArray(raw)) return raw;
    if ('value' in raw) return raw.value ?? [];
    if ('channels' in raw) return raw.channels ?? [];

    return [];
  } catch (err) {
    logger.error('Failed to list channels', { teamId, error: String(err) });
    return [];
  }
}

// ─── Discovery: Planner Plans ───

/**
 * Lists all Planner plans accessible to the authenticated user.
 * Returns an array of plan entries, or an empty array on failure.
 */
export async function listPlans(): Promise<PlanEntry[]> {
  logger.info('Listing Planner plans');

  try {
    const raw = await callTool('m365', 'planner_list_plans', {}) as
      PlanEntry[] | { value: PlanEntry[] } | { plans: PlanEntry[] };

    if (Array.isArray(raw)) return raw;
    if ('value' in raw) return raw.value ?? [];
    if ('plans' in raw) return raw.plans ?? [];

    return [];
  } catch (err) {
    logger.error('Failed to list Planner plans', { error: String(err) });
    return [];
  }
}
