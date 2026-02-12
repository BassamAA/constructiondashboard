-- Add maintenance type to truck repairs
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TruckMaintenanceType') THEN
        CREATE TYPE "TruckMaintenanceType" AS ENUM ('REPAIR', 'OIL_CHANGE', 'INSURANCE');
    END IF;
END$$;

ALTER TABLE "TruckRepair"
    ADD COLUMN IF NOT EXISTS "type" "TruckMaintenanceType" NOT NULL DEFAULT 'REPAIR';
