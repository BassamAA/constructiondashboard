export type FixedProduct = {
  name: string;
  unit: string;
  description?: string;
  unitPrice?: number | null;
  isManufactured?: boolean;
  isFuel?: boolean;
  pieceworkRate?: number | null;
  helperPieceworkRate?: number | null;
};

export const FIXED_PRODUCT_CATALOG: FixedProduct[] = [
  {
    name: "Powder",
    unit: "m³",
    description: "Bulk powder measured in cubic meters",
  },
  {
    name: "Sand",
    unit: "m³",
    description: "Bulk sand measured in cubic meters",
  },
  {
    name: "Gravel",
    unit: "m³",
    description: "Bulk gravel measured in cubic meters",
  },
  {
    name: "Debris",
    unit: "m³",
    description: "Debris intake measured in cubic meters",
  },
  {
    name: "Cement",
    unit: "bag",
    description: "Cement (bag) — 20 bags equal one ton",
  },
  {
    name: "Diesel",
    unit: "L",
    description: "Diesel fuel tracked in liters",
    isFuel: true,
  },
  {
    name: "Hollow Block 6cm",
    unit: "unit",
    description: "Precast hollow block 6cm sold per unit",
    isManufactured: true,
  },
  {
    name: "Hollow Block 8cm",
    unit: "unit",
    description: "Precast hollow block 8cm sold per unit",
    isManufactured: true,
  },
  {
    name: "Hollow Block 10cm",
    unit: "unit",
    description: "Precast hollow block 10cm sold per unit",
    isManufactured: true,
  },
  {
    name: "Hollow Block 12cm",
    unit: "unit",
    description: "Precast hollow block 12cm sold per unit",
    isManufactured: true,
  },
  {
    name: "Hollow Block 15cm",
    unit: "unit",
    description: "Precast hollow block 15cm sold per unit",
    isManufactured: true,
  },
  {
    name: "Hollow Block 20cm",
    unit: "unit",
    description: "Precast hollow block 20cm sold per unit",
    isManufactured: true,
  },
  {
    name: "Solid Block 8cm",
    unit: "unit",
    description: "Solid block 8cm sold per unit",
    isManufactured: true,
  },
  {
    name: "Solid Block 10cm",
    unit: "unit",
    description: "Solid block 10cm sold per unit",
    isManufactured: true,
  },
  {
    name: "Solid Block 15cm",
    unit: "unit",
    description: "Solid block 15cm sold per unit",
    isManufactured: true,
  },
  {
    name: "Solid Block 20cm",
    unit: "unit",
    description: "Solid block 20cm sold per unit",
    isManufactured: true,
  },
  {
    name: "Semi Solid Block 10cm",
    unit: "unit",
    description: "Semi solid block 10cm sold per unit",
    isManufactured: true,
  },
  {
    name: "Semi Solid Block 12cm",
    unit: "unit",
    description: "Semi solid block 12cm sold per unit",
    isManufactured: true,
  },
  {
    name: "Semi Solid Block 15cm",
    unit: "unit",
    description: "Semi solid block 15cm sold per unit",
    isManufactured: true,
  },
  {
    name: "Bordure 10cm",
    unit: "unit",
    description: "Bordure 10cm sold per unit",
    isManufactured: true,
  },
  {
    name: "Bordure 13cm",
    unit: "unit",
    description: "Bordure 13cm sold per unit",
    isManufactured: true,
  },
  {
    name: "Bordure 15cm",
    unit: "unit",
    description: "Bordure 15cm sold per unit",
    isManufactured: true,
  },
  {
    name: "Hordy 14cm",
    unit: "unit",
    description: "Hordy block 14cm sold per unit",
    isManufactured: true,
  },
  {
    name: "Hordy 18cm",
    unit: "unit",
    description: "Hordy block 18cm sold per unit",
    isManufactured: true,
  },
  {
    name: "Interlock",
    unit: "unit",
    description: "Interlock paver sold per unit",
    isManufactured: true,
  },
];
