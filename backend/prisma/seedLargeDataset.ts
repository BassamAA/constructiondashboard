import { PrismaClient, ReceiptType, PaymentType } from "@prisma/client";

type SeedOptions = {
  receipts: number;
  customers: number;
  drivers: number;
  trucks: number;
  days: number;
  batch: number;
  reset: boolean;
};

type ReceiptItemSeed = {
  productId: number;
  quantity: number;
  unitPrice: number;
  subtotal: number;
};

const prisma = new PrismaClient();

const DEFAULT_OPTIONS: SeedOptions = {
  receipts: 20000,
  customers: 60,
  drivers: 25,
  trucks: 20,
  days: 180,
  batch: 25,
  reset: false,
};

function parseArgs(): SeedOptions {
  const args = process.argv.slice(2);
  const options: SeedOptions = { ...DEFAULT_OPTIONS };

  for (const arg of args) {
    const [key, value] = arg.split("=");
    switch (key) {
      case "--receipts":
        options.receipts = Number(value ?? options.receipts);
        break;
      case "--customers":
        options.customers = Number(value ?? options.customers);
        break;
      case "--drivers":
        options.drivers = Number(value ?? options.drivers);
        break;
      case "--trucks":
        options.trucks = Number(value ?? options.trucks);
        break;
      case "--days":
        options.days = Number(value ?? options.days);
        break;
      case "--batch":
        options.batch = Number(value ?? options.batch);
        break;
      case "--reset":
        options.reset = true;
        break;
      default:
        break;
    }
  }

  return options;
}

const CUSTOMER_NAMES = [
  "Atlas Builders",
  "Summit Construction",
  "Prime Materials",
  "Horizon Developments",
  "RockSolid Partners",
  "HighRoad Infrastructure",
  "Frontier Works",
  "EastBridge Contracting",
  "BluePeak Aggregates",
  "Legacy Estates",
  "Cedar Ridge Homes",
  "Granite Ridge Ventures",
];

const PRODUCT_FALLBACKS = [
  { name: "Powder", unit: "m3" },
  { name: "Sand", unit: "m3" },
  { name: "Gravel", unit: "m3" },
  { name: "Cement Bag", unit: "bag" },
  { name: "Debris", unit: "m3" },
];

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomFloat(min: number, max: number, decimals = 2): number {
  const factor = 10 ** decimals;
  return Math.round((Math.random() * (max - min) + min) * factor) / factor;
}

function randomChoice<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

async function resetExistingData() {
  console.log("🔄 Resetting existing receipt data…");
  await prisma.receiptPayment.deleteMany();
  await prisma.payment.deleteMany({
    where: {
      OR: [{ receiptId: { not: null } }, { type: PaymentType.CUSTOMER_PAYMENT }],
    },
  });
  await prisma.stockMovement.deleteMany({
    where: { receiptId: { not: null } },
  });
  await prisma.receiptItem.deleteMany();
  await prisma.receipt.deleteMany();
}

async function ensureProducts() {
  let products = await prisma.product.findMany();
  if (products.length === 0) {
    console.log("📦 No products found. Creating default catalog entries…");
    for (const fallback of PRODUCT_FALLBACKS) {
      products.push(
        await prisma.product.create({
          data: {
            name: fallback.name,
            unit: fallback.unit,
            stockQty: 10000,
            unitPrice: randomFloat(10, 60),
          },
        }),
      );
    }
  }
  return products;
}

async function ensureCustomers(target: number) {
  const customers = await prisma.customer.findMany({
    include: { jobSites: true },
  });
  const result = [...customers];

  for (const customer of result) {
    if (customer.jobSites.length === 0) {
      const jobSite = await prisma.jobSite.create({
        data: {
          name: `${customer.name} HQ`,
          customerId: customer.id,
        },
      });
      customer.jobSites.push(jobSite);
    }
  }

  let counter = customers.length;
  while (counter < target) {
    const index = counter % CUSTOMER_NAMES.length;
    const suffix = Math.floor(counter / CUSTOMER_NAMES.length) + 1;
    const name = `${CUSTOMER_NAMES[index]} ${suffix}`;
    const customer = await prisma.customer.create({
      data: {
        name,
        contactName: `Contact ${counter + 1}`,
        phone: `03${randomInt(100000, 999999)}`,
        notes: "Seeded customer",
      },
    });
    const siteCount = randomInt(1, 3);
    const jobSites = [];
    for (let i = 0; i < siteCount; i += 1) {
      jobSites.push(
        await prisma.jobSite.create({
          data: {
            name: `${name} Site ${i + 1}`,
            customerId: customer.id,
          },
        }),
      );
    }
    result.push({ ...customer, jobSites });
    counter += 1;
  }

  return result;
}

async function ensureDrivers(_target: number) {
  const drivers = await prisma.driver.findMany();
  if (drivers.length === 0) {
    console.log("⚠️ No drivers exist. Seed will continue without creating demo drivers.");
  }
  return drivers;
}

async function ensureTrucks(target: number, drivers: { id: number }[]) {
  const trucks = await prisma.truck.findMany();
  const result = [...trucks];
  let counter = trucks.length;

  while (counter < target) {
    const driver =
      drivers.length > 0 && Math.random() < 0.7 ? randomChoice(drivers) : null;
    const truck = await prisma.truck.create({
      data: {
        plateNo: `TRK-${String(counter + 1).padStart(4, "0")}`,
        driverId: driver?.id ?? null,
      },
    });
    result.push(truck);
    counter += 1;
  }

  return result;
}

