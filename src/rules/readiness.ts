/**
 * MarginEdge Readiness Score Rule.
 *
 * Evaluates how complete and current the MarginEdge data setup is
 * for the store. Compares the weighted overall readiness score against
 * configured thresholds and generates alerts when quality drops below
 * acceptable levels.
 */

import { logger } from '../util/logger.js';
import { generateFingerprint } from '../util/cooldown.js';
import { getOwnerForDomain } from '../util/config.js';
import { computeReadinessScore } from '../mcp/marginedge.js';
import { buildAlert } from './engine.js';
import type { RuleHandler, RuleResult } from './engine.js';
import type { AppConfig } from '../util/config.js';
import type { Severity, Audience, NotificationEvent } from '../models/normalized.js';

const RULE_ID = 'readiness';
const RULE_NAME = 'MarginEdge Readiness Score';
const RULE_FAMILY = 'inventory';

export class ReadinessRule implements RuleHandler {
  readonly id = RULE_ID;
  readonly name = RULE_NAME;
  readonly family = RULE_FAMILY;

  async evaluate(storeId: string, config: AppConfig): Promise<RuleResult> {
    logger.info('Evaluating readiness rule', { storeId });

    const alerts: NotificationEvent[] = [];
    const thresholds = config.rules.thresholds.readiness;

    // Compute the readiness score from MarginEdge data
    let score;
    try {
      score = await computeReadinessScore(storeId, {
        weights: thresholds.weights,
      });
    } catch (err) {
      logger.error('Failed to compute readiness score', {
        storeId,
        error: String(err),
      });
      return { ruleId: RULE_ID, fired: false, alerts: [] };
    }

    const overall = score.overallScore;
    const dateWindow = score.asOfDate;

    logger.info('Readiness score evaluated', {
      storeId,
      overall,
      yellowThreshold: thresholds.yellowThreshold,
      redThreshold: thresholds.redThreshold,
      componentCount: score.components.length,
      missingCount: score.missingDetails.length,
    });

    // Determine severity
    let severity: Severity = 'green';
    if (overall < thresholds.redThreshold) {
      severity = 'red';
    } else if (overall < thresholds.yellowThreshold) {
      severity = 'yellow';
    }

    // If green, no alert needed
    if (severity === 'green') {
      logger.info('Readiness score is above threshold, no alert needed', {
        storeId,
        overall,
      });
      return { ruleId: RULE_ID, fired: false, alerts: [] };
    }

    // Build detail strings for missing components
    const missingLines: string[] = [];
    for (const missing of score.missingDetails) {
      if (missing.count > 0 || missing.items.length > 0) {
        const itemPreview = missing.items.slice(0, 5).join(', ');
        const suffix = missing.count > 5 ? ` and ${missing.count - 5} more` : '';
        missingLines.push(`${missing.component}: ${itemPreview}${suffix}`);
      }
    }

    // Build component breakdown for key metrics
    const keyMetrics: Record<string, string | number> = {
      overallScore: overall,
      target: thresholds.target,
    };
    for (const comp of score.components) {
      keyMetrics[`${comp.name}Score`] = comp.score;
      keyMetrics[`${comp.name}Weight`] = comp.weight;
    }

    // Determine audiences and owner
    const audiences: Audience[] = severity === 'red'
      ? ['exec', 'ops', 'finance']
      : ['ops', 'finance'];

    const owner = getOwnerForDomain(config, 'inventory');

    const fingerprint = generateFingerprint(RULE_ID, storeId, dateWindow, String(overall));

    const whatHappened = severity === 'red'
      ? `MarginEdge readiness score is critically low at ${overall}/100, well below the target of ${thresholds.target}.`
      : `MarginEdge readiness score is ${overall}/100, below the target of ${thresholds.target}.`;

    const whyItMatters = severity === 'red'
      ? 'Critical data gaps in MarginEdge undermine cost tracking, margin analysis, and vendor price monitoring. Financial reports will be unreliable until these gaps are resolved.'
      : 'Incomplete MarginEdge data reduces accuracy of cost and margin reports. Addressing gaps now prevents larger data quality issues.';

    const missingDetail = missingLines.length > 0
      ? ` Missing components: ${missingLines.join('; ')}.`
      : '';

    const alert = buildAlert({
      ruleId: RULE_ID,
      ruleName: RULE_NAME,
      storeId,
      severity,
      topic: `MarginEdge Readiness: ${overall}/100`,
      dateWindow,
      whatHappened: whatHappened + missingDetail,
      whyItMatters,
      keyMetrics,
      recommendedAction: buildRecommendation(score.missingDetails),
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

/**
 * Builds a prioritized recommendation string based on which
 * readiness components have the most missing data.
 */
function buildRecommendation(
  missingDetails: Array<{ component: string; items: string[]; count: number }>,
): string {
  const actionable = missingDetails.filter(m => m.count > 0 || m.items.length > 0);

  if (actionable.length === 0) {
    return 'Review MarginEdge data quality dashboard and resolve any flagged issues.';
  }

  const recommendations: string[] = [];

  for (const m of actionable) {
    switch (m.component) {
      case 'invoicesCaptured':
        recommendations.push(`Review and close ${m.count} open invoices in MarginEdge.`);
        break;
      case 'productMapping':
        recommendations.push(`Map ${m.count} unmapped products to categories in MarginEdge.`);
        break;
      case 'vendorMapping':
        recommendations.push(`Assign vendors to ${m.count} products missing vendor links.`);
        break;
      case 'recipeCoverage':
        recommendations.push('Audit recipe coverage. Recipe data is not available via API; check directly in MarginEdge.');
        break;
      case 'inventoryRecency':
        recommendations.push('Verify that inventory counts are current. Count data is not available via API; check directly in MarginEdge.');
        break;
      case 'unmappedIngredients':
        recommendations.push('Review ingredient mappings in MarginEdge for any unlinked items.');
        break;
      default:
        recommendations.push(`Address issues in ${m.component}.`);
    }
  }

  return recommendations.join(' ');
}
