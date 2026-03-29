/**
 * Alert persistence layer.
 *
 * Provides two storage backends:
 *   1. Local JSON file (always on, stored at data/alert-log.json)
 *   2. SharePoint list (optional, if configured via environment)
 *
 * The local file stores an array of NotificationEvent objects. Entries
 * older than 90 days are archived automatically to keep the working
 * file at a manageable size.
 */
import type { NotificationEvent, AlertStatus } from '../models/normalized.js';
/**
 * Logs an alert to the local JSON file and optionally to SharePoint.
 * This is the primary write path for all emitted alerts.
 */
export declare function logAlert(alert: NotificationEvent): Promise<void>;
/**
 * Retrieves recent alerts for a given store within the specified
 * number of days.
 */
export declare function getRecentAlerts(storeId: string, days: number): NotificationEvent[];
/**
 * Retrieves alerts for a given rule within the specified number of days.
 */
export declare function getAlertsByRule(ruleId: string, days: number): NotificationEvent[];
/**
 * Updates the status of an alert in the local log.
 * Sets the corresponding timestamp field based on the new status.
 */
export declare function updateAlertStatus(alertId: string, status: AlertStatus): void;
/**
 * Returns all unresolved (open or escalated) alerts for a given store.
 */
export declare function getOpenAlerts(storeId: string): NotificationEvent[];
/**
 * Returns all alerts currently in the local store.
 * Useful for diagnostics and testing.
 */
export declare function getAllAlerts(): NotificationEvent[];
/**
 * Returns the total count of alerts in the local store.
 */
export declare function getAlertCount(): number;
/**
 * Moves alerts older than the configured threshold (90 days) out of
 * the active log and into a dated archive file. This keeps the working
 * file at a manageable size for daily operations.
 *
 * Returns the number of alerts archived.
 */
export declare function archiveOldAlerts(): number;
/**
 * Reloads the alert store from disk. Useful after external modifications
 * or for testing.
 */
export declare function reloadStore(): void;
