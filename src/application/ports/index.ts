/**
 * ChoreScore V3 — Application Ports (Interfaces)
 *
 * Contracts between domain/application and infrastructure.
 * V3 removes: billing, entitlements, premium, chrono.
 * V3 preserves: auth, share, notifications, calendar, secure storage, sync, analytics, invitations.
 * Domain never depends on any external provider directly.
 */

// ── Auth Ports ─────────────────────────────────────────────────

export interface AuthGateway {
  isAvailable(): boolean;
  getCurrentUserId(): string | null;
  getCurrentUser(): AuthUser | null;
  signInWithEmail(email: string, password: string): Promise<AuthUser | null>;
  signInWithGoogle(): Promise<AuthUser | null>;
  signInWithFacebook(): Promise<AuthUser | null>;
  signOut(): Promise<void>;
  onAuthStateChanged(callback: (user: AuthUser | null) => void): () => void;
  persistSession(token: AuthSessionToken): Promise<void>;
  restoreSession(): Promise<AuthSessionToken | null>;
  clearSession(): Promise<void>;
}

export interface AuthSessionToken {
  userId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  provider: 'email' | 'google' | 'facebook' | 'local';
}

export interface AuthUser {
  userId: string;
  email: string;
  displayName: string;
  provider: 'email' | 'google' | 'facebook' | 'local';
}

// ── System Ports ───────────────────────────────────────────────

export interface SystemShareGateway {
  isAvailable(): boolean;
  share(options: ShareOptions): Promise<ShareResult>;
}

export interface ShareOptions {
  title?: string;
  message?: string;
  url?: string;
  files?: string[];
}

export interface ShareResult {
  completed: boolean;
  method?: string;
}

export interface NotificationGateway {
  isAvailable(): boolean;
  requestPermission(): Promise<boolean>;
  scheduleNotification(options: NotificationOptions): Promise<string>;
  cancelNotification(id: string): Promise<void>;
}

export interface NotificationOptions {
  title: string;
  body: string;
  scheduledAt?: string;
  data?: Record<string, unknown>;
}

export interface CalendarGateway {
  isAvailable(): boolean;
  requestPermission(): Promise<boolean>;
  createEvent(options: CalendarEventOptions): Promise<string | null>;
  deleteEvent(id: string): Promise<void>;
}

export interface CalendarEventOptions {
  title: string;
  notes?: string;
  startDate: string;
  endDate: string;
  allDay?: boolean;
}

export interface SecureStorageGateway {
  setItem(key: string, value: string): Promise<void>;
  getItem(key: string): Promise<string | null>;
  deleteItem(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface SyncGateway {
  isAvailable(): boolean;
  startSync(householdId: string): Promise<void>;
  stopSync(householdId: string): Promise<void>;
  pushChanges(householdId: string): Promise<void>;
  pullChanges(householdId: string): Promise<void>;
  getStatus(householdId: string): Promise<SyncStatus>;
}

export interface SyncStatus {
  isSyncing: boolean;
  lastSyncedAt: string | null;
  pendingChanges: number;
  error: string | null;
}

// ── Analytics Port ─────────────────────────────────────────────

export interface ResearchAnalyticsGateway {
  isEnabled(): boolean;
  setEnabled(enabled: boolean): void;
  emitFact(fact: AnalyticsFact): void;
  isAvailable(): boolean;
}

export interface AnalyticsFact {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

// ── Invitation Port ────────────────────────────────────────────

export interface InvitationGateway {
  createInvitation(data: InvitationCreateData): Promise<Invitation>;
  acceptInvitation(invitationId: string, userId: string): Promise<InvitationResult>;
  declineInvitation(invitationId: string, userId: string): Promise<InvitationResult>;
  getPendingInvitations(userId: string): Promise<Invitation[]>;
  getHouseholdInvitations(householdId: string): Promise<Invitation[]>;
  revokeInvitation(invitationId: string, householdId: string): Promise<void>;
}

export interface InvitationCreateData {
  householdId: string;
  invitedByUserId: string;
  invitedEmail: string;
  role?: 'MEMBER' | 'ADMIN';
}

export interface Invitation {
  id: string;
  householdId: string;
  invitedByUserId: string;
  invitedEmail: string;
  role: 'MEMBER' | 'ADMIN';
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  createdAt: string;
  expiresAt: string;
}

export interface InvitationResult {
  success: boolean;
  error?: string;
  membershipId?: string;
}

// ── Attachment Port (V4-01) ────────────────────────────────────

/**
 * Photo attachments behind an honest port.
 *
 * The domain only receives an opaque `ref` from this adapter, so no provider
 * type (camera roll, cloud file id, media library) ever enters the ledger.
 * When no provider is configured on the current build the adapter reports
 * `isAvailable() === false` and `pickPhoto()` resolves null — the UI then
 * hides the action instead of faking a photo.
 */
export interface AttachmentGateway {
  isAvailable(): boolean;
  /** User picked a photo, or cancelled / provider unavailable (null). */
  pickPhoto(): Promise<AttachmentSource | null>;
  /** Persist a picked source and return its opaque reference. */
  save(source: AttachmentSource, householdId: string): Promise<AttachmentHandle>;
  /** Remove the stored payload behind a reference. */
  remove(handle: AttachmentHandle): Promise<void>;
}

export interface AttachmentSource {
  localUri: string;
  mimeType?: string;
  byteSize?: number;
  width?: number;
  height?: number;
}

export interface AttachmentHandle {
  ref: string;
  mimeType?: string;
  byteSize?: number;
  width?: number;
  height?: number;
}

// ── Permissions ────────────────────────────────────────────────

export type MemberPermissionLevel = 'OWNER' | 'ADMIN' | 'MEMBER';

export interface MemberPermissions {
  canCreateEntry: boolean;
  canEditAnyEntry: boolean;
  canDeleteAnyEntry: boolean;
  canManagePersistentTasks: boolean;
  canManageTodos: boolean;
  canViewFullHistory: boolean;
  canManageMembers: boolean;
  canManageHouseholdOptions: boolean;
  canInviteMembers: boolean;
  canRemoveMembers: boolean;
}
