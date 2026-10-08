/**
 * ChoreScore V4 — Local Attachment Adapter (honest, provider-agnostic)
 *
 * V4-01 ships the attachment PORT only: no photo provider (media library /
 * camera) is configured in this tranche, so the adapter reports itself as
 * unavailable instead of faking a pick or inventing a stored file.
 *
 * Behaviour contract:
 *   - isAvailable() === false while no provider is wired;
 *   - pickPhoto() resolves null (the UI hides the photo action);
 *   - save() rejects with 'attachments-unavailable' so no phantom reference
 *     can ever be attached to a ledger entry;
 *   - remove() is a harmless no-op.
 *
 * The photo criterion later supplies a real provider behind this same port;
 * the domain, entities and repositories do not change.
 */

import { AttachmentGateway, AttachmentHandle, AttachmentSource } from '../../application/ports';

export const ATTACHMENTS_UNAVAILABLE = 'attachments-unavailable';

export class LocalAttachmentAdapter implements AttachmentGateway {
  isAvailable(): boolean {
    return false;
  }

  async pickPhoto(): Promise<AttachmentSource | null> {
    return null;
  }

  async save(_source: AttachmentSource, _householdId: string): Promise<AttachmentHandle> {
    throw new Error(ATTACHMENTS_UNAVAILABLE);
  }

  async remove(_handle: AttachmentHandle): Promise<void> {
    // Nothing was stored by this adapter: nothing to delete.
  }
}
