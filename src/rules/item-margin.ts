/**
 * Item Margin Watchlist Rule.
 *
 * Cross references Toast menu items (with prices) against MarginEdge
 * products (with costs) to compute item level margins. Flags items
 * below the minimum margin threshold, high volume items with margin
 * compression, and top sellers missing cost mappings.
 *
 * Results are prioritized by volume and contribution to revenue.
 */

import { logger } from '../util/logger.js';
import { generateFingerprint } from '../util/cooldown.js';
import { getOwnerForDomain } from '../util/config.js';
import { fetchMenuItems, fetchOrders, computeItemMix } from '../mcp/toast.js';
import { fetchProducts } from '../mcp/marginedge.js';
import { buildAlert } from './engine.js';
import type { RuleHandler, RuleResult } from './engine.js';
import type { AppConfig } from '../util/config.js';
import type {
  Severity,
  Audience,
  NotificationEvent,
  ItemMarginEntry,
} from '../models/normalized.js';

const RULE_ID = 'item_margin';
const RULE_NAME = 'Item Margin Watchlist';
const RULE_FAMILY = 'profitability';

interface MenuItemRecord {
  guid: string;
  name: string;
  price: number;
  menuGroup: string;
}

interface ProductRecord {
  id: string;
  name: string;
  cost: number;
}

interface MatchedItem extends ItemMarginEntry {
  flags: string[];
}

export class ItemMarginRule implements RuleHandler {
  readonly id = RULE_ID;
  readonly name = RULE_NAME;
  readonly family = RULE_FAMILY;

