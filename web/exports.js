import {exportBrand} from './theme.js';
const modules = new Map();
function script(file){
  if(!modules.has(file)){
    modules.set(file,new Promise((resolve,reject)=>{
      const tag=document.createElement('script');
      tag.src='/vendor/'+file;tag.onload=resolve;
      tag.onerror=()=>{modules.delete(file);reject(Error('No se pudo cargar el generador local.'))};
      document.head.append(tag);
    }));
  }
  return modules.get(file);
}
const stamp=()=>new Date().toLocaleString('es-VE');
const moneyText=(n,c)=>c+' '+(n/100).toLocaleString('es-VE',{minimumFractionDigits:2,maximumFractionDigits:2});
const meta=r=>[['Empresa',r.company],['Reporte',r.title],['Período',r.range],[r.currency?'Moneda':'Magnitud',r.currency||'Unidades de inventario'],['Filtros',r.filters],['Generado',stamp()],['Origen',r.origin],...(r.note?[['Cobertura',r.note]]:[])];
function save(blob,name){
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),30000);
}
const argb=color=>'FF'+color.slice(1).toUpperCase();
/* Draws a report chart (horizontal grouped bars) into a PNG so both formats embed the same picture. */
function chartImage(c,currency,brand){
  const W=1400,label=330,valueW=230,barH=22,gap=18,head=c.series.length>1?92:62;
  const H=head+c.labels.length*(c.series.length*barH+gap)+20;
  const canvas=document.createElement('canvas');canvas.width=W;canvas.height=H;
  const ctx=canvas.getContext('2d'),colors=[brand.accent,brand.secondary,'#8a8a8a'];
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,H);
  ctx.fillStyle='#2d262b';ctx.font='600 28px Helvetica,Arial,sans-serif';ctx.fillText(c.title,20,40);
  ctx.font='20px Helvetica,Arial,sans-serif';
  if(c.series.length>1)c.series.forEach((s,i)=>{const x=20+i*260;ctx.fillStyle=colors[i];ctx.fillRect(x,58,18,18);ctx.fillStyle='#2d262b';ctx.fillText(s.name,x+26,74)});
  const all=c.series.flatMap(s=>s.values),low=Math.min(0,...all),high=Math.max(0,...all),span=(high-low)||1;
  const x0=label,x1=W-valueW,scale=v=>x0+(v-low)/span*(x1-x0);
  const text=v=>currency?moneyText(v,currency):String(v);
  c.labels.forEach((name,i)=>{
    const y=head+i*(c.series.length*barH+gap);
    ctx.fillStyle='#2d262b';ctx.textAlign='right';
    let shown=String(name);while(ctx.measureText(shown).width>label-30&&shown.length>4)shown=shown.slice(0,-2);
    ctx.fillText(shown===String(name)?shown:shown+'…',label-14,y+c.series.length*barH/2+7);
    ctx.textAlign='left';
    c.series.forEach((s,j)=>{
      const v=s.values[i]??0,a=scale(Math.min(0,v)),b=scale(Math.max(0,v)),top=y+j*barH;
      ctx.fillStyle=colors[j];ctx.fillRect(a,top+2,Math.max(2,b-a),barH-4);
      ctx.fillStyle='#5b5359';ctx.fillText(text(v),Math.max(b,scale(0))+8,top+barH-5);
    });
  });
  ctx.strokeStyle='#bbb';ctx.beginPath();ctx.moveTo(scale(0),head-6);ctx.lineTo(scale(0),H-14);ctx.stroke();
  return {data:canvas.toDataURL('image/png'),width:W,height:H};
}
function bookStyle(row,brand){
  row.eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:argb(brand.accent)}};cell.font={bold:true,color:{argb:argb(brand.foreground)}}});
}
async function excel(r,name,brand){
  await script('exceljs.min.js');
  const book=new window.ExcelJS.Workbook(),sheet=book.addWorksheet('Resumen');
  const format='"'+r.currency+'" #,##0.00;[Red]"'+r.currency+'" -#,##0.00';
  sheet.columns=[{width:32},{width:82}];const title=sheet.addRow([r.company,r.title]);
  bookStyle(title,brand);title.height=30;title.eachCell(c=>{c.font={...c.font,size:15}});
  const signature=sheet.addRow(['',brand.signature]);bookStyle(signature,brand);signature.height=34;
  // Two cell markers keep the logo square across Excel and other OOXML readers.
  const marker=(x,y)=>({nativeCol:0,nativeRow:1,nativeColOff:x*9525,nativeRowOff:y*9525});
  sheet.addImage(book.addImage({base64:brand.logo,extension:'png'}),{tl:marker(6,4),br:marker(42,40),editAs:'oneCell'});
  sheet.addRow([]);
  
  meta(r).forEach(pair=>{sheet.addRow(pair).getCell(2).alignment={wrapText:true}});
  for(const [label,value] of r.summary)sheet.addRow([label,r.currency?value/100:value]).getCell(2).numFmt=r.currency?format:'0';
  if(r.charts?.length){
    const ws=book.addWorksheet('Gráficas');let row=0;
    for(const c of r.charts){
      const img=chartImage(c,r.currency,brand),width=900,height=Math.round(900*img.height/img.width);
      ws.addImage(book.addImage({base64:img.data,extension:'png'}),{tl:{col:0,row},ext:{width,height}});
      row+=Math.ceil(height/20)+2;
    }
  }
  for(const t of r.tables){
    const ws=book.addWorksheet(t.name);ws.views=[{state:'frozen',ySplit:1}];
    ws.columns=t.headers.map((h,i)=>({width:Math.min(48,Math.max(15,h.length+3,...t.rows.slice(0,120).map(row=>String(row[i]).length+2)))}));
    bookStyle(ws.addRow(t.headers),brand);
    for(const row of t.rows){
      const item=ws.addRow(row.map((v,i)=>t.amounts.includes(i)?v/100:v));
      t.amounts.forEach(i=>item.getCell(i+1).numFmt=format);
    }
    ws.autoFilter={from:{row:1,column:1},to:{row:Math.max(1,t.rows.length+1),column:t.headers.length}};
  }
  save(new Blob([await book.xlsx.writeBuffer()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),name+'.xlsx');
}
async function pdf(r,name,brand){
  await script('jspdf.umd.min.js');await script('jspdf.plugin.autotable.min.js');
  const doc=new window.jspdf.jsPDF({orientation:'landscape',unit:'mm',format:'a4'});
  const pageW=doc.internal.pageSize.getWidth();
  const margin={left:14,right:14,top:28,bottom:17};
  function heading(){
    doc.setFillColor(brand.accent);doc.rect(0,0,pageW,19,'F');doc.setTextColor(brand.foreground);
    doc.addImage(brand.logo,'PNG',13,4,11,11);doc.setFontSize(10);doc.text(brand.signature,27,12);doc.setFontSize(14);doc.text(r.company,80,12);doc.setFontSize(9);
    doc.text(r.origin,pageW-14,12,{align:'right'});doc.setTextColor(45,38,43);
  }
  doc.setFontSize(17);doc.text(r.title,14,32);
  doc.setFontSize(10);
  const context=doc.splitTextToSize([r.range,r.currency,r.filters,'Generado '+stamp(),r.note].filter(Boolean).join('  |  '),pageW-28);
  doc.text(context,14,40);
  const options={margin,theme:'striped',showHead:'everyPage',rowPageBreak:'avoid',styles:{font:'helvetica',fontSize:9,cellPadding:2,overflow:'linebreak'},headStyles:{fillColor:brand.accent,textColor:brand.foreground},alternateRowStyles:{fillColor:brand.paper}};
  let summaryY=43+context.length*4;
  let breakdown=r.summary;
  if(r.headlineBalances){
    doc.autoTable({...options,startY:summaryY,head:[r.headlineBalances.map(([label])=>label)],
      body:[r.headlineBalances.map(([,value])=>moneyText(value,r.currency))],bodyStyles:{fontSize:16,fontStyle:'bold',textColor:brand.accent}});
    summaryY=doc.lastAutoTable.finalY+4;
    const featured=new Set(r.headlineBalances.map(([label])=>label));
    breakdown=breakdown.filter(([label])=>!featured.has(label));
  }
  doc.autoTable({...options,startY:summaryY,head:[[r.headlineBalances?'Desglose del saldo':'Resumen',r.currency?'Importe':'Cantidad']],body:breakdown.map(([k,v])=>[k,r.currency?moneyText(v,r.currency):String(v)]),columnStyles:{1:{halign:'right'}}});
  let chartY=doc.lastAutoTable.finalY+9;
  for(const c of r.charts??[]){
    const img=chartImage(c,r.currency,brand),w=pageW-28,h=Math.min(160,w*img.height/img.width),fit=h*img.width/img.height;
    if(chartY+h>192){doc.addPage();chartY=32}
    doc.addImage(img.data,'PNG',14,chartY,Math.min(w,fit),h);
    chartY+=h+8;
  }
  if(r.charts?.length){doc.addPage();doc.lastAutoTable.finalY=23}
  for(const t of r.tables){
    let y=doc.lastAutoTable.finalY+9;
    if(y>168){doc.addPage();y=32}
    doc.setFontSize(12);doc.text(t.name,14,y);
    doc.autoTable({...options,startY:y+3,head:[t.headers],body:t.rows.map(row=>row.map((v,i)=>t.amounts.includes(i)?moneyText(v,r.currency):v)),
      columnStyles:Object.fromEntries(t.amounts.map(i=>[i,{halign:'right'}]))});
  }
  const pages=doc.getNumberOfPages();
  for(let i=1;i<=pages;i++){
    doc.setPage(i);heading();doc.setFontSize(9);doc.text(r.title+'  |  '+i+' / '+pages,14,201);
  }
  doc.save(name+'.pdf');
}
export function exportMenu(scope){
  return '<details class="export-menu"><summary>Exportar ▾</summary><div>'+['xlsx','pdf'].map((fmt,i)=>
    '<button type="button" data-export="'+scope+'" data-format="'+fmt+'">'+['Excel (.xlsx)','PDF (.pdf)'][i]+'</button>').join('')+'</div></details>';
}
export async function downloadReport(report,format){
  const name=('ORA - '+report.title).replace(/[<>:"/\\|?*]/g,'-');
  const brand=exportBrand();
  if(format==='xlsx')await excel(report,name,brand);else await pdf(report,name,brand);
}
