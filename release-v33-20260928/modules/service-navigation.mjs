// Keep legacy 4830 drafts and general-equipment drafts independently guarded.
export function serviceNavigationBlocker(current,next,{legacy,workspace}) {
  if(current.section===next.section)return null;
  const controller=current.section==='servicing'?legacy:current.section==='service-workspace'?workspace:null;
  if(!controller?.hasUnsavedChanges?.())return null;
  return controller.getUnsavedBlocker?.() || (current.section==='servicing'
    ? 'Resolve the unfinished 4830 service before leaving.'
    : 'Save the unfinished equipment or service-template changes before leaving.');
}