  async evaluate(storeId: string, config: AppConfig): Promise<RuleResult> {
    logger.info('Evaluating item margin rule', { storeId });

    const thresholds = config.rules.thresholds.itemMargin;
    const now = new Date();
    const asOfDate = now.toISOString().slice(0, 10);

    // Fetch Toast menu items
    let menuItems: MenuItemRecord[] = [];
    try {
      const rawItems = await fetchMenuItems(storeId);
      menuItems = rawItems
        .filter(item => !item.isDeleted && item.price !== undefined && item.price > 0)
        .map(item => ({
          guid: item.guid ?? 'unknown',
          name: item.name ?? 'Unknown Item',
          price: item.price ?? 0,
          menuGroup: item.menuGroup?.name ?? 'Ungrouped',
        }));
      logger.info(`Loaded ${menuItems.length} priced menu items from Toast`);
    } catch (err) {
      logger.error('Failed to fetch Toast menu items for margin analysis', {
        storeId,
        error: String(err),
      });
      return { ruleId: RULE_ID, fired: false, alerts: [] };
    }

    if (menuItems.length === 0) {
      logger.warn('No priced menu items found; skipping margin analysis', { storeId });
      return { ruleId: RULE_ID, fired: false, alerts: [] };
    }

    // Fetch MarginEdge products for cost data
    let products: ProductRecord[] = [];
    try {
      const rawProducts = await fetchProducts(storeId);
      products = rawProducts.map(p => ({
        id: String(p.id),
        name: String(p.name),
        cost: typeof (p as Record<string, unknown>).price === 'number'
          ? (p as Record<string, unknown>).price as number
          : typeof (p as Record<string, unknown>).cost === 'number'
            ? (p as Record<string, unknown>).cost as number
            : 0,
      }));
      logger.info(`Loaded ${products.length} products from MarginEdge`);
    } catch (err) {
      logger.error('Failed to fetch MarginEdge products for margin analysis', {
        storeId,
        error: String(err),
      });
      // Continue with empty products; we can still flag unmapped items
    }

    // Fetch recent item mix for volume data (prior day)
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const priorDate = yesterday.toISOString().slice(0, 10);

    let volumeMap = new Map<string, number>();
    try {
      const orders = await fetchOrders(storeId, priorDate);
      const mix = computeItemMix(storeId, orders, priorDate);
      for (const entry of mix.items) {
        volumeMap.set(entry.itemGuid, entry.quantity);
        // Also key by name for fuzzy matching fallback
        volumeMap.set(normalizeForMatch(entry.itemName), entry.quantity);
      }
      logger.info(`Volume data loaded for ${mix.items.length} items`);
    } catch (err) {
      logger.warn('Could not fetch volume data for item margin prioritization', {
        storeId,
        error: String(err),
      });
      volumeMap = new Map();
    }

    // Cross reference menu items with products by name matching
    const productsByName = new Map<string, ProductRecord>();
    for (const product of products) {
      productsByName.set(normalizeForMatch(product.name), product);
    }

    const matchedItems: MatchedItem[] = [];
    const unmatchedTopSellers: MenuItemRecord[] = [];

    for (const menuItem of menuItems) {
      const normalizedName = normalizeForMatch(menuItem.name);
      const matchedProduct = productsByName.get(normalizedName)
        ?? findFuzzyMatch(normalizedName, productsByName);

      const volume = volumeMap.get(menuItem.guid)
        ?? volumeMap.get(normalizedName)
        ?? 0;

      if (!matchedProduct || matchedProduct.cost <= 0) {
        // Track as unmatched; flag if it is a top seller
        if (volume >= thresholds.topSellerThreshold) {
          unmatchedTopSellers.push(menuItem);
        }
        continue;
      }

      const marginDollars = menuItem.price - matchedProduct.cost;
      const marginPercent = menuItem.price > 0
        ? marginDollars / menuItem.price
        : 0;

      const flags: string[] = [];

      if (marginPercent < thresholds.minMarginPercent) {
        flags.push('below_min_margin');
      }

      if (
        volume >= thresholds.highVolumeMinUnits &&
        marginPercent < thresholds.minMarginPercent + thresholds.compressionTolerancePercent
      ) {
        flags.push('high_volume_margin_compression');
      }

      matchedItems.push({
        itemGuid: menuItem.guid,
        itemName: menuItem.name,
        menuPrice: menuItem.price,
        estimatedCost: matchedProduct.cost,
        marginDollars: Math.round(marginDollars * 100) / 100,
        marginPercent: Math.round(marginPercent * 10000) / 10000,
        costComplete: true,
        recentVolume: volume,
        contributionRank: 0, // Will be assigned after sorting
        flags,
      });
    }

    // Sort by volume descending and assign contribution rank
    matchedItems.sort((a, b) => b.recentVolume - a.recentVolume);
    matchedItems.forEach((item, index) => {
      item.contributionRank = index + 1;
    });

    // Filter to flagged items only
    const flaggedItems = matchedItems.filter(item => item.flags.length > 0);

    // Sort unmatched top sellers by volume descending
    unmatchedTopSellers.sort((a, b) => {
      const volA = volumeMap.get(a.guid) ?? volumeMap.get(normalizeForMatch(a.name)) ?? 0;
      const volB = volumeMap.get(b.guid) ?? volumeMap.get(normalizeForMatch(b.name)) ?? 0;
      return volB - volA;
    });

    // Check if we have anything to report
    const hasFlags = flaggedItems.length > 0 || unmatchedTopSellers.length > 0;

    if (!hasFlags) {
      logger.info('All matched items are above margin thresholds; no alerts', { storeId });
      return { ruleId: RULE_ID, fired: false, alerts: [] };
    }

    // Determine severity
    let severity: Severity = 'yellow';
    const highVolumeBreaches = flaggedItems.filter(
      i => i.flags.includes('high_volume_margin_compression'),
    );
    if (highVolumeBreaches.length >= 3 || unmatchedTopSellers.length >= 5) {
      severity = 'red';
    }

    // Build alert
    const alerts: NotificationEvent[] = [];
    const owner = getOwnerForDomain(config, 'profitability');
    const fingerprint = generateFingerprint(
      RULE_ID,
      storeId,
      asOfDate,
      `flagged_${flaggedItems.length}_unmatched_${unmatchedTopSellers.length}`,
    );

    const whatParts: string[] = [];
    whatParts.push(`Item margin analysis for ${asOfDate}.`);
    whatParts.push(`Analyzed ${matchedItems.length} matched items out of ${menuItems.length} menu items.`);

    if (flaggedItems.length > 0) {
      whatParts.push(`${flaggedItems.length} items flagged below the ${pct(thresholds.minMarginPercent)} margin threshold.`);
      const top3 = flaggedItems.slice(0, 3);
      for (const item of top3) {
        whatParts.push(
          `${item.itemName}: price $${item.menuPrice.toFixed(2)}, cost $${item.estimatedCost.toFixed(2)}, margin ${pct(item.marginPercent)}, volume ${item.recentVolume} units.`,
        );
      }
    }

    if (unmatchedTopSellers.length > 0) {
      whatParts.push(`${unmatchedTopSellers.length} top selling items have no cost mapping in MarginEdge.`);
      const topUnmatched = unmatchedTopSellers.slice(0, 3);
      for (const item of topUnmatched) {
        const vol = volumeMap.get(item.guid) ?? volumeMap.get(normalizeForMatch(item.name)) ?? 0;
        whatParts.push(`${item.name}: price $${item.price.toFixed(2)}, volume ${vol} units, no cost data.`);
      }
    }

    const keyMetrics: Record<string, string | number> = {
      totalMenuItems: menuItems.length,
      matchedItems: matchedItems.length,
      flaggedBelowMinMargin: flaggedItems.length,
      highVolumeCompressions: highVolumeBreaches.length,
      unmatchedTopSellers: unmatchedTopSellers.length,
      minMarginThreshold: pct(thresholds.minMarginPercent),
    };

    if (flaggedItems.length > 0) {
      keyMetrics.worstMargin = pct(flaggedItems[flaggedItems.length - 1].marginPercent);
      keyMetrics.worstMarginItem = flaggedItems[flaggedItems.length - 1].itemName;
    }

    const audiences: Audience[] = severity === 'red'
      ? ['exec', 'ops', 'finance']
      : ['ops', 'finance'];

    const alert = buildAlert({
      ruleId: RULE_ID,
      ruleName: RULE_NAME,
      storeId,
      severity,
      topic: `Item Margins: ${flaggedItems.length} flagged, ${unmatchedTopSellers.length} unmapped`,
      dateWindow: asOfDate,
      whatHappened: whatParts.join(' '),
      whyItMatters: 'Low item margins directly erode profitability. High volume items with thin margins have outsized impact on bottom line performance.',
      keyMetrics,
      recommendedAction: buildRecommendedAction(flaggedItems, unmatchedTopSellers, thresholds),
      owner,
      audiences,
      channels: ['ops', 'finance'],
      fingerprint,
    });

    alerts.push(alert);

    return {
      ruleId: RULE_ID,
      fired: true,
      alerts,
    };
  }
}

