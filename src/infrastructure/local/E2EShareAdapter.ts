/**
 * ChoreScore V4-09 — E2E share adapter (deterministic, test-only)
 *
 * The automated Android/iOS harness must exercise the real "share" journey
 * without depending on a system share sheet (which is a SystemUI surface the
 * harness cannot reliably drive or dismiss). This adapter records the share
 * request and reports success, and is enabled ONLY when the explicit E2E flag
 * is set (`EXPO_PUBLIC_E2E_AUTH=1`, via `isE2EAuthEnabled`).
 *
 * Honest rules:
 * - a normal/dev/production build never enables it, so the normal build keeps
 *   the honest `LocalSystemShareAdapter` (real native share sheet);
 * - nothing durable is stored and no network call is made;
 * - nothing in the normal UI references this module.
 */

import { SystemShareGateway, ShareOptions, ShareResult } from '../../application/ports';
import { isE2EAuthEnabled } from './e2eAuthConfig';

export class E2EShareAdapter implements SystemShareGateway {
  private lastShare: ShareOptions | null = null;

  constructor(private readonly enabled: boolean = isE2EAuthEnabled()) {}

  isAvailable(): boolean {
    return this.enabled;
  }

  async share(options: ShareOptions): Promise<ShareResult> {
    if (!this.enabled) return { completed: false };
    this.lastShare = options;
    return { completed: true, method: 'e2e-mock' };
  }

  /** Test seam: the last share request, if any. */
  getLastShare(): ShareOptions | null {
    return this.lastShare;
  }
}
