/**
 * Configuration loader.
 * Reads JSON config files from the config/ directory and provides
 * typed access to thresholds, routing, owners, and store settings.
 */
import { z } from 'zod';
declare const StoreConfigSchema: z.ZodObject<{
    stores: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        toastGuid: z.ZodString;
        marginedgeId: z.ZodNumber;
        timezone: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        id: string;
        name: string;
        toastGuid: string;
        marginedgeId: number;
        timezone: string;
    }, {
        id: string;
        name: string;
        toastGuid: string;
        marginedgeId: number;
        timezone?: string | undefined;
    }>, "many">;
    defaultStoreId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    stores: {
        id: string;
        name: string;
        toastGuid: string;
        marginedgeId: number;
        timezone: string;
    }[];
    defaultStoreId: string;
}, {
    stores: {
        id: string;
        name: string;
        toastGuid: string;
        marginedgeId: number;
        timezone?: string | undefined;
    }[];
    defaultStoreId: string;
}>;
declare const ChannelMappingSchema: z.ZodObject<{
    teamId: z.ZodString;
    channels: z.ZodRecord<z.ZodString, z.ZodObject<{
        teamId: z.ZodOptional<z.ZodString>;
        channelId: z.ZodString;
        name: z.ZodString;
        audiences: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        name: string;
        channelId: string;
        audiences: string[];
        teamId?: string | undefined;
    }, {
        name: string;
        channelId: string;
        audiences: string[];
        teamId?: string | undefined;
    }>>;
    routingRules: z.ZodObject<{
        exec: z.ZodArray<z.ZodString, "many">;
        ops: z.ZodArray<z.ZodString, "many">;
        finance: z.ZodArray<z.ZodString, "many">;
        marketing: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        exec: string[];
        ops: string[];
        finance: string[];
        marketing: string[];
    }, {
        exec: string[];
        ops: string[];
        finance: string[];
        marketing: string[];
    }>;
}, "strip", z.ZodTypeAny, {
    teamId: string;
    channels: Record<string, {
        name: string;
        channelId: string;
        audiences: string[];
        teamId?: string | undefined;
    }>;
    routingRules: {
        exec: string[];
        ops: string[];
        finance: string[];
        marketing: string[];
    };
}, {
    teamId: string;
    channels: Record<string, {
        name: string;
        channelId: string;
        audiences: string[];
        teamId?: string | undefined;
    }>;
    routingRules: {
        exec: string[];
        ops: string[];
        finance: string[];
        marketing: string[];
    };
}>;
declare const OwnerSchema: z.ZodObject<{
    owners: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        email: z.ZodString;
        m365UserId: z.ZodDefault<z.ZodNullable<z.ZodString>>;
        roles: z.ZodArray<z.ZodString, "many">;
        domains: z.ZodArray<z.ZodString, "many">;
    }, "strip", z.ZodTypeAny, {
        id: string;
        name: string;
        email: string;
        m365UserId: string | null;
        roles: string[];
        domains: string[];
    }, {
        id: string;
        name: string;
        email: string;
        roles: string[];
        domains: string[];
        m365UserId?: string | null | undefined;
    }>, "many">;
    defaultOwnerByDomain: z.ZodRecord<z.ZodString, z.ZodString>;
}, "strip", z.ZodTypeAny, {
    owners: {
        id: string;
        name: string;
        email: string;
        m365UserId: string | null;
        roles: string[];
        domains: string[];
    }[];
    defaultOwnerByDomain: Record<string, string>;
}, {
    owners: {
        id: string;
        name: string;
        email: string;
        roles: string[];
        domains: string[];
        m365UserId?: string | null | undefined;
    }[];
    defaultOwnerByDomain: Record<string, string>;
}>;
declare const RulesConfigSchema: z.ZodObject<{
    mode: z.ZodDefault<z.ZodEnum<["shadow", "live", "test"]>>;
    globalCooldownMinutes: z.ZodDefault<z.ZodNumber>;
    schedules: z.ZodRecord<z.ZodString, z.ZodString>;
    thresholds: z.ZodObject<{
        readiness: z.ZodObject<{
            target: z.ZodDefault<z.ZodNumber>;
            yellowThreshold: z.ZodDefault<z.ZodNumber>;
            redThreshold: z.ZodDefault<z.ZodNumber>;
            morningRunHour: z.ZodDefault<z.ZodNumber>;
            escalationHour: z.ZodDefault<z.ZodNumber>;
            weights: z.ZodObject<{
                invoicesCaptured: z.ZodDefault<z.ZodNumber>;
                recipeCoverage: z.ZodDefault<z.ZodNumber>;
                productMapping: z.ZodDefault<z.ZodNumber>;
                inventoryRecency: z.ZodDefault<z.ZodNumber>;
                vendorMapping: z.ZodDefault<z.ZodNumber>;
                unmappedIngredients: z.ZodDefault<z.ZodNumber>;
            }, "strip", z.ZodTypeAny, {
                invoicesCaptured: number;
                recipeCoverage: number;
                productMapping: number;
                inventoryRecency: number;
                vendorMapping: number;
                unmappedIngredients: number;
            }, {
                invoicesCaptured?: number | undefined;
                recipeCoverage?: number | undefined;
                productMapping?: number | undefined;
                inventoryRecency?: number | undefined;
                vendorMapping?: number | undefined;
                unmappedIngredients?: number | undefined;
            }>;
        }, "strip", z.ZodTypeAny, {
            target: number;
            yellowThreshold: number;
            redThreshold: number;
            morningRunHour: number;
            escalationHour: number;
            weights: {
                invoicesCaptured: number;
                recipeCoverage: number;
                productMapping: number;
                inventoryRecency: number;
                vendorMapping: number;
                unmappedIngredients: number;
            };
        }, {
            weights: {
                invoicesCaptured?: number | undefined;
                recipeCoverage?: number | undefined;
                productMapping?: number | undefined;
                inventoryRecency?: number | undefined;
                vendorMapping?: number | undefined;
                unmappedIngredients?: number | undefined;
            };
            target?: number | undefined;
            yellowThreshold?: number | undefined;
            redThreshold?: number | undefined;
            morningRunHour?: number | undefined;
            escalationHour?: number | undefined;
        }>;
        primeCost: z.ZodObject<{
            laborTarget: z.ZodDefault<z.ZodNumber>;
            cogsTarget: z.ZodDefault<z.ZodNumber>;
            primeCostTarget: z.ZodDefault<z.ZodNumber>;
            dailySalesTarget: z.ZodDefault<z.ZodNumber>;
            laborYellowThreshold: z.ZodDefault<z.ZodNumber>;
            laborRedThreshold: z.ZodDefault<z.ZodNumber>;
            cogsYellowThreshold: z.ZodDefault<z.ZodNumber>;
            cogsRedThreshold: z.ZodDefault<z.ZodNumber>;
            primeCostYellowThreshold: z.ZodDefault<z.ZodNumber>;
            primeCostRedThreshold: z.ZodDefault<z.ZodNumber>;
            salesDeviationYellow: z.ZodDefault<z.ZodNumber>;
            salesDeviationRed: z.ZodDefault<z.ZodNumber>;
            trailingDays: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            laborTarget: number;
            cogsTarget: number;
            primeCostTarget: number;
            dailySalesTarget: number;
            laborYellowThreshold: number;
            laborRedThreshold: number;
            cogsYellowThreshold: number;
            cogsRedThreshold: number;
            primeCostYellowThreshold: number;
            primeCostRedThreshold: number;
            salesDeviationYellow: number;
            salesDeviationRed: number;
            trailingDays: number;
        }, {
            laborTarget?: number | undefined;
            cogsTarget?: number | undefined;
            primeCostTarget?: number | undefined;
            dailySalesTarget?: number | undefined;
            laborYellowThreshold?: number | undefined;
            laborRedThreshold?: number | undefined;
            cogsYellowThreshold?: number | undefined;
            cogsRedThreshold?: number | undefined;
            primeCostYellowThreshold?: number | undefined;
            primeCostRedThreshold?: number | undefined;
            salesDeviationYellow?: number | undefined;
            salesDeviationRed?: number | undefined;
            trailingDays?: number | undefined;
        }>;
        itemMargin: z.ZodObject<{
            minMarginPercent: z.ZodDefault<z.ZodNumber>;
            compressionTolerancePercent: z.ZodDefault<z.ZodNumber>;
            topSellerThreshold: z.ZodDefault<z.ZodNumber>;
            highVolumeMinUnits: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            minMarginPercent: number;
            compressionTolerancePercent: number;
            topSellerThreshold: number;
            highVolumeMinUnits: number;
        }, {
            minMarginPercent?: number | undefined;
            compressionTolerancePercent?: number | undefined;
            topSellerThreshold?: number | undefined;
            highVolumeMinUnits?: number | undefined;
        }>;
        vendorPrice: z.ZodObject<{
            spikeThresholdPercent: z.ZodDefault<z.ZodNumber>;
            weekOverWeekThreshold: z.ZodDefault<z.ZodNumber>;
            trailingMedianDays: z.ZodDefault<z.ZodNumber>;
            volatilityWindowDays: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            spikeThresholdPercent: number;
            weekOverWeekThreshold: number;
            trailingMedianDays: number;
            volatilityWindowDays: number;
        }, {
            spikeThresholdPercent?: number | undefined;
            weekOverWeekThreshold?: number | undefined;
            trailingMedianDays?: number | undefined;
            volatilityWindowDays?: number | undefined;
        }>;
        salesPace: z.ZodObject<{
            belowPaceYellow: z.ZodDefault<z.ZodNumber>;
            belowPaceRed: z.ZodDefault<z.ZodNumber>;
            abovePaceNotable: z.ZodDefault<z.ZodNumber>;
            trailingWeekdayCount: z.ZodDefault<z.ZodNumber>;
            checkHours: z.ZodDefault<z.ZodArray<z.ZodNumber, "many">>;
        }, "strip", z.ZodTypeAny, {
            belowPaceYellow: number;
            belowPaceRed: number;
            abovePaceNotable: number;
            trailingWeekdayCount: number;
            checkHours: number[];
        }, {
            belowPaceYellow?: number | undefined;
            belowPaceRed?: number | undefined;
            abovePaceNotable?: number | undefined;
            trailingWeekdayCount?: number | undefined;
            checkHours?: number[] | undefined;
        }>;
        labor: z.ZodObject<{
            laborPercentYellow: z.ZodDefault<z.ZodNumber>;
            laborPercentRed: z.ZodDefault<z.ZodNumber>;
            overtimeHoursThreshold: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            laborPercentYellow: number;
            laborPercentRed: number;
            overtimeHoursThreshold: number;
        }, {
            laborPercentYellow?: number | undefined;
            laborPercentRed?: number | undefined;
            overtimeHoursThreshold?: number | undefined;
        }>;
        discountCompVoid: z.ZodObject<{
            discountPercentYellow: z.ZodDefault<z.ZodNumber>;
            discountPercentRed: z.ZodDefault<z.ZodNumber>;
            voidPercentYellow: z.ZodDefault<z.ZodNumber>;
            voidPercentRed: z.ZodDefault<z.ZodNumber>;
            compPercentYellow: z.ZodDefault<z.ZodNumber>;
            compPercentRed: z.ZodDefault<z.ZodNumber>;
            refundPercentYellow: z.ZodDefault<z.ZodNumber>;
            refundPercentRed: z.ZodDefault<z.ZodNumber>;
            totalExceptionPercentYellow: z.ZodDefault<z.ZodNumber>;
            totalExceptionPercentRed: z.ZodDefault<z.ZodNumber>;
            trailingSpikeMultiplier: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            discountPercentYellow: number;
            discountPercentRed: number;
            voidPercentYellow: number;
            voidPercentRed: number;
            compPercentYellow: number;
            compPercentRed: number;
            refundPercentYellow: number;
            refundPercentRed: number;
            totalExceptionPercentYellow: number;
            totalExceptionPercentRed: number;
            trailingSpikeMultiplier: number;
        }, {
            discountPercentYellow?: number | undefined;
            discountPercentRed?: number | undefined;
            voidPercentYellow?: number | undefined;
            voidPercentRed?: number | undefined;
            compPercentYellow?: number | undefined;
            compPercentRed?: number | undefined;
            refundPercentYellow?: number | undefined;
            refundPercentRed?: number | undefined;
            totalExceptionPercentYellow?: number | undefined;
            totalExceptionPercentRed?: number | undefined;
            trailingSpikeMultiplier?: number | undefined;
        }>;
        stockout: z.ZodObject<{
            highMarginThreshold: z.ZodDefault<z.ZodNumber>;
            highVelocityMinDaily: z.ZodDefault<z.ZodNumber>;
            revenueLossAlertThreshold: z.ZodDefault<z.ZodNumber>;
        }, "strip", z.ZodTypeAny, {
            highMarginThreshold: number;
            highVelocityMinDaily: number;
            revenueLossAlertThreshold: number;
        }, {
            highMarginThreshold?: number | undefined;
            highVelocityMinDaily?: number | undefined;
            revenueLossAlertThreshold?: number | undefined;
        }>;
    }, "strip", z.ZodTypeAny, {
        readiness: {
            target: number;
            yellowThreshold: number;
            redThreshold: number;
            morningRunHour: number;
            escalationHour: number;
            weights: {
                invoicesCaptured: number;
                recipeCoverage: number;
                productMapping: number;
                inventoryRecency: number;
                vendorMapping: number;
                unmappedIngredients: number;
            };
        };
        primeCost: {
            laborTarget: number;
            cogsTarget: number;
            primeCostTarget: number;
            dailySalesTarget: number;
            laborYellowThreshold: number;
            laborRedThreshold: number;
            cogsYellowThreshold: number;
            cogsRedThreshold: number;
            primeCostYellowThreshold: number;
            primeCostRedThreshold: number;
            salesDeviationYellow: number;
            salesDeviationRed: number;
            trailingDays: number;
        };
        itemMargin: {
            minMarginPercent: number;
            compressionTolerancePercent: number;
            topSellerThreshold: number;
            highVolumeMinUnits: number;
        };
        vendorPrice: {
            spikeThresholdPercent: number;
            weekOverWeekThreshold: number;
            trailingMedianDays: number;
            volatilityWindowDays: number;
        };
        salesPace: {
            belowPaceYellow: number;
            belowPaceRed: number;
            abovePaceNotable: number;
            trailingWeekdayCount: number;
            checkHours: number[];
        };
        labor: {
            laborPercentYellow: number;
            laborPercentRed: number;
            overtimeHoursThreshold: number;
        };
        discountCompVoid: {
            discountPercentYellow: number;
            discountPercentRed: number;
            voidPercentYellow: number;
            voidPercentRed: number;
            compPercentYellow: number;
            compPercentRed: number;
            refundPercentYellow: number;
            refundPercentRed: number;
            totalExceptionPercentYellow: number;
            totalExceptionPercentRed: number;
            trailingSpikeMultiplier: number;
        };
        stockout: {
            highMarginThreshold: number;
            highVelocityMinDaily: number;
            revenueLossAlertThreshold: number;
        };
    }, {
        readiness: {
            weights: {
                invoicesCaptured?: number | undefined;
                recipeCoverage?: number | undefined;
                productMapping?: number | undefined;
                inventoryRecency?: number | undefined;
                vendorMapping?: number | undefined;
                unmappedIngredients?: number | undefined;
            };
            target?: number | undefined;
            yellowThreshold?: number | undefined;
            redThreshold?: number | undefined;
            morningRunHour?: number | undefined;
            escalationHour?: number | undefined;
        };
        primeCost: {
            laborTarget?: number | undefined;
            cogsTarget?: number | undefined;
            primeCostTarget?: number | undefined;
            dailySalesTarget?: number | undefined;
            laborYellowThreshold?: number | undefined;
            laborRedThreshold?: number | undefined;
            cogsYellowThreshold?: number | undefined;
            cogsRedThreshold?: number | undefined;
            primeCostYellowThreshold?: number | undefined;
            primeCostRedThreshold?: number | undefined;
            salesDeviationYellow?: number | undefined;
            salesDeviationRed?: number | undefined;
            trailingDays?: number | undefined;
        };
        itemMargin: {
            minMarginPercent?: number | undefined;
            compressionTolerancePercent?: number | undefined;
            topSellerThreshold?: number | undefined;
            highVolumeMinUnits?: number | undefined;
        };
        vendorPrice: {
            spikeThresholdPercent?: number | undefined;
            weekOverWeekThreshold?: number | undefined;
            trailingMedianDays?: number | undefined;
            volatilityWindowDays?: number | undefined;
        };
        salesPace: {
            belowPaceYellow?: number | undefined;
            belowPaceRed?: number | undefined;
            abovePaceNotable?: number | undefined;
            trailingWeekdayCount?: number | undefined;
            checkHours?: number[] | undefined;
        };
        labor: {
            laborPercentYellow?: number | undefined;
            laborPercentRed?: number | undefined;
            overtimeHoursThreshold?: number | undefined;
        };
        discountCompVoid: {
            discountPercentYellow?: number | undefined;
            discountPercentRed?: number | undefined;
            voidPercentYellow?: number | undefined;
            voidPercentRed?: number | undefined;
            compPercentYellow?: number | undefined;
            compPercentRed?: number | undefined;
            refundPercentYellow?: number | undefined;
            refundPercentRed?: number | undefined;
            totalExceptionPercentYellow?: number | undefined;
            totalExceptionPercentRed?: number | undefined;
            trailingSpikeMultiplier?: number | undefined;
        };
        stockout: {
            highMarginThreshold?: number | undefined;
            highVelocityMinDaily?: number | undefined;
            revenueLossAlertThreshold?: number | undefined;
        };
    }>;
    cooldowns: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodNumber>>;
    watchlists: z.ZodDefault<z.ZodObject<{
        keyIngredients: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        keyMenuItems: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        keyVendors: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        keyIngredients: string[];
        keyMenuItems: string[];
        keyVendors: string[];
    }, {
        keyIngredients?: string[] | undefined;
        keyMenuItems?: string[] | undefined;
        keyVendors?: string[] | undefined;
    }>>;
    categoryTargets: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        cogsTarget: z.ZodNumber;
        marginTarget: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        cogsTarget: number;
        marginTarget: number;
    }, {
        cogsTarget: number;
        marginTarget: number;
    }>>>;
}, "strip", z.ZodTypeAny, {
    mode: "shadow" | "live" | "test";
    globalCooldownMinutes: number;
    schedules: Record<string, string>;
    thresholds: {
        readiness: {
            target: number;
            yellowThreshold: number;
            redThreshold: number;
            morningRunHour: number;
            escalationHour: number;
            weights: {
                invoicesCaptured: number;
                recipeCoverage: number;
                productMapping: number;
                inventoryRecency: number;
                vendorMapping: number;
                unmappedIngredients: number;
            };
        };
        primeCost: {
            laborTarget: number;
            cogsTarget: number;
            primeCostTarget: number;
            dailySalesTarget: number;
            laborYellowThreshold: number;
            laborRedThreshold: number;
            cogsYellowThreshold: number;
            cogsRedThreshold: number;
            primeCostYellowThreshold: number;
            primeCostRedThreshold: number;
            salesDeviationYellow: number;
            salesDeviationRed: number;
            trailingDays: number;
        };
        itemMargin: {
            minMarginPercent: number;
            compressionTolerancePercent: number;
            topSellerThreshold: number;
            highVolumeMinUnits: number;
        };
        vendorPrice: {
            spikeThresholdPercent: number;
            weekOverWeekThreshold: number;
            trailingMedianDays: number;
            volatilityWindowDays: number;
        };
        salesPace: {
            belowPaceYellow: number;
            belowPaceRed: number;
            abovePaceNotable: number;
            trailingWeekdayCount: number;
            checkHours: number[];
        };
        labor: {
            laborPercentYellow: number;
            laborPercentRed: number;
            overtimeHoursThreshold: number;
        };
        discountCompVoid: {
            discountPercentYellow: number;
            discountPercentRed: number;
            voidPercentYellow: number;
            voidPercentRed: number;
            compPercentYellow: number;
            compPercentRed: number;
            refundPercentYellow: number;
            refundPercentRed: number;
            totalExceptionPercentYellow: number;
            totalExceptionPercentRed: number;
            trailingSpikeMultiplier: number;
        };
        stockout: {
            highMarginThreshold: number;
            highVelocityMinDaily: number;
            revenueLossAlertThreshold: number;
        };
    };
    cooldowns: Record<string, number>;
    watchlists: {
        keyIngredients: string[];
        keyMenuItems: string[];
        keyVendors: string[];
    };
    categoryTargets: Record<string, {
        cogsTarget: number;
        marginTarget: number;
    }>;
}, {
    schedules: Record<string, string>;
    thresholds: {
        readiness: {
            weights: {
                invoicesCaptured?: number | undefined;
                recipeCoverage?: number | undefined;
                productMapping?: number | undefined;
                inventoryRecency?: number | undefined;
                vendorMapping?: number | undefined;
                unmappedIngredients?: number | undefined;
            };
            target?: number | undefined;
            yellowThreshold?: number | undefined;
            redThreshold?: number | undefined;
            morningRunHour?: number | undefined;
            escalationHour?: number | undefined;
        };
        primeCost: {
            laborTarget?: number | undefined;
            cogsTarget?: number | undefined;
            primeCostTarget?: number | undefined;
            dailySalesTarget?: number | undefined;
            laborYellowThreshold?: number | undefined;
            laborRedThreshold?: number | undefined;
            cogsYellowThreshold?: number | undefined;
            cogsRedThreshold?: number | undefined;
            primeCostYellowThreshold?: number | undefined;
            primeCostRedThreshold?: number | undefined;
            salesDeviationYellow?: number | undefined;
            salesDeviationRed?: number | undefined;
            trailingDays?: number | undefined;
        };
        itemMargin: {
            minMarginPercent?: number | undefined;
            compressionTolerancePercent?: number | undefined;
            topSellerThreshold?: number | undefined;
            highVolumeMinUnits?: number | undefined;
        };
        vendorPrice: {
            spikeThresholdPercent?: number | undefined;
            weekOverWeekThreshold?: number | undefined;
            trailingMedianDays?: number | undefined;
            volatilityWindowDays?: number | undefined;
        };
        salesPace: {
            belowPaceYellow?: number | undefined;
            belowPaceRed?: number | undefined;
            abovePaceNotable?: number | undefined;
            trailingWeekdayCount?: number | undefined;
            checkHours?: number[] | undefined;
        };
        labor: {
            laborPercentYellow?: number | undefined;
            laborPercentRed?: number | undefined;
            overtimeHoursThreshold?: number | undefined;
        };
        discountCompVoid: {
            discountPercentYellow?: number | undefined;
            discountPercentRed?: number | undefined;
            voidPercentYellow?: number | undefined;
            voidPercentRed?: number | undefined;
            compPercentYellow?: number | undefined;
            compPercentRed?: number | undefined;
            refundPercentYellow?: number | undefined;
            refundPercentRed?: number | undefined;
            totalExceptionPercentYellow?: number | undefined;
            totalExceptionPercentRed?: number | undefined;
            trailingSpikeMultiplier?: number | undefined;
        };
        stockout: {
            highMarginThreshold?: number | undefined;
            highVelocityMinDaily?: number | undefined;
            revenueLossAlertThreshold?: number | undefined;
        };
    };
    mode?: "shadow" | "live" | "test" | undefined;
    globalCooldownMinutes?: number | undefined;
    cooldowns?: Record<string, number> | undefined;
    watchlists?: {
        keyIngredients?: string[] | undefined;
        keyMenuItems?: string[] | undefined;
        keyVendors?: string[] | undefined;
    } | undefined;
    categoryTargets?: Record<string, {
        cogsTarget: number;
        marginTarget: number;
    }> | undefined;
}>;
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
export declare function loadConfig(): AppConfig;
export declare function getStore(config: AppConfig, storeId?: string): {
    id: string;
    name: string;
    toastGuid: string;
    marginedgeId: number;
    timezone: string;
};
export declare function getOwnerForDomain(config: AppConfig, domain: string): string;
export declare function getOwner(config: AppConfig, ownerId: string): {
    id: string;
    name: string;
    email: string;
    m365UserId: string | null;
    roles: string[];
    domains: string[];
} | null;
export declare function getThreshold<T>(config: AppConfig, path: string): T;
export {};
