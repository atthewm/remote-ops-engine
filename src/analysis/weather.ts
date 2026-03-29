/**
 * Weather Integration Module.
 *
 * Uses the OpenWeatherMap API to tag days with weather conditions and
 * provide a 5 day forecast on Monday mornings. Weather data is saved
 * locally to data/weather/ for historical correlation analysis.
 *
 * Environment variables:
 *   OPENWEATHER_API_KEY  Required for API access
 *   STORE_LAT            Latitude (default: 32.9126 for Garland, TX)
 *   STORE_LON            Longitude (default: -96.6389 for Garland, TX)
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { todayStr } from './base.js';
import { postToTeamsWebhook } from '../routing/teams-webhook.js';
import { logger } from '../util/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEATHER_DIR = resolve(__dirname, '../../data/weather');

// Ensure weather directory exists
if (!existsSync(WEATHER_DIR)) {
  mkdirSync(WEATHER_DIR, { recursive: true });
}

const API_KEY = process.env.OPENWEATHER_API_KEY ?? '';
const LAT = process.env.STORE_LAT ?? '32.9126';
const LON = process.env.STORE_LON ?? '-96.6389';

// ── Types ──

export interface DayWeather {
  date: string;
  tempHigh: number;
  tempLow: number;
  tempAvg: number;
  humidity: number;
  description: string;
  icon: string;
  windSpeed: number;
  precipitation: number;
  conditions: string;
}

interface OWMCurrentResponse {
  main?: { temp?: number; temp_min?: number; temp_max?: number; humidity?: number };
  weather?: Array<{ description?: string; icon?: string; main?: string }>;
  wind?: { speed?: number };
  rain?: { '1h'?: number; '3h'?: number };
  snow?: { '1h'?: number; '3h'?: number };
  [key: string]: unknown;
}

interface OWMForecastEntry {
  dt?: number;
  main?: { temp?: number; temp_min?: number; temp_max?: number; humidity?: number };
  weather?: Array<{ description?: string; icon?: string; main?: string }>;
  wind?: { speed?: number };
  rain?: { '3h'?: number };
  snow?: { '3h'?: number };
  dt_txt?: string;
  [key: string]: unknown;
}

interface OWMForecastResponse {
  list?: OWMForecastEntry[];
  [key: string]: unknown;
}

// ── Tag a Day ──

/**
 * Fetches current weather for the store location and saves it
 * to data/weather/YYYYMMDD.json for historical reference.
 */
