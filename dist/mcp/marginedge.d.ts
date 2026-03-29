/**
 * MarginEdge MCP data fetcher.
 * Calls MarginEdge MCP tools and returns normalized models for the ops engine.
 */
import type { InvoiceStatus, ReadinessScore, VendorPriceChange } from '../models/normalized.js';
interface RawProduct {
    id: string | number;
    name: string;
    categoryId?: string | number | null;
    categoryName?: string | null;
    vendorId?: string | number | null;
    vendorName?: string | null;
    [key: string]: unknown;
}
interface RawCategory {
    id: string | number;
    name: string;
    [key: string]: unknown;
}
interface RawVendor {
    id: string | number;
    name: string;
    [key: string]: unknown;
}
interface RawVendorItem {
    id: string | number;
    name: string;
    productId?: string | number;
    productName?: string;
    vendorItemCode?: string;
    price?: number;
    previousPrice?: number;
    [key: string]: unknown;
}
interface RawOrderDetail {
    id: string | number;
    vendorId: string | number;
    vendorName?: string;
    items?: RawVendorItem[];
    [key: string]: unknown;
}
interface ReadinessConfig {
    weights: {
        invoicesCaptured: number;
        recipeCoverage: number;
        productMapping: number;
        inventoryRecency: number;
        vendorMapping: number;
        unmappedIngredients: number;
    };
    expectedProductCount?: number;
}
export declare function fetchInvoiceStatus(storeId: string, startDate: string, endDate: string): Promise<InvoiceStatus>;
export declare function fetchProducts(storeId: string): Promise<RawProduct[]>;
export declare function fetchCategories(storeId: string): Promise<RawCategory[]>;
export declare function fetchVendors(storeId: string): Promise<RawVendor[]>;
export declare function fetchVendorItems(storeId: string, vendorId: string): Promise<RawVendorItem[]>;
export declare function fetchOrderDetails(storeId: string, orderId: string): Promise<RawOrderDetail | null>;
/**
 * Computes a weighted readiness score for MarginEdge data quality.
 *
 * Components:
 *   1. Invoices Captured: checks prior day invoice status (closed vs open)
 *   2. Product Mapping: checks for unmapped products (missing categories)
 *   3. Vendor Mapping: checks that all products have vendor assignments
 *   4. Recipe Coverage: placeholder; MarginEdge API does not expose recipes
 *   5. Inventory Recency: placeholder; MarginEdge API does not expose counts
 *   6. Unmapped Ingredients: placeholder; no direct API mapping available
 *
 * Placeholder components score 50/100 by default and include a note
 * indicating that real data is not yet available.
 */
export declare function computeReadinessScore(storeId: string, config: ReadinessConfig): Promise<ReadinessScore>;
/**
 * Detects vendor price changes by comparing line items across two sets of
 * MarginEdge order IDs (e.g., recent week vs previous week).
 *
 * For each product that appears in both sets, computes the price difference
 * and flags changes above a trivial threshold.
 */
export declare function detectVendorPriceChanges(storeId: string, recentOrderIds: string[], previousOrderIds: string[]): Promise<VendorPriceChange>;
export {};
