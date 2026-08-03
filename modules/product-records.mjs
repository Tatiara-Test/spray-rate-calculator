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

export function firstIncompleteProductRow(rows) {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] || {};
    const slot = Number.isInteger(row.slot) ? row.slot : index;
    const name = cleanChemicalName(row.name);
    const rateText = String(row.rateText ?? row.rate ?? "").trim();
    const unit = String(row.unit ?? "").trim();
    const hasAnyValue = Boolean(name || rateText || unit);
    if (!hasAnyValue) continue;

    if (!name) return { slot, field: "name" };
    const rate = Number(rateText);
    if (!rateText || !Number.isFinite(rate) || rate <= 0) {
      return { slot, field: "rate" };
    }
    if (!unit) return { slot, field: "unit" };
  }
  return null;
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
