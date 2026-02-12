-- DropForeignKey
ALTER TABLE "CustomerSupplierLink" DROP CONSTRAINT "CustomerSupplierLink_customerId_fkey";

-- DropForeignKey
ALTER TABLE "CustomerSupplierLink" DROP CONSTRAINT "CustomerSupplierLink_supplierId_fkey";

-- AlterTable
ALTER TABLE "CustomerSupplierLink" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "CustomerSupplierLink" ADD CONSTRAINT "CustomerSupplierLink_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerSupplierLink" ADD CONSTRAINT "CustomerSupplierLink_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
