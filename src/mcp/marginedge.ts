/**
 * MarginEdge MCP data fetcher.
 * Calls MarginEdge MCP tools and returns normalized models for the ops engine.
 */

import { callTool } from './client.js';
import { logger } from '../util/logger.js';
import type {
  InvoiceStatus,
  InvoiceStatusBucket,
  ReadinessScore,
  ReadinessComponent,
  ReadinessMissing,
  VendorPriceChange,
  VendorPriceChangeEntry,
} from '../models/normalized.js';

// ─── Raw response shapes from MarginEdge MCP ───

interface RawInvoice {
  id: string | number;
  vendorId: string | number;
  vendorName?: string;
  status: string;
  total?: number;
  invoiceDate?: string;
  [key: string]: unknown;
}

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

// ─── Invoice Status ───

export async function fetchInvoiceStatus(
  storeId: string,
  startDate: string,
  endDate: string,
): Promise<InvoiceStatus> {
  logger.info('Fetching MarginEdge invoice status', { storeId, startDate, endDate });

  const raw = await callTool('marginedge', 'marginedge_invoices', {
    startDate,
    endDate,
  }) as RawInvoice[] | { invoices: RawInvoice[] };

  const invoices: RawInvoice[] = Array.isArray(raw) ? raw : (raw?.invoices ?? []);

  // Group by status
  const statusMap = new Map<string, { count: number; value: number }>();
  let totalValue = 0;

  for (const inv of invoices) {
    const status = inv.status ?? 'unknown';
    const value = inv.total ?? 0;
    totalValue += value;

    const bucket = statusMap.get(status) ?? { count: 0, value: 0 };
    bucket.count += 1;
    bucket.value += value;
    statusMap.set(status, bucket);
  }

  const byStatus: InvoiceStatusBucket[] = Array.from(statusMap.entries()).map(
    ([status, data]) => ({ status, count: data.count, value: data.value }),
  );

  const closedCount = byStatus
    .filter(b => b.status.toLowerCase() === 'closed' || b.status.toLowerCase() === 'approved')
    .reduce((sum, b) => sum + b.count, 0);

  const openCount = byStatus
    .filter(b => b.status.toLowerCase() === 'open' || b.status.toLowerCase() === 'new')
    .reduce((sum, b) => sum + b.count, 0);

  const pendingReviewCount = byStatus
    .filter(b => b.status.toLowerCase().includes('pending') || b.status.toLowerCase().includes('review'))
    .reduce((sum, b) => sum + b.count, 0);

  const total = invoices.length;

  return {
    storeId,
    dateRange: { start: startDate, end: endDate },
    totalInvoices: total,
    totalValue,
    byStatus,
    closedCount,
    closedPercent: total > 0 ? closedCount / total : 0,
    openCount,
    pendingReviewCount,
    source: 'marginedge',
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Products ───

export async function fetchProducts(storeId: string): Promise<RawProduct[]> {
  logger.info('Fetching MarginEdge products', { storeId });

  const raw = await callTool('marginedge', 'marginedge_products', {}) as
    RawProduct[] | { products: RawProduct[] };

  const products: RawProduct[] = Array.isArray(raw) ? raw : (raw?.products ?? []);
  logger.info(`Fetched ${products.length} products from MarginEdge`);
  return products;
}

// ─── Categories ───

export async function fetchCategories(storeId: string): Promise<RawCategory[]> {
  logger.info('Fetching MarginEdge categories', { storeId });

  const raw = await callTool('marginedge', 'marginedge_categories', {}) as
    RawCategory[] | { categories: RawCategory[] };

  const categories: RawCategory[] = Array.isArray(raw) ? raw : (raw?.categories ?? []);
  logger.info(`Fetched ${categories.length} categories from MarginEdge`);
  return categories;
}

// ─── Vendors ───

export async function fetchVendors(storeId: string): Promise<RawVendor[]> {
  logger.info('Fetching MarginEdge vendors', { storeId });

  const raw = await callTool('marginedge', 'marginedge_vendors', {}) as
    RawVendor[] | { vendors: RawVendor[] };

  const vendors: RawVendor[] = Array.isArray(raw) ? raw : (raw?.vendors ?? []);
  logger.info(`Fetched ${vendors.length} vendors from MarginEdge`);
  return vendors;
}

// ─── Vendor Items ───

export async function fetchVendorItems(storeId: string, vendorId: string): Promise<RawVendorItem[]> {
  logger.info('Fetching MarginEdge vendor items', { storeId, vendorId });

  const raw = await callTool('marginedge', 'marginedge_vendor_items', {
    vendorId,
  }) as RawVendorItem[] | { items: RawVendorItem[] };

  const items: RawVendorItem[] = Array.isArray(raw) ? raw : (raw?.items ?? []);
  logger.info(`Fetched ${items.length} vendor items for vendor ${vendorId}`);
  return items;
}

// ─── Order Details ───

export async function fetchOrderDetails(storeId: string, orderId: string): Promise<RawOrderDetail | null> {
  logger.info('Fetching MarginEdge order details', { storeId, orderId });

  try {
    const raw = await callTool('marginedge', 'marginedge_order_details', {
      orderId,
    }) as RawOrderDetail;

    return raw;
  } catch (err) {
    logger.error('Failed to fetch order details', { storeId, orderId, error: String(err) });
    return null;
  }
}

// ─── Readiness Score ───

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
export async function computeReadinessScore(
  storeId: string,
  config: ReadinessConfig,
): Promise<ReadinessScore> {
  logger.info('Computing MarginEdge readiness score', { storeId });

  const now = new Date();
  const asOfDate = now.toISOString().slice(0, 10);

  // Prior day date range for invoices
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);

  const components: ReadinessComponent[] = [];
  const missingDetails: ReadinessMissing[] = [];

  const w = config.weights;

  // ── 1. Invoices Captured ──
  try {
    const invoiceStatus = await fetchInvoiceStatus(storeId, yStr, yStr);
    const invoiceScore = invoiceStatus.totalInvoices > 0
      ? Math.round(invoiceStatus.closedPercent * 100)
      : 0;

    components.push({
      name: 'invoicesCaptured',
      weight: w.invoicesCaptured,
      score: invoiceScore,
      maxScore: 100,
      details: `${invoiceStatus.closedCount}/${invoiceStatus.totalInvoices} invoices closed for ${yStr}`,
    });

    if (invoiceStatus.openCount > 0) {
      missingDetails.push({
        component: 'invoicesCaptured',
        items: [`${invoiceStatus.openCount} open invoices need review`],
        count: invoiceStatus.openCount,
      });
    }
  } catch (err) {
    logger.error('Failed to fetch invoices for readiness', { error: String(err) });
    components.push({
      name: 'invoicesCaptured',
      weight: w.invoicesCaptured,
      score: 0,
      maxScore: 100,
      details: 'Unable to fetch invoice data',
    });
  }

  // ── 2. Product Mapping ──
  try {
    const products = await fetchProducts(storeId);
    const unmappedProducts = products.filter(
      p => !p.categoryId && !p.categoryName,
    );
    const expectedCount = config.expectedProductCount ?? products.length;
    const mappedCount = products.length - unmappedProducts.length;
    const productScore = expectedCount > 0
      ? Math.round((mappedCount / expectedCount) * 100)
      : 0;

    components.push({
      name: 'productMapping',
      weight: w.productMapping,
      score: Math.min(productScore, 100),
      maxScore: 100,
      details: `${mappedCount}/${expectedCount} products mapped to categories`,
    });

    if (unmappedProducts.length > 0) {
      missingDetails.push({
        component: 'productMapping',
        items: unmappedProducts.slice(0, 20).map(p => String(p.name)),
        count: unmappedProducts.length,
      });
    }
  } catch (err) {
    logger.error('Failed to fetch products for readiness', { error: String(err) });
    components.push({
      name: 'productMapping',
      weight: w.productMapping,
      score: 0,
      maxScore: 100,
      details: 'Unable to fetch product data',
    });
  }

  // ── 3. Vendor Mapping ──
  try {
    const products = await fetchProducts(storeId);
    const unvendored = products.filter(p => !p.vendorId && !p.vendorName);
    const vendorScore = products.length > 0
      ? Math.round(((products.length - unvendored.length) / products.length) * 100)
      : 0;

    components.push({
      name: 'vendorMapping',
      weight: w.vendorMapping,
      score: vendorScore,
      maxScore: 100,
      details: `${products.length - unvendored.length}/${products.length} products have vendor assignments`,
    });

    if (unvendored.length > 0) {
      missingDetails.push({
        component: 'vendorMapping',
        items: unvendored.slice(0, 20).map(p => String(p.name)),
        count: unvendored.length,
      });
    }
  } catch (err) {
    logger.error('Failed to compute vendor mapping for readiness', { error: String(err) });
    components.push({
      name: 'vendorMapping',
      weight: w.vendorMapping,
      score: 0,
      maxScore: 100,
      details: 'Unable to compute vendor mapping',
    });
  }

  // ── 4. Recipe Coverage (placeholder) ──
  // MarginEdge API does not expose recipe data directly.
  // This component uses a placeholder score until recipe access is available.
  components.push({
    name: 'recipeCoverage',
    weight: w.recipeCoverage,
    score: 50,
    maxScore: 100,
    details: 'Placeholder: MarginEdge API does not expose recipe data. Manual review recommended.',
  });
  missingDetails.push({
    component: 'recipeCoverage',
    items: ['Recipe data not available via API; requires manual verification or future API support'],
    count: 0,
  });

  // ── 5. Inventory Recency (placeholder) ──
  // MarginEdge API does not expose inventory count dates.
  // This component uses a placeholder score until inventory access is available.
  components.push({
    name: 'inventoryRecency',
    weight: w.inventoryRecency,
    score: 50,
    maxScore: 100,
    details: 'Placeholder: MarginEdge API does not expose inventory count data. Manual review recommended.',
  });
  missingDetails.push({
    component: 'inventoryRecency',
    items: ['Inventory count data not available via API; requires manual input or future API support'],
    count: 0,
  });

  // ── 6. Unmapped Ingredients (placeholder) ──
  // MarginEdge API does not expose ingredient level mapping details.
  // This component uses a placeholder score.
  components.push({
    name: 'unmappedIngredients',
    weight: w.unmappedIngredients,
    score: 50,
    maxScore: 100,
    details: 'Placeholder: ingredient mapping not available via API. Manual review recommended.',
  });
  missingDetails.push({
    component: 'unmappedIngredients',
    items: ['Ingredient mapping data not available via API'],
    count: 0,
  });

  // ── Compute weighted overall score ──
  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0);
  const weightedSum = components.reduce(
    (sum, c) => sum + (c.score / c.maxScore) * c.weight,
    0,
  );
  const overallScore = totalWeight > 0 ? Math.round((weightedSum / totalWeight) * 100) : 0;

  logger.info(`Readiness score computed: ${overallScore}/100`, { storeId });

  return {
    storeId,
    asOfDate,
    overallScore,
    components,
    missingDetails,
    source: 'computed',
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Vendor Price Change Detection ───

/**
 * Detects vendor price changes by comparing line items across two sets of
 * MarginEdge order IDs (e.g., recent week vs previous week).
 *
 * For each product that appears in both sets, computes the price difference
 * and flags changes above a trivial threshold.
 */
export async function detectVendorPriceChanges(
  storeId: string,
  recentOrderIds: string[],
  previousOrderIds: string[],
): Promise<VendorPriceChange> {
  logger.info('Detecting vendor price changes', {
    storeId,
    recentCount: recentOrderIds.length,
    previousCount: previousOrderIds.length,
  });

  // Build price maps from order details: productId => { price, vendorId, vendorName, ... }
  interface PriceRecord {
    price: number;
    vendorId: string;
    vendorName: string;
    productName: string;
    vendorItemCode: string;
  }

  async function buildPriceMap(orderIds: string[]): Promise<Map<string, PriceRecord>> {
    const priceMap = new Map<string, PriceRecord>();

    for (const orderId of orderIds) {
      const detail = await fetchOrderDetails(storeId, orderId);
      if (!detail?.items) continue;

      for (const item of detail.items) {
        const productId = String(item.productId ?? item.id);
        const price = item.price ?? 0;

        // Use the most recent price seen for each product
        priceMap.set(productId, {
          price,
          vendorId: String(detail.vendorId),
          vendorName: detail.vendorName ?? 'Unknown',
          productName: item.productName ?? item.name ?? 'Unknown',
          vendorItemCode: item.vendorItemCode ?? '',
        });
      }
    }

    return priceMap;
  }

  const [recentPrices, previousPrices] = await Promise.all([
    buildPriceMap(recentOrderIds),
    buildPriceMap(previousOrderIds),
  ]);

  const changes: VendorPriceChangeEntry[] = [];

  for (const [productId, recent] of recentPrices) {
    const previous = previousPrices.get(productId);
    if (!previous) continue;

    if (recent.price === previous.price) continue;

    const changePercent = previous.price !== 0
      ? (recent.price - previous.price) / previous.price
      : 0;

    // Skip trivially small changes (under 0.5%)
    if (Math.abs(changePercent) < 0.005) continue;

    changes.push({
      vendorId: recent.vendorId,
      vendorName: recent.vendorName,
      productId,
      productName: recent.productName,
      vendorItemCode: recent.vendorItemCode,
      previousPrice: previous.price,
      currentPrice: recent.price,
      changePercent: Math.round(changePercent * 10000) / 10000,
      changeDirection: recent.price > previous.price ? 'up' : 'down',
      affectedMenuItems: [], // Cross referencing with Toast menu items requires a separate step
    });
  }

  // Sort by absolute change percent descending
  changes.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));

  logger.info(`Detected ${changes.length} vendor price changes`, { storeId });

  return {
    storeId,
    detectedDate: new Date().toISOString().slice(0, 10),
    changes,
    source: 'marginedge',
    fetchedAt: new Date().toISOString(),
  };
}
