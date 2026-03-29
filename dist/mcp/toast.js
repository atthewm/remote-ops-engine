/**
 * Toast MCP data fetcher.
 * Calls Toast MCP tools and returns normalized models for the ops engine.
 */
import { callTool } from './client.js';
import { logger } from '../util/logger.js';
// ─── Daypart classification ───
const DAYPARTS = [
    { name: 'morning', hourStart: 6, hourEnd: 11 },
    { name: 'lunch', hourStart: 11, hourEnd: 14 },
    { name: 'afternoon', hourStart: 14, hourEnd: 17 },
    { name: 'evening', hourStart: 17, hourEnd: 22 },
];
function classifyDaypart(isoTimestamp) {
    const hour = new Date(isoTimestamp).getHours();
    for (const dp of DAYPARTS) {
        if (hour >= dp.hourStart && hour < dp.hourEnd)
            return dp.name;
    }
    return 'other';
}
// ─── Daily Sales ───
export async function fetchDailySales(storeId, businessDate) {
    logger.info('Fetching Toast daily sales', { storeId, businessDate });
    const orders = await fetchOrders(storeId, businessDate);
    let grossSales = 0;
    let netSales = 0;
    const channelMap = new Map();
    const daypartMap = new Map();
    for (const order of orders) {
        if (order.voided)
            continue;
        const orderTotal = order.totalAmount ?? order.amount ?? 0;
        grossSales += orderTotal;
        // Compute net from checks
        let orderNet = 0;
        for (const check of order.checks ?? []) {
            orderNet += check.netAmount ?? check.totalAmount ?? check.amount ?? 0;
        }
        netSales += orderNet;
        // Channel breakdown
        const channelGuid = order.diningOption?.guid ?? 'unknown';
        const channelName = order.diningOption?.name ?? 'Unknown';
        const existing = channelMap.get(channelGuid) ?? {
            channelName,
            channelGuid,
            orderCount: 0,
            netSales: 0,
        };
        existing.orderCount += 1;
        existing.netSales += orderNet;
        channelMap.set(channelGuid, existing);
        // Daypart breakdown
        const dpName = order.openedDate ? classifyDaypart(order.openedDate) : 'other';
        const dpData = daypartMap.get(dpName) ?? { orderCount: 0, netSales: 0 };
        dpData.orderCount += 1;
        dpData.netSales += orderNet;
        daypartMap.set(dpName, dpData);
    }
    const nonVoidedOrders = orders.filter(o => !o.voided);
    const orderCount = nonVoidedOrders.length;
    const channels = Array.from(channelMap.values());
    const dayparts = DAYPARTS.map(dp => {
        const data = daypartMap.get(dp.name);
        return {
            daypart: dp.name,
            hourStart: dp.hourStart,
            hourEnd: dp.hourEnd,
            orderCount: data?.orderCount ?? 0,
            netSales: data?.netSales ?? 0,
        };
    });
    // Include "other" daypart if present
    const otherDp = daypartMap.get('other');
    if (otherDp && otherDp.orderCount > 0) {
        dayparts.push({
            daypart: 'other',
            hourStart: 0,
            hourEnd: 24,
            orderCount: otherDp.orderCount,
            netSales: otherDp.netSales,
        });
    }
    return {
        storeId,
        businessDate,
        netSales: Math.round(netSales * 100) / 100,
        grossSales: Math.round(grossSales * 100) / 100,
        orderCount,
        avgTicket: orderCount > 0 ? Math.round((netSales / orderCount) * 100) / 100 : 0,
        channels,
        dayparts,
        source: 'toast',
        fetchedAt: new Date().toISOString(),
    };
}
// ─── Raw Orders ───
/**
 * Fetches orders for a given business date from Toast.
 * Always requests all order details via fetchAll so totals are accurate.
 */
export async function fetchOrders(storeId, businessDate) {
    logger.info('Fetching Toast orders', { storeId, businessDate });
    const args = {
        businessDate,
        fetchAll: true,
    };
    const raw = await callTool('toast', 'toast_list_orders', args);
    const orders = Array.isArray(raw) ? raw : (raw?.orders ?? []);
    logger.info(`Fetched ${orders.length} orders for ${businessDate}`);
    return orders;
}
// ─── Item Mix ───
/**
 * Aggregates item selections from order checks to produce a mix report.
 * Groups by item GUID and computes quantity, revenue, and mix percentages.
 */
