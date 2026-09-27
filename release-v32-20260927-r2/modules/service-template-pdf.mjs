import { loadPdfLib } from './pdf-lib-loader.mjs';

const names = {done:'Done', not_applicable:'Not applicable', deferred:'Deferred', unfinished:'Unfinished', not_started:'Unfinished'};
const WIDTH=595.28, HEIGHT=841.89, MARGIN=34, BOTTOM=48, LINE=12;

/** Offline A4 report. Long cells are continued, never truncated or scaled illegibly. */
export async function buildServiceTemplatePdf(record, {pdfLib}={}) {
  const {PDFDocument,StandardFonts,rgb}=pdfLib || await loadPdfLib();
  const doc=await PDFDocument.create();
  const regular=await doc.embedFont(StandardFonts.Helvetica);
  const bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const green=rgb(.16,.36,.22), ink=rgb(.12,.16,.13), pale=rgb(.94,.96,.93), grey=rgb(.80,.83,.80), white=rgb(1,1,1);
  const width=WIDTH-2*MARGIN;
  const text=value=>String(value??'').replace(/\r\n?/g,'\n').replace(/\t/g,'    ').replace(/[\u2010-\u2015\u2212]/g,'-').replace(/\u00a0/g,' ');
  function wrap(value, available, font=regular, size=9) {
    const result=[];
    for(const paragraph of text(value).split('\n')) {
      let line='';
      for(const character of paragraph) {
        let measured;
        try { measured=font.widthOfTextAtSize(line+character,size); }
        catch { throw new Error('This report contains a character the PDF font cannot display. Use Latin letters and standard punctuation, then export again.'); }
        if(measured>available && line) {
          const space=line.lastIndexOf(' ');
          if(space>0) {
            result.push(line.slice(0,space));line=line.slice(space+1);
            // A narrow leading word can leave a wide remainder: check again before
            // appending rather than allowing that remainder to cross the cell edge.
            if(font.widthOfTextAtSize(line+character,size)>available){result.push(line);line='';}
            line+=character;
          } else { result.push(line); line=character; }
        } else line+=character;
      }
      result.push(line);
    }
    return result;
  }
  let page,y;
  function newPage(){page=doc.addPage([WIDTH,HEIGHT]);y=HEIGHT-MARGIN;}
  function line(value,x,at,{font=regular,size=9,color=ink}={}){page.drawText(value,{x,y:at,size,font,color});}
  function rule(at){page.drawLine({start:{x:MARGIN,y:at},end:{x:WIDTH-MARGIN,y:at},thickness:.5,color:grey});}
  function ensure(height){if(y-height<BOTTOM)newPage();}
  function paragraph(value,{font=regular,size=9,color=ink,gap=8,continuation}={}) {
    for(const valueLine of wrap(value,width,font,size)) {if(y-size-4<BOTTOM){newPage();if(continuation){heading(`${continuation} (continued)`,20);y-=8;}}line(valueLine,MARGIN,y-size,{font,size,color});y-=size+4;}
    y-=gap;
  }
  function heading(title,reserve=0){
    const lines=wrap(title,width-16,bold,10);
    for(let index=0;index<lines.length;index++) {
      ensure(26+reserve);page.drawRectangle({x:MARGIN,y:y-22,width,height:22,color:green});
      line(lines[index],MARGIN+8,y-15,{font:bold,size:10,color:white});y-=22;
    }
  }
  function note(title,value){
    if(!value)return;
    ensure(52);heading(title,20);y-=8;paragraph(value,{continuation:title});rule(y);y-=10;
  }
  const sections=(record.sections||[]).filter(s=>s.tasks?.length);
  const tasks=sections.flatMap(s=>s.tasks);
  const blank=record.status==='template';
  newPage();
  paragraph(record.propertyName||'Farmhand',{font:bold,size:11,color:green,gap:3});
  paragraph(`${record.machineName||'Machine'} ${blank?'Service Template':'Service Record'}`,{font:bold,size:19,color:green,gap:3});
  paragraph(`${blank?'Blank service sheet - No work recorded':record.status==='finalised'?'Saved service record':record.unsavedChanges?'Unsaved service changes - Not saved on this device':'Draft service record - Not finalised'} | ${record.unsavedTemplate?'Unsaved changes based on template version':'Template version'} ${record.version||1}`,{size:9});
  rule(y);y-=14;
  const details=[['Machine',record.machineName],['Service date',blank?'To be completed':record.date],['Meter reading',blank?'To be completed':record.meter],['Operator',blank?'To be completed':record.operator]];
  const summary=blank?[`${tasks.length} checks in template`]:['Done','Deferred','Not applicable','Unfinished'].map(status=>`${status}: ${tasks.filter(t=>(names[t.status]||'Unfinished')===status).length}`);
  const leftWidth=width*.65, rightWidth=width-leftWidth-10;
  const detailLines=details.map(([label,value])=>({label,lines:wrap(value||'Not recorded',leftWidth-20)}));
  const boxHeight=Math.max(100,detailLines.reduce((sum,field)=>sum+16+field.lines.length*LINE,0)+16);
  if(boxHeight<HEIGHT-MARGIN-BOTTOM){
    ensure(boxHeight+10);
    page.drawRectangle({x:MARGIN,y:y-boxHeight,width:leftWidth,height:boxHeight,borderColor:grey,borderWidth:.6});
    page.drawRectangle({x:MARGIN+leftWidth+10,y:y-boxHeight,width:rightWidth,height:boxHeight,color:pale,borderColor:grey,borderWidth:.6});
    let at=y-16;
    for(const field of detailLines){line(field.label,MARGIN+10,at,{font:bold});at-=LINE;for(const valueLine of field.lines){line(valueLine,MARGIN+10,at);at-=LINE;}at-=4;}
    at=y-18;line('Service summary',MARGIN+leftWidth+20,at,{font:bold,size:11,color:green});at-=24;
    for(const valueLine of summary){line(valueLine,MARGIN+leftWidth+20,at);at-=20;}
    y-=boxHeight+12;
  }else{
    for(const [label,value] of details)note(label,value||'Not recorded');
    note('Service summary',summary.join('\n'));
  }
  note('Service intervals',(record.intervals||[]).join(', ')||(blank?'Choose when starting a service':'None selected'));
  const columns=[235,105,width-340];
  function tableHeader(){
    page.drawRectangle({x:MARGIN,y:y-22,width,height:22,color:pale});
    let x=MARGIN;
    ['Service task','Interval / status','Notes / exception'].forEach((title,i)=>{line(title,x+6,y-14,{font:bold,size:9});x+=columns[i];});y-=22;
  }
  for(const section of sections){
    ensure(76);heading(section.label||'Service checks',46);tableHeader();
    for(const [index,task] of section.tasks.entries()) {
      const taskText=[task.label,(task.custom||task.customised)?'Custom check':'',task.instructions].filter(Boolean).join('\n');
      const cells=[wrap(taskText,columns[0]-12),wrap(`${task.intervalText||'Not specified'}\n${blank?'[  ]':names[task.status]||'Unfinished'}`,columns[1]-12),wrap(task.notes||'',columns[2]-12)];
      let remaining=Math.max(...cells.map(c=>c.length)), offset=0;
      while(remaining>0){
        if(y-BOTTOM<LINE+12){newPage();heading(`${section.label||'Service checks'} (continued)`,46);tableHeader();}
        const count=Math.min(remaining,Math.floor((y-BOTTOM-12)/LINE));
        if(count<1)throw new Error('PDF page has insufficient room for a service row.');
        const height=count*LINE+12;
        page.drawRectangle({x:MARGIN,y:y-height,width,height,color:index%2?pale:white,borderColor:grey,borderWidth:.4});
        for(const offsetX of [columns[0],columns[0]+columns[1]])page.drawLine({start:{x:MARGIN+offsetX,y},end:{x:MARGIN+offsetX,y:y-height},thickness:.4,color:grey});
        let x=MARGIN;
        cells.forEach((cell,col)=>{cell.slice(offset,offset+count).forEach((valueLine,n)=>line(valueLine,x+6,y-15-n*LINE));x+=columns[col];});
        y-=height;offset+=count;remaining-=count;
      }
    }
    y-=12;
  }
  if(sections.some(s=>s.id==='boom')){
    ensure(170);heading('4830 boom reference - not to scale');
    const center=WIDTH/2, at=y-45;
    page.drawRectangle({x:center-30,y:at-10,width:60,height:25,borderColor:green,borderWidth:1});
    for(const direction of [-1,1]){
      page.drawLine({start:{x:center+direction*30,y:at},end:{x:center+direction*210,y:at},thickness:1,color:green});
      line('B',center+direction*120-3,at+10,{font:bold,color:green});
      line('C',center+direction*200-3,at+10,{font:bold,color:green});
    }
    line('A',center-3,at-24,{font:bold,color:green});
    line('D',center-3,at+24,{font:bold,color:green});y-=88;
    paragraph('A: Center frame - 50 hours - 13 fitting locations\nB: Inner to outer boom hinge - 50 hours - 6 fitting locations each side\nC: Outer to breakaway boom hinge and chain pivot - 50 hours - 2 fitting locations each side\nD: Lift arms - 10 hours - 5 fitting locations each side');
  }
  note('Parts and fluids used',record.parts);
  note('Overall notes',record.notes);
  if(!blank){
    const outstanding=tasks.filter(t=>!['done','not_applicable'].includes(t.status));
    if(outstanding.length)note('Outstanding work',outstanding.map(t=>`${t.label} - ${names[t.status]||'Unfinished'}${t.notes?'\n'+t.notes:''}`).join('\n\n'));
  }
  const pages=doc.getPages();
  pages.forEach((item,index)=>{
    page=item;
    rule(37);
    line(blank?'Blank service template - No work recorded':'Personal workshop service record',MARGIN,24,{size:8});
    const number=`Page ${index+1} of ${pages.length}`;
    line(number,WIDTH-MARGIN-regular.widthOfTextAtSize(number,8),24,{size:8});
  });
  return doc.save();
}
