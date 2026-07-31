export function supportsFileShare(navigatorLike, files) {
  if (
    !navigatorLike ||
    typeof navigatorLike.share !== "function" ||
    typeof navigatorLike.canShare !== "function" ||
    !Array.isArray(files) ||
    files.length === 0
  ) {
    return false;
  }
  try {
    return navigatorLike.canShare({ files }) === true;
  } catch {
    return false;
  }
}

export async function handFilesToShareSheet({ navigatorLike, files, title, text }) {
  if (!supportsFileShare(navigatorLike, files)) {
    return { mode: "download", reason: "unsupported" };
  }
  try {
    await navigatorLike.share({ title, text, files });
    return { mode: "shared" };
  } catch (error) {
    if (error?.name === "AbortError") return { mode: "cancelled" };
    return { mode: "download", reason: "share-failed" };
  }
}
