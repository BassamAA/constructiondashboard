import { Prisma } from "@prisma/client";
import prisma from "../prismaClient";

type AuditPayload = {
  action: string;
  entityType: string;
  entityId?: number | null;
  description?: string | null;
  user?: string | null;
  metadata?: unknown;
};

export async function logAudit({
  action,
  entityType,
  entityId = null,
  description = null,
  user = null,
  metadata,
}: AuditPayload): Promise<void> {
  try {
    const normalizedMetadata =
      metadata === undefined ? undefined : metadata === null ? Prisma.JsonNull : metadata;

    await prisma.auditLog.create({
      data: {
        action,
        entityType,
        entityId,
        description,
        user,
        ...(normalizedMetadata !== undefined ? { metadata: normalizedMetadata } : {}),
      },
    });
  } catch (err) {
    console.error("Failed to persist audit log", err);
  }
}
