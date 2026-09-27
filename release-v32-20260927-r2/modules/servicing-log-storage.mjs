import { COMBINED_PREFIX } from './storage.mjs';
import { getStorage, transactStorage } from './durable-storage.mjs';
import { emptyServicingLog, validateServicingLog } from './servicing-log-model.mjs';
export const SERVICING_LOG_KEY = `${COMBINED_PREFIX}:servicing-log:v1`;
const RESTORE_EPOCH_KEY = `${COMBINED_PREFIX}:restore-epoch`;
export function readSnapshot(storage=getStorage()) {
  const raw=storage.getItem(SERVICING_LOG_KEY);
  return {raw,epoch:storage.getItem(RESTORE_EPOCH_KEY),data:raw===null?emptyServicingLog():validateServicingLog(JSON.parse(raw))};
}
export function saveServicingLog(next,{expectedRaw,expectedEpoch}={}) {
  const raw=JSON.stringify(validateServicingLog(next));
  if(expectedRaw===undefined||expectedEpoch===undefined)return Promise.reject(new Error('Servicing save requires the original snapshot and restore epoch.'));
  return transactStorage(storage=>{
    if(storage.getItem(SERVICING_LOG_KEY)!==expectedRaw||storage.getItem(RESTORE_EPOCH_KEY)!==expectedEpoch)throw new Error('Servicing changed or records were restored. Reload before saving.');
    storage.setItem(SERVICING_LOG_KEY,raw);return {data:JSON.parse(raw),raw,epoch:expectedEpoch};
  });
}
