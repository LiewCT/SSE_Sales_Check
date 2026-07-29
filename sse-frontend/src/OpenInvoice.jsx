import {Fragment,useCallback,useEffect,useState} from "react";
import axios from "axios";
import "./OpenInvoice.css";

const POLL_INTERVAL_MS=3000;

function OpenInvoice({apiBaseUrl,onBack}){
  const [orders,setOrders]=useState([]),[openRows,setOpenRows]=useState([]),[loading,setLoading]=useState(true),[refreshing,setRefreshing]=useState(false),[error,setError]=useState(""),[lastUpdated,setLastUpdated]=useState(null);

  const fetchOrders=useCallback(async(silent=false)=>{
    silent?setRefreshing(true):setLoading(true);
    try{
      const {data}=await axios.get(`${apiBaseUrl}/open-invoices`);
      setOrders(Array.isArray(data)?data:[]);setError("");setLastUpdated(new Date());
    }catch(err){
      console.error("Cannot retrieve approved orders",err);
      setError(err.response?.data?.error||err.response?.data?.details||"Unable to retrieve approved orders.");
    }finally{setLoading(false);setRefreshing(false);}
  },[apiBaseUrl]);

  useEffect(()=>{fetchOrders();const id=setInterval(()=>fetchOrders(true),POLL_INTERVAL_MS);return()=>clearInterval(id);},[fetchOrders]);

  const toggleRow=id=>setOpenRows(rows=>rows.includes(id)?rows.filter(value=>value!==id):[...rows,id]);

  return(
    <div className="invoice-page">
      <header className="invoice-header">
        <div>
          <button type="button" className="invoice-back" onClick={onBack}>← Back</button>
          <h1>Open Invoice</h1>
          <p>Approved orders ready for invoice processing.</p>
        </div>

        <div className="invoice-header-actions">
          <button type="button" className="invoice-refresh" disabled={refreshing} onClick={()=>fetchOrders(true)}>
            {refreshing?"Refreshing...":"Refresh"}
          </button>

          <div className="invoice-live">
            <span className="invoice-live-dot"/>
            <div>
              <strong>{loading?"Connecting":"Live"}</strong>
              <small>{lastUpdated?`Updated ${lastUpdated.toLocaleTimeString()}`:"Waiting for data"}</small>
            </div>
          </div>
        </div>
      </header>

      {error&&<div className="invoice-error">{error}</div>}

      <section className="invoice-card">
        <div className="invoice-card-title"><h2>Approved Orders</h2><span>{orders.length}</span></div>

        <div className="invoice-table-wrap">
          <table className="invoice-table">
            <thead><tr><th>Dealer</th><th>Remark</th><th>Date</th><th>Items</th><th>Action</th></tr></thead>
            <tbody>
              {loading&&!orders.length?<tr><td colSpan="5" className="invoice-empty">Loading approved orders...</td></tr>
              :!orders.length?<tr><td colSpan="5" className="invoice-empty">No approved orders found.</td></tr>
              :orders.map(order=>{
                const isOpen=openRows.includes(order.id), items=Array.isArray(order.items)?order.items:[];
                return(
                  <Fragment key={order.id}>
                    <tr className="invoice-order-row" onClick={()=>toggleRow(order.id)}>
                      <td><strong>{order.dealer||"Unknown Dealer"}</strong><small>#{order.id}</small></td>
                      <td>{order.remark||"-"}</td>
                      <td>{order.date||"-"}</td>
                      <td><span className="invoice-item-count">{items.length}</span></td>
                      <td>
                        <button type="button" className="invoice-open-button" onClick={event=>{event.stopPropagation();toggleRow(order.id);}}>
                          {isOpen?"Close":"Open Invoice"}
                        </button>
                      </td>
                    </tr>

                    {isOpen&&<tr className="invoice-detail-row">
                      <td colSpan="5">
                        <div className="invoice-detail-wrap">
                          <table className="invoice-item-table">
                            <thead><tr><th>Code</th><th>Description</th><th>Quantity</th></tr></thead>
                            <tbody>
                              {!items.length?<tr><td colSpan="3" className="invoice-empty">No items found.</td></tr>
                              :items.map(item=><tr key={item.id}><td>{item.code||"-"}</td><td>{item.name||item.product_description||"-"}</td><td>{item.qty??0}</td></tr>)}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>}
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