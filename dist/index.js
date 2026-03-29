/**
 * Remote Coffee Operations Engine
 *
 * Proactive alerting and digest system for operational excellence.
 * Integrates MarginEdge, Toast, and Microsoft 365 via MCP servers.
 *
 * Modes:
 *   shadow (default): Evaluate rules and log results without posting live
 *   live: Post messages to Teams, create tasks, full operation
 *   test: Run against historical data if available
 *
 * Usage:
 *   ALERT_MODE=shadow node dist/index.js          # scheduled shadow mode
 *   ALERT_MODE=shadow node dist/index.js --run-all # one shot, all rules
 *   ALERT_MODE=shadow node dist/index.js --family readiness  # one rule family
 *   ALERT_MODE=live node dist/index.js             # scheduled live mode
 */
import { loadConfig, getStore } from './util/config.js';
import { logger } from './util/logger.js';
import { loadCooldowns } from './util/cooldown.js';
import { RulesEngine } from './rules/engine.js';
import { ReadinessRule } from './rules/readiness.js';
import { PrimeCostRule } from './rules/prime-cost.js';
import { ItemMarginRule } from './rules/item-margin.js';
import { VendorPriceRule } from './rules/vendor-price.js';
import { SalesPaceRule } from './rules/sales-pace.js';
import { LaborRule } from './rules/labor.js';
import { DiscountCompRule } from './rules/discount-comp.js';
import { StockoutRule } from './rules/stockout.js';
import { routeAlert } from './routing/channel-router.js';
import { formatAlert } from './routing/formatter.js';
import { createTaskForAlert } from './tasks/task-creator.js';
import { logAlert, getOpenAlerts } from './persistence/alert-log.js';
import { sendTeamsMessage } from './mcp/m365.js';
import { disconnectAll, healthCheck } from './mcp/client.js';
import { Scheduler } from './scheduler.js';
import { mkdirSync, existsSync } from 'fs';
// Ensure data and log directories exist
for (const dir of ['data', 'data/archive', 'logs']) {
    const fullPath = new URL(`../${dir}`, import.meta.url).pathname;
    if (!existsSync(fullPath)) {
        mkdirSync(fullPath, { recursive: true });
    }
}
async function handleAlert(alert, config) {
    const mode = config.rules.mode;
    // Always log
    await logAlert(alert);
    if (mode === 'shadow') {
        logger.info(`[SHADOW] Alert would fire`, {
            ruleId: alert.ruleId,
            severity: alert.severity,
            topic: alert.topic,
            audiences: alert.audiences,
        });
        return;
    }
    // Live mode: route, format, post, create tasks
    const routing = routeAlert(alert, config);
    // Format the message
    const html = formatAlert(alert);
    // Post to each routed channel
    for (const channel of routing.channels) {
        const result = await sendTeamsMessage(channel.teamId, channel.channelId, html);
        if (result) {
            alert.teamsMessageId = result.id ?? null;
            alert.teamsMessageUrl = result.webUrl ?? null;
            logger.info(`Posted alert to Teams channel`, {
                channel: channel.channelKey,
                messageId: result.id,
            });
        }
    }
    // Create task for red alerts
    if (routing.shouldCreateTask) {
        await createTaskForAlert(alert, routing.taskPlanId, config);
    }
    // Update the log with Teams/task references
    await logAlert(alert);
}
async function main() {
    logger.info('Remote Coffee Operations Engine starting');
    // Load configuration
    let config;
    try {
        config = loadConfig();
        logger.info(`Configuration loaded`, {
            mode: config.rules.mode,
            stores: config.stores.stores.length,
            owners: config.owners.owners.length,
        });
    }
    catch (err) {
        logger.error('Failed to load configuration', { error: String(err) });
        process.exit(1);
    }
    // Load cooldown state
    loadCooldowns();
    // Get default store
    const store = getStore(config);
    logger.info(`Operating on store: ${store.name} (${store.id})`);
    // Override mode from environment
    const envMode = process.env.ALERT_MODE;
    if (envMode && ['shadow', 'live', 'test'].includes(envMode)) {
        config.rules.mode = envMode;
        logger.info(`Mode overridden from environment: ${envMode}`);
    }
    // Build rules engine with alert handler in options
    const engine = new RulesEngine(config, {
        mode: config.rules.mode,
        onAlert: (alert) => handleAlert(alert, config),
    });
    // Register all rules
    engine.registerRule(new ReadinessRule());
    engine.registerRule(new PrimeCostRule());
    engine.registerRule(new ItemMarginRule());
    engine.registerRule(new VendorPriceRule());
    engine.registerRule(new SalesPaceRule());
    engine.registerRule(new LaborRule());
    engine.registerRule(new DiscountCompRule());
    engine.registerRule(new StockoutRule());
    // Parse CLI arguments
    const args = process.argv.slice(2);
    if (args.includes('--health')) {
        // Health check mode
        logger.info('Running health check');
        const results = await healthCheck();
        for (const [name, result] of Object.entries(results)) {
            logger.info(`${name}: ${result.status} (${result.message})`);
        }
        await disconnectAll();
        return;
    }
    if (args.includes('--run-all')) {
        // One shot: run all rules
        logger.info('Running all rules (one shot)');
        await engine.run(store.id);
        await disconnectAll();
        logger.info('One shot run complete');
        return;
    }
    const familyIdx = args.indexOf('--family');
    if (familyIdx !== -1 && args[familyIdx + 1]) {
        // One shot: run specific family
        const family = args[familyIdx + 1];
        logger.info(`Running rule family: ${family}`);
        const ruleIds = engine.listRules().filter(id => {
            // Convention: rule IDs contain or match the family name
            return id.includes(family) || id === family;
        });
        if (ruleIds.length === 0) {
            logger.error(`No rules found for family: ${family}`);
            await disconnectAll();
            process.exit(1);
        }
        await engine.run(store.id, ruleIds);
        await disconnectAll();
        logger.info(`Family run complete: ${family}`);
        return;
    }
    if (args.includes('--status')) {
        // Show open alerts
        const open = getOpenAlerts(store.id);
        logger.info(`Open alerts: ${open.length}`);
        for (const a of open) {
            logger.info(`  [${a.severity.toUpperCase()}] ${a.topic}: ${a.whatHappened}`);
        }
        return;
    }
    // Default: start scheduler
    const scheduler = new Scheduler(engine, config, store.id);
    scheduler.start();
    // Show schedule status
    const status = scheduler.getStatus();
    for (const s of status) {
        logger.info(`  ${s.name}: next run ${s.nextRun ?? 'unknown'}`);
    }
    logger.info(`Engine running in ${config.rules.mode} mode. Press Ctrl+C to stop.`);
    // Graceful shutdown
    const shutdown = async () => {
        logger.info('Shutting down...');
        scheduler.stop();
        await disconnectAll();
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}
main().catch(err => {
    logger.error('Fatal error', { error: String(err) });
    process.exit(1);
});
//# sourceMappingURL=index.js.map