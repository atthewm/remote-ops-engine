/**
 * Google Reviews Summary (Stub).
 *
 * Uses Google Places API to fetch recent reviews and summarize
 * sentiment. Requires GOOGLE_PLACES_API_KEY and GOOGLE_PLACE_ID
 * environment variables.
 *
 * Currently a stub: logs intent and returns without action if
 * environment variables are not set.
 */

import { logger } from '../util/logger.js';

const PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY ?? '';
const PLACE_ID = process.env.GOOGLE_PLACE_ID ?? '';

/**
 * Runs the review summary check.
 * Currently a stub that logs what would be fetched.
 * Returns early if API key or place ID are not configured.
 */
export async function runReviewSummary(): Promise<void> {
  logger.info('Running review summary check (stub)');

  if (!PLACES_API_KEY) {
    logger.info('GOOGLE_PLACES_API_KEY not set; skipping review summary');
    return;
  }

  if (!PLACE_ID) {
    logger.info('GOOGLE_PLACE_ID not set; skipping review summary');
    return;
  }

  // Stub: log what would be fetched
  logger.info('Would fetch Google Places reviews', {
    placeId: PLACE_ID,
    apiKeySet: true,
  });

  logger.info('Would analyze review sentiment and post summary');
  logger.info('Review summary stub complete');
}
