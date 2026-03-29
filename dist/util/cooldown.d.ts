/**
 * Cooldown and deduplication manager.
 * Prevents alert fatigue by tracking when alerts last fired
 * and suppressing duplicates within configured windows.
 */
export declare function loadCooldowns(): void;
export declare function saveCooldowns(): void;
/**
 * Check whether an alert with the given fingerprint is within its cooldown window.
 * Returns true if the alert should be suppressed.
 */
export declare function isInCooldown(fingerprint: string, cooldownMinutes: number): boolean;
/**
 * Record that an alert fired. Updates cooldown timestamp and count.
 */
export declare function recordFired(fingerprint: string, ruleId: string): void;
/**
 * Generate a fingerprint for deduplication.
 * Combines rule ID, store, date, and a key discriminator.
 */
export declare function generateFingerprint(ruleId: string, storeId: string, dateWindow: string, discriminator?: string): string;
/**
 * Clear expired cooldowns older than maxAgeDays.
 */
export declare function purgeExpired(maxAgeDays?: number): number;