// ── Helpers ──

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * Normalizes a string for name matching by lowercasing, removing
 * non alphanumeric characters, and collapsing whitespace.
 */
function normalizeForMatch(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Attempts a fuzzy match by checking if any product name contains
 * the menu item name or vice versa. Returns the best match or undefined.
 */
function findFuzzyMatch(
  normalizedName: string,
  productMap: Map<string, ProductRecord>,
): ProductRecord | undefined {
  // Try substring matching in both directions
  for (const [prodName, product] of productMap) {
    if (prodName.includes(normalizedName) || normalizedName.includes(prodName)) {
      return product;
    }
  }

  // Try matching with the first significant word (at least 4 characters)
  const words = normalizedName.split(' ').filter(w => w.length >= 4);
  if (words.length > 0) {
    for (const [prodName, product] of productMap) {
      if (words.every(w => prodName.includes(w))) {
        return product;
      }
    }
  }

  return undefined;
}

function buildRecommendedAction(
  flaggedItems: MatchedItem[],
  unmatchedTopSellers: MenuItemRecord[],
  thresholds: { minMarginPercent: number; highVolumeMinUnits: number },
): string {
  const actions: string[] = [];

  if (flaggedItems.length > 0) {
    actions.push(
      `Review pricing or vendor costs for ${flaggedItems.length} items below ${pct(thresholds.minMarginPercent)} margin.`,
    );
    const highVolumeItems = flaggedItems.filter(
      i => i.recentVolume >= thresholds.highVolumeMinUnits,
    );
    if (highVolumeItems.length > 0) {
      actions.push(
        `Priority: ${highVolumeItems.length} flagged items are high volume sellers. Address these first for maximum margin recovery.`,
      );
    }
  }

  if (unmatchedTopSellers.length > 0) {
    actions.push(
      `Map ${unmatchedTopSellers.length} top selling items to MarginEdge products so margin can be tracked.`,
    );
  }

  if (actions.length === 0) {
    actions.push('No immediate action required.');
  }

  return actions.join(' ');
}
