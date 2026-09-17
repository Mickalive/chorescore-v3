/**
 * ChoreScore V3 — SQLite Storage
 *
 * expo-sqlite based local-first storage with proper indexes.
 * All business data lives here, indexed for fast queries.
 * Navigation reads from this local store without network dependency.
 */

import * as SQLite from 'expo-sqlite';

let db: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync('chorescore.db');
  await initializeSchema(db);
  return db;
}

async function initializeSchema(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      displayName TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS households (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ownerId TEXT NOT NULL,
      contributionUnit TEXT NOT NULL DEFAULT 'minutes',
      crossLedgerCompensationEnabled INTEGER NOT NULL DEFAULT 0,
      contributionToMoneyRateJson TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS memberships (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL,
      householdId TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'MEMBER',
      joinedAt TEXT NOT NULL,
      UNIQUE(userId, householdId)
    );

    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      householdId TEXT NOT NULL,
      name TEXT NOT NULL,
      userId TEXT NOT NULL,
      joinedAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS contribution_entries (
      id TEXT PRIMARY KEY,
      householdId TEXT NOT NULL,
      label TEXT NOT NULL,
      performedByMemberId TEXT NOT NULL,
      beneficiaryMemberIds TEXT NOT NULL,
      value REAL NOT NULL,
      unit TEXT NOT NULL,
      persistentTaskId TEXT,
      occurredAt TEXT NOT NULL,
      createdBy TEXT NOT NULL,
      modifiedBy TEXT
    );

    CREATE TABLE IF NOT EXISTS persistent_tasks (
      id TEXT PRIMARY KEY,
      householdId TEXT NOT NULL,
      name TEXT NOT NULL,
      defaultValue REAL NOT NULL DEFAULT 1,
      defaultUnit TEXT NOT NULL DEFAULT 'minutes',
      defaultBeneficiaryMemberIds TEXT,
      createdAt TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS todo_items (
      id TEXT PRIMARY KEY,
      householdId TEXT NOT NULL,
      title TEXT NOT NULL,
      assigneeMemberId TEXT,
      beneficiaryMemberIds TEXT NOT NULL,
      dueAt TEXT,
      reminderAt TEXT,
      notes TEXT NOT NULL DEFAULT '',
      persistentTaskId TEXT,
      status TEXT NOT NULL DEFAULT 'todo',
      createdAt TEXT NOT NULL,
      completedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS expense_entries (
      id TEXT PRIMARY KEY,
      householdId TEXT NOT NULL,
      title TEXT NOT NULL,
      amountMinor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      paidByMemberId TEXT NOT NULL,
      participantMemberIds TEXT NOT NULL,
      splitMode TEXT NOT NULL DEFAULT 'equal',
      customSharesJson TEXT,
      note TEXT,
      category TEXT,
      occurredAt TEXT NOT NULL,
      createdBy TEXT NOT NULL,
      modifiedBy TEXT
    );

    CREATE TABLE IF NOT EXISTS settlements (
      id TEXT PRIMARY KEY,
      householdId TEXT NOT NULL,
      contributionCreditorMemberId TEXT NOT NULL,
      counterpartyMemberId TEXT NOT NULL,
      contributionValue REAL NOT NULL,
      contributionUnit TEXT NOT NULL,
      moneyAmountMinor INTEGER NOT NULL,
      currency TEXT NOT NULL,
      rateSnapshotJson TEXT NOT NULL,
      occurredAt TEXT NOT NULL,
      createdBy TEXT NOT NULL
    );

    -- Indexes for fast local queries
    CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(userId);
    CREATE INDEX IF NOT EXISTS idx_memberships_household ON memberships(householdId);
    CREATE INDEX IF NOT EXISTS idx_members_household ON members(householdId);
    CREATE INDEX IF NOT EXISTS idx_contributions_household ON contribution_entries(householdId);
    CREATE INDEX IF NOT EXISTS idx_contributions_occurred ON contribution_entries(householdId, occurredAt);
    CREATE INDEX IF NOT EXISTS idx_contributions_unit ON contribution_entries(householdId, unit);
    CREATE INDEX IF NOT EXISTS idx_tasks_household ON persistent_tasks(householdId);
    CREATE INDEX IF NOT EXISTS idx_todos_household ON todo_items(householdId);
    CREATE INDEX IF NOT EXISTS idx_todos_status ON todo_items(householdId, status);
    CREATE INDEX IF NOT EXISTS idx_expenses_household ON expense_entries(householdId);
    CREATE INDEX IF NOT EXISTS idx_expenses_occurred ON expense_entries(householdId, occurredAt);
    CREATE INDEX IF NOT EXISTS idx_settlements_household ON settlements(householdId);

    -- V3-06: Invitations
    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      householdId TEXT NOT NULL,
      invitedByUserId TEXT NOT NULL,
      invitedEmail TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'MEMBER',
      status TEXT NOT NULL DEFAULT 'pending',
      linkToken TEXT NOT NULL UNIQUE,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invitations_household ON invitations(householdId);
    CREATE INDEX IF NOT EXISTS idx_invitations_link_token ON invitations(linkToken);
    CREATE INDEX IF NOT EXISTS idx_invitations_email ON invitations(invitedEmail, status);

    -- V3-06: Sync cursors
    CREATE TABLE IF NOT EXISTS sync_cursors (
      householdId TEXT NOT NULL,
      collection TEXT NOT NULL,
      lastRevision INTEGER NOT NULL DEFAULT 0,
      lastSyncedAt TEXT NOT NULL,
      PRIMARY KEY (householdId, collection)
    );

    -- V3-06: Sync records (delta buffer)
    CREATE TABLE IF NOT EXISTS sync_records (
      id TEXT NOT NULL,
      householdId TEXT NOT NULL,
      collection TEXT NOT NULL,
      revision INTEGER NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT,
      payload TEXT,
      PRIMARY KEY (id, collection)
    );
    CREATE INDEX IF NOT EXISTS idx_sync_records_dirty ON sync_records(householdId, collection, revision);
  `);
}

/**
 * Helper to parse JSON arrays stored as text in SQLite.
 */
export function parseJsonArray<T>(text: string | null): T[] {
  if (!text) return [];
  try {
    return JSON.parse(text) as T[];
  } catch {
    return [];
  }
}

/**
 * Helper to serialize arrays to JSON text for SQLite storage.
 */
export function toJsonArray<T>(items: T[]): string {
  return JSON.stringify(items);
}
