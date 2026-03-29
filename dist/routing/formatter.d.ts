/**
 * Teams message formatter.
 *
 * Produces consistent HTML messages for alerts, daily ops digests,
 * and weekly executive summaries. Uses HTML tags compatible with
 * the Microsoft Graph Teams channel message API (p, b, br, table,
 * tr, td). No markdown; Graph API channel messages require HTML.
 */
import type { NotificationEvent, WeeklyExecutiveSummary, AlertDigest } from '../models/normalized.js';
/**
 * Formats a NotificationEvent into an HTML message suitable for
 * posting to a Teams channel via the Graph API.
 */
export declare function formatAlert(alert: NotificationEvent): string;
/**
 * Formats a daily operations digest covering the prior business day.
 * Includes sales, COGS, labor, prime cost, exceptions, and action items.
 */
export declare function formatDailyOpsDigest(digest: AlertDigest): string;
/**
 * Formats a weekly executive summary with wins, misses, biggest
 * exceptions, trend direction, recurring issues, owner scorecard,
 * and recommended next actions.
 */
export declare function formatWeeklyExecSummary(summary: WeeklyExecutiveSummary): string;
/**
 * Formats a short follow up message indicating that a Planner task
 * was created for a red alert.
 */
export declare function formatTaskCreatedNotice(alert: NotificationEvent, taskId: string, taskUrl: string | null): string;
/**
 * Builds a QuickChart.io URL for a simple line chart.
 * Returns a URL that can be embedded as an <img> tag in Teams HTML messages.
 */
export declare function buildQuickChartUrl(labels: string[], data: number[], datasetLabel: string, opts?: {
    width?: number;
    height?: number;
    borderColor?: string;
    backgroundColor?: string;
}): string;
/**
 * Generates an HTML img tag for a revenue trend chart.
 * Returns empty string if insufficient data.
 */
export declare function buildRevenueTrendHtml(labels: string[], revenues: number[]): string;
/**
 * Generates an HTML img tag for a drive thru speed trend chart.
 * Returns empty string if insufficient data.
 */
export declare function buildDriveThruTrendHtml(labels: string[], avgSeconds: number[]): string;