async function buildReceipts(
  total: number,
  options: SeedOptions,
  customers: Array<{ id: number; jobSites: { id: number }[] }>,
  drivers: { id: number }[],
  trucks: { id: number }[],
  products: { id: number; unitPrice: number | null }[],
) {
  if (products.length === 0) {
    throw new Error("No products available to create receipt items. Seed products first.");
  }

  const now = new Date();
  const normalPrefix = "NR";
  const tvaPrefix = "TVA";

  const latestNormal = await prisma.receipt.findFirst({
    where: { type: ReceiptType.NORMAL },
    orderBy: { id: "desc" },
    select: { receiptNo: true },
  });
  const latestTva = await prisma.receipt.findFirst({
    where: { type: ReceiptType.TVA },
    orderBy: { id: "desc" },
    select: { receiptNo: true },
  });

  let normalCounter = latestNormal?.receiptNo
    ? (parseInt(latestNormal.receiptNo.replace(/\D/g, ""), 10) || 0) + 1
    : 1;
  let tvaCounter = latestTva?.receiptNo
    ? (parseInt(latestTva.receiptNo.replace(/\D/g, ""), 10) || 0) + 1
    : 1;

  const batchTasks: Promise<void>[] = [];
  let created = 0;

  for (let i = 0; i < total; i += 1) {
    const isTva = Math.random() < 0.25;
    const type = isTva ? ReceiptType.TVA : ReceiptType.NORMAL;
    const prefix = isTva ? tvaPrefix : normalPrefix;
    const sequence = isTva ? tvaCounter++ : normalCounter++;
    const receiptNo = `${prefix}-${String(sequence).padStart(6, "0")}`;

    const customerEntry = randomChoice(customers);
    const customerId = customerEntry.id;
    const jobSite =
      customerEntry.jobSites.length > 0 ? randomChoice(customerEntry.jobSites) : null;

    const assignedDriver =
      drivers.length > 0 && Math.random() < 0.5 ? randomChoice(drivers) : null;
    const assignedTruck =
      trucks.length > 0 && Math.random() < 0.5 ? randomChoice(trucks) : null;

    const itemCount = randomInt(1, 4);
    const items: ReceiptItemSeed[] = [];
    let totalAmount = 0;

    for (let j = 0; j < itemCount; j += 1) {
      const product = randomChoice(products);
      const quantity = randomFloat(0.5, 20, 3);
      const unitPrice = product.unitPrice ?? randomFloat(8, 65);
      const subtotal = quantity * unitPrice;
      totalAmount += subtotal;
      items.push({
        productId: product.id,
        quantity,
        unitPrice,
        subtotal,
      });
    }

    totalAmount = Math.round(totalAmount * 100) / 100;
    const paymentRoll = Math.random();
    let amountPaid = 0;
    if (paymentRoll > 0.4) {
      if (paymentRoll > 0.8) {
        amountPaid = Number((totalAmount * randomFloat(0.4, 0.85)).toFixed(2));
      } else {
        amountPaid = totalAmount;
      }
    }
    const fullyPaid = amountPaid >= totalAmount;

    const dateOffset = randomInt(0, Math.max(options.days, 1));
    const receiptDate = new Date(now);
    receiptDate.setDate(now.getDate() - dateOffset);

    const createReceipt = async () => {
      const receipt = await prisma.receipt.create({
        data: {
          receiptNo,
          type,
          date: receiptDate,
          customerId,
          jobSiteId: jobSite?.id ?? null,
          walkInName: customerId ? null : `Walk-in ${i + 1}`,
          driverId: assignedDriver?.id ?? null,
          truckId: assignedTruck?.id ?? null,
          total: totalAmount,
          amountPaid,
          isPaid: fullyPaid,
          items: {
            create: items,
          },
        },
        select: {
          id: true,
          customerId: true,
        },
      });

      if (amountPaid > 0) {
        await prisma.payment.create({
          data: {
            date: receiptDate,
            amount: amountPaid,
            type: PaymentType.CUSTOMER_PAYMENT,
            description: `Seeded payment for ${receiptNo}`,
            customerId: receipt.customerId ?? null,
            receiptId: receipt.id,
          },
        });
      }
    };

    const receiptPromise = createReceipt()
      .then(() => {
        created += 1;
        if (created % 500 === 0) {
          console.log(`  • Created ${created}/${total} receipts`);
        }
      })
      .catch((error) => {
        console.error(`Failed to create receipt ${receiptNo}:`, error);
      });

    batchTasks.push(receiptPromise);
    if (batchTasks.length >= options.batch) {
      await Promise.all(batchTasks.splice(0, batchTasks.length));
    }
  }

  if (batchTasks.length > 0) {
    await Promise.all(batchTasks);
  }
  console.log(`✅ Seeded ${created} receipts`);
}

async function main() {
  const options = parseArgs();

  console.log("🚀 Bulk seeding starting with options:", options);

  if (options.reset) {
    await resetExistingData();
  }

  const products = await ensureProducts();
  const customers = await ensureCustomers(options.customers);
  const drivers = await ensureDrivers(options.drivers);
  const trucks = await ensureTrucks(options.trucks, drivers);

  console.log(
    `📊 Dataset before receipts — customers: ${customers.length}, drivers: ${drivers.length}, trucks: ${trucks.length}, products: ${products.length}`,
  );

  await buildReceipts(options.receipts, options, customers, drivers, trucks, products);

  console.log("🎉 Bulk seed completed.");
}

main()
  .catch((error) => {
    console.error("Seed failed", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
