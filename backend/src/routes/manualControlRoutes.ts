import { Router } from "express";
import { AdminOverrideCategory, Prisma } from "@prisma/client";
import prisma from "../prismaClient";

const router = Router();

const CATEGORY_KEYS = {
  inventoryValue: AdminOverrideCategory.INVENTORY_VALUE,
  receivablesTotal: AdminOverrideCategory.RECEIVABLES_TOTAL,
  payablesTotal: AdminOverrideCategory.PAYABLES_TOTAL,
} as const;

type ManualControlKey = keyof typeof CATEGORY_KEYS;

type ManualControlState = {
  value: number | null;
  updatedAt: string | null;
  updatedBy: {
    id: number;
    name: string | null;
    email: string;
  } | null;
};

const defaultControlState: ManualControlState = {
  value: null,
  updatedAt: null,
  updatedBy: null,
};

type AdminOverrideWithUser = Prisma.AdminOverrideGetPayload<{
  include: {
    updatedByUser: {
      select: { id: true; name: true; email: true };
    };
  };
}>[];

function serializeOverrides(overrides: AdminOverrideWithUser) {
  const response: Record<ManualControlKey, ManualControlState> = {
    inventoryValue: { ...defaultControlState },
    receivablesTotal: { ...defaultControlState },
    payablesTotal: { ...defaultControlState },
  };

  overrides.forEach((override) => {
    const key = Object.entries(CATEGORY_KEYS).find(
      ([, category]) => category === override.category,
    )?.[0] as ManualControlKey | undefined;
    if (!key) {
      return;
    }

    response[key] = {
      value: override.value,
      updatedAt: override.updatedAt.toISOString(),
      updatedBy: override.updatedByUser
        ? {
            id: override.updatedByUser.id,
            name: override.updatedByUser.name,
            email: override.updatedByUser.email,
          }
        : null,
    };
  });

  return response;
}

router.get("/", async (_req, res) => {
  try {
    const overrides = await prisma.adminOverride.findMany({
      include: {
        updatedByUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
    res.json(serializeOverrides(overrides));
  } catch (err: any) {
    console.error("[manual-controls] failed to load overrides", err);
    res.status(500).json({ error: err.message ?? "Unable to load manual controls" });
  }
});

router.put("/", async (req, res) => {
  try {
    const payload = req.body ?? {};
    const keys = Object.keys(CATEGORY_KEYS) as ManualControlKey[];

    const updates = keys
      .filter((key) => Object.prototype.hasOwnProperty.call(payload, key))
      .map((key) => {
        const rawValue = payload[key];
        const category = CATEGORY_KEYS[key];

        if (rawValue === null || rawValue === undefined || `${rawValue}`.trim() === "") {
          return prisma.adminOverride.deleteMany({
            where: { category },
          });
        }

        const parsedValue = Number(rawValue);
        if (Number.isNaN(parsedValue)) {
          throw new Error(`Invalid override value provided for ${key}`);
        }

        return prisma.adminOverride.upsert({
          where: { category },
          update: {
            value: parsedValue,
            updatedByUserId: req.user?.id ?? null,
          },
          create: {
            category,
            value: parsedValue,
            updatedByUserId: req.user?.id ?? null,
          },
        });
      });

    if (updates.length === 0) {
      return res.status(400).json({ error: "Provide at least one override field" });
    }

    await prisma.$transaction(updates);

    const overrides = await prisma.adminOverride.findMany({
      include: {
        updatedByUser: { select: { id: true, name: true, email: true } },
      },
      orderBy: { updatedAt: "desc" },
    });

    res.json(serializeOverrides(overrides));
  } catch (err: any) {
    console.error("[manual-controls] failed to update overrides", err);
    const message =
      err instanceof Error ? err.message : err?.response?.data?.error ?? "Unable to save manual overrides";
    res.status(500).json({ error: message });
  }
});

export default router;
