import {COMBINED_PREFIX} from './storage.mjs';
import {getStorage,transactStorage} from './durable-storage.mjs';
import {SERVICING_LOG_KEY} from './servicing-log-storage.mjs';
import {emptyServicingLog,validateServicingLog} from './servicing-log-model.mjs';
import {emptyWorkflows,validateWorkflows,validateWorkflowTransition} from './service-workflow-model.mjs';
export const SERVICING_WORKFLOWS_KEY=`${COMBINED_PREFIX}:servicing-workflows:v1`;
export const SERVICE_WORKFLOW_KEY=SERVICING_WORKFLOWS_KEY;
const EPOCH=`${COMBINED_PREFIX}:restore-epoch`;
export function readSnapshot(storage=getStorage()){const raw=storage.getItem(SERVICING_WORKFLOWS_KEY),logRaw=storage.getItem(SERVICING_LOG_KEY),equipment=(logRaw===null?emptyServicingLog():validateServicingLog(JSON.parse(logRaw))).equipment;return {raw,logRaw,epoch:storage.getItem(EPOCH),data:raw===null?emptyWorkflows():validateWorkflows(JSON.parse(raw),equipment),equipment};}
export function saveWorkflows(next,{expectedRaw,expectedLogRaw,expectedEpoch}={}){if([expectedRaw,expectedLogRaw,expectedEpoch].some(v=>v===undefined))return Promise.reject(new Error('Workflow save requires the original snapshot, equipment snapshot and restore epoch.'));const frozen=structuredClone(next);return transactStorage(storage=>{const before=readSnapshot(storage);if(before.raw!==expectedRaw||before.logRaw!==expectedLogRaw||before.epoch!==expectedEpoch)throw new Error('Workflows or equipment changed, or records were restored. Reload before saving.');validateWorkflowTransition(before.data,frozen,before.equipment);const raw=JSON.stringify(frozen);storage.setItem(SERVICING_WORKFLOWS_KEY,raw);return {...before,data:JSON.parse(raw),raw};});}
