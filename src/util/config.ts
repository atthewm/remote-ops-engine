/**
 * Configuration loader.
 * Reads JSON config files from the config/ directory and provides
 * typed access to thresholds, routing, owners, and store settings.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { z } from 'zod';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, '../../config');

// ─── Schema Definitions ───

const StoreConfigSchema = z.object({
  stores: z.array(z.object({
    id: z.string(),
    name: z.string(),
    toastGuid: z.string(),
    marginedgeId: z.number(),
    timezone: z.string().default('America/Chicago'),
  })),
  defaultStoreId: z.string(),
});

const ChannelMappingSchema = z.object({
  teamId: z.string(),
  channels: z.record(z.string(), z.object({
    teamId: z.string().optional(),
    channelId: z.string(),
    name: z.string(),
    audiences: z.array(z.string()),
  })),
  routingRules: z.object({
    exec: z.array(z.string()),
    ops: z.array(z.string()),
    finance: z.array(z.string()),
    marketing: z.array(z.string()),
  }),
});

const OwnerSchema = z.object({
  owners: z.array(z.object({
    id: z.string(),
    name: z.string(),
    email: z.string(),
    m365UserId: z.string().nullable().default(null),
    roles: z.array(z.string()),
    domains: z.array(z.string()),
  })),
  defaultOwnerByDomain: z.record(z.string(), z.string()),
});

const RulesConfigSchema = z.object({
  mode: z.enum(['shadow', 'live', 'test']).default('shadow'),
  globalCooldownMinutes: z.number().default(120),
  schedules: z.record(z.string(), z.string()),
  thresholds: z.object({
    readiness: z.object({
      target: z.number().default(85),
      yellowThreshold: z.number().default(85),
      redThreshold: z.number().default(70),
      morningRunHour: z.number().default(7),
      escalationHour: z.number().default(10),
      weights: z.object({
        invoicesCaptured: z.number().default(25),
        recipeCoverage: z.number().default(25),
        productMapping: z.number().default(20),
        inventoryRecency: z.number().default(15),
        vendorMapping: z.number().default(10),
        unmappedIngredients: z.number().default(5),
      }),
    }),
    primeCost: z.object({
      laborTarget: z.number().default(0.30),
      cogsTarget: z.number().default(0.30),
      primeCostTarget: z.number().default(0.60),
      dailySalesTarget: z.number().default(2500),
      laborYellowThreshold: z.number().default(0.33),
      laborRedThreshold: z.number().default(0.38),
      cogsYellowThreshold: z.number().default(0.33),
      cogsRedThreshold: z.number().default(0.38),
      primeCostYellowThreshold: z.number().default(0.63),
      primeCostRedThreshold: z.number().default(0.68),
      salesDeviationYellow: z.number().default(0.15),
      salesDeviationRed: z.number().default(0.25),
      trailingDays: z.number().default(28),
    }),
    itemMargin: z.object({
      minMarginPercent: z.number().default(0.65),
      compressionTolerancePercent: z.number().default(0.05),
      topSellerThreshold: z.number().default(10),
      highVolumeMinUnits: z.number().default(20),
    }),
    vendorPrice: z.object({
      spikeThresholdPercent: z.number().default(0.10),
      weekOverWeekThreshold: z.number().default(0.05),
      trailingMedianDays: z.number().default(30),
      volatilityWindowDays: z.number().default(90),
    }),
    salesPace: z.object({
      belowPaceYellow: z.number().default(0.15),
      belowPaceRed: z.number().default(0.25),
      abovePaceNotable: z.number().default(0.20),
      trailingWeekdayCount: z.number().default(4),
      checkHours: z.array(z.number()).default([10, 13, 16]),
    }),
    labor: z.object({
      laborPercentYellow: z.number().default(0.33),
      laborPercentRed: z.number().default(0.38),
      overtimeHoursThreshold: z.number().default(4),
    }),
    discountCompVoid: z.object({
      discountPercentYellow: z.number().default(0.05),
      discountPercentRed: z.number().default(0.10),
      voidPercentYellow: z.number().default(0.02),
      voidPercentRed: z.number().default(0.05),
      compPercentYellow: z.number().default(0.03),
      compPercentRed: z.number().default(0.05),
      refundPercentYellow: z.number().default(0.02),
      refundPercentRed: z.number().default(0.04),
      totalExceptionPercentYellow: z.number().default(0.05),
      totalExceptionPercentRed: z.number().default(0.08),
      trailingSpikeMultiplier: z.number().default(2.0),
    }),
    stockout: z.object({
      highMarginThreshold: z.number().default(0.70),
      highVelocityMinDaily: z.number().default(15),
      revenueLossAlertThreshold: z.number().default(50),
    }),
  }),
  cooldowns: z.record(z.string(), z.number()).default({}),
  watchlists: z.object({
    keyIngredients: z.array(z.string()).default([]),
    keyMenuItems: z.array(z.string()).default([]),
    keyVendors: z.array(z.string()).default([]),
  }).default({}),
  categoryTargets: z.record(z.string(), z.object({
    cogsTarget: z.number(),
    marginTarget: z.number(),
  })).default({}),
});

// ─── Types ───

export type StoresConfig = z.infer<typeof StoreConfigSchema>;
export type TeamsConfig = z.infer<typeof ChannelMappingSchema>;
export type OwnersConfig = z.infer<typeof OwnerSchema>;
export type RulesConfig = z.infer<typeof RulesConfigSchema>;

export interface AppConfig {
  stores: StoresConfig;
  teams: TeamsConfig;
  owners: OwnersConfig;
  rules: RulesConfig;
}

// ─── Loader ───

function loadJsonFile(filename: string): unknown {
  const filepath = resolve(CONFIG_DIR, filename);
  if (!existsSync(filepath)) {
    throw new Error(`Config file not found: ${filepath}`);
  }
  const raw = readFileSync(filepath, 'utf-8');
  return JSON.parse(raw);
}

export function loadConfig(): AppConfig {
  const stores = StoreConfigSchema.parse(loadJsonFile('stores.json'));
  const teams = ChannelMappingSchema.parse(loadJsonFile('teams.json'));
  const owners = OwnerSchema.parse(loadJsonFile('owners.json'));
  const rules = RulesConfigSchema.parse(loadJsonFile('rules.json'));

  return { stores, teams, owners, rules };
}

export function getStore(config: AppConfig, storeId?: string) {
  const id = storeId ?? config.stores.defaultStoreId;
  const store = config.stores.stores.find(s => s.id === id);
  if (!store) throw new Error(`Store not found: ${id}`);
  return store;
}

export function getOwnerForDomain(config: AppConfig, domain: string): string {
  return config.owners.defaultOwnerByDomain[domain] ?? 'unassigned';
}

export function getOwner(config: AppConfig, ownerId: string) {
  return config.owners.owners.find(o => o.id === ownerId) ?? null;
}

export function getThreshold<T>(config: AppConfig, path: string): T {
  const parts = path.split('.');
  let current: unknown = config.rules.thresholds;
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      throw new Error(`Threshold not found: ${path}`);
    }
  }
  return current as T;
}
