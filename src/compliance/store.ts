// src/compliance/store.ts — Pluggable storage for compliance justifications

import type { ComplianceJustification } from './types.js';

/**
 * A justification store persists DSA Art. 17 explanations so users can
 * retrieve them later (on a "permanent medium" as the law requires).
 *
 * Implement this interface to use a database, file system, or cloud storage.
 * The ID is a string you control — could be a UUID, a database row ID, etc.
 */
export interface JustificationStore {
  /**
   * Persist a justification under the given ID.
   * Throw on error (e.g., storage full, network down).
   */
  save(id: string, justification: ComplianceJustification): Promise<void>;

  /**
   * Retrieve a justification by ID.
   * Return null if not found (no throw for missing IDs — let the
   * caller decide whether that's an error).
   */
  get(id: string): Promise<ComplianceJustification | null>;

  /**
   * Optional: list all stored IDs (useful for debugging and admin panels).
   * If not implemented, omit the method entirely.
   */
  list?(): Promise<string[]>;
}

/**
 * In-memory store — useful for demos and testing, but DOES NOT persist.
 * For production, implement JustificationStore against a real database.
 *
 * In the legal sense (DSA Art. 17), "permanent medium" means the user must be
 * able to retrieve the justification later — a month later, a year later.
 * An in-memory map is cleared when the process restarts. Use a database.
 */
export class InMemoryJustificationStore implements JustificationStore {
  private store = new Map<string, ComplianceJustification>();

  async save(id: string, justification: ComplianceJustification): Promise<void> {
    this.store.set(id, justification);
  }

  async get(id: string): Promise<ComplianceJustification | null> {
    return this.store.get(id) ?? null;
  }

  async list(): Promise<string[]> {
    return Array.from(this.store.keys());
  }
}
