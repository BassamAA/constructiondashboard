import prisma from "../prismaClient";
import { FIXED_PRODUCT_CATALOG } from "../config/productCatalog";

export async function ensureProductCatalog(): Promise<void> {
  for (const entry of FIXED_PRODUCT_CATALOG) {
    const existing = await prisma.product.findFirst({
      where: { name: entry.name },
    });

    if (!existing) {
      await prisma.product.create({
        data: {
          name: entry.name,
          unit: entry.unit,
          unitPrice: entry.unitPrice ?? null,
          description: entry.description ?? null,
          isManufactured: entry.isManufactured ?? false,
          isFuel: entry.isFuel ?? false,
          pieceworkRate: entry.pieceworkRate ?? null,
          helperPieceworkRate: entry.helperPieceworkRate ?? null,
        },
      });
      continue;
    }

    await prisma.product.update({
      where: { id: existing.id },
      data: {
        unit: entry.unit,
        unitPrice: entry.unitPrice ?? null,
        description: entry.description ?? null,
        isManufactured: entry.isManufactured ?? false,
        isFuel: entry.isFuel ?? false,
        pieceworkRate: entry.pieceworkRate ?? null,
        helperPieceworkRate: entry.helperPieceworkRate ?? null,
      },
    });
  }
}
