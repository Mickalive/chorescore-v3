/**
 * ChoreScore V4-04 — E2E attachment adapter (deterministic, test-only)
 *
 * The automated Android/iOS harness must exercise the real "add a photo"
 * journey without a human tapping a system photo picker and without shipping
 * any media library. This adapter provides a deterministic, offline photo
 * source that is enabled ONLY when the explicit E2E flag is set
 * (`EXPO_PUBLIC_E2E_AUTH=1`, via `isE2EAuthEnabled`).
 *
 * Honest rules:
 * - a normal/dev/production build never enables it, so `isAvailable()` stays
 *   false and the UI hides the photo action (the normal build keeps the honest
 *   `LocalAttachmentAdapter` — no faked pick, no fabricated file);
 * - the references are synthetic (`e2e-attachment://<group>/<n>`) and never
 *   leave the operational store; they are not real files nor remote ids;
 * - nothing in the normal UI references this module.
 */

import {
  AttachmentGateway,
  AttachmentHandle,
  AttachmentSource,
} from '../../application/ports';
import { ATTACHMENTS_UNAVAILABLE } from './LocalAttachmentAdapter';
import { isE2EAuthEnabled } from './e2eAuthConfig';

export const E2E_ATTACHMENT_REF_PREFIX = 'e2e-attachment://';

export class E2EAttachmentAdapter implements AttachmentGateway {
  private counter = 0;

  constructor(private readonly enabled: boolean = isE2EAuthEnabled()) {}

  isAvailable(): boolean {
    return this.enabled;
  }

  async pickPhoto(): Promise<AttachmentSource | null> {
    if (!this.enabled) return null;
    return {
      localUri: 'e2e://photo/pick',
      mimeType: 'image/jpeg',
      byteSize: 2048,
      width: 640,
      height: 480,
    };
  }

  async save(source: AttachmentSource, householdId: string): Promise<AttachmentHandle> {
    if (!this.enabled) throw new Error(ATTACHMENTS_UNAVAILABLE);
    this.counter += 1;
    const handle: AttachmentHandle = {
      ref: `${E2E_ATTACHMENT_REF_PREFIX}${householdId}/${this.counter}`,
    };
    if (source.mimeType !== undefined) handle.mimeType = source.mimeType;
    if (source.byteSize !== undefined) handle.byteSize = source.byteSize;
    if (source.width !== undefined) handle.width = source.width;
    if (source.height !== undefined) handle.height = source.height;
    return handle;
  }

  async remove(_handle: AttachmentHandle): Promise<void> {
    // Nothing durable is stored by this synthetic adapter.
  }
}
