/**
 * ChoreScore V3 — Repository Interfaces
 *
 * Provider-independent contracts for data access.
 * V3 domain entities carry their own unit/currency so history is never reinterpreted.
 */

import {
  User,
  Membership,
  Household,
  Member,
  ContributionEntry,
  PersistentTask,
  TodoItem,
  ExpenseEntry,
  CrossLedgerSettlement,
} from '../../domain/entities';

export interface UserRepository {
  getById(id: string): Promise<User | null>;
  getByEmail(email: string): Promise<User | null>;
  create(data: Omit<User, 'id' | 'createdAt'>): Promise<User>;
  update(id: string, data: Partial<User>): Promise<User>;
  getAll(): Promise<User[]>;
}

export interface MembershipRepository {
  getByUser(userId: string): Promise<Membership[]>;
  getByHousehold(householdId: string): Promise<Membership[]>;
  getByUserAndHousehold(userId: string, householdId: string): Promise<Membership | null>;
  create(data: Omit<Membership, 'id' | 'joinedAt'>): Promise<Membership>;
  delete(id: string): Promise<void>;
}

export interface HouseholdRepository {
  getAll(): Promise<Household[]>;
  getById(id: string): Promise<Household | null>;
  create(data: Omit<Household, 'id' | 'createdAt'>): Promise<Household>;
  update(id: string, data: Partial<Household>): Promise<Household>;
  delete(id: string): Promise<void>;
}

export interface MemberRepository {
  getByHousehold(householdId: string): Promise<Member[]>;
  getById(id: string): Promise<Member | null>;
  create(data: Omit<Member, 'id' | 'joinedAt'>): Promise<Member>;
}

export interface ContributionEntryRepository {
  getByHousehold(householdId: string): Promise<ContributionEntry[]>;
  getById(id: string): Promise<ContributionEntry | null>;
  create(entry: Omit<ContributionEntry, 'id'>): Promise<ContributionEntry>;
  update(id: string, data: Partial<ContributionEntry>): Promise<ContributionEntry>;
  delete(id: string): Promise<void>;
}

export interface PersistentTaskRepository {
  getByHousehold(householdId: string): Promise<PersistentTask[]>;
  getById(id: string): Promise<PersistentTask | null>;
  create(task: Omit<PersistentTask, 'id' | 'createdAt'>): Promise<PersistentTask>;
  delete(id: string): Promise<void>;
}

export interface TodoRepository {
  getByHousehold(householdId: string): Promise<TodoItem[]>;
  getById(id: string): Promise<TodoItem | null>;
  create(todo: Omit<TodoItem, 'id' | 'createdAt'>): Promise<TodoItem>;
  update(id: string, data: Partial<TodoItem>): Promise<TodoItem>;
  delete(id: string): Promise<void>;
}

export interface ExpenseEntryRepository {
  getByHousehold(householdId: string): Promise<ExpenseEntry[]>;
  getById(id: string): Promise<ExpenseEntry | null>;
  create(entry: Omit<ExpenseEntry, 'id'>): Promise<ExpenseEntry>;
  update(id: string, data: Partial<ExpenseEntry>): Promise<ExpenseEntry>;
  delete(id: string): Promise<void>;
}

export interface SettlementRepository {
  getByHousehold(householdId: string): Promise<CrossLedgerSettlement[]>;
  getById(id: string): Promise<CrossLedgerSettlement | null>;
  create(settlement: Omit<CrossLedgerSettlement, 'id'>): Promise<CrossLedgerSettlement>;
  delete(id: string): Promise<void>;
}
