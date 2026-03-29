/**
 * Teams message formatter.
 *
 * Produces consistent HTML messages for alerts, daily ops digests,
 * and weekly executive summaries. Uses HTML tags compatible with
 * the Microsoft Graph Teams channel message API (p, b, br, table,
 * tr, td). No markdown; Graph API channel messages require HTML.
 */
// ── Severity Display ──
const SEVERITY_LABEL = {
    green: '🟢 Green',
    yellow: '🟡 Yellow',
    red: '🔴 Red',
};
const SEVERITY_COLOR = {
    green: '#2ecc71',
    yellow: '#f1c40f',
    red: '#e74c3c',
};
// ── Single Alert Formatter ──
/**
 * Formats a NotificationEvent into an HTML message suitable for
 * posting to a Teams channel via the Graph API.
 */
export function formatAlert(alert) {
    const severityLabel = SEVERITY_LABEL[alert.severity];
    const severityColor = SEVERITY_COLOR[alert.severity];
    const metricsHtml = formatMetricsTable(alert.keyMetrics);
    const dueTimeText = alert.dueTime ?? 'Not specified';
    const linkHtml = alert.teamsMessageUrl
        ? `<p><b>Reference:</b> <a href="${escapeHtml(alert.teamsMessageUrl)}">View in Teams</a></p>`
        : '';
    const taskHtml = alert.taskUrl
        ? `<p><b>Task:</b> <a href="${escapeHtml(alert.taskUrl)}">View task in Planner</a></p>`
        : '';
    // Extract chart URLs from keyMetrics (keys starting with _chart)
    const chartHtml = Object.entries(alert.keyMetrics)
        .filter(([key]) => key.startsWith('_chart'))
        .map(([, url]) => `<p><img src="${escapeHtml(String(url))}" alt="Trend chart" width="400" height="200" /></p>`)
        .join('\n');
    return [
        `<p style="border-left: 4px solid ${severityColor}; padding-left: 8px;">`,
        `<b>${severityLabel}</b></p>`,
        `<p><b>Topic:</b> ${escapeHtml(alert.topic)}</p>`,
        `<p><b>Store:</b> ${escapeHtml(alert.storeId)}</p>`,
        `<p><b>Date / Time Window:</b> ${escapeHtml(alert.dateWindow)}</p>`,
        `<p><b>What Happened:</b> ${escapeHtml(alert.whatHappened)}</p>`,
        `<p><b>Why It Matters:</b> ${escapeHtml(alert.whyItMatters)}</p>`,
        metricsHtml,
        chartHtml,
        `<p><b>Recommended Action:</b> ${escapeHtml(alert.recommendedAction)}</p>`,
        `<p><b>Owner:</b> ${escapeHtml(alert.owner)}</p>`,
        `<p><b>Due:</b> ${escapeHtml(dueTimeText)}</p>`,
        linkHtml,
        taskHtml,
    ].join('\n');
}
// ── Daily Ops Digest Formatter ──
/**
 * Formats a daily operations digest covering the prior business day.
 * Includes sales, COGS, labor, prime cost, exceptions, and action items.
 */
export function formatDailyOpsDigest(digest) {
    const heading = `<p><b>📋 Daily Ops Digest: ${escapeHtml(digest.period)}</b></p>`;
    const storeInfo = `<p><b>Store:</b> ${escapeHtml(digest.storeId)}</p>`;
    const generatedAt = `<p><b>Generated:</b> ${escapeHtml(digest.generatedAt)}</p>`;
    const sectionsHtml = digest.sections
        .map(section => formatDigestSection(section))
        .join('\n<br/>\n');
    // Alert summary: group by severity
    const alertSummaryHtml = formatAlertSummary(digest.alerts);
    // Action items: list red and yellow alerts with recommended actions
    const actionItemsHtml = formatActionItems(digest.alerts);
    return [
        heading,
        storeInfo,
        generatedAt,
        '<br/>',
        sectionsHtml,
        '<br/>',
        alertSummaryHtml,
        '<br/>',
        actionItemsHtml,
    ].join('\n');
}
// ── Weekly Executive Summary Formatter ──
/**
 * Formats a weekly executive summary with wins, misses, biggest
 * exceptions, trend direction, recurring issues, owner scorecard,
 * and recommended next actions.
 */
