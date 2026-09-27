const MAX_BYTES=16*1024*1024;
const MIMES=new Set(['application/pdf','text/csv','text/plain','application/json']);
function validateFile(blob,filename) {
  if(!blob || typeof blob.arrayBuffer!=='function')throw new Error('The generated file is unavailable. Generate it again.');
  if(blob.size>MAX_BYTES)throw new Error('This file exceeds the 16 MiB limit. Choose a shorter reporting period.');
  const mimeType=String(blob.type||'').split(';')[0].trim().toLowerCase();
  if(!MIMES.has(mimeType))throw new Error('This file type is not supported for export.');
  if(typeof filename!=='string'||!filename.trim()||/[\/\\\u0000-\u001f\u007f]/.test(filename)||['.','..'].includes(filename)||[...filename].length>160||new TextEncoder().encode(filename).length>240)throw new Error('The generated filename is invalid.');
  return mimeType;
}
export async function filePayload(blob,filename) {
  const mimeType=validateFile(blob,filename);
  const bytes=new Uint8Array(await blob.arrayBuffer());
  if(bytes.length>MAX_BYTES)throw new Error('This file exceeds the 16 MiB limit.');
  let binary='';
  for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  return {base64:btoa(binary),filename,mimeType};
}
export async function saveFileCopy(blob,filename,{preferPicker=false}={}) {
  validateFile(blob,filename);
  // Open the picker before awaiting bytes so the user gesture stays active.
  let handle;
  if(preferPicker && typeof globalThis.showSaveFilePicker==='function') {
    try { handle=await globalThis.showSaveFilePicker({suggestedName:filename}); }
    catch(error) { if(error.name==='AbortError')return {mode:'cancelled'}; throw error; }
  }
  await filePayload(blob,filename);
  if(handle) {
    const writer=await handle.createWritable();
    try { await writer.write(blob); await writer.close(); }
    catch(error) { try {await writer.abort();}catch{} throw error; }
    const actual=new Uint8Array(await (await handle.getFile()).arrayBuffer());
    const expected=new Uint8Array(await blob.arrayBuffer());
    if(actual.length!==expected.length || actual.some((byte,i)=>byte!==expected[i]))throw new Error('The saved copy could not be verified. Try saving it again.');
    return {mode:'saved',verified:true};
  }
  const url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  return {mode:'downloaded',verified:false};
}
export async function nativeShareFiles({files,title,text}) {
  const navigatorLike=globalThis.navigator;
  if(!navigatorLike?.canShare || !navigatorLike?.share)return {mode:'unsupported'};
  if(!Array.isArray(files)||files.length!==1)throw new Error('Choose one report file to share.');
  if(!navigatorLike.canShare({files}))return {mode:'unsupported'};
  try { await navigatorLike.share({files,title:String(title||''),text:String(text||'')}); }
  catch(error) {if(error.name==='AbortError')return {mode:'cancelled'};throw error;}
  return {mode:'shared'};
}
