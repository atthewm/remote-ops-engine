/**
 * Competitor Pricing Monitor.
 *
 * Scrapes competitor DoorDash menu pages via Firecrawl API,
 * extracts prices for comparable items, and posts a weekly
 * pricing comparison to the #marketplace Teams channel.
 *
 * Saves price snapshots to data/competitors/ for trend tracking.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../util/logger.js';
import { postToTeamsWebhook } from '../routing/teams-webhook.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(__dirname, '../../config/competitors.json');
const DATA_DIR = resolve(__dirname, '../../data/competitors');

const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY ?? '';
const FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev/v1';

// ── Types ──

interface CompetitorItem {
  ourItem: string;
  theirItem: string;
  ourPrice: number;
}

interface CompetitorEntry {
  name: string;
  doordashUrl: string;
  ubereatsUrl: string;
  items: CompetitorItem[];
  lastChecked: string | null;
}

interface CompetitorsConfig {
  competitors: CompetitorEntry[];
}

interface PriceSnapshot {
  competitor: string;
  date: string;
  items: Array<{
    ourItem: string;
    theirItem: string;
    ourPrice: number;
    theirPrice: number | null;
    priceDifference: number | null;
  }>;
}

interface ScrapedMenuItem {
  name: string;
  price: number;
}

// ── Firecrawl Scraping ──

/**
 * Scrape a DoorDash menu page using Firecrawl and extract item prices.
 */
async function scrapeDoorDashMenu(url: string): Promise<ScrapedMenuItem[]> {
  if (!url) return [];

  try {
    const resp = await fetch(`${FIRECRAWL_BASE_URL}/scrape`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      },
      body: JSON.stringify({
        url,
        formats: ['extract'],
        extract: {
          schema: {
            type: 'object',
            properties: {
              menuItems: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    price: { type: 'number' },
                  },
                  required: ['name', 'price'],
                },
              },
            },
            required: ['menuItems'],
          },
          prompt: 'Extract all menu item names and their prices in dollars from this restaurant menu page. Include every item with its price.',
        },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      logger.warn('Firecrawl scrape failed', { url, status: resp.status, body: errText.slice(0, 200) });
      return [];
    }

    const data = await resp.json() as {
      success?: boolean;
      data?: {
        extract?: {
          menuItems?: Array<{ name: string; price: number }>;
        };
      };
    };

    const items = data?.data?.extract?.menuItems ?? [];
    logger.info(`Scraped ${items.length} menu items from ${url}`);
    return items;
  } catch (err) {
    logger.error('Firecrawl scrape error', { url, error: String(err) });
    return [];
  }
}

/**
 * Find the best price match for a target item name in a list of scraped items.
 * Uses case insensitive substring matching.
 */
function findPrice(scrapedItems: ScrapedMenuItem[], targetName: string): number | null {
  const target = targetName.toLowerCase();

  // Exact match first
  const exact = scrapedItems.find(i => i.name.toLowerCase() === target);
  if (exact) return exact.price;

  // Substring match
  const partial = scrapedItems.find(i => i.name.toLowerCase().includes(target));
  if (partial) return partial.price;

  // Reverse substring (target contains scraped name)
  const reverse = scrapedItems.find(i => target.includes(i.name.toLowerCase()));
  if (reverse) return reverse.price;

  return null;
}

// ── Persistence ──

function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

function saveSnapshot(snapshot: PriceSnapshot): void {
  ensureDataDir();
  const filename = `${snapshot.date}_${snapshot.competitor.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}.json`;
  writeFileSync(resolve(DATA_DIR, filename), JSON.stringify(snapshot, null, 2));
}

function loadPreviousSnapshot(competitorName: string): PriceSnapshot | null {
  ensureDataDir();
  const prefix = competitorName.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
  const files = readdirSync(DATA_DIR)
    .filter(f => f.includes(prefix) && f.endsWith('.json'))
    .sort()
    .reverse();

  if (files.length === 0) return null;

  try {
    return JSON.parse(readFileSync(resolve(DATA_DIR, files[0]), 'utf-8'));
  } catch {
    return null;
  }
}