export function formatWeeklyExecSummary(summary) {
    const heading = `<p><b>📊 Weekly Executive Summary: Week Ending ${escapeHtml(summary.weekEnding)}</b></p>`;
    const storeInfo = `<p><b>Store:</b> ${escapeHtml(summary.storeId)}</p>`;
    // Trend direction
    const trendEmoji = summary.trendDirection === 'improving'
        ? '📈'
        : summary.trendDirection === 'declining'
            ? '📉'
            : '➡️';
    const trendLabel = summary.trendDirection.charAt(0).toUpperCase()
        + summary.trendDirection.slice(1);
    const trendHtml = `<p><b>Trend:</b> ${trendEmoji} ${escapeHtml(trendLabel)}</p>`;
    // Key metrics table
    const metricsHtml = formatMetricsTable({
        'Total Net Sales': formatCurrency(summary.keyMetrics.totalNetSales),
        'Avg Daily Net Sales': formatCurrency(summary.keyMetrics.avgDailyNetSales),
        'Avg Prime Cost %': formatPercent(summary.keyMetrics.avgPrimeCostPercent),
        'Avg Labor %': formatPercent(summary.keyMetrics.avgLaborPercent),
        'Avg COGS %': formatPercent(summary.keyMetrics.avgCogsPercent),
        'Total Alerts Fired': summary.keyMetrics.totalAlertsFired,
        'Alerts Resolved': summary.keyMetrics.alertsResolved,
        'Alerts Still Open': summary.keyMetrics.alertsOpen,
    });
    // Wins
    const winsHtml = formatBulletList('Wins', summary.wins);
    // Misses
    const missesHtml = formatBulletList('Misses', summary.misses);
    // Biggest exceptions
    const exceptionsHtml = formatBulletList('Biggest Exceptions', summary.biggestExceptions);
    // Recurring issues
    const recurringHtml = formatBulletList('Recurring Issues', summary.recurringIssues);
    // Owner scorecard
    const scorecardHtml = formatOwnerScorecard(summary.ownerScorecard);
    // Recommended next actions
    const actionsHtml = formatBulletList('Recommended Next Actions', summary.recommendedActions);
    return [
        heading,
        storeInfo,
        trendHtml,
        '<br/>',
        metricsHtml,
        '<br/>',
        winsHtml,
        '<br/>',
        missesHtml,
        '<br/>',
        exceptionsHtml,
        '<br/>',
        recurringHtml,
        '<br/>',
        scorecardHtml,
        '<br/>',
        actionsHtml,
    ].join('\n');
}
// ── Task Created Notification ──
/**
 * Formats a short follow up message indicating that a Planner task
 * was created for a red alert.
 */
export function formatTaskCreatedNotice(alert, taskId, taskUrl) {
    const linkText = taskUrl
        ? `<a href="${escapeHtml(taskUrl)}">View Task</a>`
        : `Task ID: ${escapeHtml(taskId)}`;
    return [
        `<p>✅ <b>Task Created</b> for: ${escapeHtml(alert.topic)}</p>`,
        `<p><b>Severity:</b> ${SEVERITY_LABEL[alert.severity]}</p>`,
        `<p><b>Owner:</b> ${escapeHtml(alert.owner)}</p>`,
        `<p><b>Due:</b> ${escapeHtml(alert.dueTime ?? 'Not specified')}</p>`,
        `<p>${linkText}</p>`,
    ].join('\n');
}
// ── QuickChart.io Helpers ──
/**
 * Builds a QuickChart.io URL for a simple line chart.
 * Returns a URL that can be embedded as an <img> tag in Teams HTML messages.
 */
