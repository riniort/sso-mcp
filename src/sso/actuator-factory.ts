import { join } from 'node:path';
import { defaultStoreRoot } from '../store/root.js';
import type { SsoPortalActuator } from './actuator.js';
import { UnconfiguredPortalActuator } from './actuator.js';
import { BrowserPortalActuator } from './browser-actuator.js';

/**
 * Live browser use is OFF unless explicitly enabled, so a default install never
 * opens a browser or reads a credential (PROJECT.md §6 lazy-auth). Enable with:
 *   SSOMCP_LIVE=1                 → allow the real Playwright login/session
 *   SSOMCP_ENABLE_WRITE_FLOW=1    → additionally allow the (still-to-be-verified)
 *                                   attach/save/submit flow
 *   SSOMCP_HEADFUL=1              → show the browser window (default headless)
 */
export interface PortalRuntimeConfig {
  live: boolean;
  enableWriteFlow: boolean;
  headless: boolean;
  credentialTargetPrefix: string;
  /** Directory for per-นายจ้าง session files (`<dir>/<accountNo>.json`). */
  storageStateDir: string;
  /** Test/host override; when set it wins over env-based construction. */
  createActuator?: () => SsoPortalActuator;
}

export function resolvePortalConfig(
  env: NodeJS.ProcessEnv = process.env,
  storeRoot: string = defaultStoreRoot(),
  overrides: Partial<PortalRuntimeConfig> = {},
): PortalRuntimeConfig {
  const truthy = (value: string | undefined) => value === '1' || value?.toLowerCase() === 'true';
  return {
    live: truthy(env.SSOMCP_LIVE),
    enableWriteFlow: truthy(env.SSOMCP_ENABLE_WRITE_FLOW),
    headless: !truthy(env.SSOMCP_HEADFUL),
    credentialTargetPrefix: env.SSOMCP_CRED_PREFIX?.trim() || 'ssomcp',
    storageStateDir: join(storeRoot, 'session'),
    ...overrides,
  };
}

export function buildActuator(config: PortalRuntimeConfig): SsoPortalActuator {
  if (config.createActuator) return config.createActuator();
  if (!config.live) return new UnconfiguredPortalActuator();
  return new BrowserPortalActuator({
    headless: config.headless,
    enableWriteFlow: config.enableWriteFlow,
    credentialTargetPrefix: config.credentialTargetPrefix,
    storageStateDir: config.storageStateDir,
  });
}
