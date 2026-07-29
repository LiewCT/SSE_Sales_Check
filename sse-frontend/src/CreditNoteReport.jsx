import{useMemo,useState}from"react";
import axios from"axios";
import{utils,writeFileXLSX}from"xlsx";
import"./CreditNoteReport.css";

const DEFAULT_API_BASE_URL="https://sse-sales-check.onrender.com";
const CREDIT_NOTE_REPORT_API_URL=`${API_BASE_URL}/credit-note-report`;
const CATEGORIES=[{key:"no_problem_cn",title:"No Problem CN"},{key:"problem_cn",title:"Problem CN"},{key:"others",title:"Others"}];
const EXPORT_FIELDS=[{key:"dealer_name",label:"Dealer Name",width:25},{key:"date",label:"Date",width:20},{key:"product_code",label:"Code",width:18},{key:"product_name",label:"Name",width:48},{key:"product_description",label:"Description",width:48},{key:"remark",label:"Remark",width:38},{key:"refund_qty",label:"Refund Qty",width:12}];

const getYesterdayDate=()=>{const date=new Date();date.setDate(date.getDate()-1);return`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;};
const normalizeCreditText=value=>String(value??"").replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/\u00a0/g," ").replace(/[\u200B-\u200D\uFEFF]/g,"").normalize("NFKC").toUpperCase().replace(/[^A-Z0-9]/g,"");
const resolveCreditCategory=row=>{const normalized=normalizeCreditText(row?.remark??row?.credit_remark??"");if(normalized==="NOPROBLEMCN")return"no_problem_cn";if(normalized==="PROBLEMCN")return"problem_cn";return"others";};
const getCellValue=(row,key)=>key==="refund_qty"?Number(row?.[key])||0:key==="remark"?(row?.remark??row?.credit_remark??""):row?.[key]??"";
const getDisplayValue=(row,key)=>{const value=getCellValue(row,key);return value===""||value===null||value===undefined?"-":value;};
const getCopyValue=(row,key)=>String(getCellValue(row,key)).replace(/\t/g," ").replace(/\r?\n/g," ");
const compareValues=(a,b,key)=>{const valueA=getCellValue(a,key),valueB=getCellValue(b,key);if(key==="refund_qty")return Number(valueA)-Number(valueB);if(key==="date"){const dateA=Date.parse(String(valueA)),dateB=Date.parse(String(valueB));if(Number.isFinite(dateA)&&Number.isFinite(dateB))return dateA-dateB;}return String(valueA).localeCompare(String(valueB),undefined,{numeric:true,sensitivity:"base"});};
const sortRows=(rows,key,direction)=>{if(!key)return[...rows];const multiplier=direction==="desc"?-1:1;return[...rows].sort((a,b)=>compareValues(a,b,key)*multiplier);};
const getSortLabels=key=>key==="date"||key==="refund_qty"?{asc:"Ascending",desc:"Descending"}:{asc:"A-Z",desc:"Z-A"};

function CreditNoteReport({apiBaseUrl=DEFAULT_API_BASE_URL,onBack}){
  const CREDIT_NOTE_REPORT_API_URL=`${apiBaseUrl}/credit-note-report`;
  const[dateStart,setDateStart]=useState("");
  const[dateEnd,setDateEnd]=useState(getYesterdayDate);
  const[reportRows,setReportRows]=useState([]);
  const[recordsFiltered,setRecordsFiltered]=useState(0);
  const[matchedCreditNotes,setMatchedCreditNotes]=useState(0);
  const[loading,setLoading]=useState(false);
  const[progress,setProgress]=useState("");
  const[error,setError]=useState("");
  const[previewOpen,setPreviewOpen]=useState(false);
  const[selectedFieldKeys,setSelectedFieldKeys]=useState(()=>EXPORT_FIELDS.map(field=>field.key));
  const[selectedCategoryKeys,setSelectedCategoryKeys]=useState(()=>CATEGORIES.map(category=>category.key));
  const[includeTitleHeader,setIncludeTitleHeader]=useState(true);
  const[includeFieldHeader,setIncludeFieldHeader]=useState(true);
  const[sortField,setSortField]=useState("");
  const[sortDirection,setSortDirection]=useState("asc");
  const[copyMessage,setCopyMessage]=useState("");

  const categorizedRows=useMemo(()=>CATEGORIES.map(category=>({...category,rows:reportRows.filter(row=>resolveCreditCategory(row)===category.key)})),[reportRows]);
  const sortedCategories=useMemo(()=>categorizedRows.map(category=>({...category,rows:sortRows(category.rows,sortField,sortDirection)})),[categorizedRows,sortField,sortDirection]);
  const selectedExportCategories=useMemo(()=>sortedCategories.filter(category=>selectedCategoryKeys.includes(category.key)),[sortedCategories,selectedCategoryKeys]);
  const selectedFields=useMemo(()=>EXPORT_FIELDS.filter(field=>selectedFieldKeys.includes(field.key)),[selectedFieldKeys]);
  const totalRefundQty=useMemo(()=>reportRows.reduce((total,row)=>total+(Number(row.refund_qty)||0),0),[reportRows]);
  const categoryCounts=useMemo(()=>Object.fromEntries(categorizedRows.map(category=>[category.key,new Set(category.rows.map((row,index)=>String(row.credit_note_id??row.credit_group??`${category.key}-${index}`))).size])),[categorizedRows]);
  const sortLabels=getSortLabels(sortField);
  const canExport=selectedFields.length>0&&selectedExportCategories.length>0;

  const generateReport=async event=>{
    event.preventDefault();
    if(!dateStart||!dateEnd){setError("Please select both start date and end date.");return;}
    if(dateStart>dateEnd){setError("Start date cannot be later than end date.");return;}
    setLoading(true);setError("");setReportRows([]);setRecordsFiltered(0);setMatchedCreditNotes(0);setPreviewOpen(false);setCopyMessage("");setProgress("Retrieving Credits Note Report...");

    try{
      const response=await axios.post(CREDIT_NOTE_REPORT_API_URL,{date_start:dateStart,date_end:dateEnd});
      const rawRows=Array.isArray(response.data?.data)?response.data.data:[];
      const normalizedRows=rawRows.map(row=>{const remark=row?.remark??row?.credit_remark??"-";const normalizedRow={...row,remark};return{...normalizedRow,credit_category:resolveCreditCategory(normalizedRow)};});
      setReportRows(normalizedRows);
      setRecordsFiltered(Number(response.data?.records_filtered)||0);
      setMatchedCreditNotes(Number(response.data?.matched_credit_notes)||0);
      setProgress("");
    }catch(requestError){
      console.error("Cannot generate Credits Note Report",requestError);
      setError(requestError.response?.data?.error||requestError.response?.data?.details||requestError.message||"Unable to generate the report.");
      setProgress("");
    }finally{setLoading(false);}
  };

  const toggleField=key=>setSelectedFieldKeys(keys=>keys.includes(key)?keys.filter(item=>item!==key):[...keys,key]);
  const toggleCategory=key=>setSelectedCategoryKeys(keys=>keys.includes(key)?keys.filter(item=>item!==key):[...keys,key]);
  const openPreview=()=>{if(!reportRows.length)return;setCopyMessage("");setPreviewOpen(true);};
  const closePreview=()=>{setPreviewOpen(false);setCopyMessage("");};

  const copyExcelValues=async()=>{
    if(!canExport)return;

    const blocks=selectedExportCategories.map(category=>{
      const lines=[];
      if(includeTitleHeader)lines.push(category.title);
      if(includeFieldHeader)lines.push(selectedFields.map(field=>field.label).join("\t"));
      lines.push(...category.rows.map(row=>selectedFields.map(field=>getCopyValue(row,field.key)).join("\t")));
      return lines.join("\n");
    }).filter(Boolean);

    try{
      const text=blocks.join("\n\n");

      if(navigator.clipboard?.writeText){
        await navigator.clipboard.writeText(text);
      }else{
        const textarea=document.createElement("textarea");
        textarea.value=text;
        textarea.style.position="fixed";
        textarea.style.opacity="0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        textarea.remove();
      }

      setCopyMessage("Copied. Paste directly into Excel.");
    }catch(copyError){
      console.error("Cannot copy Excel values",copyError);
      setCopyMessage("Unable to copy. Please try again.");
    }
  };

  const exportToExcel=()=>{
    if(!canExport)return;

    const workbook=utils.book_new();

    selectedExportCategories.forEach(category=>{
      const excelRows=[];

      if(includeTitleHeader){
        excelRows.push([category.title,...Array(Math.max(selectedFields.length-1,0)).fill("")]);
      }

      if(includeFieldHeader){
        excelRows.push(selectedFields.map(field=>field.label));
      }

      excelRows.push(...category.rows.map(row=>selectedFields.map(field=>getCellValue(row,field.key))));

      const worksheet=utils.aoa_to_sheet(excelRows);
      worksheet["!cols"]=selectedFields.map(field=>({wch:field.width}));

      if(includeTitleHeader&&selectedFields.length>1){
        worksheet["!merges"]=[{s:{r:0,c:0},e:{r:0,c:selectedFields.length-1}}];
      }

      utils.book_append_sheet(workbook,worksheet,category.title);
    });

    writeFileXLSX(workbook,`Credit_Note_Report_${dateStart}_to_${dateEnd}.xlsx`);
  };

  const renderTable=(category,fields,isPreview=false)=>{
    const showTitle=!isPreview||includeTitleHeader;
    const showFieldHeader=!isPreview||includeFieldHeader;

    return<section className={isPreview?"credit-report-preview-category":"credit-report-category-section"} key={`${isPreview?"preview":"report"}-${category.key}`}>
      {showTitle&&<div className="credit-report-category-heading"><h3 className="credit-report-category-title">{category.title}</h3><span className="credit-report-category-count">{category.rows.length} rows</span></div>}

      <div className="credit-report-table-wrapper">
        <table className="credit-report-table">
          {showFieldHeader&&<thead><tr>{fields.map(field=><th key={field.key}>{field.label}</th>)}</tr></thead>}

          <tbody>
            {!fields.length?(
              <tr><td className="credit-report-empty-cell">Select at least one field.</td></tr>
            ):!category.rows.length?(
              <tr><td className="credit-report-empty-cell" colSpan={fields.length}>{loading?"Loading report...":"No report data found."}</td></tr>
            ):(
              category.rows.map((row,rowIndex)=>{
                const previousRow=category.rows[rowIndex-1];
                const isGroupStart=rowIndex===0||previousRow?.credit_group!==row.credit_group;
                const groupColor=Math.abs(Number(row.credit_group)||0)%6;

                return<tr key={`${category.key}-${row.credit_note_id||row.credit_group}-${row.product_code}-${rowIndex}`} className={[`credit-report-group-${groupColor}`,isGroupStart?"credit-report-group-start":""].join(" ")}>
                  {fields.map(field=><td key={field.key} className={`credit-report-cell-${field.key}`}>{getDisplayValue(row,field.key)}</td>)}
                </tr>;
              })
            )}
          </tbody>
        </table>
      </div>
    </section>;
  };

  return<div className="credit-report-page">
    <header className="credit-report-header">
      <div><h2 className="credit-report-title">Credits Note Report</h2><p className="credit-report-subtitle">Search credit notes by date and separate them into No Problem CN, Problem CN and Others.</p></div>
      <button type="button" className="credit-report-back-button" onClick={onBack}>Back to Packaging Queue</button>
    </header>

    <form className="credit-report-filter-card" onSubmit={generateReport}>
      <label className="credit-report-field"><span className="credit-report-label">Start Date</span><input type="date" value={dateStart} onChange={event=>setDateStart(event.target.value)} className="credit-report-input" disabled={loading}/></label>
      <label className="credit-report-field"><span className="credit-report-label">End Date</span><input type="date" value={dateEnd} onChange={event=>setDateEnd(event.target.value)} className="credit-report-input" disabled={loading}/></label>
      <div className="credit-report-buttons"><button type="submit" className="credit-report-generate-button" disabled={loading}>{loading?"Generating...":"Generate Report"}</button><button type="button" className="credit-report-export-button" onClick={openPreview} disabled={loading||!reportRows.length}>Export Excel</button></div>
    </form>

    {progress&&<div className="credit-report-info-message">{progress}</div>}
    {error&&<div className="credit-report-error-message">{error}</div>}

    <div className="credit-report-summary">
      <div className="credit-report-summary-item"><span>Filtered Records</span><strong>{recordsFiltered}</strong></div>
      <div className="credit-report-summary-item"><span>Matched Credit Notes</span><strong>{matchedCreditNotes}</strong></div>
      <div className="credit-report-summary-item"><span>No Problem CN</span><strong>{categoryCounts.no_problem_cn||0}</strong></div>
      <div className="credit-report-summary-item"><span>Problem CN</span><strong>{categoryCounts.problem_cn||0}</strong></div>
      <div className="credit-report-summary-item"><span>Others</span><strong>{categoryCounts.others||0}</strong></div>
      <div className="credit-report-summary-item"><span>Report Rows</span><strong>{reportRows.length}</strong></div>
      <div className="credit-report-summary-item"><span>Total Refund Qty</span><strong>{totalRefundQty}</strong></div>
    </div>

    <main className="credit-report-category-list">{categorizedRows.map(category=>renderTable(category,EXPORT_FIELDS))}</main>

    {previewOpen&&<div className="credit-report-export-preview">
      <div className="credit-report-preview-container">
        <header className="credit-report-preview-header">
          <div><h3 className="credit-report-preview-title">Excel Preview</h3><p className="credit-report-preview-subtitle">Select categories, fields, headers and sorting.</p></div>
          <button type="button" className="credit-report-preview-close-button" onClick={closePreview}>Close Preview</button>
        </header>

        <div className="credit-report-field-selector">
          <div className="credit-report-field-selector-actions">
            <strong>Export Categories</strong>
            <div><button type="button" onClick={()=>setSelectedCategoryKeys(CATEGORIES.map(category=>category.key))}>Select All</button><button type="button" onClick={()=>setSelectedCategoryKeys([])}>Clear All</button></div>
          </div>

          <div className="credit-report-field-options credit-report-category-options">
            {CATEGORIES.map(category=><label className="credit-report-field-option" key={category.key}><input type="checkbox" checked={selectedCategoryKeys.includes(category.key)} onChange={()=>toggleCategory(category.key)}/><span>{category.title}</span></label>)}
          </div>

          <div className="credit-report-layout-divider"/>

          <div className="credit-report-field-selector-actions">
            <strong>Export Fields</strong>
            <div><button type="button" onClick={()=>setSelectedFieldKeys(EXPORT_FIELDS.map(field=>field.key))}>Select All</button><button type="button" onClick={()=>setSelectedFieldKeys([])}>Clear All</button></div>
          </div>

          <div className="credit-report-field-options">
            {EXPORT_FIELDS.map(field=><label className="credit-report-field-option" key={field.key}><input type="checkbox" checked={selectedFieldKeys.includes(field.key)} onChange={()=>toggleField(field.key)}/><span>{field.label}</span></label>)}
          </div>

          <div className="credit-report-layout-divider"/>

          <strong>Excel Layout</strong>

          <div className="credit-report-field-options credit-report-layout-options">
            <label className="credit-report-field-option"><input type="checkbox" checked={includeTitleHeader} onChange={event=>setIncludeTitleHeader(event.target.checked)}/><span>Include Title Header</span></label>
            <label className="credit-report-field-option"><input type="checkbox" checked={includeFieldHeader} onChange={event=>setIncludeFieldHeader(event.target.checked)}/><span>Include Field Header</span></label>
          </div>

          <div className="credit-report-layout-divider"/>

          <strong>Sort Excel Rows</strong>

          <div className="credit-report-sort-controls">
            <label className="credit-report-sort-field"><span>Sort Field</span><select value={sortField} onChange={event=>{setSortField(event.target.value);setSortDirection("asc");}} className="credit-report-sort-select"><option value="">Original Order</option>{EXPORT_FIELDS.map(field=><option value={field.key} key={field.key}>{field.label}</option>)}</select></label>

            <label className="credit-report-sort-field"><span>Direction</span><select value={sortDirection} onChange={event=>setSortDirection(event.target.value)} className="credit-report-sort-select" disabled={!sortField}><option value="asc">{sortLabels.asc}</option><option value="desc">{sortLabels.desc}</option></select></label>
          </div>
        </div>

        {!selectedCategoryKeys.length&&<div className="credit-report-error-message">Select at least one category.</div>}

        <div className="credit-report-preview-actions">
          <button type="button" className="credit-report-copy-button" onClick={copyExcelValues} disabled={!canExport}>Copy Excel Values</button>
          <button type="button" className="credit-report-confirm-export-button" onClick={exportToExcel} disabled={!canExport}>Export Excel</button>
          {copyMessage&&<span className="credit-report-copy-message">{copyMessage}</span>}
        </div>

        <div className="credit-report-preview-tables">{selectedExportCategories.map(category=>renderTable(category,selectedFields,true))}</div>
      </div>
    </div>}
  </div>;
}

export default CreditNoteReport;