export async function tagDayWithWeather(dateStr: string): Promise<DayWeather | null> {
  if (!API_KEY) {
    logger.info('OPENWEATHER_API_KEY not set; skipping weather tagging');
    return null;
  }

  logger.info('Tagging day with weather', { date: dateStr });

  try {
    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${LAT}&lon=${LON}&appid=${API_KEY}&units=imperial`;
    const response = await fetch(url);

    if (!response.ok) {
      logger.error('OpenWeatherMap API error', { status: response.status });
      return null;
    }

    const data = await response.json() as OWMCurrentResponse;

    const weather: DayWeather = {
      date: dateStr,
      tempHigh: data.main?.temp_max ?? 0,
      tempLow: data.main?.temp_min ?? 0,
      tempAvg: data.main?.temp ?? 0,
      humidity: data.main?.humidity ?? 0,
      description: data.weather?.[0]?.description ?? 'unknown',
      icon: data.weather?.[0]?.icon ?? '',
      windSpeed: data.wind?.speed ?? 0,
      precipitation: (data.rain?.['1h'] ?? data.rain?.['3h'] ?? 0)
        + (data.snow?.['1h'] ?? data.snow?.['3h'] ?? 0),
      conditions: data.weather?.[0]?.main ?? 'Unknown',
    };

    // Save to file
    const filename = dateStr.replace(/-/g, '') + '.json';
    const filepath = resolve(WEATHER_DIR, filename);
    writeFileSync(filepath, JSON.stringify(weather, null, 2), 'utf-8');
    logger.info('Weather data saved', { filepath });

    return weather;
  } catch (err) {
    logger.error('Failed to fetch weather', { error: String(err) });
    return null;
  }
}

// ── Load History ──

/**
 * Loads all saved weather files from data/weather/ and returns
 * them sorted by date (oldest first).
 */
export function loadWeatherHistory(): DayWeather[] {
  if (!existsSync(WEATHER_DIR)) return [];

  const files = readdirSync(WEATHER_DIR).filter(f => f.endsWith('.json'));
  const results: DayWeather[] = [];

  for (const file of files) {
    try {
      const raw = readFileSync(resolve(WEATHER_DIR, file), 'utf-8');
      const weather = JSON.parse(raw) as DayWeather;
      results.push(weather);
    } catch (err) {
      logger.warn('Failed to load weather file', { file, error: String(err) });
    }
  }

  results.sort((a, b) => a.date.localeCompare(b.date));
  return results;
}

// ── 5 Day Forecast ──

/**
 * Fetches a 5 day forecast from OpenWeatherMap and posts a summary
 * to the Teams #ops webhook. Intended to run on Monday mornings.
 */
export async function runWeatherForecast(timezone: string): Promise<void> {
  if (!API_KEY) {
    logger.info('OPENWEATHER_API_KEY not set; skipping weather forecast');
    return;
  }

  logger.info('Running 5 day weather forecast');

  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${LAT}&lon=${LON}&appid=${API_KEY}&units=imperial`;
    const response = await fetch(url);

    if (!response.ok) {
      logger.error('OpenWeatherMap forecast API error', { status: response.status });
      return;
    }

    const data = await response.json() as OWMForecastResponse;
    const entries = data.list ?? [];

    if (entries.length === 0) {
      logger.warn('No forecast data returned');
      return;
    }

    // Group by date, find daily high/low and dominant conditions
    const dayMap = new Map<string, {
      temps: number[];
      conditions: string[];
      descriptions: string[];
      precipitation: number;
    }>();

    for (const entry of entries) {
      const dtText = entry.dt_txt ?? '';
      const dateOnly = dtText.split(' ')[0];
      if (!dateOnly) continue;

      const existing = dayMap.get(dateOnly) ?? {
        temps: [],
        conditions: [],
        descriptions: [],
        precipitation: 0,
      };

      existing.temps.push(entry.main?.temp ?? 0);
      existing.conditions.push(entry.weather?.[0]?.main ?? 'Unknown');
      existing.descriptions.push(entry.weather?.[0]?.description ?? 'unknown');
      existing.precipitation += (entry.rain?.['3h'] ?? 0) + (entry.snow?.['3h'] ?? 0);
      dayMap.set(dateOnly, existing);
    }

    // Build message
    const today = todayStr(timezone);
    const lines = [
      `**5 Day Forecast for Remote Coffee (Garland, TX)**`,
      `**Generated:** ${today}`,
      '',
      '| Date | High | Low | Conditions | Precip |',
      '|------|------|-----|------------|--------|',
    ];

    const sortedDates = Array.from(dayMap.keys()).sort().slice(0, 5);

    for (const dateKey of sortedDates) {
      const d = dayMap.get(dateKey)!;
      const high = Math.round(Math.max(...d.temps));
      const low = Math.round(Math.min(...d.temps));

      // Most common condition
      const condCounts = new Map<string, number>();
      for (const c of d.conditions) {
        condCounts.set(c, (condCounts.get(c) ?? 0) + 1);
      }
      const dominant = Array.from(condCounts.entries())
        .sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'Unknown';

      const precip = d.precipitation > 0 ? `${d.precipitation.toFixed(1)}mm` : 'None';

      lines.push(`| ${dateKey} | ${high}F | ${low}F | ${dominant} | ${precip} |`);
    }

    // Add weather impact notes
    const rainyDays = sortedDates.filter(d => {
      const entry = dayMap.get(d)!;
      return entry.precipitation > 0 || entry.conditions.some(c =>
        c.toLowerCase().includes('rain') || c.toLowerCase().includes('snow') || c.toLowerCase().includes('storm')
      );
    });

    if (rainyDays.length > 0) {
      lines.push('');
      lines.push(`**Note:** ${rainyDays.length} day(s) with precipitation expected. Consider staffing adjustments.`);
    }

    const title = 'Weekly Weather Forecast';
    const body = lines.join('\n');

    await postToTeamsWebhook('ops', title, body);

    logger.info('Weather forecast posted', { days: sortedDates.length });
  } catch (err) {
    logger.error('Failed to fetch weather forecast', { error: String(err) });
  }
}
