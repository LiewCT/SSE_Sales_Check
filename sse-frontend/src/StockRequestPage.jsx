import {useEffect,useState} from "react";
import axios from "axios";
import "./StockRequestPage.css";

const STATUSES=["New","Approved","Closed"];
const BRANCHES=["Melaka","Klang","Low Yat"];
const emptySections=()=>Object.fromEntries(STATUSES.map(status=>[status,{items:[],loading:true,error:"",dateStart:"",dateEnd:""}]));
const normalizeBranch=value=>String(value||"").trim().toLowerCase().replace(/[^a-z0-9]/g,"");
const normalizeRow=(row,index)=>{
  if(!Array.isArray(row))return null;
  const recordId=String(row[8]||"").match(/getRecord\(\s*["']?(\d+)/i)?.[1]||"";
  const id=recordId||`${row[1]||"request"}-${index}`;
  return {id,recordId,number:String(row[1]||"-"),status:String(row[2]||"-"),remark:String(row[3]||"-"),fromBranch:String(row[4]||"-"),toBranch:String(row[5]||"-"),requestedBy:String(row[6]||"-"),date:String(row[7]||"-")};
};
const getDirection=item=>{
  const from=normalizeBranch(item.fromBranch);
  const to=normalizeBranch(item.toBranch);
  const branches=BRANCHES.map(normalizeBranch);
  if(from==="southcity"&&branches.includes(to))return "send";
  if(to==="southcity"&&branches.includes(from))return "receive";
  return "other";
};
const getBranch=(item,direction=getDirection(item))=>{
  const routeBranch=direction==="send"?item.toBranch:direction==="receive"?item.fromBranch:"";
  const match=BRANCHES.find(branch=>normalizeBranch(branch)===normalizeBranch(routeBranch));
  if(match)return match;
  return BRANCHES.find(branch=>[item.fromBranch,item.toBranch].some(value=>normalizeBranch(value)===normalizeBranch(branch)))||"";
};
const getBranchClass=branch=>`branch-${normalizeBranch(branch)==="lowyat"?"low-yat":normalizeBranch(branch)}`;
const isAiForecast=item=>/^ai\s+forecast\s+batch\b/i.test(item.remark.trim());
const isPassTo=item=>/^pass\s+to\b/i.test(item.remark.trim());
const formatDate=value=>{
  const match=String(value||"").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match?`${match[3]}/${match[2]}/${match[1]}`:value;
};
const HTML_ENTITIES={"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"};
const escapeHtml=value=>String(value??"-").replace(/[&<>"']/g,character=>HTML_ENTITIES[character]);
const normalizeScanCode=value=>String(value||"").replace(/[\r\n\t]/g,"").trim().toUpperCase();
const REQUEST_DETAIL_STYLE=`*{box-sizing:border-box}body{margin:0;background:#f1f5f9;color:#0f172a;font-family:Arial,sans-serif}.request-detail-page{width:min(1180px,calc(100% - 32px));margin:28px auto}.request-detail-page h1{margin:0 0 18px;font-size:28px}.request-detail-summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:20px}.request-detail-summary div{padding:16px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;box-shadow:0 4px 12px rgba(15,23,42,.06)}.request-detail-summary span{display:block;margin-bottom:7px;color:#64748b;font-size:12px;font-weight:800;text-transform:uppercase}.request-detail-summary strong{font-size:17px;overflow-wrap:anywhere}.request-detail-status{color:#0f766e}.request-detail-table-wrap{overflow:auto;border:1px solid #cbd5e1;border-radius:12px;background:#fff;box-shadow:0 5px 16px rgba(15,23,42,.07)}table{width:100%;min-width:720px;border-collapse:collapse}th,td{padding:13px 14px;border-bottom:1px solid #e2e8f0;text-align:left;vertical-align:top}th{background:#0f766e;color:#fff;font-size:13px}td{font-size:14px}tr:last-child td{border-bottom:0}th:first-child,td:first-child{width:70px;text-align:center}th:nth-child(2),td:nth-child(2){width:190px;font-weight:700}th:last-child,td:last-child{width:145px;text-align:center}.request-detail-message{padding:50px 20px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;color:#64748b;font-size:17px;text-align:center}.request-detail-error{color:#b91c1c}@media(max-width:720px){.request-detail-page{width:min(100% - 20px,1180px);margin:14px auto}.request-detail-summary{grid-template-columns:1fr}.request-detail-page h1{font-size:23px}}`;
const REQUEST_SCANNER_STYLE=`.request-scanner{margin-bottom:20px;padding:17px;border:1px solid #cbd5e1;border-radius:12px;background:#fff;box-shadow:0 5px 16px rgba(15,23,42,.07)}.request-scanner-top{display:flex;align-items:flex-end;justify-content:space-between;gap:14px}.request-scanner h2{margin:0;font-size:20px}.request-scanner p{margin:5px 0 0;color:#64748b;font-size:13px}.request-scanner-controls{display:flex;gap:8px}.request-scan-input{width:280px;max-width:100%;padding:11px 12px;border:2px solid #0f766e;border-radius:8px;font-size:16px;font-weight:700;text-transform:uppercase;outline:none}.request-scan-input:focus{box-shadow:0 0 0 4px rgba(15,118,110,.16)}.request-scan-submit,.request-scan-reset{padding:10px 14px;border:0;border-radius:8px;color:#fff;font-weight:800;cursor:pointer}.request-scan-submit{background:#0f766e}.request-scan-submit:hover{background:#115e59}.request-scan-reset{background:#475569}.request-scan-reset:hover{background:#334155}.request-scan-message{margin-top:13px;padding:10px 12px;border-radius:8px;background:#f1f5f9;color:#475569;font-size:14px;font-weight:800}.request-scan-message.correct{background:#dcfce7;color:#15803d}.request-scan-message.wrong{background:#fee2e2;color:#b91c1c}.request-scan-progress{display:flex;align-items:center;gap:10px;margin-top:12px}.request-scan-progress>span{min-width:72px;font-size:13px;font-weight:800}.request-scan-progress-bar{flex:1;height:10px;overflow:hidden;border-radius:999px;background:#e2e8f0}.request-scan-progress-bar i{display:block;width:0;height:100%;background:#0f766e;transition:width .18s ease}.request-wrong-scans{display:none;margin-top:12px;color:#b91c1c;font-size:13px;font-weight:800}.request-wrong-scans.visible{display:block}.request-wrong-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:7px}.request-wrong-list span{padding:5px 8px;border-radius:999px;background:#fee2e2}.request-detail-table-wrap table{min-width:980px}.scan-count,.scan-result{text-align:center;font-weight:800}.scan-result span{display:inline-block;padding:5px 8px;border-radius:999px}.scan-result .pending{background:#e2e8f0;color:#475569}.scan-result .counting{background:#fef3c7;color:#a16207}.scan-result .matched{background:#dcfce7;color:#15803d}.scan-row-flash td{animation:scanRowFlash .7s ease}@keyframes scanRowFlash{0%,100%{background:transparent}45%{background:#bbf7d0}}@media(max-width:720px){.request-scanner-top{align-items:stretch;flex-direction:column}.request-scanner-controls{flex-direction:column}.request-scan-input{width:100%}}`;
const writeRequestTab=(target,title,content)=>{
  if(!target||target.closed)return;
  target.document.open();
  target.document.write(`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title><style>${REQUEST_DETAIL_STYLE}${REQUEST_SCANNER_STYLE}</style></head><body>${content}</body></html>`);
  target.document.close();
};
const renderRequestDetail=detail=>{
  const records=Array.isArray(detail.records)?detail.records:[];
  const requestedTotal=records.reduce((total,record)=>total+Math.max(0,Number(record.request_qty)||0),0);
  const rows=records.map((record,index)=>{
    const requested=Math.max(0,Number(record.request_qty)||0);
    return `<tr id="scan-row-${index}"><td>${index+1}</td><td>${escapeHtml(record.product_code)}</td><td>${escapeHtml(record.product_description||record.product_name)}</td><td>${requested}</td><td class="scan-count" id="scan-count-${index}">0 / ${requested}</td><td class="scan-result" id="scan-result-${index}"><span class="pending">Pending</span></td></tr>`;
  }).join("")||`<tr><td colspan="6">No products found.</td></tr>`;
  return `<main class="request-detail-page"><h1>Stock Request Details</h1><section class="request-detail-summary"><div><span>Request Code</span><strong>${escapeHtml(detail.request_code)}</strong></div><div><span>Request Branch → Requested From</span><strong>${escapeHtml(detail.request_branch_name)} → ${escapeHtml(detail.request_from_branch_name)}</strong></div><div><span>Request Status</span><strong class="request-detail-status">${escapeHtml(detail.request_status)}</strong></div></section><section class="request-scanner"><div class="request-scanner-top"><div><h2>Scan Products</h2><p>Scan a QR/product code. Enter and Tab are accepted.</p></div><div class="request-scanner-controls"><input id="request-scan-input" class="request-scan-input" type="text" inputmode="none" autocomplete="off" placeholder="Scan product code" aria-label="Product code scanner"><button id="request-scan-submit" class="request-scan-submit" type="button">Check Code</button><button id="request-scan-reset" class="request-scan-reset" type="button">Reset</button></div></div><div id="request-scan-message" class="request-scan-message">Ready to scan.</div><div class="request-scan-progress"><span id="request-scan-total">0 / ${requestedTotal}</span><div class="request-scan-progress-bar"><i id="request-scan-progress-bar"></i></div></div><div id="request-wrong-scans" class="request-wrong-scans">Wrong scans<div id="request-wrong-list" class="request-wrong-list"></div></div></section><div class="request-detail-table-wrap"><table><thead><tr><th>No.</th><th>Product Code</th><th>Description</th><th>Request Quantity</th><th>Scanned Quantity</th><th>Match</th></tr></thead><tbody>${rows}</tbody></table></div></main>`;
};
const setupRequestScanner=(target,records)=>{
  if(!target||target.closed)return;
  const doc=target.document;
  const input=doc.getElementById("request-scan-input");
  const submit=doc.getElementById("request-scan-submit");
  const reset=doc.getElementById("request-scan-reset");
  const message=doc.getElementById("request-scan-message");
  const totalText=doc.getElementById("request-scan-total");
  const progressBar=doc.getElementById("request-scan-progress-bar");
  const wrongPanel=doc.getElementById("request-wrong-scans");
  const wrongList=doc.getElementById("request-wrong-list");
  if(!input||!submit||!reset||!message||!totalText||!progressBar||!wrongPanel||!wrongList)return;
  const entries=(Array.isArray(records)?records:[]).map((record,index)=>({index,code:normalizeScanCode(record.product_code),required:Math.max(0,Number(record.request_qty)||0),scanned:0}));
  const requiredTotal=entries.reduce((total,entry)=>total+entry.required,0);
  const wrongCounts=new Map();
  const showMessage=(text,type="")=>{message.textContent=text;message.className=`request-scan-message${type?` ${type}`:""}`;};
  const updateEntry=entry=>{
    const count=doc.getElementById(`scan-count-${entry.index}`);
    const result=doc.getElementById(`scan-result-${entry.index}`);
    if(count)count.textContent=`${entry.scanned} / ${entry.required}`;
    if(result){const matched=entry.scanned===entry.required;result.innerHTML=`<span class="${matched?"matched":entry.scanned>0?"counting":"pending"}">${matched?"Matched":entry.scanned>0?"Counting":"Pending"}</span>`;}
  };
  const updateProgress=()=>{
    const scannedTotal=entries.reduce((total,entry)=>total+entry.scanned,0);
    totalText.textContent=`${scannedTotal} / ${requiredTotal}`;
    progressBar.style.width=`${requiredTotal?Math.min(100,scannedTotal/requiredTotal*100):100}%`;
    return entries.every(entry=>entry.scanned===entry.required);
  };
  const updateWrongList=()=>{
    wrongPanel.classList.toggle("visible",wrongCounts.size>0);
    wrongList.replaceChildren(...[...wrongCounts].map(([code,count])=>{const badge=doc.createElement("span");badge.textContent=`${code} × ${count}`;return badge;}));
  };
  const addWrong=code=>{wrongCounts.set(code,(wrongCounts.get(code)||0)+1);updateWrongList();};
  const flashRow=entry=>{
    const row=doc.getElementById(`scan-row-${entry.index}`);
    if(!row)return;
    row.classList.remove("scan-row-flash");
    void row.offsetWidth;
    row.classList.add("scan-row-flash");
    target.setTimeout(()=>row.classList.remove("scan-row-flash"),750);
  };
  const scan=value=>{
    const code=normalizeScanCode(value);
    input.value="";
    input.focus();
    if(!code){showMessage("Scan a product code first.","wrong");return;}
    const matches=entries.filter(entry=>entry.code===code);
    if(matches.length===0){addWrong(code);showMessage(`Wrong code: ${code} is not in this request.`,"wrong");return;}
    const entry=matches.find(candidate=>candidate.scanned<candidate.required);
    if(!entry){addWrong(`${code} (extra)`);showMessage(`Wrong quantity: ${code} is already fully scanned.`,"wrong");return;}
    entry.scanned+=1;
    updateEntry(entry);
    flashRow(entry);
    const complete=updateProgress();
    showMessage(complete?"All product codes and quantities match.":`${code}: ${entry.scanned} / ${entry.required} scanned.`,"correct");
  };
  input.addEventListener("keydown",event=>{if(event.key==="Enter"||event.key==="Tab"){event.preventDefault();scan(input.value);}});
  submit.addEventListener("click",()=>scan(input.value));
  reset.addEventListener("click",()=>{entries.forEach(entry=>{entry.scanned=0;updateEntry(entry);});wrongCounts.clear();updateWrongList();updateProgress();showMessage("Scan counts reset.");input.value="";input.focus();});
  doc.addEventListener("keydown",event=>{if(doc.activeElement===input||event.ctrlKey||event.altKey||event.metaKey||event.key.length!==1)return;input.focus();input.value+=event.key;event.preventDefault();});
  entries.forEach(updateEntry);
  updateProgress();
  input.focus();
};

function StockRequestCard({item,onCheck}){
  const branch=getBranch(item);
  const highlighted=item.status.toLowerCase()==="new"&&isPassTo(item);
  return <article className={`stock-request-card${branch?` ${getBranchClass(branch)}`:""}${highlighted?" highlighted":""}${isAiForecast(item)?" ai-forecast":""}`}>
    <div className="stock-request-card-top"><strong>{item.number}</strong><div className="stock-request-card-actions"><span className="stock-request-status">{item.status}</span>{onCheck&&<button type="button" className="stock-request-check" disabled={!item.recordId} onClick={()=>onCheck(item)}>{item.recordId?"Check":"Unavailable"}</button>}</div></div>
    <p className="stock-request-remark">{item.remark}</p>
    <div className="stock-request-meta"><span className="stock-request-route">{item.fromBranch} → {item.toBranch}</span><span>By {item.requestedBy}</span><span>{item.date}</span></div>
  </article>;
}

function StockRequestGroup({title,subtitle,items,branch="",onCheck}){
  return <details className={`stock-request-group${branch?` ${getBranchClass(branch)}`:""}`}>
    <summary className="stock-request-group-header"><div><h3>{title}</h3><small>{subtitle}</small></div><span>{items.length}</span></summary>
    {items.length===0?<div className="stock-request-empty">No requests</div>:<div className="stock-request-group-list">{items.map(item=><StockRequestCard key={item.id} item={item} onCheck={onCheck}/>)}</div>}
  </details>;
}

function StockRequestDirection({direction,groups,onCheck}){
  const send=direction==="send";
  const count=Object.values(groups).reduce((total,items)=>total+items.length,0);
  return <details className={`stock-request-direction ${direction}`}>
    <summary className="stock-request-direction-header"><div><h3>{send?"Send":"Receive"}</h3><small>{send?"South City → branches":"Branches → South City"}</small></div><span>{count}</span></summary>
    <div className="stock-request-direction-body">{BRANCHES.map(branch=><StockRequestGroup key={branch} title={branch} subtitle={send?`South City → ${branch}`:`${branch} → South City`} items={groups[branch]} branch={branch} onCheck={onCheck}/>)}</div>
  </details>;
}

export default function StockRequestPage({apiBaseUrl,onBack}){
  const [sections,setSections]=useState(emptySections);
  const [showAiForecast,setShowAiForecast]=useState(false);
  const [reloadKey,setReloadKey]=useState(0);
  useEffect(()=>{
    let active=true;
    setSections(emptySections());
    const load=async()=>{
      await Promise.all(STATUSES.map(async status=>{
        try{
          const response=await axios.post(`${apiBaseUrl}/stock-requests`,{status,length:1000});
          const rows=Array.isArray(response.data?.data)?response.data.data:[];
          const items=rows.map(normalizeRow).filter(item=>item&&item.status.toLowerCase()===status.toLowerCase());
          if(active)setSections(current=>({...current,[status]:{items,loading:false,error:"",dateStart:String(response.data?.date_start||""),dateEnd:String(response.data?.date_end||"")}}));
        }catch(error){
          const message=error.response?.data?.error||error.message||`Unable to load ${status.toLowerCase()} requests.`;
          if(active)setSections(current=>({...current,[status]:{items:[],loading:false,error:message,dateStart:"",dateEnd:""}}));
        }
      }));
    };
    load();
    return()=>{active=false;};
  },[apiBaseUrl,reloadKey]);
  const loading=STATUSES.some(status=>sections[status].loading);
  const hiddenAiCount=sections.New.items.filter(isAiForecast).length;
  const visibleNewItems=showAiForecast?sections.New.items:sections.New.items.filter(item=>!isAiForecast(item));
  const newOther=visibleNewItems.filter(item=>getDirection(item)==="other");
  const groupBranches=(items,direction)=>Object.fromEntries(BRANCHES.map(branch=>[branch,items.filter(item=>getDirection(item)===direction&&getBranch(item,direction)===branch)]));
  const newGroups={send:groupBranches(visibleNewItems,"send"),receive:groupBranches(visibleNewItems,"receive")};
  const approvedGroups={send:groupBranches(sections.Approved.items,"send"),receive:groupBranches(sections.Approved.items,"receive")};
  const approvedOther=sections.Approved.items.filter(item=>getDirection(item)==="other");
  const closedGroups=groupBranches(sections.Closed.items,"receive");
  const approvedCount=sections.Approved.items.length;
  const closedCount=Object.values(closedGroups).reduce((total,items)=>total+items.length,0);
  const renderState=(section,content)=>section.loading?<div className="stock-request-message">Loading requests...</div>:section.error?<div className="stock-request-message stock-request-error">{section.error}</div>:content;
  const closedRange=sections.Closed.dateStart&&sections.Closed.dateEnd?`${formatDate(sections.Closed.dateStart)} – ${formatDate(sections.Closed.dateEnd)}`:"Previous Sunday – this Saturday";
  const openRequestDetails=async item=>{
    if(!item.recordId)return;
    const detailWindow=window.open("","_blank");
    if(!detailWindow){window.alert("Please allow pop-ups to check the stock request.");return;}
    detailWindow.opener=null;
    writeRequestTab(detailWindow,`Request ${item.number}`,`<main class="request-detail-page"><div class="request-detail-message">Loading request...</div></main>`);
    try{
      const response=await axios.get(`${apiBaseUrl}/stock-requests/${item.recordId}`);
      const detail=response.data?.data;
      if(!response.data?.status||!detail)throw new Error(response.data?.message||"Invalid request detail response.");
      writeRequestTab(detailWindow,`Request ${detail.request_code||item.number}`,renderRequestDetail(detail));
      setupRequestScanner(detailWindow,detail.records);
    }catch(error){
      const message=error.response?.data?.error||error.response?.data?.message||error.message||"Unable to load request details.";
      writeRequestTab(detailWindow,"Request Detail Error",`<main class="request-detail-page"><div class="request-detail-message request-detail-error">${escapeHtml(message)}</div></main>`);
    }
  };
  return <div className="stock-request-page">
    <header className="stock-request-topbar">
      <button type="button" className="stock-request-button" onClick={onBack}>Back</button>
      <div><h1>Stock Requests</h1><p>Grouped by status, direction and branch.</p><div className="stock-request-legend" aria-label="Branch colours">{BRANCHES.map(branch=><span key={branch} className={getBranchClass(branch)}><i/>{branch}</span>)}</div></div>
      <button type="button" className="stock-request-button refresh" disabled={loading} onClick={()=>setReloadKey(value=>value+1)}>{loading?"Loading...":"Refresh"}</button>
    </header>
    <main className="stock-request-layout">
      <section className="stock-request-board new">
        <div className="stock-request-board-header"><div><h2>New</h2><small>Send and Receive</small></div><span className="stock-request-count">{sections.New.loading?"...":visibleNewItems.length}</span></div>
        {renderState(sections.New,<div className="stock-request-board-body">
          <label className="stock-request-toggle"><input type="checkbox" checked={showAiForecast} onChange={event=>setShowAiForecast(event.target.checked)}/>Show AI Forecast batch ({hiddenAiCount})</label>
          <StockRequestDirection direction="send" groups={newGroups.send} onCheck={openRequestDetails}/>
          <StockRequestDirection direction="receive" groups={newGroups.receive} onCheck={openRequestDetails}/>
          {newOther.length>0&&<StockRequestGroup title="Other" subtitle="Other branch routes" items={newOther} onCheck={openRequestDetails}/>}
        </div>)}
      </section>
      <section className="stock-request-board approved">
        <div className="stock-request-board-header"><div><h2>Approved</h2><small>Send and Receive</small></div><span className="stock-request-count">{sections.Approved.loading?"...":approvedCount}</span></div>
        {renderState(sections.Approved,<div className="stock-request-board-body">
          <StockRequestDirection direction="send" groups={approvedGroups.send} onCheck={openRequestDetails}/>
          <StockRequestDirection direction="receive" groups={approvedGroups.receive} onCheck={openRequestDetails}/>
          {approvedOther.length>0&&<StockRequestGroup title="Other" subtitle="Other branch routes" items={approvedOther} onCheck={openRequestDetails}/>}
        </div>)}
      </section>
      <section className="stock-request-board closed">
        <div className="stock-request-board-header"><div><h2>Closed</h2><small>{closedRange}</small></div><span className="stock-request-count">{sections.Closed.loading?"...":closedCount}</span></div>
        {renderState(sections.Closed,<div className="stock-request-board-body">{BRANCHES.map(branch=><StockRequestGroup key={branch} title={branch} subtitle={`${branch} → South City`} items={closedGroups[branch]} branch={branch} onCheck={openRequestDetails}/>)}</div>)}
      </section>
    </main>
  </div>;
}
