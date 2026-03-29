/**
 * Discount / Comp / Void / Refund Anomaly Rule.
 *
 * Fetches prior day orders from Toast, computes void, refund, comp,
 * and discount metrics, compares each against configured thresholds,
 * and flags spikes versus trailing averages.
 */
import { logger } from '../util/logger.js';
import { generateFingerprint } from '../util/cooldown.js';
import { getOwnerForDomain } from '../util/config.js';
import { fetchOrders, fetchDailySales, computeVoidsRefundsComps, computeDiscountSummary, } from '../mcp/toast.js';
import { buildAlert } from './engine.js';
const RULE_ID = 'discount_comp_void';
const RULE_NAME = 'Discount, Comp, Void, and Refund Anomaly';
const RULE_FAMILY = 'exceptions';
export class DiscountCompRule {
    id = RULE_ID;
    name = RULE_NAME;
    family = RULE_FAMILY;
    async evaluate(storeId, config) {
        logger.info('Evaluating discount/comp/void rule', { storeId });
        const thresholds = config.rules.thresholds.discountCompVoid;
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const businessDate = yesterday.toISOString().slice(0, 10);
        // Fetch prior day data
        let metrics = null;
        try {
            metrics = await this.fetchMetrics(storeId, businessDate);
        }
        catch (err) {
            logger.error('Failed to fetch exception metrics', {
                storeId,
                businessDate,
                error: String(err),
            });
            return { ruleId: RULE_ID, fired: false, alerts: [] };
        }
        if (!metrics || metrics.netSales <= 0) {
            logger.warn('No sales data for exception analysis', { storeId, businessDate });
            return { ruleId: RULE_ID, fired: false, alerts: [] };
        }
        const { vrc, discounts, netSales } = metrics;
        // Fetch trailing data for spike comparison
        let trailingVrc = null;
        let trailingDiscounts = null;
        try {
            const trailing = await this.fetchTrailingAverage(storeId, now, 7);
            trailingVrc = trailing.vrc;
            trailingDiscounts = trailing.discounts;
        }
        catch (err) {
            logger.warn('Could not compute trailing average for exception comparison', {
                storeId,
                error: String(err),
            });
        }
        // Evaluate thresholds
        const breaches = [];
        // Discount check
        evaluateMetric(breaches, 'Discounts', discounts.discountPercent, thresholds.discountPercentYellow, thresholds.discountPercentRed, discounts.totalDiscounts, trailingDiscounts?.discountPercent ?? null, thresholds.trailingSpikeMultiplier);
        // Void check
        evaluateMetric(breaches, 'Voids', vrc.voidPercent, thresholds.voidPercentYellow, thresholds.voidPercentRed, vrc.voidAmount, trailingVrc?.voidPercent ?? null, thresholds.trailingSpikeMultiplier);
        // Comp check
        evaluateMetric(breaches, 'Comps', vrc.compPercent, thresholds.compPercentYellow, thresholds.compPercentRed, vrc.compAmount, trailingVrc?.compPercent ?? null, thresholds.trailingSpikeMultiplier);
        // Refund check
        evaluateMetric(breaches, 'Refunds', vrc.refundPercent, thresholds.refundPercentYellow, thresholds.refundPercentRed, vrc.refundAmount, trailingVrc?.refundPercent ?? null, thresholds.trailingSpikeMultiplier);
        // Total exceptions check
        evaluateMetric(breaches, 'Total Exceptions', vrc.totalExceptionPercent + discounts.discountPercent, thresholds.totalExceptionPercentYellow, thresholds.totalExceptionPercentRed, vrc.totalExceptionAmount + discounts.totalDiscounts, trailingVrc && trailingDiscounts
            ? (trailingVrc.totalExceptionPercent + trailingDiscounts.discountPercent)
            : null, thresholds.trailingSpikeMultiplier);
        if (breaches.length === 0) {
            logger.info('All exception metrics within normal range', {
                storeId,
                businessDate,
            });
            return { ruleId: RULE_ID, fired: false, alerts: [] };
        }
        // Determine overall severity from the worst breach
        const severity = breaches.some(b => b.severity === 'red') ? 'red' : 'yellow';
        // Build alert
        const alerts = [];
        const owner = getOwnerForDomain(config, 'exceptions');
        const fingerprint = generateFingerprint(RULE_ID, storeId, businessDate, `breaches_${breaches.length}`);
        const whatParts = [];
        whatParts.push(`Exception anomaly report for ${businessDate} (net sales: $${netSales.toFixed(2)}).`);
        // Breakdown section
        whatParts.push(`Voids: ${vrc.voidCount} totaling $${vrc.voidAmount.toFixed(2)} (${pct(vrc.voidPercent)} of sales).`);
        whatParts.push(`Refunds: ${vrc.refundCount} totaling $${vrc.refundAmount.toFixed(2)} (${pct(vrc.refundPercent)} of sales).`);
        whatParts.push(`Comps: ${vrc.compCount} totaling $${vrc.compAmount.toFixed(2)} (${pct(vrc.compPercent)} of sales).`);
        whatParts.push(`Discounts: ${discounts.discountCount} totaling $${discounts.totalDiscounts.toFixed(2)} (${pct(discounts.discountPercent)} of sales).`);
        // Threshold breaches
        whatParts.push(`Thresholds breached: ${breaches.map(b => b.message).join('; ')}.`);
        // Trailing spike notes
        const spikeBreaches = breaches.filter(b => b.isSpikeVsTrailing);
        if (spikeBreaches.length > 0) {
            whatParts.push(`Trailing average spikes detected: ${spikeBreaches.map(b => b.metric).join(', ')}.`);
        }
        // Discount breakdown by type if available
        if (discounts.byType.length > 0 && discounts.totalDiscounts > 0) {
            const topDiscounts = discounts.byType.slice(0, 5);
            const discountDetails = topDiscounts
                .map(d => `${d.name}: $${d.amount.toFixed(2)} (${d.count}x)`)
                .join(', ');
            whatParts.push(`Top discounts: ${discountDetails}.`);
        }
        const keyMetrics = {
            businessDate,
            netSales: `$${netSales.toFixed(2)}`,
            voidCount: vrc.voidCount,
            voidAmount: `$${vrc.voidAmount.toFixed(2)}`,
            voidPercent: pct(vrc.voidPercent),
            refundCount: vrc.refundCount,
            refundAmount: `$${vrc.refundAmount.toFixed(2)}`,
            refundPercent: pct(vrc.refundPercent),
            compCount: vrc.compCount,
            compAmount: `$${vrc.compAmount.toFixed(2)}`,
            compPercent: pct(vrc.compPercent),
            discountCount: discounts.discountCount,
            discountAmount: `$${discounts.totalDiscounts.toFixed(2)}`,
            discountPercent: pct(discounts.discountPercent),
            totalExceptionAmount: `$${(vrc.totalExceptionAmount + discounts.totalDiscounts).toFixed(2)}`,
            breachCount: breaches.length,
        };
        const audiences = severity === 'red'
            ? ['exec', 'ops', 'finance']
            : ['ops', 'finance'];
        const alert = buildAlert({
            ruleId: RULE_ID,
            ruleName: RULE_NAME,
            storeId,
            severity,
            topic: `Exception Anomaly: ${breaches.length} thresholds breached on ${businessDate}`,
            dateWindow: businessDate,
            whatHappened: whatParts.join(' '),
            whyItMatters: 'Elevated voids, comps, refunds, and discounts directly erode net revenue. Spikes may indicate process issues, training gaps, or unauthorized discounting.',
            keyMetrics,
            recommendedAction: buildRecommendedAction(breaches, vrc, discounts),
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
    /**
     * Fetches orders and computes exception metrics for a single business date.
     */
    async fetchMetrics(storeId, businessDate) {
        const [sales, orders] = await Promise.all([
            fetchDailySales(storeId, businessDate),
            fetchOrders(storeId, businessDate),
        ]);
        const netSales = sales.netSales;
        const vrc = computeVoidsRefundsComps(storeId, orders, netSales, businessDate);
        const discounts = computeDiscountSummary(storeId, orders, netSales, businessDate);
        return { vrc, discounts, netSales };
    }
    /**
     * Computes a trailing average of exception metrics over the specified
     * number of prior days. Returns averaged VoidsRefundsComps and DiscountSummary.
     */
    async fetchTrailingAverage(storeId, now, days) {
        const trailingMetrics = [];
        // Start from 2 days ago (skip yesterday, which is the evaluation day)
        for (let i = 2; i <= days + 1 && trailingMetrics.length < days; i++) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dateStr = date.toISOString().slice(0, 10);
            try {
                const metrics = await this.fetchMetrics(storeId, dateStr);
                if (metrics.netSales > 0) {
                    trailingMetrics.push(metrics);
                }
            }
            catch (err) {
                logger.debug('Could not fetch trailing data for date', {
                    storeId,
                    date: dateStr,
                    error: String(err),
                });
            }
        }
        if (trailingMetrics.length === 0) {
            throw new Error('No trailing data available for comparison');
        }
        const count = trailingMetrics.length;
        // Average the VRC metrics
        const avgVrc = {
            storeId,
            businessDate: 'trailing_avg',
            voidCount: Math.round(trailingMetrics.reduce((s, m) => s + m.vrc.voidCount, 0) / count),
            voidAmount: trailingMetrics.reduce((s, m) => s + m.vrc.voidAmount, 0) / count,
            voidPercent: trailingMetrics.reduce((s, m) => s + m.vrc.voidPercent, 0) / count,
            refundCount: Math.round(trailingMetrics.reduce((s, m) => s + m.vrc.refundCount, 0) / count),
            refundAmount: trailingMetrics.reduce((s, m) => s + m.vrc.refundAmount, 0) / count,
            refundPercent: trailingMetrics.reduce((s, m) => s + m.vrc.refundPercent, 0) / count,
            compCount: Math.round(trailingMetrics.reduce((s, m) => s + m.vrc.compCount, 0) / count),
            compAmount: trailingMetrics.reduce((s, m) => s + m.vrc.compAmount, 0) / count,
            compPercent: trailingMetrics.reduce((s, m) => s + m.vrc.compPercent, 0) / count,
            totalExceptionAmount: trailingMetrics.reduce((s, m) => s + m.vrc.totalExceptionAmount, 0) / count,
            totalExceptionPercent: trailingMetrics.reduce((s, m) => s + m.vrc.totalExceptionPercent, 0) / count,
            source: 'toast',
            fetchedAt: new Date().toISOString(),
        };
        // Average the discount metrics
        const avgDiscounts = {
            storeId,
            businessDate: 'trailing_avg',
            totalDiscounts: trailingMetrics.reduce((s, m) => s + m.discounts.totalDiscounts, 0) / count,
            discountPercent: trailingMetrics.reduce((s, m) => s + m.discounts.discountPercent, 0) / count,
            discountCount: Math.round(trailingMetrics.reduce((s, m) => s + m.discounts.discountCount, 0) / count),
            byType: [],
            source: 'toast',
            fetchedAt: new Date().toISOString(),
        };
        return { vrc: avgVrc, discounts: avgDiscounts };
    }
}
function evaluateMetric(breaches, metricName, currentValue, yellowThreshold, redThreshold, dollarAmount, trailingValue, spikeMultiplier) {
    // Absolute threshold check
    if (currentValue >= redThreshold) {
        breaches.push({
            metric: metricName,
            severity: 'red',
            message: `${metricName} at ${pct(currentValue)} ($${dollarAmount.toFixed(2)}) exceeds red threshold of ${pct(redThreshold)}`,
            isSpikeVsTrailing: false,
        });
    }
    else if (currentValue >= yellowThreshold) {
        breaches.push({
            metric: metricName,
            severity: 'yellow',
            message: `${metricName} at ${pct(currentValue)} ($${dollarAmount.toFixed(2)}) exceeds yellow threshold of ${pct(yellowThreshold)}`,
            isSpikeVsTrailing: false,
        });
    }
    // Trailing spike check
    if (trailingValue !== null && trailingValue > 0) {
        const ratio = currentValue / trailingValue;
        if (ratio >= spikeMultiplier) {
            breaches.push({
                metric: metricName,
                severity: 'yellow',
                message: `${metricName} is ${ratio.toFixed(1)}x the trailing average (${pct(currentValue)} vs ${pct(trailingValue)})`,
                isSpikeVsTrailing: true,
            });
        }
    }
}
// ── Helpers ──
function pct(value) {
    return `${(value * 100).toFixed(1)}%`;
}
function buildRecommendedAction(breaches, vrc, discounts) {
    const actions = [];
    const hasVoidBreach = breaches.some(b => b.metric === 'Voids');
    const hasCompBreach = breaches.some(b => b.metric === 'Comps');
    const hasRefundBreach = breaches.some(b => b.metric === 'Refunds');
    const hasDiscountBreach = breaches.some(b => b.metric === 'Discounts');
    if (hasVoidBreach) {
        actions.push(`Investigate ${vrc.voidCount} voids totaling $${vrc.voidAmount.toFixed(2)}. Check for training issues or POS errors.`);
    }
    if (hasCompBreach) {
        actions.push(`Review ${vrc.compCount} comps totaling $${vrc.compAmount.toFixed(2)}. Verify comp authorization and documentation.`);
    }
    if (hasRefundBreach) {
        actions.push(`Review ${vrc.refundCount} refunds totaling $${vrc.refundAmount.toFixed(2)}. Identify patterns or recurring issues.`);
    }
    if (hasDiscountBreach) {
        actions.push(`Audit discount usage: ${discounts.discountCount} discounts totaling $${discounts.totalDiscounts.toFixed(2)}. Verify all discounts are authorized.`);
    }
    if (breaches.some(b => b.isSpikeVsTrailing)) {
        actions.push('Spike vs trailing average detected. Compare to recent days for context and determine if this is an isolated event or emerging pattern.');
    }
    if (actions.length === 0) {
        actions.push('Review exception details and ensure all voids, comps, and discounts are properly documented.');
    }
    return actions.join(' ');
}
//# sourceMappingURL=discount-comp.js.map