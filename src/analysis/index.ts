/**
 * Analysis module barrel export.
 *
 * Re-exports all analysis functions from individual modules for
 * convenient import throughout the ops engine.
 */

// Base utilities
export {
  fetchDaySummary,
  fetchDayRange,
  parseDate,
  formatDate,
  todayStr,
  yesterdayStr,
  dayName,
  pct,
  dollars,
  pctChange,
} from './base.js';

export type {
  DaySnapshot,
  LaborSnapshot,
  PlatformEntry,
  DriveThruSnapshot,
} from './base.js';

// Analysis runners
export { runServerPerformance } from './server-performance.js';
export { runWeeklyTrends } from './weekly-trends.js';
export { runDayDecayDetection } from './day-decay.js';
export { runLaborPatterns } from './labor-patterns.js';
export { tagDayWithWeather, loadWeatherHistory, runWeatherForecast } from './weather.js';
export { runExecutiveSummary } from './executive-summary.js';
export { runCompetitorPricing } from './competitor-pricing.js';
export { runReviewSummary } from './reviews.js';
