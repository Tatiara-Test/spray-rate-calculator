import {mountServicingLogApp} from './servicing-log-app.mjs';
import {mountServiceWorkflowApp} from './service-workflow-app.mjs';

export function mountServicingWorkspaceApp(host,options={}) {
  host.innerHTML='<div data-service-register></div><div data-service-workflow hidden></div>';
  const registerHost=host.querySelector('[data-service-register]');
  const workflowHost=host.querySelector('[data-service-workflow]');
  let workflow=null,active='register',register;
  const hasUnsavedChanges=()=>Boolean(register?.hasUnsavedChanges()||workflow?.hasUnsavedChanges());
  const notify=()=>options.onDirtyChange?.(hasUnsavedChanges());
  function back(){
    if(hasUnsavedChanges())return false;
    active='register';workflowHost.hidden=true;registerHost.hidden=false;register.refresh();notify();return true;
  }
  function openEquipment(equipmentId){
    if(hasUnsavedChanges())return false;
    if(!workflow) workflow=mountServiceWorkflowApp(workflowHost,{equipmentId,onBack:back,onDirtyChange:notify});
    else if(workflow.openEquipment(equipmentId)===false)return false;
    active='workflow';registerHost.hidden=true;workflowHost.hidden=false;workflow.show?.();notify();return true;
  }
  register=mountServicingLogApp(registerHost,{onDirtyChange:notify,onOpenWorkflow:openEquipment});
  const refresh=()=>{
    if(hasUnsavedChanges())return false;
    return active==='workflow'?workflow.refresh():register.refresh();
  };
  return {refresh,show:refresh,hasUnsavedChanges,
    getUnsavedBlocker:()=>workflow?.getUnsavedBlocker()||register.getUnsavedBlocker(),
    flush:()=>active==='workflow'?workflow.flush():register.flush(),
    dispose(){register.dispose?.();workflow?.dispose?.();}};
}
