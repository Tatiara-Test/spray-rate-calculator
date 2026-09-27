import { createEquipment, updateEquipment, setEquipmentStatus, createServiceRecord, updateServiceRecord, formatServiceHistory } from './servicing-log-model.mjs';
import { readSnapshot, saveServicingLog } from './servicing-log-storage.mjs';
import { saveFileCopy } from './native-files.mjs';
import { handFilesToShareSheet } from './share-files.mjs';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const meterLabel = basis => basis === 'hours' ? 'Hours' : basis === 'km' ? 'Kilometres' : basis === 'both' ? 'Hours and kilometres' : 'No meter';
export function readServiceForm(form, names) {
  return Object.fromEntries(names.map(name => [name, form.elements.namedItem(name)?.value ?? '']));
}

// Explicit drafts survive rejected commits. Only the verified storage receipt
// advances the captured raw value and restore epoch.
export function createServiceDraftController({read, save, onStatus = () => {}}) {
  let snapshot = read(), draft = null, running = null, error = null;
  const state = () => ({data:snapshot.data, draft, saving:Boolean(running), dirty:draft !== null, error});
  const notify = () => onStatus(state());
  return {
    state,
    begin(value) { if (draft || running) return false; draft=structuredClone(value); error=null; notify(); return true; },
    edit(fields) { if (!draft || running) return false; draft={...draft,fields:{...draft.fields,...fields}}; error=null; notify(); return true; },
    cancel() { if(running) return false; draft=null; error=null; notify(); return true; },
    refresh() { if(draft || running) return false; snapshot=read(); error=null; notify(); return true; },
    flush(transform) {
      if(running) return running;
      if(!draft) return Promise.resolve(true);
      error=null;
      running=Promise.resolve().then(async()=>{
        try {
          const next=transform(snapshot.data,structuredClone(draft));
          const receipt=await save(next,{expectedRaw:snapshot.raw,expectedEpoch:snapshot.epoch});
          snapshot=receipt || {...snapshot,data:next,raw:JSON.stringify(next)};
          draft=null;
          return true;
        } catch(cause) { error=cause; return false; }
        finally { running=null; notify(); }
      });
      notify();
      return running;
    },
  };
}

export async function exportServiceHistory(data, equipmentId, {action,save=saveFileCopy,share=handFilesToShareSheet,navigatorLike=globalThis.navigator}={}) {
  const equipment=data.equipment.find(item=>item.id===equipmentId);
  if(!equipment) throw new Error('Select equipment before exporting.');
  const filename=`${equipment.name.replace(/[^a-z0-9 _-]/gi,'').trim().slice(0,65)||'Equipment'} service history.txt`;
  const file=new File([formatServiceHistory(data,{equipmentId})],filename,{type:'text/plain'});
  if(action==='save') {
    const result=await save(file,filename);
    if(result.mode==='cancelled') return 'Save cancelled. Your service history is still here.';
    if(result.mode==='downloaded') return 'Service history download started. Check your browser downloads; the saved copy has not been verified.';
    if(result.mode!=='saved'||result.verified!==true) throw new Error('A saved copy could not be verified. Try Save text copy again.');
    return 'Service history text copy saved and verified.';
  }
  const result=await share({navigatorLike,files:[file],title:`${equipment.name} service history`,text:'Service history text copy'});
  if(result.mode==='cancelled') return 'Sharing cancelled. Your service history is still here.';
  if(result.mode!=='shared') throw new Error(result.message||'The share chooser could not be opened. Try Save text copy.');
  return 'Text copy handed to the share chooser. Delivery is not confirmed.';
}

