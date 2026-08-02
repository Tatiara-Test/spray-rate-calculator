export function cleanChemicalName(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function normalizeChemicalName(value) {
  return cleanChemicalName(value).toLocaleLowerCase("en-AU");
}

export function usedCalculatorProducts(rows) {
  return rows
    .map((row, slot) => ({
      slot: Number.isInteger(row?.slot) ? row.slot : slot,
      name: cleanChemicalName(row?.name),
      rate: Number(row?.rate),
      rateText: String(row?.rateText ?? ""),
      unit: String(row?.unit ?? ""),
    }))
    .filter((product) =>
      product.rateText !== "" &&
      Number.isFinite(product.rate) &&
      product.rate > 0 &&
      product.unit,
    );
}

export function firstUnnamedProduct(products) {
  return products.find((product) => !cleanChemicalName(product?.name)) || null;
}

export function snapshotProducts(products, calculateCanonicalAmount) {
  return products.map((product) => ({
    slot: product.slot,
    name: cleanChemicalName(product.name),
    normalizedName: normalizeChemicalName(product.name),
    rate: Number(product.rate),
    unit: product.unit,
    ...calculateCanonicalAmount(product),
  }));
}

export function productDisplayName(product) {
  return cleanChemicalName(product?.name) ||
    `Product ${Math.max(0, Number(product?.slot) || 0) + 1} (name missing)`;
}

export function missingProductSlots(tank) {
  return (tank?.products || [])
    .filter((product) => !cleanChemicalName(product?.name))
    .map((product) => Math.max(0, Number(product?.slot) || 0));
}
