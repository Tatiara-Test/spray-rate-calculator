const HECTARE_EPSILON = 0.005;
const BASE_AMOUNT_EPSILON = 0.5;

const finitePositive = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

const cleanName = (value) => String(value || "").trim().replace(/\s+/g, " ");
const normalizedName = (product) => cleanName(product?.normalizedName || product?.name)
  .toLocaleLowerCase("en-AU");

function relevantRecord(record) {
  return finitePositive(record?.tankTotal) > 0
    || finitePositive(record?.hectares) > 0
    || (Array.isArray(record?.products) && record.products.length > 0);
}

function perHectareRate(product) {
  const rate = finitePositive(product?.rate);
  if (!rate) return null;
  if (product.unit === "l_ha") return { rateBase: rate * 1000, baseUnit: "ml" };
  if (product.unit === "ml_ha") return { rateBase: rate, baseUnit: "ml" };
  if (product.unit === "kg_ha") return { rateBase: rate * 1000, baseUnit: "g" };
  if (product.unit === "g_ha") return { rateBase: rate, baseUnit: "g" };
  return null;
}

function approximatelyEqual(left, right, epsilon = BASE_AMOUNT_EPSILON) {
  return Math.abs(left - right) <= epsilon;
}

function varianceState(variance, epsilon) {
  if (Math.abs(variance) <= epsilon) return "matched";
  return variance > 0 ? "over" : "remaining";
}

function chemicalVariances(records, sizeHectares) {
  const chemicals = new Map();

  for (const record of records) {
    if (record?.sprayMethod !== "Broadacre") continue;
    for (const product of Array.isArray(record.products) ? record.products : []) {
      const key = normalizedName(product);
      if (!key) continue;
      const name = cleanName(product.name) || key;
      const rate = perHectareRate(product);
      const amountBase = Number(product.amountBase);
      const amountValid = Number.isFinite(amountBase) && amountBase >= 0;
      const group = chemicals.get(key) || {
        name,
        normalizedName: key,
        baseUnit: null,
        ratePerHectareBase: null,
        recordedAmountBase: 0,
        comparable: true,
      };

      if (!rate || !amountValid) {
        group.comparable = false;
      } else if (group.baseUnit === null) {
        group.baseUnit = rate.baseUnit;
        group.ratePerHectareBase = rate.rateBase;
      } else if (
        group.baseUnit !== rate.baseUnit
        || !approximatelyEqual(group.ratePerHectareBase, rate.rateBase)
      ) {
        group.comparable = false;
      }
      if (amountValid) group.recordedAmountBase += amountBase;
      chemicals.set(key, group);
    }
  }

  return [...chemicals.values()]
    .filter((chemical) => chemical.comparable && chemical.ratePerHectareBase !== null)
    .map((chemical) => {
      const nominalAmountBase = chemical.ratePerHectareBase * sizeHectares;
      const varianceAmountBase = chemical.recordedAmountBase - nominalAmountBase;
      return {
        name: chemical.name,
        normalizedName: chemical.normalizedName,
        baseUnit: chemical.baseUnit,
        ratePerHectareBase: chemical.ratePerHectareBase,
        recordedAmountBase: chemical.recordedAmountBase,
        nominalAmountBase,
        varianceAmountBase,
        state: varianceState(varianceAmountBase, BASE_AMOUNT_EPSILON),
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Summarises records assigned to one paddock. Camera litres are reported but
 * never counted as whole-paddock coverage. Chemical figures compare recorded
 * Broadacre tank-mix amounts with one nominal full-paddock amount; they do not
 * claim how much chemical was discharged.
 */
export function calculatePaddockBalance({ sizeHectares, records } = {}) {
  const normalizedSize = finitePositive(sizeHectares) || null;
  const sourceRecords = Array.isArray(records) ? records : [];
  let broadacreHectares = 0;
  let broadacreLitres = 0;
  let cameraLitres = 0;
  let cameraRecordCount = 0;
  let unknownMethodRecordCount = 0;

  for (const record of sourceRecords) {
    if (!relevantRecord(record)) continue;
    if (record.sprayMethod === "Broadacre") {
      broadacreHectares += finitePositive(record.hectares);
      broadacreLitres += finitePositive(record.tankTotal);
    } else if (record.sprayMethod === "Camera") {
      cameraLitres += finitePositive(record.tankTotal);
      cameraRecordCount += 1;
    } else {
      unknownMethodRecordCount += 1;
    }
  }

  let state;
  let varianceHectares = null;
  if (unknownMethodRecordCount > 0) {
    state = "unknown-method";
  } else if (normalizedSize === null) {
    state = "missing-size";
  } else {
    varianceHectares = broadacreHectares - normalizedSize;
    state = varianceState(varianceHectares, HECTARE_EPSILON);
  }

  return {
    state,
    sizeHectares: normalizedSize,
    broadacreHectares,
    broadacreLitres,
    cameraLitres,
    cameraRecordCount,
    unknownMethodRecordCount,
    varianceHectares,
    chemicalVariances: state === "unknown-method" || normalizedSize === null
      ? []
      : chemicalVariances(sourceRecords, normalizedSize),
  };
}
