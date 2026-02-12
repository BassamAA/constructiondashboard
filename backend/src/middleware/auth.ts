import { NextFunction, Request, Response } from "express";
import prisma from "../prismaClient";
import { hashToken } from "../utils/sessionService";
import { UserRole } from "@prisma/client";
import { mergePermissions, hasPermission, PermissionKey } from "../utils/permissions";

const MUTATING_METHODS = new Set(["PUT", "PATCH", "DELETE"]);
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME ?? "sid";

export type AuthenticatedUser = {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
  permissions: ReturnType<typeof mergePermissions>;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      session?: {
        id: string;
      };
    }
  }
}

export async function authenticateSession(req: Request, res: Response, next: NextFunction) {
  const token = (req.cookies?.[SESSION_COOKIE_NAME] ?? "").trim();
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const tokenHash = hashToken(token);

  try {
    const session = await prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      return res.status(401).json({ error: "Session expired. Please log in again." });
    }

    const permissions = mergePermissions(session.user.role, session.user.permissions as any);

    req.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      role: session.user.role,
      permissions,
    };
    req.session = { id: session.id };

    if (session.user.role === "WORKER" && req.method !== "GET") {
      return res.status(403).json({ error: "Workers are not permitted to perform this action" });
    }

    return next();
  } catch (err) {
    console.error("[auth] failed to verify session", err);
    return res.status(500).json({ error: "Unable to verify session" });
  }
}

export function requireRole(...allowed: UserRole[]) {
  const whitelist = new Set<UserRole>(allowed);

  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!whitelist.has(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    return next();
  };
}

export function restrictManagerMutations(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role === "MANAGER" && MUTATING_METHODS.has(req.method.toUpperCase())) {
    return res.status(403).json({ error: "Managers cannot modify or delete existing records" });
  }
  return next();
}

export function requirePermission(permission: PermissionKey, methods?: string[]) {
  const allowedMethods = methods?.map((method) => method.toUpperCase());
  return (req: Request, res: Response, next: NextFunction) => {
    if (allowedMethods && !allowedMethods.includes(req.method.toUpperCase())) {
      return next();
    }
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (req.user.role === UserRole.ADMIN) {
      return next();
    }
    if (!hasPermission(req.user.permissions, permission)) {
      return res.status(403).json({ error: "You do not have permission to perform this action" });
    }
    return next();
  };
}
