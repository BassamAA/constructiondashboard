import crypto from "crypto";
import prisma from "../prismaClient";

export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "sid";
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS ?? 1000 * 60 * 60 * 24 * 7); // 7 days

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: number,
  metadata: { userAgent?: string; ipAddress?: string } = {},
) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  const session = await prisma.session.create({
    data: {
      tokenHash,
      userId,
      expiresAt,
      userAgent: metadata.userAgent ?? null,
      ipAddress: metadata.ipAddress ?? null,
      lastUsedAt: new Date(),
    },
  });

  return { rawToken, session };
}

export async function revokeSessionById(id: string) {
  await prisma.session.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeSessionByToken(token: string) {
  const tokenHash = hashToken(token);
  await prisma.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
