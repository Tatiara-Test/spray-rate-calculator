export const emptyServicingLog = () => ({version:1,equipment:[],records:[]});
const clone = value => structuredClone(value);
const equipmentFields = ['id','name','type','makeModel','identifier','meterBasis','status','createdAt','updatedAt'];
const recordFields = ['id','equipmentId','date','hoursReading','kmReading','workDone','partsFluids','notes','equipmentSnapshot','createdAt','updatedAt'];
function object(value,fields) {
  if (!value || Object.getPrototypeOf(value)!==Object.prototype || Object.keys(value).length!==fields.length || fields.some(key=>!Object.hasOwn(value,key))) throw new Error('Unsupported or malformed Servicing fields. Original data must be retained.');
}
function text(value) { if(typeof value!=='string') throw new Error('Servicing text must be a string.'); }
function required(value) { text(value);if(!value.trim())throw new Error('Servicing identity, name or work description is missing.'); }
function timestamp(value) {text(value);if(!Number.isFinite(Date.parse(value)))throw new Error('Servicing timestamp is invalid.');}
function equipment(value) {
  object(value,equipmentFields);required(value.id);required(value.name);
  for(const key of ['type','makeModel','identifier'])text(value[key]);
  if(!['hours','km','both','neither'].includes(value.meterBasis)||!['active','archived'].includes(value.status))throw new Error('Invalid equipment meter basis or status.');
  timestamp(value.createdAt);timestamp(value.updatedAt);
}
export function validateServicingLog(data) {
  object(data,['version','equipment','records']);
  if(data.version!==1||!Array.isArray(data.equipment)||!Array.isArray(data.records))throw new Error('Unsupported Servicing version or collections.');
  const equipmentIds=new Set(),recordIds=new Set();
  for(const item of data.equipment){equipment(item);if(equipmentIds.has(item.id))throw new Error('Duplicate equipment identity.');equipmentIds.add(item.id);}
  for(const record of data.records){
    object(record,recordFields);required(record.id);required(record.equipmentId);
    if(recordIds.has(record.id)||!equipmentIds.has(record.equipmentId))throw new Error('Duplicate service identity or missing equipment reference.');recordIds.add(record.id);
    equipment(record.equipmentSnapshot);
    if(record.equipmentSnapshot.id!==record.equipmentId)throw new Error('Service snapshot identity does not match equipment.');
    if(typeof record.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(record.date)||!Number.isFinite(Date.parse(record.date))||new Date(record.date).toISOString().slice(0,10)!==record.date)throw new Error('Service date must be a valid YYYY-MM-DD date.');
    for(const [field,basis] of [['hoursReading','hours'],['kmReading','km']]){
      const reading=record[field];
      if(reading!==null&&(typeof reading!=='number'||!Number.isFinite(reading)||reading<0||![basis,'both'].includes(record.equipmentSnapshot.meterBasis)))throw new Error('Service reading must match the original equipment meter basis and be nonnegative.');
    }
    required(record.workDone);text(record.partsFluids);text(record.notes);timestamp(record.createdAt);timestamp(record.updatedAt);
  }
  return data;
}
function patchFields(patch,fields){if(!patch||Object.getPrototypeOf(patch)!==Object.prototype||Object.keys(patch).some(key=>!fields.includes(key)))throw new Error('Unsupported Servicing edit.');}
export function createEquipment(data,fields={}) {
  validateServicingLog(data);patchFields(fields,['name','type','makeModel','identifier','meterBasis']);
  const stamp=new Date().toISOString();
  const item={id:crypto.randomUUID(),name:'',type:'',makeModel:'',identifier:'',meterBasis:'neither',...clone(fields),status:'active',createdAt:stamp,updatedAt:stamp};
  const next=clone(data);next.equipment.push(item);return validateServicingLog(next);
}
function transform(data,collection,id,fn){validateServicingLog(data);const next=clone(data),item=next[collection].find(item=>item.id===id);if(!item)throw new Error('Servicing item no longer exists.');fn(item);item.updatedAt=new Date().toISOString();return validateServicingLog(next);}
export function updateEquipment(data,id,patch){patchFields(patch,['name','type','makeModel','identifier','meterBasis']);return transform(data,'equipment',id,item=>Object.assign(item,clone(patch)));}
export const setEquipmentStatus=(data,id,status)=>transform(data,'equipment',id,item=>{item.status=status;});
export function createServiceRecord(data,fields={}) {
  validateServicingLog(data);patchFields(fields,['equipmentId','date','hoursReading','kmReading','workDone','partsFluids','notes']);
  const item=data.equipment.find(item=>item.id===fields.equipmentId);if(!item||item.status!=='active')throw new Error('Choose active equipment to add a service record.');
  const stamp=new Date().toISOString();const record={id:crypto.randomUUID(),equipmentId:item.id,date:'',hoursReading:null,kmReading:null,workDone:'',partsFluids:'',notes:'',...clone(fields),equipmentSnapshot:clone(item),createdAt:stamp,updatedAt:stamp};
  const next=clone(data);next.records.push(record);return validateServicingLog(next);
}
export function updateServiceRecord(data,id,patch){patchFields(patch,['date','hoursReading','kmReading','workDone','partsFluids','notes']);return transform(data,'records',id,item=>Object.assign(item,clone(patch)));}
export function formatServiceHistory(data,{equipmentId}={}) {
  validateServicingLog(data);
  if(equipmentId!==undefined&&!data.equipment.some(item=>item.id===equipmentId))throw new Error('Equipment no longer exists.');
  const records=data.records.filter(item=>equipmentId===undefined||item.equipmentId===equipmentId).slice().sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt));
  const current=data.equipment.find(item=>item.id===equipmentId);
  const header=current ? [`Service history — ${current.name}`,...[current.type,current.makeModel,current.identifier].filter(Boolean),`Status: ${current.status}`].join('\n') : 'Service history — all equipment';
  const history=records.map(record=>{
    const item=record.equipmentSnapshot;
    return [`${record.date} — ${item.name}`,...[item.type,item.makeModel,item.identifier].filter(Boolean),...(record.hoursReading===null?[]:[`${record.hoursReading} hours`]),...(record.kmReading===null?[]:[`${record.kmReading} km`]),`Work done: ${record.workDone}`,...(record.partsFluids?[`Parts / fluids: ${record.partsFluids}`]:[]),...(record.notes?[`Notes: ${record.notes}`]:[])].join('\n');
  }).join('\n\n');
  return `${header}\n\n${history||'No service records.'}`;
}
