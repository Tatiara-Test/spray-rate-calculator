const HECTARE_EPSILON = 0.005;
const LITRE_EPSILON = 0.005;
const BASE_AMOUNT_EPSILON = 0.5;
const RATE_RELATIVE_EPSILON = 0.000001;
const METHODS = new Set(["Broadacre", "Camera"]);

const cleanName = (value) => String(value || "").trim().replace(/\s+/g, " ");
const normalizedName = (product) => cleanName(product?.name || product?.normalizedName)
  .toLocaleLowerCase("en-AU");

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeNumber(value) {
  const number = finiteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function positiveNumber(value) {
  const number = finiteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function approximatelyEqual(left, right, absolute = BASE_AMOUNT_EPSILON) {
  const relative = Math.max(Math.abs(left), Math.abs(right)) * RATE_RELATIVE_EPSILON;
  return Math.abs(left - right) <= Math.max(absolute, relative);
}

function varianceState(variance, epsilon) {
  if (Math.abs(variance) <= epsilon) return "matched";
  return variance > 0 ? "over" : "remaining";
}

function relevantRecord(record) {
  const before = finiteNumber(record?.controllerBeforeLitres);
  const after = finiteNumber(record?.controllerAfterLitres);
  return positiveNumber(record?.tankTotal) !== null
    || positiveNumber(record?.hectares) !== null
    || (before !== null && after !== null && before !== after)
    || (Array.isArray(record?.products) && record.products.length > 0);
}

function recordIssue(record, recordIndex, code, severity, message) {
  return {
    recordIndex,
    recordId: cleanName(record?.id) || null,
    code,
    severity,
    message,
  };
}

function authoritativeLitres(record, recordIndex) {
  const hasControllerBoundary = record?.recordType === "run-allocation"
    || Object.hasOwn(record || {}, "controllerBeforeLitres")
    || Object.hasOwn(record || {}, "controllerAfterLitres");
  if (!hasControllerBoundary) {
    const tankTotal = nonNegativeNumber(record?.tankTotal);
    if (tankTotal === null) {
      return {
        litres: null,
        issues: [recordIssue(
          record,
          recordIndex,
          "invalid-tank-litres",
          "blocking",
          "Tank total litres are unavailable or invalid.",
        )],
      };
    }
    return { litres: tankTotal, issues: [] };
  }

  const before = nonNegativeNumber(record?.controllerBeforeLitres);
  const after = nonNegativeNumber(record?.controllerAfterLitres);
  if (before === null || after === null || before <= after) {
    return {
      litres: null,
      issues: [recordIssue(
        record,
        recordIndex,
        "invalid-controller-boundary",
        "blocking",
        "Buffer controller readings must be valid and decrease.",
      )],
    };
  }

  const litres = before - after;
  const issues = [];
  for (const [field, code] of [
    ["litresUsed", "controller-litres-used-disagreement"],
    ["tankTotal", "controller-tank-total-disagreement"],
  ]) {
    if (!Object.hasOwn(record, field)) continue;
    const comparison = nonNegativeNumber(record[field]);
    if (comparison === null || !approximatelyEqual(comparison, litres, LITRE_EPSILON)) {
      issues.push(recordIssue(
        record,
        recordIndex,
        code,
        "disagreement",
        `Buffer controller litres disagree with ${field}.`,
      ));
    }
  }
  return { litres, issues };
}

function canonicalRate(product, sprayRate) {
  const rate = positiveNumber(product?.rate);
  if (rate === null) return null;
  if (product.unit === "l_ha") return { ratePerHectareBase: rate * 1000, baseUnit: "ml" };
  if (product.unit === "ml_ha") return { ratePerHectareBase: rate, baseUnit: "ml" };
  if (product.unit === "kg_ha") return { ratePerHectareBase: rate * 1000, baseUnit: "g" };
  if (product.unit === "g_ha") return { ratePerHectareBase: rate, baseUnit: "g" };
  if (product.unit === "ml_100" && sprayRate > 0) {
    return { ratePerHectareBase: rate * sprayRate / 100, baseUnit: "ml" };
  }
  if (product.unit === "kg_100" && sprayRate > 0) {
    return { ratePerHectareBase: rate * 1000 * sprayRate / 100, baseUnit: "g" };
  }
  return null;
}

function createProductGroup(product, recordIndex, expectedBaseUnit) {
  const name = cleanName(product?.name);
  const normalized = normalizedName(product);
  return {
    name: name || `Product ${Math.max(0, Number(product?.slot) || 0) + 1} (name missing)`,
    normalizedName: normalized,
    baseUnit: expectedBaseUnit || (product?.baseUnit === "g" ? "g" : product?.baseUnit === "ml" ? "ml" : null),
    recordCount: 0,
    validRecordCount: 0,
    unavailableRecordCount: 0,
    recordedAmountBase: 0,
    activeSprayEquivalentHectares: 0,
    chemicalEquivalentHectares: 0,
    varianceEquivalentHectares: 0,
    varianceAmountBase: 0,
    rates: [],
    issues: [],
    firstRecordIndex: recordIndex,
  };
}

function productIssue(group, recordIndex, code, message) {
  group.unavailableRecordCount += 1;
  group.issues.push({ recordIndex, code, message });
}

function buildProductSummaries(sourceRecords, processedByIndex, sizeHectares) {
  const groups = new Map();
  const formsByName = new Map();

  sourceRecords.forEach((record, recordIndex) => {
    if (!relevantRecord(record)) return;
    const active = processedByIndex.get(recordIndex) || null;
    const products = Array.isArray(record?.products) ? record.products : [];
    const recordGroups = new Map();
    products.forEach((product, productIndex) => {
      const rate = canonicalRate(product, active?.sprayRate || positiveNumber(record?.sprayRate));
      const expectedBaseUnit = rate?.baseUnit || null;
      const normalized = normalizedName(product);
      const missingKey = `missing:${recordIndex}:${Number.isInteger(product?.slot) ? product.slot : productIndex}`;
      const key = `${normalized || missingKey}|${expectedBaseUnit || product?.baseUnit || "unknown"}`;
      const group = groups.get(key) || createProductGroup(product, recordIndex, expectedBaseUnit);
      group.recordCount += 1;
      groups.set(key, group);

      if (normalized && group.baseUnit) {
        const forms = formsByName.get(normalized) || new Set();
        forms.add(group.baseUnit);
        formsByName.set(normalized, forms);
      }

      if (!normalized) {
        productIssue(group, recordIndex, "missing-product-name", "Chemical name is missing.");
        return;
      }
      if (!active) {
        productIssue(group, recordIndex, "active-equivalent-unavailable", "This record has no valid active-spray equivalent.");
        return;
      }
      if (!rate) {
        productIssue(group, recordIndex, "invalid-product-rate", "Product rate or rate unit is unavailable or invalid.");
        return;
      }
      if (product?.baseUnit !== rate.baseUnit) {
        productIssue(group, recordIndex, "product-base-unit-disagreement", "Product amount unit disagrees with its rate unit.");
        return;
      }
      const amountBase = nonNegativeNumber(product?.amountBase);
      if (amountBase === null) {
        productIssue(group, recordIndex, "invalid-product-amount", "Calculated product amount is unavailable or invalid.");
        return;
      }

      const contribution = recordGroups.get(key) || {
        group,
        active,
        amountBase: 0,
        rates: [],
      };
      contribution.amountBase += amountBase;
      contribution.rates.push(rate.ratePerHectareBase);
      recordGroups.set(key, contribution);
    });

    for (const contribution of recordGroups.values()) {
      const { group } = contribution;
      const firstRate = contribution.rates[0] ?? null;
      const rateConsistent = firstRate !== null
        && contribution.rates.every((rate) => approximatelyEqual(rate, firstRate, 0.000001));
      if (!rateConsistent) {
        productIssue(
          group,
          recordIndex,
          "duplicate-product-rate-disagreement",
          "Repeated entries for this chemical in one record use different rates, so their comparison is unavailable.",
        );
        continue;
      }
      const chemicalEquivalent = contribution.amountBase / firstRate;
      const varianceEquivalent = chemicalEquivalent - contribution.active.activeSprayEquivalentHectares;
      const varianceAmount = contribution.amountBase
        - firstRate * contribution.active.activeSprayEquivalentHectares;
      group.validRecordCount += 1;
      group.recordedAmountBase += contribution.amountBase;
      group.activeSprayEquivalentHectares += contribution.active.activeSprayEquivalentHectares;
      group.chemicalEquivalentHectares += chemicalEquivalent;
      group.varianceEquivalentHectares += varianceEquivalent;
      group.varianceAmountBase += varianceAmount;
      group.rates.push(firstRate);
    }
  });

  return [...groups.values()].map((group) => {
    const firstRate = group.rates[0] ?? null;
    const ratesConsistent = firstRate !== null
      && group.rates.every((rate) => approximatelyEqual(rate, firstRate, 0.000001));
    const ratePerHectareBase = ratesConsistent ? firstRate : null;
    const hasValid = group.validRecordCount > 0;
    const incompatibleForm = Boolean(
      group.normalizedName
      && (formsByName.get(group.normalizedName)?.size || 0) > 1,
    );
    const fullPaddockAmountBase = sizeHectares !== null && ratePerHectareBase !== null
      ? ratePerHectareBase * sizeHectares
      : null;
    const fullPaddockVarianceAmountBase = fullPaddockAmountBase === null
      ? null
      : group.recordedAmountBase - fullPaddockAmountBase;
    const fullPaddockVarianceEquivalentHectares = hasValid && sizeHectares !== null
      ? group.chemicalEquivalentHectares - sizeHectares
      : null;
    return {
      name: group.name,
      normalizedName: group.normalizedName,
      baseUnit: group.baseUnit,
      recordCount: group.recordCount,
      validRecordCount: group.validRecordCount,
      unavailableRecordCount: group.unavailableRecordCount,
      status: !hasValid ? "unavailable" : group.unavailableRecordCount ? "partial" : "complete",
      issues: group.issues,
      ratePerHectareBase,
      rateStatus: !hasValid ? "unavailable" : ratesConsistent ? "consistent" : "varied",
      recordedAmountBase: hasValid ? group.recordedAmountBase : null,
      activeSprayEquivalentHectares: hasValid ? group.activeSprayEquivalentHectares : null,
      chemicalEquivalentHectares: hasValid ? group.chemicalEquivalentHectares : null,
      chemicalEquivalentCoveragePercent: hasValid && sizeHectares !== null
        ? group.chemicalEquivalentHectares / sizeHectares * 100
        : null,
      varianceEquivalentHectares: hasValid ? group.varianceEquivalentHectares : null,
      varianceAmountBase: hasValid ? group.varianceAmountBase : null,
      state: hasValid
        ? varianceState(group.varianceAmountBase, BASE_AMOUNT_EPSILON)
        : "unavailable",
      fullPaddockAmountBase,
      fullPaddockVarianceAmountBase,
      fullPaddockVarianceEquivalentHectares,
      fullPaddockState: fullPaddockVarianceAmountBase === null
        ? "unavailable"
        : varianceState(fullPaddockVarianceAmountBase, BASE_AMOUNT_EPSILON),
      incompatibleForm,
    };
  }).sort((left, right) => (
    left.name.localeCompare(right.name)
    || String(left.baseUnit).localeCompare(String(right.baseUnit))
  ));
}

function compatibilityChemicalVariances(processedRecords, sizeHectares) {
  if (sizeHectares === null) return [];
  const groups = new Map();
  for (const active of processedRecords) {
    if (active.method !== "Broadacre") continue;
    for (const product of Array.isArray(active.record?.products) ? active.record.products : []) {
      const normalized = normalizedName(product);
      const rate = canonicalRate(product, active.sprayRate);
      const amountBase = nonNegativeNumber(product?.amountBase);
      if (!normalized || !rate || amountBase === null || product.baseUnit !== rate.baseUnit) continue;
      const key = `${normalized}|${rate.baseUnit}`;
      const group = groups.get(key) || {
        name: cleanName(product.name),
        normalizedName: normalized,
        baseUnit: rate.baseUnit,
        ratePerHectareBase: rate.ratePerHectareBase,
        recordedAmountBase: 0,
        comparable: true,
      };
      if (!approximatelyEqual(group.ratePerHectareBase, rate.ratePerHectareBase, 0.000001)) {
        group.comparable = false;
      }
      group.recordedAmountBase += amountBase;
      groups.set(key, group);
    }
  }
  return [...groups.values()].filter((group) => group.comparable).map((group) => {
    const nominalAmountBase = group.ratePerHectareBase * sizeHectares;
    const varianceAmountBase = group.recordedAmountBase - nominalAmountBase;
    return {
      name: group.name,
      normalizedName: group.normalizedName,
      baseUnit: group.baseUnit,
      ratePerHectareBase: group.ratePerHectareBase,
      recordedAmountBase: group.recordedAmountBase,
      nominalAmountBase,
      varianceAmountBase,
      state: varianceState(varianceAmountBase, BASE_AMOUNT_EPSILON),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
}

/**
 * Calculates reported Broadacre hectares and a separate active-spray
 * equivalent for Broadacre and Camera records. Active-spray equivalent is
 * liquid used divided by the saved spray rate; it is not GPS-measured unique
 * ground and Camera passes may overlap. Product amounts remain calculated
 * tank-mix equivalents, not measured chemical discharge.
 */
export function calculatePaddockBalance({ sizeHectares, records } = {}) {
  const normalizedSize = positiveNumber(sizeHectares);
  const sourceRecords = Array.isArray(records) ? records : [];
  const processedRecords = [];
  const processedByIndex = new Map();
  const recordIssues = [];
  let relevantRecordCount = 0;
  let broadacreHectares = 0;
  let broadacreLitres = 0;
  let cameraLitres = 0;
  let cameraRecordCount = 0;
  let unknownMethodRecordCount = 0;
  let broadacreRelevantRecordCount = 0;
  let reportedBroadacreRecordCount = 0;
  let broadacreActiveSprayEquivalentHectares = 0;
  let cameraActiveSprayEquivalentHectares = 0;

  sourceRecords.forEach((record, recordIndex) => {
    if (!relevantRecord(record)) return;
    relevantRecordCount += 1;
    const method = METHODS.has(record?.sprayMethod) ? record.sprayMethod : null;
    if (!method) {
      unknownMethodRecordCount += 1;
      recordIssues.push(recordIssue(
        record,
        recordIndex,
        "unknown-application-method",
        "blocking",
        "Application method needs review before this record can contribute.",
      ));
      return;
    }
    if (method === "Broadacre") broadacreRelevantRecordCount += 1;

    const liquid = authoritativeLitres(record, recordIndex);
    recordIssues.push(...liquid.issues);
    const sprayRate = positiveNumber(record?.sprayRate);
    if (liquid.litres === null || sprayRate === null) {
      if (sprayRate === null) {
        recordIssues.push(recordIssue(
          record,
          recordIndex,
          "invalid-spray-rate",
          "blocking",
          "Saved calibrated spray rate must be greater than zero.",
        ));
      }
      return;
    }

    const activeSprayEquivalentHectares = liquid.litres / sprayRate;
    const active = {
      record,
      recordIndex,
      method,
      litres: liquid.litres,
      sprayRate,
      activeSprayEquivalentHectares,
    };
    processedRecords.push(active);
    processedByIndex.set(recordIndex, active);

    if (method === "Broadacre") {
      broadacreLitres += liquid.litres;
      broadacreActiveSprayEquivalentHectares += activeSprayEquivalentHectares;
      const reportedHectares = nonNegativeNumber(record?.hectares);
      if (reportedHectares === null) {
        recordIssues.push(recordIssue(
          record,
          recordIndex,
          "missing-reported-hectares",
          "disagreement",
          "Reported Broadacre hectares are unavailable.",
        ));
      } else {
        broadacreHectares += reportedHectares;
        reportedBroadacreRecordCount += 1;
        if (!approximatelyEqual(reportedHectares, activeSprayEquivalentHectares, HECTARE_EPSILON)) {
          recordIssues.push(recordIssue(
            record,
            recordIndex,
            "reported-hectares-disagreement",
            "disagreement",
            "Reported Broadacre hectares disagree with litres divided by spray rate.",
          ));
        }
      }
    } else {
      cameraLitres += liquid.litres;
      cameraRecordCount += 1;
      cameraActiveSprayEquivalentHectares += activeSprayEquivalentHectares;
      const legacyHectares = nonNegativeNumber(record?.hectares);
      if (legacyHectares !== null && legacyHectares > HECTARE_EPSILON) {
        recordIssues.push(recordIssue(
          record,
          recordIndex,
          "camera-hectares-ignored",
          "disagreement",
          "Stored Camera hectares were ignored; Camera uses calculated active-spray equivalent.",
        ));
      }
    }
  });

  const invalidOnly = relevantRecordCount > 0 && processedRecords.length === 0;
  const activeSprayEquivalentHectares = invalidOnly
    ? null
    : broadacreActiveSprayEquivalentHectares + cameraActiveSprayEquivalentHectares;
  const activeSprayVarianceHectares = normalizedSize === null || activeSprayEquivalentHectares === null
    ? null
    : activeSprayEquivalentHectares - normalizedSize;
  const activeSprayCoveragePercent = normalizedSize === null || activeSprayEquivalentHectares === null
    ? null
    : activeSprayEquivalentHectares / normalizedSize * 100;
  const blockingCount = recordIssues.filter((issue) => issue.severity === "blocking").length;
  const disagreementCount = recordIssues.filter((issue) => issue.severity === "disagreement").length;
  let activeSprayState;
  if (blockingCount && !processedRecords.length) activeSprayState = "unavailable";
  else if (normalizedSize === null) activeSprayState = "missing-size";
  else if (blockingCount) activeSprayState = "partial";
  else if (disagreementCount) activeSprayState = "disagreement";
  else activeSprayState = varianceState(activeSprayVarianceHectares, HECTARE_EPSILON);

  let state;
  let varianceHectares = null;
  if (unknownMethodRecordCount > 0) state = "unknown-method";
  else if (normalizedSize === null) state = "missing-size";
  else if (broadacreRelevantRecordCount > 0 && reportedBroadacreRecordCount === 0) state = "unavailable";
  else if (reportedBroadacreRecordCount < broadacreRelevantRecordCount) state = "partial";
  else {
    varianceHectares = broadacreHectares - normalizedSize;
    state = varianceState(varianceHectares, HECTARE_EPSILON);
  }

  const productSummaries = buildProductSummaries(sourceRecords, processedByIndex, normalizedSize);
  const reportedBroadacreComplete = unknownMethodRecordCount === 0
    && reportedBroadacreRecordCount === broadacreRelevantRecordCount;
  const reportedBroadacreHectares = reportedBroadacreComplete ? broadacreHectares : null;
  const reportedBroadacreCoveragePercent = normalizedSize === null || !reportedBroadacreComplete
    ? null
    : broadacreHectares / normalizedSize * 100;
  return {
    state,
    sizeHectares: normalizedSize,
    broadacreHectares,
    reportedBroadacreHectares,
    broadacreLitres,
    cameraLitres,
    cameraRecordCount,
    unknownMethodRecordCount,
    varianceHectares,
    broadacreVarianceHectares: varianceHectares,
    reportedBroadacreCoveragePercent,
    broadacreCoveragePercent: reportedBroadacreCoveragePercent,
    chemicalVariances: state === "unknown-method" || normalizedSize === null
      ? []
      : compatibilityChemicalVariances(processedRecords, normalizedSize),
    activeSprayState,
    activeSprayEquivalentHectares,
    activeSprayCoveragePercent,
    activeSprayVarianceHectares,
    broadacreActiveSprayEquivalentHectares: invalidOnly ? null : broadacreActiveSprayEquivalentHectares,
    cameraActiveSprayEquivalentHectares: invalidOnly ? null : cameraActiveSprayEquivalentHectares,
    broadacreRelevantRecordCount,
    reportedBroadacreRecordCount,
    relevantRecordCount,
    includedRecordCount: processedRecords.length,
    recordIssues,
    productSummaries,
  };
}
