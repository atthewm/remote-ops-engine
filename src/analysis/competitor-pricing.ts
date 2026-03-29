/**
 * Competitor Pricing Monitor (Stub).
 *
 * Reads config/competitors.json for competitor definitions.
 * When fully implemented, this will scrape or query competitor pricing
 * and compare against Remote Coffee menu prices.
 *
 * Currently a stub: logs intent and returns without action if no
 * competitors are configured or the file is missing.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../util/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '../../config/competitors.json');

// ── Types ──

interface CompetitorItem {
  name: string;
  lastKnownPrice: number;
}

interface CompetitorEntry {
  name: string;
  type: string;
  url: string;
  items: CompetitorItem[];
  lastChecked: string | null;
}

interface CompetitorsConfig {
  competitors: CompetitorEntry[];
}

// ── Runner ──

/**
 * Runs the competitor pricing check.
 * Currently a stub that logs what would be checked.
 * Returns early if no competitors are configured.
 */
export async function runCompetitorPricing(): Promise<void> {
  logger.info('Running competitor pricing check (stub)');

  if (!existsSync(CONFIG_PATH)) {
    logger.info('competitors.json not found; skipping competitor pricing');
    return;
  }

  let config: CompetitorsConfig;
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    config = JSON.parse(raw) as CompetitorsConfig;
  } catch (err) {
    logger.error('Failed to parse competitors.json', { error: String(err) });
    return;
  }

  if (!config.competitors || config.competitors.length === 0) {
    logger.info('No competitors configured; skipping pricing check');
    return;
  }

  // Stub: log what would be scraped
  for (const competitor of config.competitors) {
    logger.info('Would check competitor pricing', {
      name: competitor.name,
      type: competitor.type,
      url: competitor.url,
      itemCount: competitor.items.length,
    });

    for (const item of competitor.items) {
      logger.debug('Would compare price', {
        competitor: competitor.name,
        item: item.name,
        lastKnownPrice: item.lastKnownPrice,
      });
    }
  }

  logger.info('Competitor pricing stub complete', {
    competitorsChecked: config.competitors.length,
  });
}
