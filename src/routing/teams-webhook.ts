/**
 * Teams Incoming Webhook Poster.
 *
 * Posts messages to Microsoft Teams channels using incoming webhook URLs.
 * Uses Office 365 MessageCard format for rich formatting.
 *
 * Webhook URLs are configured in config/teams.json under the "webhooks"
 * section, keyed by channel purpose (ops, finance, marketplace, etc.).
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../util/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR = resolve(__dirname, '../../config');

// ── Types ──

export interface WebhookEntry {
  webhookUrl: string;
  name: string;
}

export interface WebhookConfig {
  webhooks: Record<string, WebhookEntry>;
}

// ── Config Loader ──

let cachedConfig: WebhookConfig | null = null;

/**
 * Loads webhook configuration from config/teams.json.
 * Expects a "webhooks" key with channel keys mapped to
 * { webhookUrl, name } objects.
 *
 * If the webhooks section is missing, returns an empty map.
 */
export function loadWebhookConfig(config?: unknown): WebhookConfig {
  if (cachedConfig && !config) return cachedConfig;

  if (config && typeof config === 'object') {
    const obj = config as Record<string, unknown>;
    const webhooks = (obj.webhooks ?? {}) as Record<string, WebhookEntry>;
    cachedConfig = { webhooks };
    return cachedConfig;
  }

  const filepath = resolve(CONFIG_DIR, 'teams.json');
  if (!existsSync(filepath)) {
    logger.warn('teams.json not found; webhook posting disabled');
    cachedConfig = { webhooks: {} };
    return cachedConfig;
  }

  try {
    const raw = JSON.parse(readFileSync(filepath, 'utf-8'));
    const webhooks = (raw.webhooks ?? {}) as Record<string, WebhookEntry>;
    cachedConfig = { webhooks };
    return cachedConfig;
  } catch (err) {
    logger.error('Failed to parse teams.json for webhooks', { error: String(err) });
    cachedConfig = { webhooks: {} };
    return cachedConfig;
  }
}

/**
 * Resets the cached webhook config so the next call to
 * loadWebhookConfig will re-read from disk.
 */
export function resetWebhookConfigCache(): void {
  cachedConfig = null;
}

// ── Poster ──

/**
 * Posts a message to a Teams channel via incoming webhook.
 *
 * Uses the Office 365 MessageCard format:
 * https://learn.microsoft.com/en-us/outlook/actionable-messages/message-card-reference
 *
 * @param channelKey  Key from the webhooks config (e.g. "ops", "finance")
 * @param title       Card title shown prominently at the top
 * @param body        Message body (supports basic markdown)
 * @returns true if posted successfully, false otherwise
 */
export async function postToTeamsWebhook(
  channelKey: string,
  title: string,
  body: string,
): Promise<boolean> {
  const config = loadWebhookConfig();
  const entry = config.webhooks[channelKey];

  if (!entry) {
    logger.warn('No webhook configured for channel key', { channelKey });
    return false;
  }

  if (!entry.webhookUrl || entry.webhookUrl.trim() === '') {
    logger.info('Webhook URL is empty; skipping post', {
      channelKey,
      name: entry.name,
    });
    return false;
  }

  const card = {
    '@type': 'MessageCard',
    '@context': 'https://schema.org/extensions',
    summary: title,
    themeColor: '0076D7',
    title,
    sections: [
      {
        activityTitle: title,
        text: body,
        markdown: true,
      },
    ],
  };

  try {
    const response = await fetch(entry.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(card),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.error('Webhook post failed', {
        channelKey,
        status: response.status,
        response: text,
      });
      return false;
    }

    logger.info('Webhook post succeeded', {
      channelKey,
      name: entry.name,
      title,
    });
    return true;
  } catch (err) {
    logger.error('Webhook post exception', {
      channelKey,
      error: String(err),
    });
    return false;
  }
}
