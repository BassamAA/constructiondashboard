import { Router, type Request, type Response } from "express";
import prisma from "../prismaClient";

type HealthResponse = {
  status: "ok";
  uptimeSeconds: number;
  timestamp: string;
};

type ReadyResponse =
  | { status: "ready"; timestamp: string }
  | { status: "not_ready"; timestamp: string; error: string };

const router = Router();

router.get("/health", (_req: Request, res: Response<HealthResponse>) => {
  res.status(200).json({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

router.get("/ready", async (_req: Request, res: Response<ReadyResponse>) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ready", timestamp: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Database connectivity check failed";
    res.status(503).json({
      status: "not_ready",
      timestamp: new Date().toISOString(),
      error: message,
    });
  }
});

export default router;