export function buildQuickChartUrl(labels, data, datasetLabel, opts) {
    const width = opts?.width ?? 400;
    const height = opts?.height ?? 200;
    const borderColor = opts?.borderColor ?? 'rgb(75, 192, 192)';
    const backgroundColor = opts?.backgroundColor ?? 'rgba(75, 192, 192, 0.2)';
    const chartConfig = {
        type: 'line',
        data: {
            labels,
            datasets: [
                {
                    label: datasetLabel,
                    data,
                    fill: true,
                    borderColor,
                    backgroundColor,
                    tension: 0.3,
                    pointRadius: 4,
                },
            ],
        },
        options: {
            plugins: {
                legend: { display: false },
            },
            scales: {
                y: { beginAtZero: false },
            },
        },
    };
    const encoded = encodeURIComponent(JSON.stringify(chartConfig));
    return `https://quickchart.io/chart?c=${encoded}&w=${width}&h=${height}&bkg=white`;
}
/**
 * Generates an HTML img tag for a revenue trend chart.
 * Returns empty string if insufficient data.
 */
export function buildRevenueTrendHtml(labels, revenues) {
    if (labels.length < 2 || revenues.length < 2)
        return '';
    const url = buildQuickChartUrl(labels, revenues, 'Net Revenue ($)', {
        borderColor: 'rgb(46, 204, 113)',
        backgroundColor: 'rgba(46, 204, 113, 0.15)',
    });
    return `<p><b>Revenue Trend (Last ${labels.length} Days):</b></p><p><img src="${escapeHtml(url)}" alt="Revenue trend chart" width="400" height="200" /></p>`;
}
/**
 * Generates an HTML img tag for a drive thru speed trend chart.
 * Returns empty string if insufficient data.
 */
export function buildDriveThruTrendHtml(labels, avgSeconds) {
    if (labels.length < 2 || avgSeconds.length < 2)
        return '';
    const url = buildQuickChartUrl(labels, avgSeconds, 'Avg DT Seconds', {
        borderColor: 'rgb(52, 152, 219)',
        backgroundColor: 'rgba(52, 152, 219, 0.15)',
    });
    return `<p><b>Drive Thru Speed Trend (Last ${labels.length} Days):</b></p><p><img src="${escapeHtml(url)}" alt="Drive thru speed trend chart" width="400" height="200" /></p>`;
}
// ── Private Helpers ──
/**
 * Renders a Record of key/value pairs as an HTML table.
 * Skips entries whose keys start with '_chart' (used for chart URLs).
 */
function formatMetricsTable(metrics) {
    const entries = Object.entries(metrics).filter(([key]) => !key.startsWith('_chart'));
    if (entries.length === 0)
        return '';
    const rows = entries
        .map(([key, value]) => `<tr><td style="padding: 2px 8px;"><b>${escapeHtml(key)}</b></td>` +
        `<td style="padding: 2px 8px;">${escapeHtml(String(value))}</td></tr>`)
        .join('\n');
    return [
        '<p><b>Key Metrics:</b></p>',
        '<table style="border-collapse: collapse;">',
        rows,
        '</table>',
    ].join('\n');
}
/**
 * Renders a DigestSection as HTML with title, content, and metrics.
 */
function formatDigestSection(section) {
    const title = `<p><b>${escapeHtml(section.title)}</b></p>`;
    const content = `<p>${escapeHtml(section.content)}</p>`;
    const metrics = Object.entries(section.metrics);
    if (metrics.length === 0) {
        return [title, content].join('\n');
    }
    const rows = metrics
        .map(([key, value]) => `<tr><td style="padding: 2px 8px;">${escapeHtml(key)}</td>` +
        `<td style="padding: 2px 8px;">${escapeHtml(String(value))}</td></tr>`)
        .join('\n');
    const table = [
        '<table style="border-collapse: collapse;">',
        rows,
        '</table>',
    ].join('\n');
    return [title, content, table].join('\n');
}
/**
 * Summarizes alerts grouped by severity.
 */
function formatAlertSummary(alerts) {
    if (alerts.length === 0) {
        return '<p><b>Alerts:</b> None fired during this period.</p>';
    }
    const redCount = alerts.filter(a => a.severity === 'red').length;
    const yellowCount = alerts.filter(a => a.severity === 'yellow').length;
    const greenCount = alerts.filter(a => a.severity === 'green').length;
    return [
        '<p><b>Alert Summary:</b></p>',
        '<table style="border-collapse: collapse;">',
        `<tr><td style="padding: 2px 8px;">🔴 Red</td><td style="padding: 2px 8px;">${redCount}</td></tr>`,
        `<tr><td style="padding: 2px 8px;">🟡 Yellow</td><td style="padding: 2px 8px;">${yellowCount}</td></tr>`,
        `<tr><td style="padding: 2px 8px;">🟢 Green</td><td style="padding: 2px 8px;">${greenCount}</td></tr>`,
        '</table>',
    ].join('\n');
}
/**
 * Lists recommended actions from red and yellow alerts.
 */
