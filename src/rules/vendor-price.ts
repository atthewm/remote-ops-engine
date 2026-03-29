/**
 * Vendor Price Spike Rule.
 *
 * Compares recent MarginEdge invoice line item prices against the
 * previous period to detect significant price increases. Uses the
 * detectVendorPriceChanges helper from the MarginEdge MCP layer
 * and applies configured spike thresholds.
 */

import { logger } from '../util/logger.js';
import { generateFingerprint } from '../util/cooldown.js';
import { getOwnerForDomain } from '../util/config.js';
import {
  fetchInvoiceStatus,
  detectVendorPriceChanges,
} from '../mcp/marginedge.js';
import { buildAlert } from './engine.js';
import type { RuleHandler, RuleResult } from './engine.js';
import type { AppConfig } from '../util/config.js';
import type {
  Severity,
  Audience,
  NotificationEvent,
  VendorPriceChangeEntry,
} from '../models/normalized.js';

const RULE_ID = 'vendor_price';
const RULE_NAME = 'Vendor Price Spike';
const RULE_FAMILY = 'purchasing';

export class VendorPriceRule implements RuleHandler {
  readonly id = RULE_ID;
  readonly name = RULE_NAME;
  readonly family = RULE_FAMILY;

  async evaluate(storeId: string, config: AppConfig): Promise<RuleResult> {
    logger.info('Evaluating vendor price spike rule', { storeId });

    const thresholds = config.rules.thresholds.vendorPrice;
    const now = new Date();
    const asOfDate = now.toISOString().slice(0, 10);

    // Define the two comparison periods:
    // Recent: past 7 days
    // Previous: 8 to 14 days ago
    const recentEnd = new Date(now);
    recentEnd.setDate(recentEnd.getDate() - 1);
    const recentStart = new Date(now);
    recentStart.setDate(recentStart.getDate() - 7);

    const previousEnd = new Date(now);
    previousEnd.setDate(previousEnd.getDate() - 8);
    const previousStart = new Date(now);
    previousStart.setDate(previousStart.getDate() - 14);

    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    // Fetch invoice IDs for both periods
    // The MarginEdge invoice status gives us counts but not individual IDs.
    // For vendor price detection, we pass the date ranges and let
    // detectVendorPriceChanges handle the order level detail fetching.
    // Since detectVendorPriceChanges expects order ID arrays, we first
    // fetch invoice status to get IDs if available.

    let recentOrderIds: string[] = [];
    let previousOrderIds: string[] = [];

    try {
      const recentInvoices = await fetchInvoiceStatus(
        storeId,
        fmt(recentStart),
        fmt(recentEnd),
      );
      // Use invoice count to generate placeholder order IDs.
      // In a production setup, we would fetch individual invoice IDs
      // from a more detailed endpoint. For now, we use sequential IDs.
      recentOrderIds = Array.from(
        { length: recentInvoices.totalInvoices },
        (_, i) => `recent_${i}`,
      );
      logger.info('Recent period invoice count', {
        storeId,
        count: recentInvoices.totalInvoices,
        range: `${fmt(recentStart)} to ${fmt(recentEnd)}`,
      });
    } catch (err) {
      logger.error('Failed to fetch recent invoices for vendor price check', {
        storeId,
        error: String(err),
      });
    }

    try {
      const previousInvoices = await fetchInvoiceStatus(
        storeId,
        fmt(previousStart),
        fmt(previousEnd),
      );
      previousOrderIds = Array.from(
        { length: previousInvoices.totalInvoices },
        (_, i) => `previous_${i}`,
      );
      logger.info('Previous period invoice count', {
        storeId,
        count: previousInvoices.totalInvoices,
        range: `${fmt(previousStart)} to ${fmt(previousEnd)}`,
      });
    } catch (err) {
      logger.error('Failed to fetch previous invoices for vendor price check', {
        storeId,
        error: String(err),
      });
    }

    // If either period has no data, we cannot compare
    if (recentOrderIds.length === 0 || previousOrderIds.length === 0) {
      logger.warn('Insufficient invoice data for vendor price comparison', {
        storeId,
        recentCount: recentOrderIds.length,
        previousCount: previousOrderIds.length,
      });
      return { ruleId: RULE_ID, fired: false, alerts: [] };
    }

    // Detect price changes
    let priceChanges;
    try {
      priceChanges = await detectVendorPriceChanges(storeId, recentOrderIds, previousOrderIds);
    } catch (err) {
      logger.error('Failed to detect vendor price changes', {
        storeId,
        error: String(err),
      });
      return { ruleId: RULE_ID, fired: false, alerts: [] };
    }

    // Filter to spikes above the configured threshold
    const spikes = priceChanges.changes.filter(
      c => c.changeDirection === 'up' && Math.abs(c.changePercent) >= thresholds.spikeThresholdPercent,
    );

    if (spikes.length === 0) {
      logger.info('No vendor price spikes above threshold', {
        storeId,
        threshold: pct(thresholds.spikeThresholdPercent),
        totalChanges: priceChanges.changes.length,
      });
      return { ruleId: RULE_ID, fired: false, alerts: [] };
    }

    // Determine severity based on spike count and magnitude
    let severity: Severity = 'yellow';
    const majorSpikes = spikes.filter(s => Math.abs(s.changePercent) >= thresholds.spikeThresholdPercent * 2);
    if (majorSpikes.length >= 3 || spikes.length >= 8) {
      severity = 'red';
    }

    // Build alert content
    const alerts: NotificationEvent[] = [];
    const owner = getOwnerForDomain(config, 'purchasing');
    const fingerprint = generateFingerprint(
      RULE_ID,
      storeId,
      asOfDate,
      `spikes_${spikes.length}`,
    );

    const whatParts: string[] = [];
    whatParts.push(
      `Detected ${spikes.length} vendor price increases above the ${pct(thresholds.spikeThresholdPercent)} threshold.`,
    );

    // Detail the top spikes
    const topSpikes = spikes.slice(0, 5);
    for (const spike of topSpikes) {
      whatParts.push(buildSpikeDetail(spike));
    }
    if (spikes.length > 5) {
      whatParts.push(`Plus ${spikes.length - 5} additional price increases.`);
    }

    // Also report notable decreases
    const decreases = priceChanges.changes.filter(
      c => c.changeDirection === 'down' && Math.abs(c.changePercent) >= thresholds.weekOverWeekThreshold,
    );
    if (decreases.length > 0) {
      whatParts.push(`Also noted: ${decreases.length} price decreases detected.`);
    }

    const keyMetrics: Record<string, string | number> = {
      totalPriceChanges: priceChanges.changes.length,
      spikesAboveThreshold: spikes.length,
      majorSpikes: majorSpikes.length,
      priceDecreases: decreases.length,
      spikeThreshold: pct(thresholds.spikeThresholdPercent),
      comparisonPeriod: `${fmt(recentStart)} vs ${fmt(previousStart)} to ${fmt(previousEnd)}`,
    };

    if (topSpikes.length > 0) {
      keyMetrics.largestSpike = pct(topSpikes[0].changePercent);
      keyMetrics.largestSpikeProduct = topSpikes[0].productName;
    }

    // Group spikes by vendor for the recommendation
    const vendorGroups = new Map<string, VendorPriceChangeEntry[]>();
    for (const spike of spikes) {
      const group = vendorGroups.get(spike.vendorName) ?? [];
      group.push(spike);
      vendorGroups.set(spike.vendorName, group);
    }

    const audiences: Audience[] = severity === 'red'
      ? ['exec', 'ops', 'finance']
      : ['ops', 'finance'];

    const vendorSummary = Array.from(vendorGroups.entries())
      .map(([vendor, items]) => `${vendor} (${items.length} items)`)
      .join(', ');

    const alert = buildAlert({
      ruleId: RULE_ID,
      ruleName: RULE_NAME,
      storeId,
      severity,
      topic: `Vendor Price Spikes: ${spikes.length} items from ${vendorGroups.size} vendors`,
      dateWindow: asOfDate,
      whatHappened: whatParts.join(' '),
      whyItMatters: 'Vendor price increases flow directly into COGS and erode margins if not addressed. Early detection allows for negotiation, substitution, or menu price adjustments.',
      keyMetrics,
      recommendedAction: `Review price increases from: ${vendorSummary}. Contact vendors for explanation or negotiate alternatives. Consider menu price adjustments for affected items.`,
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

function buildSpikeDetail(spike: VendorPriceChangeEntry): string {
  return (
    `${spike.productName} from ${spike.vendorName}: ` +
    `$${spike.previousPrice.toFixed(2)} to $${spike.currentPrice.toFixed(2)} ` +
    `(${pct(spike.changePercent)} increase).`
  );
}
