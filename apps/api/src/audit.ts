import type { Kysely, Transaction } from 'kysely';
import type { Database } from './db/schema.js';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  reason?: string | null;
  /** Never put passwords, tokens or session IDs here. */
  metadata?: Record<string, unknown>;
}

/** FR-30: record administrative actions for accountability. */
export async function audit(db: Kysely<Database> | Transaction<Database>, e: AuditEntry) {
  await db
    .insertInto('audit_log')
    .values({
      actor_id: e.actorId,
      action: e.action,
      target_type: e.targetType,
      target_id: e.targetId,
      reason: e.reason ?? null,
      metadata: JSON.stringify(e.metadata ?? {}),
    })
    .execute();
}
