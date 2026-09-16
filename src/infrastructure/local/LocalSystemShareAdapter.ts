/**
 * ChoreScore V3 — Local System Share Adapter
 *
 * Uses expo-sharing when available, honest fallback when not.
 */

import { SystemShareGateway, ShareOptions, ShareResult } from '../../application/ports';

export class LocalSystemShareAdapter implements SystemShareGateway {
  private shareAsync: (() => Promise<{ completed: boolean }>) | null = null;

  isAvailable(): boolean {
    return true;
  }

  async share(options: ShareOptions): Promise<ShareResult> {
    try {
      // Lazy-load expo-sharing to avoid import failures when module unavailable
      if (!this.shareAsync) {
        try {
          const sharing = require('expo-sharing');
          if (await sharing.isAvailableAsync()) {
            this.shareAsync = () =>
              sharing.shareAsync(options.url || options.message || '', {
                mimeType: 'text/plain',
                dialogTitle: options.title || 'Partager',
              });
          }
        } catch {
          // expo-sharing not available
        }
      }

      if (this.shareAsync) {
        const result = await this.shareAsync();
        return { completed: result.completed, method: 'system-share' };
      }

      return { completed: false };
    } catch {
      return { completed: false };
    }
  }
}
