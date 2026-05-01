import 'server-only';

import { currentUser } from '@clerk/nextjs/server';
import { db } from '@/db';
import { auditEvent } from '@/db/schema';
import { publishRealtime } from '@/lib/realtime';
import { normalizeAuditAction } from '@/lib/audit-taxonomy';

type AuditPayload = Record<string, unknown> | null;

type AuditActorInput = {
  email?: string | null;
  id?: string | null;
};

type WriteAuditInput = {
  action: string;
  actor?: AuditActorInput | null;
  after?: unknown;
  before?: unknown;
  entityId: string;
  entityType: string;
  publish?: boolean;
  reason?: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE_KEY_PATTERN = /(password|secret|token|authorization|cookie|credential|session|otp|api[_-]?key|access[_-]?key|private[_-]?key)/i;
const REDACTED = '[redacted]';

function toActorUserId(id: string | null | undefined) {
  if (!id || !UUID_PATTERN.test(id)) return null;
  return id;
}

export async function getAuditActor(actor?: AuditActorInput | null) {
  let actorEmail = actor?.email?.trim() || '';
  let actorId = actor?.id || null;

  if (!actorEmail || !actorId) {
    try {
      const user = await currentUser();
      if (user) {
        actorEmail = actorEmail || user.emailAddresses[0]?.emailAddress || 'unknown';
        actorId = actorId || user.id;
      }
    } catch {
      // Anonymous/system work is still auditable.
    }
  }

  return {
    actorEmail: actorEmail || 'system',
    actorUserId: toActorUserId(actorId),
  };
}

function sanitizeValue(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;

  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, seen));
  }

  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    output[key] = SENSITIVE_KEY_PATTERN.test(key)
      ? REDACTED
      : sanitizeValue(item, seen);
  }

  return output;
}

export function sanitizeAuditPayload(value: unknown): AuditPayload {
  if (value === null || value === undefined) return null;
  const sanitized = sanitizeValue(value, new WeakSet());
  if (sanitized && typeof sanitized === 'object' && !Array.isArray(sanitized)) {
    return sanitized as AuditPayload;
  }

  return { value: sanitized };
}

export async function writeAuditEvent(input: WriteAuditInput) {
  const actor = await getAuditActor(input.actor);
  const action = normalizeAuditAction(input.action);

  const [event] = await db.insert(auditEvent).values({
    entityType: input.entityType,
    entityId: input.entityId,
    action,
    beforeJson: sanitizeAuditPayload(input.before),
    afterJson: sanitizeAuditPayload(input.after),
    actorUserId: actor.actorUserId,
    actorEmail: actor.actorEmail,
  }).returning({ id: auditEvent.id });

  if (input.publish !== false) {
    const eventPayload = {
      reason: input.reason || 'audit',
      entityType: input.entityType,
      entityId: input.entityId,
      action,
      auditEventId: event?.id,
    };

    publishRealtime('audit-trail', 'invalidate', eventPayload);
    publishRealtime('dashboard', 'invalidate', eventPayload);
    publishRealtime('notifications', 'invalidate', eventPayload);
  }

  return event;
}

export async function tryWriteAuditEvent(input: WriteAuditInput) {
  try {
    return await writeAuditEvent(input);
  } catch (error) {
    console.error('Audit log failed:', error);
    return null;
  }
}
