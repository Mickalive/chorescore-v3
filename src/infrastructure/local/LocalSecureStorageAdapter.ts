/**
 * ChoreScore V3 — Local Secure Storage Adapter
 *
 * Uses expo-secure-store when available. Falls back gracefully.
 */

import { SecureStorageGateway } from '../../application/ports';

export class LocalSecureStorageAdapter implements SecureStorageGateway {
  private secureStore: typeof import('expo-secure-store') | null = null;

  private async getStore() {
    if (this.secureStore) return this.secureStore;
    try {
      this.secureStore = require('expo-secure-store');
      return this.secureStore;
    } catch {
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    const store = await this.getStore();
    if (store) {
      await store.setItemAsync(key, value);
    }
  }

  async getItem(key: string): Promise<string | null> {
    const store = await this.getStore();
    if (store) {
      return store.getItemAsync(key);
    }
    return null;
  }

  async deleteItem(key: string): Promise<void> {
    const store = await this.getStore();
    if (store) {
      await store.deleteItemAsync(key);
    }
  }

  async clear(): Promise<void> {
    // Secure store has no clear-all; individual deletions only
  }
}