export function mountServicingLogApp(host, options={}) {
  host.classList.add('servicing-log-app');
  let writer, selected=null, view='active', exportBusy=false, locked=false, message='';
  const find=selector=>host.querySelector(selector);
  const data=()=>writer.state().data;
  const equipment=()=>data().equipment.find(item=>item.id===selected);
  const hasUnsavedChanges=()=>!locked && (exportBusy || writer.state().dirty || writer.state().saving);
  const getUnsavedBlocker=()=>hasUnsavedChanges() ? exportBusy ? 'Finish the service history file action before leaving.' : 'Save or cancel the Servicing Log draft before leaving. If saving failed, use Retry save.' : null;
  function failRead(error) {
    locked=true;
    host.innerHTML='<h2>Servicing Log unavailable</h2><p role="alert"></p><p>The stored records have not been changed. Return to Main menu and resolve the storage problem before editing.</p>';
    find('[role=alert]').textContent=error.message || 'Servicing records could not be read safely.';
    options.onDirtyChange?.(false);
  }
  function status() {
    if(!writer || locked) return;
    const state=writer.state();
    const target=find('[data-save-status]');
    if(target) target.textContent=exportBusy?'Preparing service history…':state.saving?'Saving…':state.error?`Not saved. ${state.error.message} Your draft is still here.`:state.dirty?'Draft — not saved yet':'Saved on this device';
    const retry=find('[data-action="retry"]');
    if(retry) retry.hidden=!state.error;
    host.querySelectorAll('button,input,textarea,select').forEach(control=>{control.disabled=exportBusy||state.saving;});
    options.onDirtyChange?.(hasUnsavedChanges());
  }
  try { writer=createServiceDraftController({read:options.readSnapshot||readSnapshot,save:options.saveServicingLog||saveServicingLog,onStatus:status}); }
  catch(error) { failRead(error); return {show(){},refresh:()=>false,hasUnsavedChanges:()=>false,getUnsavedBlocker:()=>null,flush:async()=>false}; }
  function transform(current,draft) {
    if(draft.kind==='equipment') return draft.id ? updateEquipment(current,draft.id,draft.fields) : createEquipment(current,draft.fields);
    if(draft.kind==='status') return setEquipmentStatus(current,draft.id,draft.fields.status);
    const fields={...draft.fields};
    for(const key of ['hoursReading','kmReading']) fields[key]=fields[key]===''||fields[key]==null?null:Number(fields[key]);
    return draft.id ? updateServiceRecord(current,draft.id,fields) : createServiceRecord(current,fields);
  }
  async function flush() {
    if(locked||exportBusy) return false;
    const saved=await writer.flush(transform);
    if(saved) { message=''; render(); }
    return saved;
  }
  function start(draft) { if(writer.begin(draft)) {message='';render();find('form input')?.focus();} }
  const field=(name,label,value,{required=false,type='text',max=240}={})=>`<label>${label}<input name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''} ${type==='number'?'min="0" step="any"':type==='text'?`maxlength="${max}"`:''}></label>`;
  const area=(name,label,value,required=false)=>`<label>${label}<textarea name="${name}" ${required?'required':''} maxlength="12000">${esc(value)}</textarea></label>`;
  function renderDraft(draft) {
    const f=draft.fields;
    if(draft.kind==='status') return `<h3>${f.status==='archived'?'Archive':'Restore'} equipment</h3><p>The change has not been saved. Service history is retained.</p><button data-action="cancel">Cancel change</button>`;
    let fields;
    if(draft.kind==='equipment') fields=field('name','Equipment name',f.name,{required:true})+field('type','Type',f.type)+field('makeModel','Make / model',f.makeModel)+field('identifier','Identifier / registration',f.identifier)+`<label>Meter basis<select name="meterBasis">${['hours','km','both','neither'].map(basis=>`<option value="${basis}" ${basis===f.meterBasis?'selected':''}>${meterLabel(basis)}</option>`).join('')}</select></label><p>Changing equipment details keeps earlier records and their original equipment details.</p>`;
    else {
      const snapshot=draft.snapshot;
      fields=`<p>${esc(snapshot.name)} · ${esc(snapshot.identifier||snapshot.makeModel||snapshot.type)}</p>`+field('date','Date',f.date,{required:true,type:'date'})+(snapshot.meterBasis==='neither'?'<p>No meter reading for this equipment record.</p>':(['hours','both'].includes(snapshot.meterBasis)?field('hoursReading','Hours (optional)',f.hoursReading,{type:'number'}):'')+(['km','both'].includes(snapshot.meterBasis)?field('kmReading','Kilometres (optional)',f.kmReading,{type:'number'}):''))+area('workDone','Work done',f.workDone,true)+area('partsFluids','Parts / fluids (optional)',f.partsFluids)+area('notes','Notes (optional)',f.notes);
    }
    return `<form data-service-form><h3>${draft.id?'Edit':'Add'} ${draft.kind==='equipment'?'equipment':'record'}</h3>${fields}<div class="sl-toolbar"><button type="button" data-action="cancel">Cancel</button><button type="submit">Save ${draft.kind==='equipment'?'equipment':'record'}</button></div></form>`;
  }
  function render() {
    if(locked) return;
    const draft=writer.state().draft, item=equipment();
    let body;
    if(draft) body=renderDraft(draft);
    else if(item) {
      const records=data().records.filter(record=>record.equipmentId===item.id).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
      body=`<button data-action="back">← Equipment register</button><h3>${esc(item.name)}</h3><p>${[item.type,item.makeModel,item.identifier,meterLabel(item.meterBasis),item.status==='archived'?'Archived':'Active'].filter(Boolean).map(esc).join(' · ')}</p><div class="sl-toolbar"><button data-action="edit-equipment">Edit equipment</button><button data-action="${item.status==='active'?'archive':'restore'}">${item.status==='active'?'Archive':'Restore'}</button>${item.status==='active'?'<button data-action="add-record">Add simple record</button>':''}</div><h3>Simple service log</h3>${records.length?'':'<p>No simple service entries yet. Checklist reports are under Service templates &amp; checklists.</p>'}<div class="sl-history">${records.map(record=>`<article><h4>${esc(record.date)}</h4><p>${[record.equipmentSnapshot.name,record.equipmentSnapshot.type,record.equipmentSnapshot.makeModel,record.equipmentSnapshot.identifier].filter(Boolean).map(esc).join(' · ')}${record.hoursReading==null?'':` · ${esc(record.hoursReading)} hours`}${record.kmReading==null?'':` · ${esc(record.kmReading)} km`}</p><p class="sl-text">${esc(record.workDone)}</p>${record.partsFluids?`<p class="sl-text"><strong>Parts / fluids:</strong> ${esc(record.partsFluids)}</p>`:''}${record.notes?`<p class="sl-text"><strong>Notes:</strong> ${esc(record.notes)}</p>`:''}<button data-edit-record="${esc(record.id)}">Edit record</button></article>`).join('')}</div><div class="sl-toolbar"><button data-action="save-text">Save text copy</button><button data-action="share-text">Share text</button></div>`;
    } else body=`<p>Keep equipment details and a record of work carried out.</p><button data-action="add-equipment">Add equipment</button><nav class="sl-toolbar" aria-label="Equipment views">${['active','archived'].map(value=>`<button data-view="${value}" aria-pressed="${value===view}">${value==='active'?'Active':'Archived'}</button>`).join('')}</nav><div class="sl-register">${data().equipment.filter(item=>item.status===view).map(item=>`<button data-equipment="${esc(item.id)}"><strong>${esc(item.name)}</strong><span>${[item.type,item.makeModel,item.identifier].filter(Boolean).map(esc).join(' · ')}</span></button>`).join('')||'<p>No equipment in this view.</p>'}</div>`;
    host.innerHTML=`<h2>Servicing Log</h2><p data-save-status role="status" aria-live="polite"></p><button data-action="retry" hidden>Retry save</button><p data-message role="alert">${esc(message)}</p>${body}`;
    if (!draft && item && options.onOpenWorkflow) host.querySelector('.sl-toolbar')?.insertAdjacentHTML('beforeend','<button data-action="workflow">Service templates &amp; checklists</button>');
    status();
  }
  async function exportCurrent(action) {
    if(hasUnsavedChanges()) return;
    exportBusy=true; status();
    try { message=await exportServiceHistory(structuredClone(data()),selected,{action,...options.exportOptions}); }
    catch(error) { message=`${error.message} Service records remain on this device.`; }
    finally { exportBusy=false; render(); }
  }
  host.addEventListener('click',event=>{
    if(locked||exportBusy||writer.state().saving) return;
    const button=event.target.closest('button');
    if(!button||!host.contains(button)) return;
    const d=button.dataset;
    if(d.action==='cancel') {writer.cancel();message='Draft cancelled.';render();return;}
    if(d.action==='retry') {void flush();return;}
    if(writer.state().dirty) return;
    if(d.equipment) {selected=d.equipment;message='';render();return;}
    if(d.view) {view=d.view;render();return;}
    if(d.editRecord) {
      const record=data().records.find(item=>item.id===d.editRecord);
      if(record) start({kind:'record',id:record.id,snapshot:record.equipmentSnapshot,fields:{date:record.date,hoursReading:record.hoursReading,kmReading:record.kmReading,workDone:record.workDone,partsFluids:record.partsFluids,notes:record.notes}});
      return;
    }
    switch(d.action) {
      case 'workflow': options.onOpenWorkflow?.(selected); break;
      case 'back': selected=null;message='';render();break;
      case 'add-equipment': start({kind:'equipment',fields:{name:'',type:'',makeModel:'',identifier:'',meterBasis:'hours'}});break;
      case 'edit-equipment': {const item=equipment();start({kind:'equipment',id:item.id,fields:Object.fromEntries(['name','type','makeModel','identifier','meterBasis'].map(key=>[key,item[key]]))});break;}
      case 'archive': case 'restore': start({kind:'status',id:selected,fields:{status:d.action==='archive'?'archived':'active'}});void flush();break;
      case 'add-record': {if(equipment().status!=='active') return;const now=new Date(),date=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;start({kind:'record',snapshot:equipment(),fields:{equipmentId:selected,date,hoursReading:null,kmReading:null,workDone:'',partsFluids:'',notes:''}});break;}
      case 'save-text': void exportCurrent('save');break;
      case 'share-text': void exportCurrent('share');break;
    }
  });
  function capture(event) {
    if(locked) return;
    const form=event.target.closest('[data-service-form]');
    if(!form) return;
    const draft=writer.state().draft;
    const names=draft.kind==='equipment'?['name','type','makeModel','identifier','meterBasis']:['date','hoursReading','kmReading','workDone','partsFluids','notes'];
    writer.edit(readServiceForm(form,names));
  }
  host.addEventListener('input',capture);
  host.addEventListener('change',capture);
  host.addEventListener('submit',event=>{
    if(!event.target.matches('[data-service-form]')) return;
    event.preventDefault();capture(event);void flush();
  });
  function refresh() {if(locked||hasUnsavedChanges()) return false;try {writer.refresh();render();return true;} catch(error) {failRead(error);return false;}}
  const unload=event=>{if(hasUnsavedChanges()){event.preventDefault();event.returnValue='';}};
  globalThis.addEventListener?.('beforeunload',unload);
  render();
  return {show(){if(!hasUnsavedChanges())refresh();},refresh,hasUnsavedChanges,getUnsavedBlocker,flush,dispose(){globalThis.removeEventListener?.('beforeunload',unload);}};
}
