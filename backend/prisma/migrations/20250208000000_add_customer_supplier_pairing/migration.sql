-- Add table to pair a customer with a supplier (1:1)
CREATE TABLE "CustomerSupplierLink" (
    "id" SERIAL PRIMARY KEY,
    "customerId" INTEGER NOT NULL UNIQUE REFERENCES "Customer"("id") ON DELETE CASCADE,
    "supplierId" INTEGER NOT NULL UNIQUE REFERENCES "Supplier"("id") ON DELETE CASCADE,
    "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);
