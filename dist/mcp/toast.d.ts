/**
 * Toast MCP data fetcher.
 * Calls Toast MCP tools and returns normalized models for the ops engine.
 */
import type { DailySales, LaborSummary, ItemMix, DiscountSummary, VoidsRefundsComps, StockoutOrDisabledItem } from '../models/normalized.js';
interface RawOrder {
    guid?: string;
    entityType?: string;
    openedDate?: string;
    closedDate?: string;
    diningOption?: {
        guid?: string;
        name?: string;
    } | null;
    voided?: boolean;
    voidDate?: string;
    amount?: number;
    totalAmount?: number;
    checks?: RawCheck[];
    [key: string]: unknown;
}
interface RawCheck {
    guid?: string;
    amount?: number;
    totalAmount?: number;
    netAmount?: number;
    selections?: RawSelection[];
    appliedDiscounts?: RawAppliedDiscount[];
    [key: string]: unknown;
}
interface RawSelection {
    guid?: string;
    itemGuid?: string;
    item?: {
        guid?: string;
        name?: string;
        entityType?: string;
    };
    displayName?: string;
    itemGroup?: {
        guid?: string;
        name?: string;
    };
    quantity?: number;
    price?: number;
    preDiscountPrice?: number;
    voided?: boolean;
    deselectedModifiers?: unknown[];
    appliedDiscounts?: RawAppliedDiscount[];
    refund?: {
        refundAmount?: number;
    } | null;
    [key: string]: unknown;
}
interface RawAppliedDiscount {
    name?: string;
    discountAmount?: number;
    discount?: {
        guid?: string;
        name?: string;
    };
    appliedPromoCode?: string;
    [key: string]: unknown;
}
interface RawMenuItem {
    guid?: string;
    name?: string;
    price?: number;
    visibility?: string[];
    isVisible?: boolean;
    isDeleted?: boolean;
    menuGroup?: {
        guid?: string;
        name?: string;
    };
    [key: string]: unknown;
}
export declare function fetchDailySales(storeId: string, businessDate: string): Promise<DailySales>;
/**
 * Fetches orders for a given business date from Toast.
 * Always requests all order details via fetchAll so totals are accurate.
 */
export declare function fetchOrders(storeId: string, businessDate: string): Promise<RawOrder[]>;
/**
 * Aggregates item selections from order checks to produce a mix report.
 * Groups by item GUID and computes quantity, revenue, and mix percentages.
 */
export declare function computeItemMix(storeId: string, orders: RawOrder[], businessDate: string): ItemMix;
/**
 * Extracts discount data from order checks and produces a summary.
 * Groups discounts by name and computes totals and percentages vs net sales.
 */
export declare function computeDiscountSummary(storeId: string, orders: RawOrder[], netSales: number, businessDate: string): DiscountSummary;
/**
 * Detects voided orders and computes void, refund, and comp totals.
 * Voided orders are those with the voided flag set.
 * Refunds are detected from selection level refund fields.
 * Comps are detected from discounts with names containing "comp".
 */
export declare function computeVoidsRefundsComps(storeId: string, orders: RawOrder[], netSales: number, businessDate: string): VoidsRefundsComps;
/**
 * Fetches labor data for a given business date from Toast.
 * Returns a normalized LaborSummary with hours, cost, overtime, and tips.
 */
export declare function fetchLaborSummary(storeId: string, businessDate: string, netSales: number): Promise<LaborSummary>;
export declare function fetchMenuItems(storeId: string): Promise<RawMenuItem[]>;
/**
 * Detects menu items that are currently disabled or hidden.
 * Compares menu item visibility flags to identify items not available for sale.
 * Revenue loss estimation requires recent sales data (passed as context or
 * computed separately).
 */
export declare function detectDisabledItems(storeId: string, menuItems: RawMenuItem[], recentItemMix?: ItemMix): StockoutOrDisabledItem;
export {};