export function computeItemMix(storeId, orders, businessDate) {
    logger.info('Computing item mix from orders', { storeId, orderCount: orders.length });
    const itemMap = new Map();
    let totalQuantity = 0;
    let totalNetRevenue = 0;
    for (const order of orders) {
        if (order.voided)
            continue;
        for (const check of order.checks ?? []) {
            for (const sel of check.selections ?? []) {
                if (sel.voided)
                    continue;
                const itemGuid = sel.item?.guid ?? sel.itemGuid ?? sel.guid ?? 'unknown';
                const itemName = sel.displayName ?? sel.item?.name ?? 'Unknown Item';
                const menuGroup = sel.itemGroup?.name ?? 'Ungrouped';
                const quantity = sel.quantity ?? 1;
                const grossPrice = (sel.preDiscountPrice ?? sel.price ?? 0) * quantity;
                const netPrice = (sel.price ?? 0) * quantity;
                const existing = itemMap.get(itemGuid) ?? {
                    itemGuid,
                    itemName,
                    menuGroup,
                    quantity: 0,
                    grossRevenue: 0,
                    netRevenue: 0,
                };
                existing.quantity += quantity;
                existing.grossRevenue += grossPrice;
                existing.netRevenue += netPrice;
                itemMap.set(itemGuid, existing);
                totalQuantity += quantity;
                totalNetRevenue += netPrice;
            }
        }
    }
    const items = Array.from(itemMap.values())
        .map(entry => ({
        ...entry,
        grossRevenue: Math.round(entry.grossRevenue * 100) / 100,
        netRevenue: Math.round(entry.netRevenue * 100) / 100,
        mixPercent: totalQuantity > 0
            ? Math.round((entry.quantity / totalQuantity) * 10000) / 10000
            : 0,
        revenuePercent: totalNetRevenue > 0
            ? Math.round((entry.netRevenue / totalNetRevenue) * 10000) / 10000
            : 0,
    }))
        .sort((a, b) => b.netRevenue - a.netRevenue);
    logger.info(`Item mix computed: ${items.length} unique items`);
    return {
        storeId,
        businessDate,
        items,
        source: 'toast',
        fetchedAt: new Date().toISOString(),
    };
}
// ─── Discount Summary ───
/**
 * Extracts discount data from order checks and produces a summary.
 * Groups discounts by name and computes totals and percentages vs net sales.
 */
export function computeDiscountSummary(storeId, orders, netSales, businessDate) {
    logger.info('Computing discount summary', { storeId, orderCount: orders.length });
    const discountMap = new Map();
    let totalDiscounts = 0;
    let discountCount = 0;
    for (const order of orders) {
        if (order.voided)
            continue;
        for (const check of order.checks ?? []) {
            // Check level discounts
            for (const disc of check.appliedDiscounts ?? []) {
                const name = disc.name ?? disc.discount?.name ?? 'Unknown Discount';
                const amount = disc.discountAmount ?? 0;
                if (amount === 0)
                    continue;
                totalDiscounts += Math.abs(amount);
                discountCount += 1;
                const existing = discountMap.get(name) ?? { amount: 0, count: 0 };
                existing.amount += Math.abs(amount);
                existing.count += 1;
                discountMap.set(name, existing);
            }
            // Selection level discounts
            for (const sel of check.selections ?? []) {
                for (const disc of sel.appliedDiscounts ?? []) {
                    const name = disc.name ?? disc.discount?.name ?? 'Unknown Discount';
                    const amount = disc.discountAmount ?? 0;
                    if (amount === 0)
                        continue;
                    totalDiscounts += Math.abs(amount);
                    discountCount += 1;
                    const existing = discountMap.get(name) ?? { amount: 0, count: 0 };
                    existing.amount += Math.abs(amount);
                    existing.count += 1;
                    discountMap.set(name, existing);
                }
            }
        }
    }
    const byType = Array.from(discountMap.entries())
        .map(([name, data]) => ({
        name,
        amount: Math.round(data.amount * 100) / 100,
        count: data.count,
    }))
        .sort((a, b) => b.amount - a.amount);
    return {
        storeId,
        businessDate,
        totalDiscounts: Math.round(totalDiscounts * 100) / 100,
        discountPercent: netSales > 0 ? Math.round((totalDiscounts / netSales) * 10000) / 10000 : 0,
        discountCount,
        byType,
        source: 'toast',
        fetchedAt: new Date().toISOString(),
    };
}
// ─── Voids, Refunds, Comps ───
/**
 * Detects voided orders and computes void, refund, and comp totals.
 * Voided orders are those with the voided flag set.
 * Refunds are detected from selection level refund fields.
 * Comps are detected from discounts with names containing "comp".
 */
