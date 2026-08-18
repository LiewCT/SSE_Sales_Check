import{Fragment,useCallback,useEffect,useRef,useState}from"react";
import axios from"axios";
import"./OpenInvoice.css";

const POLL_INTERVAL_MS=3000;
const formatDate=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
const getToday=()=>formatDate(new Date());
const getMonthStart=()=>{const date=new Date();date.setDate(1);return formatDate(date);};

function OpenInvoice({apiBaseUrl,onBack}){
  const[orders,setOrders]=useState([]);
  const[openRows,setOpenRows]=useState([]);
  const[loading,setLoading]=useState(true);
  const[refreshing,setRefreshing]=useState(false);
  const[error,setError]=useState("");
  const[lastUpdated,setLastUpdated]=useState(null);
  const[dateStart,setDateStart]=useState(()=>getToday());
  const[dateEnd,setDateEnd]=useState(()=>getToday());
  const fetchingRef=useRef(false);

  const fetchOrders=useCallback(async(silent=false)=>{
    if(fetchingRef.current)return;
    if(!apiBaseUrl){
      setError("API base URL is missing.");
      setLoading(false);
      return;
    }
    if(!dateStart||!dateEnd){
      setError("Start date and end date are required.");
      setLoading(false);
      return;
    }
    if(dateStart>dateEnd){
      setError("Start date cannot be later than end date.");
      setLoading(false);
      return;
    }

    fetchingRef.current=true;
    silent?setRefreshing(true):setLoading(true);

    try{
      const response=await axios.post(`${apiBaseUrl}/open-invoices`,{
        date_start:dateStart,
        date_end:dateEnd
      },{
        timeout:60000,
        headers:{"Content-Type":"application/json"}
      });

      const data=response.data;
      setOrders(Array.isArray(data)?data:[]);
      setError("");
      setLastUpdated(new Date());
    }catch(err){
      console.error("Cannot retrieve open invoices:",err);
      setError(
        err.response?.data?.error||
        err.response?.data?.details||
        err.message||
        "Unable to retrieve approved orders."
      );
    }finally{
      fetchingRef.current=false;
      setLoading(false);
      setRefreshing(false);
    }
  },[apiBaseUrl,dateStart,dateEnd]);

  useEffect(()=>{
    fetchOrders(false);
    const intervalId=setInterval(()=>fetchOrders(true),POLL_INTERVAL_MS);
    return()=>clearInterval(intervalId);
  },[fetchOrders]);

  const toggleRow=id=>{
    setOpenRows(rows=>rows.includes(id)?rows.filter(value=>value!==id):[...rows,id]);
  };

  const today=getToday();

  return(
    <div className="invoice-page">
      <header className="invoice-header">
        <div>
          <button type="button" className="invoice-back" onClick={onBack}>← Back</button>
          <h1>Open Invoice</h1>
          <p>Approved orders ready for invoice processing.</p>
        </div>

        <div className="invoice-header-actions">
          <label>
            <small>Start Date</small>
            <input
              type="date"
              value={dateStart||today}
              max={dateEnd||today}
              onChange={event=>setDateStart(event.target.value)}
            />
          </label>

          <label>
            <small>End Date</small>
            <input
              type="date"
              value={dateEnd}
              min={dateStart}
              max={today}
              onChange={event=>setDateEnd(event.target.value)}
            />
          </label>

          <button
            type="button"
            className="invoice-refresh"
            disabled={loading||refreshing}
            onClick={()=>fetchOrders(true)}
          >
            {refreshing?"Refreshing...":"Refresh"}
          </button>

          <div className="invoice-live">
            <span className="invoice-live-dot"/>
            <div>
              <strong>{loading?"Connecting":"Live"}</strong>
              <small>
                {lastUpdated?`Updated ${lastUpdated.toLocaleTimeString()}`:"Waiting for data"}
              </small>
            </div>
          </div>
        </div>
      </header>

      {error&&<div className="invoice-error">{error}</div>}

      <section className="invoice-card">
        <div className="invoice-card-title">
          <h2>Approved Orders</h2>
          <span>{orders.length}</span>
        </div>

        <div className="invoice-table-wrap">
          <table className="invoice-table">
            <thead>
              <tr>
                <th>Dealer</th>
                <th>Remark</th>
                <th>Date</th>
                <th>Items</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {loading&&orders.length===0?(
                <tr>
                  <td colSpan={5} className="invoice-empty">Loading approved orders...</td>
                </tr>
              ):orders.length===0?(
                <tr>
                  <td colSpan={5} className="invoice-empty">No approved orders found.</td>
                </tr>
              ):orders.map((order,index)=>{
                const orderId=String(order?.id??index);
                const items=Array.isArray(order?.items)?order.items:[];
                const isOpen=openRows.includes(orderId);

                return(
                  <Fragment key={orderId}>
                    <tr className="invoice-order-row" onClick={()=>toggleRow(orderId)}>
                      <td>
                        <strong>{order?.dealer||"Unknown Dealer"}</strong>
                        <small>#{orderId}</small>
                      </td>
                      <td>{order?.remark||"-"}</td>
                      <td>{order?.date||"-"}</td>
                      <td>
                        <span className="invoice-item-count">{items.length}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="invoice-open-button"
                          onClick={event=>{
                            event.stopPropagation();
                            toggleRow(orderId);
                          }}
                        >
                          {isOpen?"Close":"Open Invoice"}
                        </button>
                      </td>
                    </tr>

                    {isOpen&&(
                      <tr className="invoice-detail-row">
                        <td colSpan={5}>
                          <div className="invoice-detail-wrap">
                            <table className="invoice-item-table">
                              <thead>
                                <tr>
                                  <th>Code</th>
                                  <th>Description</th>
                                  <th>Quantity</th>
                                </tr>
                              </thead>

                              <tbody>
                                {items.length===0?(
                                  <tr>
                                    <td colSpan={3} className="invoice-empty">No items found.</td>
                                  </tr>
                                ):items.map((item,itemIndex)=>(
                                  <tr key={String(item?.id||item?.code||`${orderId}-${itemIndex}`)}>
                                    <td>{item?.code||"-"}</td>
                                    <td>{item?.name||item?.product_description||"-"}</td>
                                    <td>{item?.qty??0}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default OpenInvoice;