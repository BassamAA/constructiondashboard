import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import prisma from "./prismaClient";
import authRoutes from "./routes/authRoutes";
import healthRoutes from "./routes/healthRoutes";
import receiptRoutes from "./routes/receiptRoutes";
import jobSiteRoutes from "./routes/jobSiteRoutes";
import supplierRoutes from "./routes/supplierRoutes";
import inventoryRoutes from "./routes/inventoryRoutes";
import customerRoutes from "./routes/customerRoutes";
import productRoutes from "./routes/productRoutes";
import truckRoutes from "./routes/truckRoutes";
import paymentRoutes from "./routes/paymentRoutes";
import employeeRoutes from "./routes/employeeRoutes";
import payrollRoutes from "./routes/payrollRoutes";
import debrisRoutes from "./routes/debrisRoutes";
import dashboardRoutes from "./routes/dashboardRoutes";
import reportRoutes from "./routes/reportRoutes";
import dieselRoutes from "./routes/dieselRoutes";
import auditRoutes from "./routes/auditRoutes";
import workerRoutes from "./routes/workerRoutes";
import cashRoutes from "./routes/cashRoutes";
import financeRoutes from "./routes/financeRoutes";
import manualControlRoutes from "./routes/manualControlRoutes";
import invoiceRoutes from "./routes/invoiceRoutes";
import taxRoutes from "./routes/taxRoutes";
import debugRoutes from "./routes/debugRoutes";
import displaySettingsRoutes from "./routes/displaySettingsRoutes";
import toolRoutes from "./routes/toolRoutes";
import mergeRoutes from "./routes/mergeRoutes";
import { ensureProductCatalog } from "./setup/productCatalog";
import {
  authenticateSession,
  requireRole,
  requirePermission,
} from "./middleware/auth";
import { UserRole } from "@prisma/client";

const app = express();
app.set("trust proxy", 1);

const allowedOrigins =
  process.env.CORS_ORIGIN?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean) ?? ["http://localhost:5173"];

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, origin ?? allowedOrigins[0]);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));

app.use(healthRoutes);
app.use("/auth", authRoutes);

const staticDir = path.resolve(__dirname, "../public");
const hasFrontendBundle = fs.existsSync(path.join(staticDir, "index.html"));

if (hasFrontendBundle) {
  app.use(express.static(staticDir));
  app.use((req: Request, res: Response, next) => {
    if (req.method !== "GET") {
      return next();
    }
    // Skip SPA fallback for API/PDF exports
    if (req.path.startsWith("/reports/exports")) {
      return next();
    }
    const acceptsHtml = req.headers.accept?.includes("text/html");
    if (!acceptsHtml) {
      return next();
    }
    return res.sendFile(path.join(staticDir, "index.html"));
  });
} else {
  app.get("/", (req: Request, res: Response) => {
    res.send("🚧 Construction Dashboard API is running!");
  });
}

app.use(authenticateSession);

const managerOrAdmin = requireRole(UserRole.ADMIN, UserRole.MANAGER);

app.use(
  "/receipts",
  requirePermission("receipts:view", ["GET"]),
  requirePermission("receipts:create", ["POST"]),
  requirePermission("receipts:update", ["PUT", "PATCH"]),
  requirePermission("receipts:delete", ["DELETE"]),
  managerOrAdmin,
  receiptRoutes,
);
app.use(
  "/invoices",
  managerOrAdmin,
  requirePermission("invoices:view", ["GET"]),
  requirePermission("invoices:manage", ["POST"]),
  invoiceRoutes,
);
app.use(
  "/job-sites",
  managerOrAdmin,
  requirePermission("customers:view", ["GET"]),
  requirePermission("customers:manage", ["POST", "PUT", "PATCH", "DELETE"]),
  jobSiteRoutes,
);
app.use(
  "/suppliers",
  managerOrAdmin,
  requirePermission("suppliers:view", ["GET"]),
  requirePermission("suppliers:manage", ["POST", "PUT", "PATCH", "DELETE"]),
  supplierRoutes,
);
app.use(
  "/inventory",
  managerOrAdmin,
  requirePermission("inventory:manage"),
  inventoryRoutes,
);
app.use(
  "/customers",
  managerOrAdmin,
  requirePermission("customers:view", ["GET"]),
  requirePermission("customers:manage", ["POST", "PUT", "PATCH", "DELETE"]),
  customerRoutes,
);
app.use(
  "/products",
  managerOrAdmin,
  requirePermission("products:view", ["GET"]),
  requirePermission("products:manage", ["POST", "PUT", "PATCH", "DELETE"]),
  productRoutes,
);
app.use(
  "/trucks",
  managerOrAdmin,
  requirePermission("customers:manage"),
  truckRoutes,
);
app.use(
  "/payments",
  managerOrAdmin,
  requirePermission("payments:manage"),
  paymentRoutes,
);
app.use("/employees", employeeRoutes);
app.use(
  "/payroll",
  managerOrAdmin,
  requirePermission("payroll:manage"),
  payrollRoutes,
);
app.use("/debris", requirePermission("debris:manage"), debrisRoutes);
app.use(
  "/dashboard",
  managerOrAdmin,
  requirePermission("reports:view"),
  dashboardRoutes,
);
app.use(
  "/reports",
  managerOrAdmin,
  requirePermission("reports:view"),
  reportRoutes,
);
app.use(
  "/debug",
  managerOrAdmin,
  requirePermission("reports:view"),
  debugRoutes,
);
app.use(
  "/tax",
  managerOrAdmin,
  requirePermission("reports:view"),
  taxRoutes,
);
app.use(
  "/finance",
  managerOrAdmin,
  requirePermission("reports:view"),
  financeRoutes,
);
app.use(
  "/diesel",
  managerOrAdmin,
  requirePermission("diesel:manage"),
  dieselRoutes,
);
app.use(
  "/tools",
  managerOrAdmin,
  requirePermission("inventory:manage", ["GET", "POST", "PUT", "PATCH", "DELETE"]),
  toolRoutes,
);
app.use("/cash", requirePermission("cash:manage"), cashRoutes);
app.use("/audit-logs", requireRole(UserRole.ADMIN), auditRoutes);
app.use(
  "/display-settings",
  requireRole(UserRole.ADMIN),
  requirePermission("reports:view", ["GET", "PUT"]),
  displaySettingsRoutes,
);
app.use("/worker", requirePermission("receipts:print"), workerRoutes);
app.use("/manual-controls", requireRole(UserRole.ADMIN), manualControlRoutes);
app.use("/merge", requireRole(UserRole.ADMIN), mergeRoutes);

app.get(
  "/drivers",
  managerOrAdmin,
  requirePermission("customers:manage"),
  async (req: Request, res: Response) => {
    try {
      const drivers = await prisma.driver.findMany();
      res.json(drivers);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch drivers" });
    }
  },
);

app.post(
  "/drivers",
  requireRole(UserRole.ADMIN),
  requirePermission("customers:manage"),
  async (req: Request, res: Response) => {
    try {
      const { name, phone } = req.body;
      const driver = await prisma.driver.create({
        data: { name, phone },
      });
      res.json(driver);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create driver" });
    }
  },
);

const PORT = Number(process.env.PORT ?? 3000);

async function startServer() {
  await ensureProductCatalog();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server", err);
  process.exit(1);
});
