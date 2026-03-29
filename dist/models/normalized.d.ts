/**
 * Normalized data models for Remote Coffee operations engine.
 *
 * These models decouple rule logic from raw MCP tool response shapes.
 * Each model represents a unified internal view of operational data
 * regardless of which source system provided it.
 */
export type Severity = 'green' | 'yellow' | 'red';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved' | 'escalated';
export type AlertMode = 'shadow' | 'live' | 'test';
export type Audience = 'exec' | 'ops' | 'finance' | 'marketing';
export declare const SEVERITY_ORDER: Record<Severity, number>;
export interface Store {
    id: string;
    name: string;
    toastGuid: string;
    marginedgeId: number;
    timezone: string;
}
export interface DailySales {
    storeId: string;
    businessDate: string;
    netSales: number;
    grossSales: number;
    orderCount: number;
    avgTicket: number;
    /** Breakdown by dining option / channel */
    channels: ChannelSales[];
    /** Breakdown by daypart if available */
    dayparts: DaypartSales[];
    source: 'toast';
    fetchedAt: string;
}
export interface ChannelSales {
    channelName: string;
    channelGuid: string;
    orderCount: number;
    netSales: number;
}
export interface DaypartSales {
    daypart: string;
    hourStart: number;
    hourEnd: number;
    orderCount: number;
    netSales: number;
}
export interface LaborSummary {
    storeId: string;
    businessDate: string;
    totalLaborCost: number;
    totalLaborHours: number;
    laborPercent: number;
    /** Breakdown by daypart if available */
    dayparts: DaypartLabor[];
    overtimeHours: number;
    source: 'toast' | 'manual';
    fetchedAt: string;
    /** Flag when labor data is estimated or unavailable */
    estimated: boolean;
}
export interface DaypartLabor {
    daypart: string;
    laborCost: number;
    laborHours: number;
    laborPercent: number;
}
export interface ItemMix {
    storeId: string;
    businessDate: string;
    items: ItemMixEntry[];
    source: 'toast';
    fetchedAt: string;
}
export interface ItemMixEntry {
    itemGuid: string;
    itemName: string;
    menuGroup: string;
    quantity: number;
    grossRevenue: number;
    netRevenue: number;
    /** Percentage of total units sold */
    mixPercent: number;
    /** Percentage of total revenue */
    revenuePercent: number;
}
export interface ItemMargin {
    storeId: string;
    asOfDate: string;
    items: ItemMarginEntry[];
    source: 'computed';
    fetchedAt: string;
}
export interface ItemMarginEntry {
    itemGuid: string;
    itemName: string;
    menuPrice: number;
    estimatedCost: number;
    marginDollars: number;
    marginPercent: number;
    /** Whether cost is fully mapped or estimated */
    costComplete: boolean;
    /** Volume from recent period for prioritization */
    recentVolume: number;
    /** Revenue contribution rank */
    contributionRank: number;
}
export interface InvoiceStatus {
    storeId: string;
    dateRange: {
        start: string;
        end: string;
    };
    totalInvoices: number;
    totalValue: number;
    byStatus: InvoiceStatusBucket[];
    closedCount: number;
    closedPercent: number;
    openCount: number;
    pendingReviewCount: number;
    source: 'marginedge';
    fetchedAt: string;
}
export interface InvoiceStatusBucket {
    status: string;
    count: number;
    value: number;
}
export interface RecipeStatus {
    storeId: string;
    asOfDate: string;
    totalActiveMenuItems: number;
    itemsWithCompleteRecipe: number;
    itemsMissingRecipe: number;
    recipeCoveragePercent: number;
    /** Items missing recipe details */
    missingItems: {
        itemGuid: string;
        itemName: string;
        menuPrice: number;
    }[];
    source: 'computed';
    fetchedAt: string;
}
export interface VendorPriceChange {
    storeId: string;
    detectedDate: string;
    changes: VendorPriceChangeEntry[];
    source: 'marginedge';
    fetchedAt: string;
}
export interface VendorPriceChangeEntry {
    vendorId: string;
    vendorName: string;
    productId: string;
    productName: string;
    vendorItemCode: string;
    previousPrice: number;
    currentPrice: number;
    changePercent: number;
    changeDirection: 'up' | 'down';
    /** Affected menu items if cross-reference is available */
    affectedMenuItems: string[];
}
export interface DiscountSummary {
    storeId: string;
    businessDate: string;
    totalDiscounts: number;
    discountPercent: number;
    discountCount: number;
    /** Breakdown by discount type if available */
    byType: DiscountEntry[];
    source: 'toast';
    fetchedAt: string;
}
export interface DiscountEntry {
    name: string;
    amount: number;
    count: number;
}
export interface VoidsRefundsComps {
    storeId: string;
    businessDate: string;
    voidCount: number;
    voidAmount: number;
    voidPercent: number;
    refundCount: number;
    refundAmount: number;
    refundPercent: number;
    compCount: number;
    compAmount: number;
    compPercent: number;
    totalExceptionAmount: number;
    totalExceptionPercent: number;
    source: 'toast';
    fetchedAt: string;
}
export interface StockoutOrDisabledItem {
    storeId: string;
    detectedDate: string;
    items: StockoutEntry[];
    source: 'toast';
    fetchedAt: string;
}
export interface StockoutEntry {
    itemGuid: string;
    itemName: string;
    menuGroup: string;
    menuPrice: number;
    /** Estimated daily revenue impact based on recent volume */
    estimatedDailyRevenueLoss: number;
    /** Whether item is currently visible on menu */
    visible: boolean;
    reason: 'disabled' | '86d' | 'hidden' | 'unknown';
}
export interface InventoryCountStatus {
    storeId: string;
    asOfDate: string;
    lastCountDate: string | null;
    daysSinceLastCount: number | null;
    /** Whether count is current per configured threshold */
    countCurrent: boolean;
    source: 'marginedge' | 'manual';
    fetchedAt: string;
}
export interface ExceptionEvent {
    id: string;
    storeId: string;
    timestamp: string;
    category: string;
    description: string;
    amount: number | null;
    severity: Severity;
    source: 'toast' | 'marginedge' | 'computed';
}
export interface NotificationEvent {
    id: string;
    ruleId: string;
    ruleName: string;
    storeId: string;
    severity: Severity;
    topic: string;
    dateWindow: string;
    whatHappened: string;
    whyItMatters: string;
    keyMetrics: Record<string, string | number>;
    recommendedAction: string;
    owner: string;
    dueTime: string | null;
    audiences: Audience[];
    channels: string[];
    status: AlertStatus;
    createdAt: string;
    acknowledgedAt: string | null;
    resolvedAt: string | null;
    escalatedAt: string | null;
    /** Reference to Planner task if created */
    taskId: string | null;
    taskUrl: string | null;
    /** Reference to Teams message if posted */
    teamsMessageId: string | null;
    teamsMessageUrl: string | null;
    /** For dedup / cooldown */
    fingerprint: string;
    /** Whether this was generated in shadow mode */
    shadowMode: boolean;
}
export interface OwnerAssignment {
    ownerId: string;
    ownerName: string;
    email: string;
    /** Microsoft 365 user ID for task assignment */
    m365UserId: string | null;
    roles: Audience[];
    /** Areas of responsibility */
    domains: string[];
}
export interface ReadinessScore {
    storeId: string;
    asOfDate: string;
    overallScore: number;
    components: ReadinessComponent[];
    missingDetails: ReadinessMissing[];
    source: 'computed';
    fetchedAt: string;
}
export interface ReadinessComponent {
    name: string;
    weight: number;
    score: number;
    maxScore: number;
    details: string;
}
export interface ReadinessMissing {
    component: string;
    items: string[];
    count: number;
}
export interface PrimeCostSummary {
    storeId: string;
    businessDate: string;
    netSales: number;
    cogs: number;
    cogsPercent: number;
    laborCost: number;
    laborPercent: number;
    primeCost: number;
    primeCostPercent: number;
    avgTicket: number;
    orderCount: number;
    /** Variance vs configured targets */
    varianceVsTarget: {
        cogsVariance: number;
        laborVariance: number;
        primeCostVariance: number;
        salesVariance: number;
    };
    /** Variance vs trailing weekday average */
    varianceVsTrailing: {
        cogsVariance: number;
        laborVariance: number;
        primeCostVariance: number;
        salesVariance: number;
        trailingPeriodDays: number;
    } | null;
    source: 'computed';
    fetchedAt: string;
}
export interface WeeklyExecutiveSummary {
    storeId: string;
    weekEnding: string;
    wins: string[];
    misses: string[];
    biggestExceptions: string[];
    trendDirection: 'improving' | 'stable' | 'declining';
    recurringIssues: string[];
    ownerScorecard: OwnerScorecardEntry[];
    recommendedActions: string[];
    keyMetrics: {
        totalNetSales: number;
        avgDailyNetSales: number;
        avgPrimeCostPercent: number;
        avgLaborPercent: number;
        avgCogsPercent: number;
        totalAlertsFired: number;
        alertsResolved: number;
        alertsOpen: number;
    };
}
export interface OwnerScorecardEntry {
    ownerName: string;
    alertsAssigned: number;
    alertsResolved: number;
    alertsOpen: number;
    avgResolutionHours: number | null;
}
export interface RuleDefinition {
    id: string;
    name: string;
    family: string;
    description: string;
    enabled: boolean;
    schedule: string;
    audiences: Audience[];
    defaultSeverity: Severity;
    escalationSeverity: Severity;
    cooldownMinutes: number;
    /** Config key references for thresholds */
    thresholdKeys: string[];
}
export interface AlertDigest {
    digestType: 'daily_ops' | 'daily_finance' | 'weekly_exec';
    storeId: string;
    period: string;
    generatedAt: string;
    sections: DigestSection[];
    alerts: NotificationEvent[];
}
export interface DigestSection {
    title: string;
    content: string;
    metrics: Record<string, string | number>;
}
