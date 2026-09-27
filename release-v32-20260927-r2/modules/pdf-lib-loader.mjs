const pendingLoads = new WeakMap();

function isPdfLib(value) {
  return Boolean(value?.PDFDocument && value?.StandardFonts && value?.rgb);
}

export async function loadPdfLib({
  globalObject = globalThis,
  importer = (url) => import(url),
  url = new URL("../vendor/pdf-lib.min.js", import.meta.url).href,
} = {}) {
  if (isPdfLib(globalObject?.PDFLib)) return globalObject.PDFLib;
  if (!globalObject || (typeof globalObject !== "object" && typeof globalObject !== "function")) {
    throw new Error("The offline PDF generator is unavailable.");
  }
  const existing = pendingLoads.get(globalObject);
  if (existing) return existing;

  const pending = Promise.resolve()
    .then(() => importer(url))
    .then((moduleNamespace) => {
      const pdfLib = globalObject.PDFLib || moduleNamespace?.default || moduleNamespace;
      if (!isPdfLib(pdfLib)) throw new Error("The offline PDF generator is unavailable.");
      return pdfLib;
    })
    .catch((error) => {
      pendingLoads.delete(globalObject);
      if (error?.message === "The offline PDF generator is unavailable.") throw error;
      throw new Error("The offline PDF generator could not be loaded.", { cause: error });
    });

  pendingLoads.set(globalObject, pending);
  return pending;
}
