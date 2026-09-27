import { nativeShareFiles } from './native-files.mjs';
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
  try {
    const native=await nativeShareFiles({files,title,text});
    if(native.mode!=='unsupported')return native;
  } catch(error) {
    return {mode:'download',reason:'share-failed',message:error?.message||'Native sharing could not start.'};
  }
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