// ── Runner ──

/**
 * Run the competitor pricing analysis.
 * Scrapes DoorDash menus, compares prices, saves snapshots, posts report.
 */
export async function runCompetitorPricing(): Promise<void> {
  logger.info('Running competitor pricing check');

  if (!FIRECRAWL_API_KEY) {
    logger.info('FIRECRAWL_API_KEY not set; skipping competitor pricing');
    return;
  }

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

  const today = new Date().toISOString().slice(0, 10);
  const reportLines: string[] = [];
  const priceChanges: string[] = [];
  let competitorsScraped = 0;

  for (const competitor of config.competitors) {
    const url = competitor.doordashUrl || competitor.ubereatsUrl;
    if (!url) {
      logger.info(`No URL for ${competitor.name}, skipping`);
      continue;
    }

    logger.info(`Scraping ${competitor.name}`, { url });
    const scrapedItems = await scrapeDoorDashMenu(url);

    if (scrapedItems.length === 0) {
      logger.warn(`No items scraped for ${competitor.name}`);
      reportLines.push(`**${competitor.name}**: Could not retrieve menu data`);
      continue;
    }

    competitorsScraped++;

    // Match prices
    const snapshot: PriceSnapshot = {
      competitor: competitor.name,
      date: today,
      items: [],
    };

    const itemLines: string[] = [];
    const previousSnapshot = loadPreviousSnapshot(competitor.name);

    for (const item of competitor.items) {
      const theirPrice = findPrice(scrapedItems, item.theirItem);
      const priceDiff = (theirPrice !== null && item.ourPrice > 0)
        ? theirPrice - item.ourPrice
        : null;

      snapshot.items.push({
        ourItem: item.ourItem,
        theirItem: item.theirItem,
        ourPrice: item.ourPrice,
        theirPrice,
        priceDifference: priceDiff,
      });

      if (theirPrice !== null) {
        let priceStr = `${item.ourItem}: $${theirPrice.toFixed(2)}`;

        // Check for price change vs previous snapshot
        if (previousSnapshot) {
          const prevItem = previousSnapshot.items.find(p => p.theirItem === item.theirItem);
          if (prevItem?.theirPrice !== null && prevItem?.theirPrice !== undefined && prevItem.theirPrice !== theirPrice) {
            const direction = theirPrice > prevItem.theirPrice ? 'up' : 'down';
            const delta = Math.abs(theirPrice - prevItem.theirPrice);
            priceStr += ` (${direction} $${delta.toFixed(2)} from $${prevItem.theirPrice.toFixed(2)})`;
            priceChanges.push(`${competitor.name} ${item.theirItem}: ${direction} $${delta.toFixed(2)} to $${theirPrice.toFixed(2)}`);
          }
        }

        if (item.ourPrice > 0) {
          const diff = theirPrice - item.ourPrice;
          if (diff > 0.50) {
            priceStr += ` (you're $${diff.toFixed(2)} cheaper)`;
          } else if (diff < -0.50) {
            priceStr += ` (you're $${Math.abs(diff).toFixed(2)} higher)`;
          }
        }

        itemLines.push(priceStr);
      }
    }

    saveSnapshot(snapshot);

    if (itemLines.length > 0) {
      reportLines.push(`**${competitor.name}** (${scrapedItems.length} items scraped):\n${itemLines.join('\n')}`);
    } else {
      reportLines.push(`**${competitor.name}**: No matching items found in ${scrapedItems.length} scraped items`);
    }
  }

  if (reportLines.length === 0) {
    logger.info('No competitor data to report');
    return;
  }

  // Build the report
  let body = reportLines.join('\n\n');

  if (priceChanges.length > 0) {
    body += `\n\n**Price Changes This Week**:\n${priceChanges.join('\n')}`;
  }

  body += `\n\n_${competitorsScraped} competitors scraped on ${today}_`;

  await postToTeamsWebhook('marketplace', `Competitor Pricing Report (${today})`, body);
  logger.info(`Competitor pricing complete: ${competitorsScraped} competitors scraped`);
}