export function computeVoidsRefundsComps(storeId, orders, netSales, businessDate) {
    logger.info('Computing voids, refunds, and comps', { storeId, orderCount: orders.length });
    let voidCount = 0;
    let voidAmount = 0;
    let refundCount = 0;
    let refundAmount = 0;
    let compCount = 0;
    let compAmount = 0;
    for (const order of orders) {
        // Voided orders
        if (order.voided) {
            voidCount += 1;
            voidAmount += order.totalAmount ?? order.amount ?? 0;
            continue;
        }
        for (const check of order.checks ?? []) {
            for (const sel of check.selections ?? []) {
                // Refunds from selection data
                if (sel.refund && sel.refund.refundAmount) {
                    refundCount += 1;
                    refundAmount += Math.abs(sel.refund.refundAmount);
                }
                // Comps from discounts containing "comp" in the name
                for (const disc of sel.appliedDiscounts ?? []) {
                    const discName = (disc.name ?? disc.discount?.name ?? '').toLowerCase();
                    if (discName.includes('comp')) {
                        compCount += 1;
                        compAmount += Math.abs(disc.discountAmount ?? 0);
                    }
                }
            }
            // Check level comps
            for (const disc of check.appliedDiscounts ?? []) {
                const discName = (disc.name ?? disc.discount?.name ?? '').toLowerCase();
                if (discName.includes('comp')) {
                    compCount += 1;
                    compAmount += Math.abs(disc.discountAmount ?? 0);
                }
            }
        }
    }
    voidAmount = Math.round(voidAmount * 100) / 100;
    refundAmount = Math.round(refundAmount * 100) / 100;
    compAmount = Math.round(compAmount * 100) / 100;
    const totalExceptionAmount = voidAmount + refundAmount + compAmount;
    return {
        storeId,
        businessDate,
        voidCount,
        voidAmount,
        voidPercent: netSales > 0 ? Math.round((voidAmount / netSales) * 10000) / 10000 : 0,
        refundCount,
        refundAmount,
        refundPercent: netSales > 0 ? Math.round((refundAmount / netSales) * 10000) / 10000 : 0,
        compCount,
        compAmount,
        compPercent: netSales > 0 ? Math.round((compAmount / netSales) * 10000) / 10000 : 0,
        totalExceptionAmount: Math.round(totalExceptionAmount * 100) / 100,
        totalExceptionPercent: netSales > 0
            ? Math.round((totalExceptionAmount / netSales) * 10000) / 10000
            : 0,
        source: 'toast',
        fetchedAt: new Date().toISOString(),
    };
}
// ─── Labor Summary ───
/**
 * Fetches labor data for a given business date from Toast.
 * Returns a normalized LaborSummary with hours, cost, overtime, and tips.
 */
