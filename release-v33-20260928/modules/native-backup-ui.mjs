import { getNativePlugin, getRevision, isStorageBusy } from './durable-storage.mjs';
import { createNativeBackup, prepareNativeRestore, applyNativeRestore, preparePreviousRecovery, recordVerifiedBackup, getBackupStatus, describeRestoreContents } from './native-backup.mjs';

export function backupFileOutcome(result) {
  if(result.cancelled||result.mode==='cancelled')return 'Cancelled. Records were not changed.';
  if(result.mode==='downloaded')return 'Backup download started. Check your browser downloads; the saved file has not been verified.';
  if(result.mode==='saved'&&result.verified===true)return 'Backup file saved and read back successfully.';
  if(result.mode==='shared')return 'Share chooser opened. Confirm that the receiving app kept the file.';
  return 'The file could not be verified. Try Save backup file and check the result.';
}

export function mountNativeBackup({hasUnsavedChanges = () => false, getBlocker = () => null, onResolve = () => {}} = {}) {
  const dialog = document.createElement('dialog');
  dialog.style.cssText = 'max-width:36rem;width:calc(100% - 3rem);border:1px solid #aebdad;border-radius:16px;padding:1.25rem;color:#18231b';
  dialog.innerHTML = `<h2>Web backup and recovery</h2><p>Includes saved tanks and Buffers, Work Diary, Notebook (including archived and binned notes), the equipment register, service logs, versioned templates, checklist drafts and finalised service reports, paddock library, rates, equipment settings, farm, appearance and weather settings, unfinished calculations, and retained record recovery data.</p><p>Navigation, weather cache, AI access settings, and older recovery snapshots are excluded. After restore, unfinished calculations and undo data are preserved but cannot resume.</p><p>Save a backup somewhere separate from this app. Sharing alone does not prove another app saved it.</p><div style="display:flex;flex-wrap:wrap;gap:.6rem"><button data-action="save">Save backup file</button><button data-action="share">Share backup</button><button data-action="import">Choose backup to restore</button><button data-action="recover">Recover before last restore</button><button data-action="close">Close</button></div><p role="status" style="white-space:pre-wrap"></p><div data-preview hidden><p data-summary></p><button data-action="confirm">Replace records with this backup</button> <button data-action="cancel">Cancel restore</button></div>`;
  document.body.append(dialog);
  const backupStatus = document.createElement('p');
  backupStatus.dataset.backupStatus = '';
  dialog.querySelector('h2').after(backupStatus);
  const resolveButton = document.createElement('button');
  resolveButton.dataset.action = 'resolve';
  resolveButton.textContent = 'Go to unfinished edit';
  resolveButton.hidden = true;
  dialog.querySelector('[role=status]').after(resolveButton);
  const status = dialog.querySelector('[role=status]');
  const preview = dialog.querySelector('[data-preview]');
  let prepared = null, revision = null, busy = false;
  const blocker = () => isStorageBusy() ? {message:'A save is still finishing. Wait a moment, then try again.'} : getBlocker() || (hasUnsavedChanges() ? {message:'Save or cancel your unfinished edit before backup or restore.'} : null);
  const clean = () => !blocker();
  function showBlocker(value) {status.textContent=value.message;resolveButton.hidden=!(value.section || value.tab);}
  async function refreshStatus() {try {backupStatus.textContent=(await getBackupStatus()).message;} catch {backupStatus.textContent='Backup status is unavailable until saved records can be read.';}}
  function clearPreview() {prepared=null; revision=null; preview.hidden=true;}
  function lock(value) {busy=value; dialog.querySelectorAll('button').forEach(b=>b.disabled=value);}
  dialog.addEventListener('cancel',event=>{if(busy) event.preventDefault();else clearPreview();});
  dialog.addEventListener('click',async event=>{
    const action=event.target.closest('button')?.dataset.action;
    if(!action || busy)return;
    if(action==='close'){clearPreview();dialog.close();return;}
    if(action==='cancel'){clearPreview();status.textContent='Restore cancelled. Records were not changed.';return;}
    if(action==='resolve'){
      const value=blocker();
      if(value && (value.section || value.tab)){clearPreview();dialog.close();onResolve(value);}
      else if(value)showBlocker(value);
      else {resolveButton.hidden=true;status.textContent='The unfinished edit has been resolved. You can continue.';}
      return;
    }
    lock(true);
    try {
      const blocking=blocker();
      if(blocking){clearPreview();showBlocker(blocking);return;}
      resolveButton.hidden=true;
      if(action==='save'||action==='share'){
        clearPreview();
        const payload=createNativeBackup();
        const text=JSON.stringify(payload,null,2)+'\n';
        const filename=`spray-web-backup_${payload.createdAt.replaceAll(':','-')}.json`;
        const result=await getNativePlugin()[action==='save'?'saveBackup':'shareBackup']({text,filename});
        if(!result.cancelled && result.mode==='saved' && result.verified===true){
          try {await recordVerifiedBackup(payload,result);await refreshStatus();}
          catch(error){status.textContent=`The backup file was saved and verified, but its status could not be recorded: ${error.message}`;return;}
        }
        status.textContent=backupFileOutcome(result);
      }else if(action==='import'||action==='recover'){
        clearPreview();
        const startingRevision=getRevision();
        if(action==='import'){
          const result=await getNativePlugin().openBackup();
          if(result.cancelled){status.textContent='Import cancelled. Records were not changed.';return;}
          prepared=prepareNativeRestore(result.text);
        }else prepared=await preparePreviousRecovery();
        if(!clean()||getRevision()!==startingRevision)throw new Error('Records changed while selecting the backup. Choose it again.');
        revision=startingRevision;
        dialog.querySelector('[data-summary]').textContent=`Backup: ${prepared.createdAt}. Contains ${describeRestoreContents(prepared.entries)}. This replaces all current app records and settings, including rates and equipment. A recovery copy of the current state will be retained. Old draft and undo actions will be disabled.`;
        preview.hidden=false;status.textContent='Review before replacing records. No changes have been made.';
      }else if(action==='confirm'){
        if(!prepared||getRevision()!==revision)throw new Error('The preview is stale. Choose the backup again.');
        await applyNativeRestore(prepared,revision);
        status.textContent='Restore committed and verified. Reopening records…';
        location.reload();
      }
    }catch(error){clearPreview();status.textContent=error.message||'The operation could not be completed.';}
    finally{lock(false);}
  });
  return {getStatus:getBackupStatus, open(){clearPreview();status.textContent='';resolveButton.hidden=true;refreshStatus();const value=blocker();if(value)showBlocker(value);dialog.showModal();}};
}