function formatActionItems(alerts) {
    const actionable = alerts.filter(a => a.severity === 'red' || a.severity === 'yellow');
    if (actionable.length === 0) {
        return '<p><b>Action Items:</b> None at this time.</p>';
    }
    const items = actionable
        .map(a => `<tr>` +
        `<td style="padding: 2px 8px;">${SEVERITY_LABEL[a.severity]}</td>` +
        `<td style="padding: 2px 8px;">${escapeHtml(a.topic)}</td>` +
        `<td style="padding: 2px 8px;">${escapeHtml(a.recommendedAction)}</td>` +
        `<td style="padding: 2px 8px;">${escapeHtml(a.owner)}</td>` +
        `</tr>`)
        .join('\n');
    return [
        '<p><b>Action Items:</b></p>',
        '<table style="border-collapse: collapse;">',
        '<tr><td style="padding: 2px 8px;"><b>Severity</b></td>' +
            '<td style="padding: 2px 8px;"><b>Topic</b></td>' +
            '<td style="padding: 2px 8px;"><b>Action</b></td>' +
            '<td style="padding: 2px 8px;"><b>Owner</b></td></tr>',
        items,
        '</table>',
    ].join('\n');
}
/**
 * Renders a titled bullet list as HTML paragraphs.
 */
function formatBulletList(title, items) {
    if (items.length === 0) {
        return `<p><b>${escapeHtml(title)}:</b> None.</p>`;
    }
    const listItems = items
        .map(item => `• ${escapeHtml(item)}`)
        .join('<br/>');
    return `<p><b>${escapeHtml(title)}:</b><br/>${listItems}</p>`;
}
/**
 * Renders the owner scorecard as an HTML table.
 */
function formatOwnerScorecard(entries) {
    if (entries.length === 0) {
        return '<p><b>Owner Scorecard:</b> No data.</p>';
    }
    const header = [
        '<tr>',
        '<td style="padding: 2px 8px;"><b>Owner</b></td>',
        '<td style="padding: 2px 8px;"><b>Assigned</b></td>',
        '<td style="padding: 2px 8px;"><b>Resolved</b></td>',
        '<td style="padding: 2px 8px;"><b>Open</b></td>',
        '<td style="padding: 2px 8px;"><b>Avg Resolution (hrs)</b></td>',
        '</tr>',
    ].join('');
    const rows = entries
        .map(entry => {
        const avgHrs = entry.avgResolutionHours !== null
            ? entry.avgResolutionHours.toFixed(1)
            : 'N/A';
        return [
            '<tr>',
            `<td style="padding: 2px 8px;">${escapeHtml(entry.ownerName)}</td>`,
            `<td style="padding: 2px 8px;">${entry.alertsAssigned}</td>`,
            `<td style="padding: 2px 8px;">${entry.alertsResolved}</td>`,
            `<td style="padding: 2px 8px;">${entry.alertsOpen}</td>`,
            `<td style="padding: 2px 8px;">${avgHrs}</td>`,
            '</tr>',
        ].join('');
    })
        .join('\n');
    return [
        '<p><b>Owner Scorecard:</b></p>',
        '<table style="border-collapse: collapse;">',
        header,
        rows,
        '</table>',
    ].join('\n');
}
/**
 * Formats a number as a currency string (USD).
 */
function formatCurrency(value) {
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
/**
 * Formats a decimal ratio as a percentage string.
 * Input of 0.32 becomes "32.0%".
 */
function formatPercent(value) {
    return `${(value * 100).toFixed(1)}%`;
}
/**
 * Escapes HTML special characters for safe embedding in Teams messages.
 */
function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
//# sourceMappingURL=formatter.js.map