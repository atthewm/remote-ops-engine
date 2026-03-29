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

import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { NotificationEvent, AlertStatus } from '../models/normalized.js';
import { logAlertToSharePoint } from '../mcp/m365.js';
import { logger } from '../util/logger.js';

// ── File Paths ──

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = resolve(__dirname, '../../data');
const LOG_FILE = resolve(DATA_DIR, 'alert-log.json');
const ARCHIVE_DIR = resolve(DATA_DIR, 'archive');

const ARCHIVE_THRESHOLD_DAYS = 90;

// ── SharePoint Config (optional) ──

function getSharePointConfig(): { siteId: string; listId: string } | null {
  const siteId = process.env.SHAREPOINT_SITE_ID;
  const listId = process.env.SHAREPOINT_ALERT_LIST_ID;

  if (siteId && listId) {
    return { siteId, listId };
  }

  return null;
}

// ── Internal Store ──

let alertStore: NotificationEvent[] | null = null;

/**
 * Ensures the data directory and log file exist.
 * Loads the alert store into memory on first access.
 */
function ensureLoaded(): NotificationEvent[] {
  if (alertStore !== null) return alertStore;

  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  if (!existsSync(LOG_FILE)) {
    writeFileSync(LOG_FILE, '[]', 'utf-8');
    alertStore = [];
    return alertStore;
  }

  try {
    const raw = readFileSync(LOG_FILE, 'utf-8');
    alertStore = JSON.parse(raw) as NotificationEvent[];
    logger.debug(`Loaded ${alertStore.length} alerts from local log`);
  } catch (err) {
    logger.warn('Failed to parse alert log file, starting with empty store', {
      error: String(err),
    });
    alertStore = [];
  }

  return alertStore;
}

/**
 * Writes the in memory alert store to disk.
 */
function flush(): void {
  const store = ensureLoaded();

  try {
    writeFileSync(LOG_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    logger.error('Failed to write alert log file', { error: String(err) });
  }
}

// ── Public API ──

/**
 * Logs an alert to the local JSON file and optionally to SharePoint.
 * This is the primary write path for all emitted alerts.
 */
export async function logAlert(alert: NotificationEvent): Promise<void> {
  const store = ensureLoaded();

  // Avoid duplicates by alert ID
  const existing = store.find(a => a.id === alert.id);
  if (existing) {
    logger.debug('Alert already logged, skipping duplicate', { alertId: alert.id });
    return;
  }

  store.push(alert);
  flush();
  logger.info('Alert logged to local file', { alertId: alert.id, ruleId: alert.ruleId });

  // Optionally write to SharePoint
  const spConfig = getSharePointConfig();
  if (spConfig) {
    try {
      await logAlertToSharePoint(spConfig.siteId, spConfig.listId, {
        title: alert.topic,
        severity: alert.severity,
        ruleId: alert.ruleId,
        ruleName: alert.ruleName,
        storeId: alert.storeId,
        topic: alert.topic,
        whatHappened: alert.whatHappened,
        whyItMatters: alert.whyItMatters,
        recommendedAction: alert.recommendedAction,
        createdAt: alert.createdAt,
      });
      logger.info('Alert also logged to SharePoint', { alertId: alert.id });
    } catch (err) {
      // Non fatal: local log is the source of truth
      logger.error('Failed to log alert to SharePoint, local copy retained', {
        alertId: alert.id,
        error: String(err),
      });
    }
  }
}

/**
 * Retrieves recent alerts for a given store within the specified
 * number of days.
 */
export function getRecentAlerts(storeId: string, days: number): NotificationEvent[] {
  const store = ensureLoaded();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  return store.filter(alert =>
    alert.storeId === storeId &&
    new Date(alert.createdAt).getTime() >= cutoff,
  );
}

/**
 * Retrieves alerts for a given rule within the specified number of days.
 */
export function getAlertsByRule(ruleId: string, days: number): NotificationEvent[] {
  const store = ensureLoaded();
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;

  return store.filter(alert =>
    alert.ruleId === ruleId &&
    new Date(alert.createdAt).getTime() >= cutoff,
  );
}

/**
 * Updates the status of an alert in the local log.
 * Sets the corresponding timestamp field based on the new status.
 */
export function updateAlertStatus(alertId: string, status: AlertStatus): void {
  const store = ensureLoaded();
  const alert = store.find(a => a.id === alertId);

  if (!alert) {
    logger.warn('Alert not found for status update', { alertId, status });
    return;
  }

  const previousStatus = alert.status;
  alert.status = status;

  const now = new Date().toISOString();

  switch (status) {
    case 'acknowledged':
      alert.acknowledgedAt = now;
      break;
    case 'resolved':
      alert.resolvedAt = now;
      break;
    case 'escalated':
      alert.escalatedAt = now;
      break;
    case 'open':
      // Reopening: clear resolution timestamps
      alert.resolvedAt = null;
      break;
  }

  flush();
  logger.info('Alert status updated', {
    alertId,
    previousStatus,
    newStatus: status,
  });
}

/**
 * Returns all unresolved (open or escalated) alerts for a given store.
 */
export function getOpenAlerts(storeId: string): NotificationEvent[] {
  const store = ensureLoaded();

  return store.filter(alert =>
    alert.storeId === storeId &&
    (alert.status === 'open' || alert.status === 'escalated'),
  );
}

/**
 * Returns all alerts currently in the local store.
 * Useful for diagnostics and testing.
 */
export function getAllAlerts(): NotificationEvent[] {
  return [...ensureLoaded()];
}

/**
 * Returns the total count of alerts in the local store.
 */
export function getAlertCount(): number {
  return ensureLoaded().length;
}

// ── Archival ──

/**
 * Moves alerts older than the configured threshold (90 days) out of
 * the active log and into a dated archive file. This keeps the working
 * file at a manageable size for daily operations.
 *
 * Returns the number of alerts archived.
 */
export function archiveOldAlerts(): number {
  const store = ensureLoaded();
  const cutoff = Date.now() - ARCHIVE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

  const toArchive = store.filter(a => new Date(a.createdAt).getTime() < cutoff);
  const toKeep = store.filter(a => new Date(a.createdAt).getTime() >= cutoff);

  if (toArchive.length === 0) {
    logger.debug('No alerts to archive');
    return 0;
  }

  // Write archive file with date stamp
  if (!existsSync(ARCHIVE_DIR)) {
    mkdirSync(ARCHIVE_DIR, { recursive: true });
  }

  const dateStamp = new Date().toISOString().slice(0, 10);
  const archiveFile = resolve(ARCHIVE_DIR, `alert-log-${dateStamp}.json`);

  try {
    // If an archive file for today already exists, merge with it
    let existingArchive: NotificationEvent[] = [];
    if (existsSync(archiveFile)) {
      try {
        const raw = readFileSync(archiveFile, 'utf-8');
        existingArchive = JSON.parse(raw) as NotificationEvent[];
      } catch {
        existingArchive = [];
      }
    }

    const merged = [...existingArchive, ...toArchive];
    writeFileSync(archiveFile, JSON.stringify(merged, null, 2), 'utf-8');

    // Update the active store
    alertStore = toKeep;
    flush();

    logger.info('Archived old alerts', {
      archivedCount: toArchive.length,
      remainingCount: toKeep.length,
      archiveFile,
    });

    return toArchive.length;
  } catch (err) {
    logger.error('Failed to archive alerts', { error: String(err) });
    return 0;
  }
}

/**
 * Reloads the alert store from disk. Useful after external modifications
 * or for testing.
 */
export function reloadStore(): void {
  alertStore = null;
  ensureLoaded();
}
