import {saveFileCopy} from './native-files.mjs';

export function recoverySaveMessage(result) {
  if(result?.mode==='saved'&&result.verified===true)return 'Recovery file saved and verified.';
  if(result?.mode==='downloaded')return 'Recovery download started. Check your downloads; the saved file has not been verified.';
  if(result?.mode==='cancelled')return 'Save cancelled. No records changed.';
  throw new Error('The recovery copy could not be saved. No records changed.');
}

// This screen stays outside normal app bootstrap so conflicts never hide the
// only route to preserving both versions. Raw values are never normalized here.
export async function mountStorageConflictRecovery(host,{plugin,buildBackup,save=saveFileCopy,reload=()=>location.reload()}={}) {
  let snapshot;
  try {snapshot=await plugin.inspectLegacyConflict();}catch{return false;}
  if(!snapshot)return false;
  const panel=document.createElement('section');
  panel.innerHTML='<h2>Preserve and review both versions</h2><p data-description></p><p>Close other tabs of this app before continuing. Download recovery copies first. Neither version will be merged automatically, and the older browser records will not be deleted.</p><p data-summary></p><button type="button" data-export>Download both versions for recovery</button> <button type="button" data-backup>Save current app backup</button><p role="status" data-status></p><div data-choice hidden><label><input type="checkbox" data-ack> Keep the current app version. Do not apply the older tab’s changes.</label><p>The complete current app version and older tab records will also be retained together in a browser recovery archive before reopening. This choice applies to every record, not just one section.</p><button type="button" data-confirm disabled>Keep current app records and reopen</button></div><p data-unavailable></p>';
  host.append(panel);
  const find=s=>panel.querySelector(s),status=find('[data-status]');
  const conflict=snapshot.conflict===true;
  find('[data-description]').textContent=conflict?'The current app and an older tab have different saved records. Both versions are still present.':'Saved records could not be opened. Download their original contents for review before attempting a repair.';
  find('[data-summary]').textContent=`${snapshot.changedKeys?.length||0} older record entries differ from the original import. Current app revision: ${snapshot.state?.revision??'unavailable'}.`;
  let backedUp=false,busy=false;
  const canKeep=conflict&&snapshot.canKeepDurable===true;
  find('[data-choice]').hidden=!canKeep;
  if(!canKeep)find('[data-unavailable]').textContent='Automatic reopening is unavailable for these records. Keep the recovery file for review; the originals have not been changed.';
  let backup;
  try {backup=buildBackup(snapshot.state.entries,snapshot.state.revision);}catch{}
  find('[data-backup]').disabled=!backup;
  const controls=()=>{
    find('[data-export]').disabled=busy;
    find('[data-backup]').disabled=busy||!backup;
    find('[data-ack]').disabled=busy;
    find('[data-confirm]').disabled=busy||!canKeep||!backedUp||!find('[data-ack]').checked;
  };
  find('[data-ack]').addEventListener('change',controls);
  async function exportCopy(value,filename,isRecovery){
    busy=true;controls();
    try {
      const result=await save(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}),filename);
      status.textContent=recoverySaveMessage(result);
      if(isRecovery&&(result.mode==='downloaded'||result.mode==='saved'&&result.verified===true))backedUp=true;
    }catch(error){status.textContent=`${error.message} No records changed.`;}finally{busy=false;controls();}
  }
  find('[data-export]').addEventListener('click',()=>void exportCopy(snapshot,'web-records-both-versions-recovery.json',true));
  find('[data-backup]').addEventListener('click',()=>void exportCopy(backup,'web-current-app-backup.json',false));
  find('[data-confirm]').addEventListener('click',async()=>{
    if(busy||!canKeep||!backedUp||!find('[data-ack]').checked)return;
    busy=true;controls();
    try {
      const receipt=await plugin.keepDurableAfterLegacyConflict({expectedRevision:snapshot.state.revision,expectedLegacyEntries:snapshot.legacyEntries,expectedBaseline:snapshot.baseline,confirmation:'keep-durable-records',operationId:crypto.randomUUID()});
      if(!receipt?.archiveId)throw new Error('The recovery archive could not be confirmed.');
      const archive=await plugin.readConflictArchive(receipt.archiveId);
      if(JSON.stringify(archive.legacyEntries)!==JSON.stringify(snapshot.legacyEntries)||JSON.stringify(archive.originalRecord?.state?.entries)!==JSON.stringify(snapshot.state.entries))throw new Error('The archived versions could not be verified.');
      status.textContent='Both versions archived. Reopening the current app records…';
      reload();
    }catch(error){status.textContent=`${error.message} Keep this recovery copy and reload to review the latest versions.`;busy=false;controls();}
  });
  controls();return true;
}
