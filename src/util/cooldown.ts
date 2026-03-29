/**
 * Cooldown and deduplication manager.
 * Prevents alert fatigue by tracking when alerts last fired
 * and suppressing duplicates within configured windows.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const COOLDOWN_FILE = resolve(__dirname, '../../data/cooldowns.json');

interface CooldownEntry {
  fingerprint: string;
  ruleId: string;
  lastFired: string; // ISO timestamp
  count: number;
}

type CooldownStore = Record<string, CooldownEntry>;

let store: CooldownStore = {};

export function loadCooldowns(): void {
  if (existsSync(COOLDOWN_FILE)) {
    try {
      const raw = readFileSync(COOLDOWN_FILE, 'utf-8');
      store = JSON.parse(raw);
      logger.debug(`Loaded ${Object.keys(store).length} cooldown entries`);
    } catch (err) {
      logger.warn('Failed to load cooldown file, starting fresh', { error: String(err) });
      store = {};
    }
  }
}

export function saveCooldowns(): void {
  const dir = dirname(COOLDOWN_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(COOLDOWN_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

/**
 * Check whether an alert with the given fingerprint is within its cooldown window.
 * Returns true if the alert should be suppressed.
 */
export function isInCooldown(fingerprint: string, cooldownMinutes: number): boolean {
  const entry = store[fingerprint];
  if (!entry) return false;

  const lastFired = new Date(entry.lastFired).getTime();
  const now = Date.now();
  const elapsed = (now - lastFired) / (1000 * 60);

  if (elapsed < cooldownMinutes) {
    logger.debug(`Alert suppressed by cooldown`, {
      fingerprint,
      minutesRemaining: Math.round(cooldownMinutes - elapsed),
    });
    return true;
  }

  return false;
}

/**
 * Record that an alert fired. Updates cooldown timestamp and count.
 */
export function recordFired(fingerprint: string, ruleId: string): void {
  const existing = store[fingerprint];
  store[fingerprint] = {
    fingerprint,
    ruleId,
    lastFired: new Date().toISOString(),
    count: (existing?.count ?? 0) + 1,
  };
  saveCooldowns();
}

/**
 * Generate a fingerprint for deduplication.
 * Combines rule ID, store, date, and a key discriminator.
 */
export function generateFingerprint(
  ruleId: string,
  storeId: string,
  dateWindow: string,
  discriminator?: string
): string {
  const parts = [ruleId, storeId, dateWindow];
  if (discriminator) parts.push(discriminator);
  return parts.join('::');
}

/**
 * Clear expired cooldowns older than maxAgeDays.
 */
export function purgeExpired(maxAgeDays: number = 7): number {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  let purged = 0;
  for (const [key, entry] of Object.entries(store)) {
    if (new Date(entry.lastFired).getTime() < cutoff) {
      delete store[key];
      purged++;
    }
  }
  if (purged > 0) {
    saveCooldowns();
    logger.info(`Purged ${purged} expired cooldown entries`);
  }
  return purged;
}
