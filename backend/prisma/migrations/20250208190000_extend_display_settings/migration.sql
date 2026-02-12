ALTER TABLE "DisplaySettings"
  ADD COLUMN IF NOT EXISTS "includeReceipts" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "includeSupplierPurchases" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "includeManufacturing" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "includePayroll" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "includeDebris" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "includeGeneralExpenses" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS "includeInventoryValue" BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE "DisplaySettings"
SET
  "includeReceipts" = COALESCE("includeReceipts", TRUE),
  "includeSupplierPurchases" = COALESCE("includeSupplierPurchases", TRUE),
  "includeManufacturing" = COALESCE("includeManufacturing", TRUE),
  "includePayroll" = COALESCE("includePayroll", TRUE),
  "includeDebris" = COALESCE("includeDebris", TRUE),
  "includeGeneralExpenses" = COALESCE("includeGeneralExpenses", TRUE),
  "includeInventoryValue" = COALESCE("includeInventoryValue", TRUE)
WHERE id = 1;
