import { Router } from "express";
import prisma from "../prismaClient";
import { createSession, revokeSessionById, SESSION_COOKIE_NAME } from "../utils/sessionService";
import { hashPassword, verifyPassword } from "../utils/password";
import { authenticateSession, requireRole } from "../middleware/auth";
import { UserRole } from "@prisma/client";
import { mergePermissions, sanitizePermissionInput } from "../utils/permissions";

const router = Router();

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

router.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || typeof email !== "string" || !password || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
  });

  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const { rawToken, session } = await createSession(user.id, {
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip,
  });

  res.cookie(SESSION_COOKIE_NAME, rawToken, {
    ...COOKIE_OPTIONS,
    maxAge: Number(process.env.SESSION_TTL_MS ?? 1000 * 60 * 60 * 24 * 7),
  });

  return res.json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      permissions: mergePermissions(user.role, user.permissions as any),
    },
    sessionId: session.id,
  });
});

router.post("/logout", authenticateSession, async (req, res) => {
  if (req.session) {
    await revokeSessionById(req.session.id);
  }
  res.clearCookie(SESSION_COOKIE_NAME, COOKIE_OPTIONS);
  return res.json({ success: true });
});

router.get("/me", authenticateSession, async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ error: "Not authenticated" });
  }
  return res.json({ user: req.user });
});

router.post(
  "/users",
  authenticateSession,
  requireRole(UserRole.ADMIN),
  async (req, res) => {
    const { email, password, role, name, permissions } = req.body ?? {};

    if (!email || typeof email !== "string" || !password || typeof password !== "string") {
      return res.status(400).json({ error: "Email and password are required" });
    }

    if (typeof role !== "string" || !Object.values(UserRole).includes(role as UserRole)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const normalizedEmail = normalizeEmail(email);
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(409).json({ error: "A user with this email already exists" });
    }

    const passwordHash = await hashPassword(password);
    const permissionOverrides = sanitizePermissionInput(permissions);

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        name: typeof name === "string" ? name.trim() : null,
        role: role as UserRole,
        passwordHash,
        permissions: permissionOverrides ?? undefined,
      },
    });

    return res.status(201).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        permissions: mergePermissions(user.role, user.permissions as any),
      },
    });
  },
);

router.get(
  "/users",
  authenticateSession,
  requireRole(UserRole.ADMIN),
  async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: { id: "asc" },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        permissions: true,
      },
    });

    return res.json({
      users: users.map((account) => ({
        id: account.id,
        email: account.email,
        name: account.name,
        role: account.role,
        createdAt: account.createdAt,
        updatedAt: account.updatedAt,
        permissions: mergePermissions(account.role, account.permissions as any),
        permissionOverrides: account.permissions ?? null,
      })),
    });
  },
);

router.patch(
  "/users/:id",
  authenticateSession,
  requireRole(UserRole.ADMIN),
  async (req, res) => {
    const userId = Number(req.params.id);
    if (Number.isNaN(userId)) {
      return res.status(400).json({ error: "Invalid user id" });
    }

    const { role, permissions, password, name } = req.body ?? {};

    const data: any = {};

    if (role) {
      if (!Object.values(UserRole).includes(role)) {
        return res.status(400).json({ error: "Invalid role" });
      }
      data.role = role;
    }

    if (permissions !== undefined) {
      const sanitized = sanitizePermissionInput(permissions);
      data.permissions = sanitized ?? null;
    }

    if (typeof name === "string") {
      data.name = name.trim();
    }

    if (password) {
      if (typeof password !== "string" || password.length < 8) {
        return res.status(400).json({ error: "Password must be at least 8 characters" });
      }
      data.passwordHash = await hashPassword(password);
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: "No updates provided" });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data,
    });

    return res.json({
      user: {
        id: updated.id,
        email: updated.email,
        name: updated.name,
        role: updated.role,
        permissions: mergePermissions(updated.role, updated.permissions as any),
      },
    });
  },
);

router.post("/bootstrap", async (req, res) => {
  const userCount = await prisma.user.count();
  if (userCount > 0) {
    return res.status(400).json({ error: "Users already exist. Use the normal login flow." });
  }

  const bootstrapToken = process.env.ADMIN_BOOTSTRAP_TOKEN;
  if (!bootstrapToken) {
    return res.status(500).json({ error: "ADMIN_BOOTSTRAP_TOKEN is not configured" });
  }

  const provided = req.header("x-bootstrap-token");
  if (!provided || provided !== bootstrapToken) {
    return res.status(403).json({ error: "Invalid bootstrap token" });
  }

  const { email, password, name } = req.body ?? {};
  if (!email || typeof email !== "string" || !password || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required" });
  }

  const user = await prisma.user.create({
    data: {
      email: normalizeEmail(email),
      passwordHash: await hashPassword(password),
      name: typeof name === "string" ? name.trim() : null,
      role: UserRole.ADMIN,
    },
  });

  return res.status(201).json({
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      permissions: mergePermissions(user.role, user.permissions as any),
    },
  });
});

export default router;
