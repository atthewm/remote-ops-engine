/**
 * Stockout / 86'd / Disabled Item Rule.
 *
 * Fetches the full Toast menu, detects items that are currently
 * disabled or hidden, filters to high margin or high velocity items,
 * and generates an alert if significant items are offline with an
 * estimate of the revenue impact.
 */
import { logger } from '../util/logger.js';
import { generateFingerprint } from '../util/cooldown.js';
import { getOwnerForDomain } from '../util/config.js';
import { fetchMenuItems, fetchOrders, computeItemMix, detectDisabledItems, } from '../mcp/toast.js';
import { fetchProducts } from '../mcp/marginedge.js';
import { buildAlert } from './engine.js';
const RULE_ID = 'stockout';
const RULE_NAME = 'Stockout and Disabled Item Monitor';
const RULE_FAMILY = 'menu';
export class StockoutRule {
    id = RULE_ID;
    name = RULE_NAME;
    family = RULE_FAMILY;
    async evaluate(storeId, config) {
        logger.info('Evaluating stockout rule', { storeId });
        const thresholds = config.rules.thresholds.stockout;
        const now = new Date();
        const asOfDate = now.toISOString().slice(0, 10);
        // Fetch current menu from Toast
        let menuItems;
        try {
            menuItems = await fetchMenuItems(storeId);
            logger.info(`Fetched ${menuItems.length} menu items for stockout check`);
        }
        catch (err) {
            logger.error('Failed to fetch menu items for stockout check', {
                storeId,
                error: String(err),
            });
            return { ruleId: RULE_ID, fired: false, alerts: [] };
        }
        if (menuItems.length === 0) {
            logger.warn('No menu items returned; skipping stockout check', { storeId });
            return { ruleId: RULE_ID, fired: false, alerts: [] };
        }
        // Fetch recent item mix for volume and revenue estimation
        let recentMix = null;
        try {
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);
            const priorDate = yesterday.toISOString().slice(0, 10);
            const orders = await fetchOrders(storeId, priorDate);
            if (orders.length > 0) {
                recentMix = computeItemMix(storeId, orders, priorDate);
                logger.info(`Recent mix computed from ${orders.length} orders`);
            }
        }
        catch (err) {
            logger.warn('Could not fetch recent item mix for revenue estimation', {
                storeId,
                error: String(err),
            });
        }
        // Detect disabled items
        const stockoutResult = detectDisabledItems(storeId, menuItems, recentMix ?? undefined);
        if (stockoutResult.items.length === 0) {
            logger.info('No disabled or hidden items detected', { storeId });
            return { ruleId: RULE_ID, fired: false, alerts: [] };
        }
        // Fetch margin data from MarginEdge for filtering high margin items
        const marginMap = new Map();
        try {
            const products = await fetchProducts(storeId);
            for (const product of products) {
                const cost = typeof product.cost === 'number'
                    ? product.cost
                    : typeof product.price === 'number'
                        ? product.price
                        : 0;
                marginMap.set(normalizeForMatch(product.name), cost);
            }
            logger.info(`Loaded cost data for ${marginMap.size} products`);
        }
        catch (err) {
            logger.warn('Could not fetch MarginEdge products for margin filtering', {
                storeId,
                error: String(err),
            });
        }
        // Build volume lookup from recent mix
        const volumeMap = new Map();
        if (recentMix) {
            for (const entry of recentMix.items) {
                volumeMap.set(entry.itemGuid, entry.quantity);
                volumeMap.set(normalizeForMatch(entry.itemName), entry.quantity);
            }
        }
        // Filter to significant items: high margin, high velocity, or high revenue loss
        const significantItems = stockoutResult.items.filter(item => {
            // High revenue loss
            if (item.estimatedDailyRevenueLoss >= thresholds.revenueLossAlertThreshold) {
                return true;
            }
            // High velocity
            const volume = volumeMap.get(item.itemGuid) ?? volumeMap.get(normalizeForMatch(item.itemName)) ?? 0;
            if (volume >= thresholds.highVelocityMinDaily) {
                return true;
            }
            // High margin (if cost data available)
            if (item.menuPrice > 0) {
                const cost = marginMap.get(normalizeForMatch(item.itemName)) ?? 0;
                if (cost > 0) {
                    const marginPct = (item.menuPrice - cost) / item.menuPrice;
                    if (marginPct >= thresholds.highMarginThreshold) {
                        return true;
                    }
                }
            }
            return false;
        });
        if (significantItems.length === 0) {
            logger.info('Disabled items detected but none meet significance criteria', {
                storeId,
                totalDisabled: stockoutResult.items.length,
            });
            return { ruleId: RULE_ID, fired: false, alerts: [] };
        }
        // Compute total estimated revenue loss
        const totalRevenueLoss = significantItems.reduce((sum, item) => sum + item.estimatedDailyRevenueLoss, 0);
        // Determine severity
        let severity = 'yellow';
        if (significantItems.length >= 5 ||
            totalRevenueLoss >= thresholds.revenueLossAlertThreshold * 3) {
            severity = 'red';
        }
        // Build alert
        const alerts = [];
        const owner = getOwnerForDomain(config, 'menu');
        const fingerprint = generateFingerprint(RULE_ID, storeId, asOfDate, `disabled_${significantItems.length}`);
        const whatParts = [];
        whatParts.push(`${significantItems.length} significant menu items are currently disabled or hidden.`);
        whatParts.push(`Total disabled items: ${stockoutResult.items.length}. Significant items (high margin, high velocity, or material revenue impact): ${significantItems.length}.`);
        if (totalRevenueLoss > 0) {
            whatParts.push(`Estimated daily revenue loss: $${totalRevenueLoss.toFixed(2)}.`);
        }
        // Detail the top items
        const topItems = significantItems.slice(0, 5);
        for (const item of topItems) {
            whatParts.push(buildItemDetail(item, volumeMap, marginMap));
        }
        if (significantItems.length > 5) {
            whatParts.push(`Plus ${significantItems.length - 5} additional items.`);
        }
        // Group by reason
        const reasonCounts = new Map();
        for (const item of significantItems) {
            const count = reasonCounts.get(item.reason) ?? 0;
            reasonCounts.set(item.reason, count + 1);
        }
        const reasonSummary = Array.from(reasonCounts.entries())
            .map(([reason, count]) => `${reason}: ${count}`)
            .join(', ');
        whatParts.push(`By reason: ${reasonSummary}.`);
        const keyMetrics = {
            totalDisabledItems: stockoutResult.items.length,
            significantItems: significantItems.length,
            estimatedDailyRevenueLoss: `$${totalRevenueLoss.toFixed(2)}`,
            highMarginThreshold: pct(thresholds.highMarginThreshold),
            highVelocityMinDaily: thresholds.highVelocityMinDaily,
            revenueLossThreshold: `$${thresholds.revenueLossAlertThreshold}`,
        };
        const audiences = severity === 'red'
            ? ['exec', 'ops']
            : ['ops'];
        const alert = buildAlert({
            ruleId: RULE_ID,
            ruleName: RULE_NAME,
            storeId,
            severity,
            topic: `Stockout Alert: ${significantItems.length} items offline, ~$${totalRevenueLoss.toFixed(0)} daily impact`,
            dateWindow: asOfDate,
            whatHappened: whatParts.join(' '),
            whyItMatters: 'Disabled menu items result in lost sales and customer disappointment, especially for high demand or high margin items. Every hour an item is offline compounds the revenue loss.',
            keyMetrics,
            recommendedAction: buildRecommendedAction(significantItems, totalRevenueLoss),
            owner,
            audiences,
            channels: ['ops'],
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
function pct(value) {
    return `${(value * 100).toFixed(1)}%`;
}
function normalizeForMatch(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
function buildItemDetail(item, volumeMap, marginMap) {
    const parts = [];
    parts.push(`${item.itemName} ($${item.menuPrice.toFixed(2)})`);
    parts.push(`reason: ${item.reason}`);
    const volume = volumeMap.get(item.itemGuid) ?? volumeMap.get(normalizeForMatch(item.itemName)) ?? 0;
    if (volume > 0) {
        parts.push(`recent daily volume: ${volume} units`);
    }
    if (item.estimatedDailyRevenueLoss > 0) {
        parts.push(`est. daily loss: $${item.estimatedDailyRevenueLoss.toFixed(2)}`);
    }
    const cost = marginMap.get(normalizeForMatch(item.itemName));
    if (cost && cost > 0 && item.menuPrice > 0) {
        const margin = (item.menuPrice - cost) / item.menuPrice;
        parts.push(`margin: ${pct(margin)}`);
    }
    return parts.join(', ') + '.';
}
function buildRecommendedAction(items, totalRevenueLoss) {
    const actions = [];
    const disabledItems = items.filter(i => i.reason === 'disabled');
    const hiddenItems = items.filter(i => i.reason === 'hidden');
    const eightySixedItems = items.filter(i => i.reason === '86d');
    if (disabledItems.length > 0) {
        actions.push(`Re enable ${disabledItems.length} disabled items in Toast if stock is available.`);
    }
    if (eightySixedItems.length > 0) {
        actions.push(`Check inventory for ${eightySixedItems.length} 86'd items and restore when restocked.`);
    }
    if (hiddenItems.length > 0) {
        actions.push(`Review ${hiddenItems.length} hidden items to confirm they should remain hidden.`);
    }
    if (totalRevenueLoss >= 100) {
        actions.push(`Estimated daily impact is $${totalRevenueLoss.toFixed(2)}. Prioritize restoring highest revenue items first.`);
    }
    if (actions.length === 0) {
        actions.push('Review all disabled menu items and restore those that should be available for sale.');
    }
    return actions.join(' ');
}
//# sourceMappingURL=stockout.js.map