export async function fetchLaborSummary(storeId, businessDate, netSales) {
    logger.info('Fetching Toast labor data', { storeId, businessDate });
    const raw = await callTool('toast', 'toast_list_shifts', { businessDate });
    if (!raw?.laborSummary) {
        logger.warn('No labor data returned from Toast', { storeId, businessDate });
        return {
            storeId,
            businessDate,
            totalLaborCost: 0,
            totalLaborHours: 0,
            laborPercent: 0,
            dayparts: [],
            overtimeHours: 0,
            source: 'toast',
            fetchedAt: new Date().toISOString(),
            estimated: true,
        };
    }
    const ls = raw.laborSummary;
    const totalLaborCost = ls.totalLaborCost ?? 0;
    const totalHours = ls.totalHours ?? 0;
    const overtimeHours = ls.totalOvertimeHours ?? 0;
    const laborPercent = netSales > 0 ? totalLaborCost / netSales : 0;
    // Build daypart breakdown from time entries if available
    const dayparts = [];
    const entries = raw.actual?.timeEntries ?? [];
    if (entries.length > 0) {
        const dpMap = new Map();
        for (const entry of entries) {
            if (!entry.clockIn)
                continue;
            const dpName = classifyDaypart(entry.clockIn);
            const hours = (entry.regularHours ?? 0) + (entry.overtimeHours ?? 0);
            const cost = entry.laborCost ?? 0;
            const sales = entry.sales ?? 0;
            const existing = dpMap.get(dpName) ?? { cost: 0, hours: 0, sales: 0 };
            existing.cost += cost;
            existing.hours += hours;
            existing.sales += sales;
            dpMap.set(dpName, existing);
        }
        for (const [dpName, data] of dpMap) {
            dayparts.push({
                daypart: dpName,
                laborCost: Math.round(data.cost * 100) / 100,
                laborHours: Math.round(data.hours * 100) / 100,
                laborPercent: data.sales > 0 ? Math.round((data.cost / data.sales) * 10000) / 10000 : 0,
            });
        }
    }
    logger.info(`Labor data: $${totalLaborCost.toFixed(2)}, ${totalHours.toFixed(1)}h, ${overtimeHours.toFixed(1)}h OT`);
    return {
        storeId,
        businessDate,
        totalLaborCost: Math.round(totalLaborCost * 100) / 100,
        totalLaborHours: Math.round(totalHours * 100) / 100,
        laborPercent: Math.round(laborPercent * 10000) / 10000,
        dayparts,
        overtimeHours: Math.round(overtimeHours * 100) / 100,
        source: 'toast',
        fetchedAt: new Date().toISOString(),
        estimated: false,
    };
}
// ─── Menu Items ───
export async function fetchMenuItems(storeId) {
    logger.info('Fetching Toast menu items', { storeId });
    const raw = await callTool('toast', 'toast_menus', {});
    // Toast menus endpoint returns { menus: [...] } with nested groups and items
    if (Array.isArray(raw)) {
        return raw;
    }
    const items = [];
    for (const menu of raw?.menus ?? []) {
        for (const group of menu.groups ?? []) {
            for (const item of group.items ?? []) {
                items.push(item);
            }
        }
    }
    logger.info(`Fetched ${items.length} menu items from Toast`);
    return items;
}
// ─── Disabled / 86'd Items ───
/**
 * Detects menu items that are currently disabled or hidden.
 * Compares menu item visibility flags to identify items not available for sale.
 * Revenue loss estimation requires recent sales data (passed as context or
 * computed separately).
 */
export function detectDisabledItems(storeId, menuItems, recentItemMix) {
    logger.info('Detecting disabled menu items', { storeId, itemCount: menuItems.length });
    const entries = [];
    for (const item of menuItems) {
        if (item.isDeleted)
            continue;
        const isVisible = item.isVisible !== false;
        const visibilityFlags = item.visibility ?? [];
        const isHidden = visibilityFlags.length > 0 &&
            visibilityFlags.every(v => v.toLowerCase() === 'none' || v.toLowerCase() === 'hidden');
        if (isVisible && !isHidden)
            continue;
        // Determine the reason
        let reason = 'unknown';
        if (item.isVisible === false) {
            reason = 'disabled';
        }
        else if (isHidden) {
            reason = 'hidden';
        }
        // Estimate daily revenue loss from recent item mix if available
        let estimatedDailyRevenueLoss = 0;
        if (recentItemMix) {
            const mixEntry = recentItemMix.items.find(m => m.itemGuid === item.guid);
            if (mixEntry) {
                estimatedDailyRevenueLoss = mixEntry.netRevenue;
            }
        }
        entries.push({
            itemGuid: item.guid ?? 'unknown',
            itemName: item.name ?? 'Unknown Item',
            menuGroup: item.menuGroup?.name ?? 'Unknown',
            menuPrice: item.price ?? 0,
            estimatedDailyRevenueLoss: Math.round(estimatedDailyRevenueLoss * 100) / 100,
            visible: false,
            reason,
        });
    }
    // Sort by estimated revenue loss descending
    entries.sort((a, b) => b.estimatedDailyRevenueLoss - a.estimatedDailyRevenueLoss);
    logger.info(`Found ${entries.length} disabled or hidden items`);
    return {
        storeId,
        detectedDate: new Date().toISOString().slice(0, 10),
        items: entries,
        source: 'toast',
        fetchedAt: new Date().toISOString(),
    };
}
//# sourceMappingURL=toast.js.map