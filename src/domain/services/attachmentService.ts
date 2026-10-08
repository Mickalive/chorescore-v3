/**
 * ChoreScore V4 — attachment service (provider-agnostic).
 *
 * Attachments are optional photos on a task or an expense. The domain only
 * ever sees an opaque `ref` produced by an AttachmentGateway adapter: no
 * provider type, no file path semantics, no cloud assumption.
 *
 * Privacy: the reference itself can carry sensitive information (local path,
 * provider file id), so it never leaves the operational store.
 * `attachmentReleaseDescriptor` is the ONLY shape allowed to travel toward
 * the research/release plane, and it contains metadata only.
 */

import { Attachment, AttachmentKind } from '../entities';

/** Local references are bounded so a malformed pick cannot bloat the store. */
export const ATTACHMENT_REF_MAX_LENGTH = 512;
export const ATTACHMENT_NOTE_MAX_LENGTH = 2000;

export interface AttachmentInput {
  id: string;
  kind: AttachmentKind;
  ref: string;
  mimeType?: string;
  byteSize?: number;
  width?: number;
  height?: number;
  createdAt: string;
}

function requireAttachmentKind(kind: string): asserts kind is AttachmentKind {
  if (kind !== 'photo') {
    throw new Error(`Unsupported attachment kind '${kind}'`);
  }
}

/** Validate and copy an attachment coming from a provider adapter. */
export function createAttachment(input: AttachmentInput): Attachment {
  requireAttachmentKind(input.kind);

  if (typeof input.ref !== 'string' || input.ref.trim().length === 0) {
    throw new Error('Attachment reference must be a non-empty string');
  }
  if (input.ref.length > ATTACHMENT_REF_MAX_LENGTH) {
    throw new Error(
      `Attachment reference must be at most ${ATTACHMENT_REF_MAX_LENGTH} characters`
    );
  }
  if (typeof input.id !== 'string' || input.id.trim().length === 0) {
    throw new Error('Attachment id must be a non-empty string');
  }

  const attachment: Attachment = {
    id: input.id,
    kind: input.kind,
    ref: input.ref,
    createdAt: input.createdAt,
  };

  if (input.mimeType !== undefined) attachment.mimeType = input.mimeType;
  if (input.byteSize !== undefined) {
    if (!Number.isFinite(input.byteSize) || input.byteSize < 0) {
      throw new Error('Attachment byteSize must be a non-negative number');
    }
    attachment.byteSize = input.byteSize;
  }
  for (const dimension of ['width', 'height'] as const) {
    const value = input[dimension];
    if (value !== undefined) {
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(`Attachment ${dimension} must be a non-negative integer`);
      }
      attachment[dimension] = value;
    }
  }

  return attachment;
}

/** Opaque reference for the storage adapter (never interpreted by the domain). */
export function attachmentRefOf(attachment: Attachment): string {
  return attachment.ref;
}

/**
 * Metadata-only projection safe for non-operational use.
 * Deliberately omits `id` and `ref`: no reference, path or join key ever
 * crosses into a release/analytics payload.
 */
export interface AttachmentReleaseDescriptor {
  kind: AttachmentKind;
  mimeType?: string;
  byteSize?: number;
  width?: number;
  height?: number;
}

export function attachmentReleaseDescriptor(
  attachment: Attachment
): AttachmentReleaseDescriptor {
  requireAttachmentKind(attachment.kind);
  const descriptor: AttachmentReleaseDescriptor = { kind: attachment.kind };
  if (attachment.mimeType !== undefined) descriptor.mimeType = attachment.mimeType;
  if (attachment.byteSize !== undefined) descriptor.byteSize = attachment.byteSize;
  if (attachment.width !== undefined) descriptor.width = attachment.width;
  if (attachment.height !== undefined) descriptor.height = attachment.height;
  return descriptor;
}

/**
 * Normalize an optional free note: trim, bound the length, drop empties.
 * Notes stay operational-only and are never exported as free text.
 */
export function normalizeNote(note?: string | null): string | undefined {
  if (note === null || note === undefined) return undefined;
  if (typeof note !== 'string') throw new Error('Note must be a string');
  const trimmed = note.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > ATTACHMENT_NOTE_MAX_LENGTH) {
    throw new Error(
      `Note must be at most ${ATTACHMENT_NOTE_MAX_LENGTH} characters, got ${trimmed.length}`
    );
  }
  return trimmed;
}
