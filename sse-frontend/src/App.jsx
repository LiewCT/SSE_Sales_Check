import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import "./App.css";
import PwaInstallButton from "./PwaInstallButton";
import CreditNoteReport from "./CreditNoteReport";
import OpenInvoice from "./OpenInvoice";
const API_BASE_URL = "https://sse-sales-check.onrender.com";
// const API_BASE_URL = "http://localhost:5000";
const APPROVALS_API_URL = `${API_BASE_URL}/approvals`;
const PACKAGING_STATUS_API_URL = `${API_BASE_URL}/packaging-status`;
const APPROVE_ORDER_API_URL = `${API_BASE_URL}/approve-order`;
const COMBINE_ORDERS_API_URL = `${API_BASE_URL}/combine-orders`;
const REMOVE_ORDER_API_URL = `${API_BASE_URL}/remove-order`;
const MOVE_PRODUCT_API_URL = `${API_BASE_URL}/move-product`;
const POLL_INTERVAL_MS = 3000;
const CARD_HEIGHT_PX = 450;
const AUTO_SCROLL_EDGE_PX = 90;
const AUTO_SCROLL_MAX_SPEED = 50;
const SCANNER_BUFFER_RESET_MS = 300;
const SCAN_HIGHLIGHT_MS = 2500;
const MOBILE_SCAN_INTERVAL_MS=250;
const MOBILE_MOTION_INTERVAL_MS=500;
const MOBILE_SCAN_INACTIVITY_MS=5000;
const MOBILE_SCAN_CLEAR_FRAMES=3;
const TRASH_PROXIMITY_DISTANCE_PX = 240;
const ORDER_TYPE_STORAGE_KEY = "order-type-overrides";
const SEEN_ORDERS_STORAGE_KEY = "seen-order-ids";
const SERVER_SNAPSHOT_STORAGE_KEY = "packaging-server-snapshot";
const ORDER_CHANGES_STORAGE_KEY = "packaging-order-changes";
const NINE_TECH_PATTERN=/9[\s_-]*tech\b/i;

const getPageFromPath=()=>location.pathname==="/credit-note-report"?"credit-note-report":location.pathname==="/open-invoice"?"open-invoice":location.pathname==="/mobile-scanner"?"mobile-scanner":"packaging";
const normalizeProductCode=value=>String(value||"").replace(/[\r\n\t]/g,"").trim().toUpperCase();
const toQuantity=value=>Math.max(0,Number(value)||0);
const clampPackedQuantity=(value,quantity)=>Math.min(toQuantity(quantity),toQuantity(value));
const isItemFullyPackaged=item=>toQuantity(item?.quantity)>0&&toQuantity(item?.packedQuantity)>=toQuantity(item?.quantity);
const getNextPackedQuantity=item=>isItemFullyPackaged(item)?0:Math.min(toQuantity(item?.quantity),toQuantity(item?.packedQuantity)+1);
const isNineTechItem=item=>NINE_TECH_PATTERN.test(`${item?.product_code||""} ${item?.product_name||""} ${item?.product_description||""}`);
const hasMixedNineTechProducts=order=>{
  const items=(order?.items||[]).filter(item=>toQuantity(item.quantity)>0);
  return items.some(isNineTechItem)&&items.some(item=>!isNineTechItem(item));
};
const getOrderProductGroup=order=>{
  const items=(order?.items||[]).filter(item=>toQuantity(item.quantity)>0);
  if(items.length===0)return "empty";
  const nineTechCount=items.filter(isNineTechItem).length;
  if(nineTechCount===items.length)return "nine_tech";
  if(nineTechCount===0)return "normal";
  return "mixed";
};
const normalizeDealerKey=value=>String(value||"").trim().toLowerCase().replace(/\s+/g," ");
const getDealerKey=order=>normalizeDealerKey(order?.dealer_id||order?.dealerId||order?.name);
const getOrderMergeEligibility=(sourceOrder,targetOrder)=>{
  if(!sourceOrder||!targetOrder)return {allowed:false,reason:"missing_order"};
  if(sourceOrder.id===targetOrder.id)return {allowed:false,reason:"same_order"};
  if(!sourceOrder.items?.length)return {allowed:false,reason:"no_items"};
  if(!getDealerKey(sourceOrder)||getDealerKey(sourceOrder)!==getDealerKey(targetOrder))return {allowed:false,reason:"different_dealer"};
  const sourceGroup=getOrderProductGroup(sourceOrder);
  const targetGroup=getOrderProductGroup(targetOrder);
  if(sourceGroup==="mixed"||targetGroup==="mixed")return {allowed:false,reason:"nine_tech_mixed"};
  if(sourceGroup!==targetGroup)return {allowed:false,reason:"nine_tech_mismatch"};
  return {allowed:true,reason:"allowed"};
};
const getProductMoveEligibility=(draggedProduct,targetOrder)=>{
  const sourceOrder=draggedProduct?.sourceOrder;
  const item=draggedProduct?.item;
  if(!sourceOrder||!item||!targetOrder)return {allowed:false,reason:"missing_product"};
  if(sourceOrder.id===targetOrder.id)return {allowed:false,reason:"same_order"};
  if(!getDealerKey(sourceOrder)||getDealerKey(sourceOrder)!==getDealerKey(targetOrder))return {allowed:false,reason:"different_dealer"};
  const targetGroup=getOrderProductGroup(targetOrder);
  if(targetGroup==="mixed")return {allowed:false,reason:"nine_tech_mixed"};
  if(targetGroup!=="empty"&&targetGroup!==(isNineTechItem(item)?"nine_tech":"normal"))return {allowed:false,reason:"nine_tech_mismatch"};
  return {allowed:true,reason:"allowed"};
};
const getProductPackagingLabel=(item,packedValue=item?.packedQuantity)=>{
  const total=toQuantity(item?.quantity);
  const packed=clampPackedQuantity(packedValue,total);
  if(total<=0)return "0/0 Not Packed";
  if(packed<=0)return `0/${total} Not Packed`;
  if(packed>=total)return `${packed}/${total} Packed`;
  return `${packed}/${total} Ongoing`;
};

// Normal grid: New, Trip, Hold. Fixed at bottom: Send Now.
const ORDER_SECTIONS = [
  {
    title: "New",
    type: "new"
  },
  {
    title: "Trip",
    type: "trip"
  },
  {
    title: "Hold",
    type: "hold"
  },
  {
    title: "Send Now",
    type: "send_now"
  }
];
const getSavedObject = (storageKey) => {
  try {
    return JSON.parse(localStorage.getItem(storageKey)) || {};
  } catch (error) {
    console.error(`Cannot read ${storageKey}`, error);
    return {};
  }
};
const saveObject = (storageKey, value) => {
  localStorage.setItem(storageKey, JSON.stringify(value));
};
const getSavedArray = (storageKey) => {
  try {
    const result = JSON.parse(localStorage.getItem(storageKey));
    return Array.isArray(result) ? result : [];
  } catch (error) {
    console.error(`Cannot read ${storageKey}`, error);
    return [];
  }
};
const saveArray = (storageKey, value) => {
  localStorage.setItem(storageKey, JSON.stringify(value));
};
const getOrderType = (remark) => {
  const value = String(remark || "").toLowerCase().trim();
  // Any remark containing "now" or exactly equal to "sn" becomes Send Now.
  if (value === "sn" || /now/.test(value)) {
    return "send_now";
  }
  // Any remark containing a number or "trip" becomes Trip
  if (/\d/.test(value) || /trip/.test(value)) {
    return "trip";
  }
  if (value.includes("hold")) {
    return "hold";
  }
  // Empty or other remarks become New.
  return "new";
};
const getResolvedOrderType = (order) => {
  return order.manualType || getOrderType(order.remark);
};
const buildServerSnapshot = (orders) => {
  return Object.fromEntries(
    orders.map((order) => [
      order.id,
      {
        items: Object.fromEntries(
          order.items.map((item) => [
            item.itemId,
            {
              product_code: item.product_code,
              product_name: item.product_name,
              quantity: item.quantity
            }
          ])
        )
      }
    ])
  );
};
const detectOrderChanges = (previousSnapshot, currentSnapshot) => {
  const detectedChanges = {};
  Object.entries(currentSnapshot).forEach(([orderId, currentOrder]) => {
    const previousOrder = previousSnapshot[orderId];
    // A completely new order already uses the shining effect.
    if (!previousOrder) {
      return;
    }
    const previousItems = previousOrder.items || {};
    const currentItems = currentOrder.items || {};
    const changes = [];
    // Detect new items and quantity changes.
    Object.entries(currentItems).forEach(([itemId, currentItem]) => {
      const previousItem = previousItems[itemId];
      if (!previousItem) {
        changes.push({
          type: "new-item",
          group: "presence",
          itemId,
          label: "New Item",
          product_code: currentItem.product_code,
          product_name: currentItem.product_name
        });
        return;
      }
      const quantityDifference = currentItem.quantity - previousItem.quantity;
      if (quantityDifference > 0) {
        changes.push({
          type: "quantity-add",
          group: "quantity",
          itemId,
          label: `+${quantityDifference}`,
          product_code: currentItem.product_code,
          product_name: currentItem.product_name
        });
      }
      if (quantityDifference < 0) {
        changes.push({
          type: "quantity-remove",
          group: "quantity",
          itemId,
          label: `${quantityDifference}`,
          product_code: currentItem.product_code,
          product_name: currentItem.product_name
        });
      }
    });
    // Detect removed items.
    Object.entries(previousItems).forEach(([itemId, previousItem]) => {
      if (!currentItems[itemId]) {
        changes.push({
          type: "remove-item",
          group: "presence",
          itemId,
          label: "Remove Item",
          product_code: previousItem.product_code,
          product_name: previousItem.product_name
        });
      }
    });
    if (changes.length > 0) {
      detectedChanges[orderId] = changes;
    }
  });
  return detectedChanges;
};
const mergeOrderChanges = (currentChanges, detectedChanges) => {
  const nextChanges = {
    ...currentChanges
  };
  Object.entries(detectedChanges).forEach(([orderId, changes]) => {
    const changeMap = new Map();
    // Keep existing changes that have not been acknowledged.
    (nextChanges[orderId] || []).forEach((change) => {
      const changeKey = `${change.itemId}-${change.group}`;
      changeMap.set(changeKey, change);
    });
    // Replace older changes for the same item.
    changes.forEach((change) => {
      const changeKey = `${change.itemId}-${change.group}`;
      changeMap.set(changeKey, change);
    });
    nextChanges[orderId] = Array.from(changeMap.values());
  });
  return nextChanges;
};

function MobileScannerPage({loading,onExit,onScan,scanResult}){
  const videoRef=useRef(null);
  const onScanRef=useRef(onScan);
  const loadingRef=useRef(loading);
  const wakeScannerRef=useRef(()=>{});
  const [cameraStatus,setCameraStatus]=useState({type:"starting",message:"Starting rear camera..."});
  const [lastCode,setLastCode]=useState("");
  const [torchOn,setTorchOn]=useState(false);
  const [torchSupported,setTorchSupported]=useState(false);
  useEffect(()=>{onScanRef.current=onScan;},[onScan]);
  useEffect(()=>{loadingRef.current=loading;},[loading]);
  useEffect(()=>{
    let active=true,detecting=false,busy=false,waitingForClear=false,clearFrames=0,previousFrame=null,ignoreMotionUntil=0;
    let stream,track,detector,scanTimer,motionTimer,inactivityTimer,torchTask=Promise.resolve();
    let lastActivity=Date.now(),idle=false;
    const motionCanvas=document.createElement("canvas");
    motionCanvas.width=48;
    motionCanvas.height=36;
    const motionContext=motionCanvas.getContext("2d",{willReadFrequently:true});
    const applyTorch=enabled=>{
      if(!track?.getCapabilities?.().torch)return Promise.resolve();
      torchTask=torchTask.then(()=>track.applyConstraints({advanced:[{torch:enabled}]})).then(()=>{if(active)setTorchOn(enabled);}).catch(error=>console.warn("Torch control unavailable",error));
      return torchTask;
    };
    const markReady=async()=>{
      if(!active)return;
      idle=false;
      lastActivity=Date.now();
      setCameraStatus({type:"ready",message:"Ready to scan"});
      await applyTorch(true);
    };
    const wakeScanner=()=>{
      if(!active||!track||busy||waitingForClear)return;
      previousFrame=null;
      ignoreMotionUntil=Date.now()+1500;
      markReady();
    };
    wakeScannerRef.current=wakeScanner;
    const detectFrame=async()=>{
      const video=videoRef.current;
      if(!active||detecting||busy||idle||loadingRef.current||!detector||video?.readyState<2)return;
      detecting=true;
      try{
        const codes=await detector.detect(video);
        if(waitingForClear){
          clearFrames=codes.length===0?clearFrames+1:0;
          if(clearFrames>=MOBILE_SCAN_CLEAR_FRAMES){waitingForClear=false;clearFrames=0;await markReady();}
          return;
        }
        const code=normalizeProductCode(codes[0]?.rawValue);
        if(!code)return;
        busy=true;
        waitingForClear=true;
        lastActivity=Date.now();
        setLastCode(code);
        setCameraStatus({type:"processing",message:`Packing ${code}...`});
        await applyTorch(false);
        const saved=await onScanRef.current(code);
        if(active)setCameraStatus(saved?{type:"success",message:`${code} scanned. Remove QR to scan next.`}:{type:"error",message:`${code} was not packed. Remove QR to continue.`});
      }catch(error){
        if(active&&error?.name!=="NotFoundError")console.warn("QR detection failed",error);
      }finally{busy=false;detecting=false;}
    };
    const detectMotion=()=>{
      const video=videoRef.current;
      if(!active||!motionContext||video?.readyState<2)return;
      motionContext.drawImage(video,0,0,motionCanvas.width,motionCanvas.height);
      const pixels=motionContext.getImageData(0,0,motionCanvas.width,motionCanvas.height).data;
      if(previousFrame&&Date.now()>=ignoreMotionUntil){
        let difference=0,samples=0;
        for(let index=0;index<pixels.length;index+=16){difference+=Math.abs(pixels[index]-previousFrame[index]);samples+=1;}
        if(difference/Math.max(samples,1)>7){lastActivity=Date.now();if(idle)wakeScanner();}
      }
      previousFrame=new Uint8ClampedArray(pixels);
    };
    const checkInactivity=async()=>{
      if(!active||idle||busy||waitingForClear||Date.now()-lastActivity<MOBILE_SCAN_INACTIVITY_MS)return;
      idle=true;
      previousFrame=null;
      ignoreMotionUntil=Date.now()+1500;
      setCameraStatus({type:"idle",message:"No activity for 10 seconds. Move the phone or tap to resume."});
      await applyTorch(false);
    };
    const handleVisibility=()=>document.hidden?applyTorch(false):wakeScanner();
    const startCamera=async()=>{
      try{
        if(!navigator.mediaDevices?.getUserMedia)throw new Error("Camera access requires HTTPS and a supported browser.");
        if(!("BarcodeDetector" in window))throw new Error("QR scanning is not supported in this browser. Use Chrome on Android.");
        const formats=await window.BarcodeDetector.getSupportedFormats();
        if(!formats.includes("qr_code"))throw new Error("This browser cannot detect QR codes.");
        detector=new window.BarcodeDetector({formats:["qr_code"]});
        stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}}});
        if(!active){stream.getTracks().forEach(item=>item.stop());return;}
        track=stream.getVideoTracks()[0];
        const supportsTorch=Boolean(track?.getCapabilities?.().torch);
        setTorchSupported(supportsTorch);
        videoRef.current.srcObject=stream;
        await videoRef.current.play();
        await markReady();
        scanTimer=setInterval(detectFrame,MOBILE_SCAN_INTERVAL_MS);
        motionTimer=setInterval(detectMotion,MOBILE_MOTION_INTERVAL_MS);
        inactivityTimer=setInterval(checkInactivity,1000);
        document.addEventListener("visibilitychange",handleVisibility);
      }catch(error){
        if(!active)return;
        const denied=error?.name==="NotAllowedError"||error?.name==="PermissionDeniedError";
        setCameraStatus({type:"error",message:denied?"Camera permission was denied. Allow camera access and try again.":error.message||"Unable to start camera."});
      }
    };
    startCamera();
    return()=>{
      active=false;
      clearInterval(scanTimer);
      clearInterval(motionTimer);
      clearInterval(inactivityTimer);
      document.removeEventListener("visibilitychange",handleVisibility);
      if(track?.getCapabilities?.().torch)track.applyConstraints({advanced:[{torch:false}]}).catch(()=>{});
      stream?.getTracks().forEach(item=>item.stop());
      if(videoRef.current)videoRef.current.srcObject=null;
    };
  },[]);
  const statusColor=cameraStatus.type==="success"?"#22c55e":cameraStatus.type==="error"?"#ef4444":cameraStatus.type==="processing"?"#60a5fa":cameraStatus.type==="idle"?"#f59e0b":"#ffffff";
  return <div onPointerDown={()=>wakeScannerRef.current()} style={{minHeight:"100dvh",background:"#020617",color:"#fff",display:"flex",flexDirection:"column",fontFamily:"inherit"}}>
    <style>{`@keyframes mobile-scan-line{0%,100%{transform:translateY(-110px)}50%{transform:translateY(110px)}}`}</style>
    <header style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:"12px",padding:"14px 16px",background:"#0f172a",position:"relative",zIndex:2}}>
      <div><strong style={{fontSize:"18px"}}>Continuous QR Scanner</strong><div style={{fontSize:"12px",color:"#94a3b8"}}>{loading?"Loading orders...":"Scan once to pack one unit"}</div></div>
      <button type="button" onClick={event=>{event.stopPropagation();onExit();}} style={{padding:"10px 16px",border:0,borderRadius:"10px",background:"#ef4444",color:"#fff",fontWeight:800}}>Exit</button>
    </header>
    <main style={{flex:1,display:"flex",flexDirection:"column",padding:"16px",gap:"14px"}}>
      <div style={{position:"relative",flex:"1 1 55vh",minHeight:"340px",maxHeight:"68vh",overflow:"hidden",borderRadius:"18px",background:"#111827",border:`3px solid ${statusColor}`}}>
        <video ref={videoRef} muted playsInline autoPlay style={{width:"100%",height:"100%",objectFit:"cover"}}/>
        <div style={{position:"absolute",left:"12%",right:"12%",top:"22%",bottom:"22%",border:"3px solid rgba(255,255,255,.9)",borderRadius:"16px",boxShadow:"0 0 0 999px rgba(2,6,23,.28)"}}/>
        {cameraStatus.type==="ready"&&<div style={{position:"absolute",left:"16%",right:"16%",top:"50%",height:"3px",background:"#22c55e",boxShadow:"0 0 12px #22c55e",animation:"mobile-scan-line 2s ease-in-out infinite"}}/>}
        <div style={{position:"absolute",left:"12px",top:"12px",padding:"7px 10px",borderRadius:"999px",background:"rgba(2,6,23,.75)",fontSize:"12px",fontWeight:800}}>{torchSupported?(torchOn?"🔦 Torch on":"🔦 Torch off"):"Torch unavailable"}</div>
      </div>
      <section style={{padding:"14px",borderRadius:"14px",background:"#0f172a",border:`1px solid ${statusColor}`}}>
        <div style={{color:statusColor,fontWeight:800}}>{cameraStatus.message}</div>
        <div style={{marginTop:"6px",fontSize:"13px",color:scanResult.type==="error"?"#fca5a5":"#cbd5e1"}}>{scanResult.message}</div>
        {lastCode&&<div style={{marginTop:"6px",fontSize:"12px",color:"#94a3b8"}}>Last QR: {lastCode}</div>}
      </section>
    </main>
  </div>;
}

function App() {
  const [currentPage,setCurrentPage]=useState(getPageFromPath);
  const [navigationState,setNavigationState]=useState(()=>window.history.state||{});
  const [orders, setOrders] = useState([]);
  const [openRows, setOpenRows] = useState([]);
  const [newOrderIds, setNewOrderIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [draggingOrderId, setDraggingOrderId] = useState(null);
  const [draggingProduct,setDraggingProduct]=useState(null);
  const [dragOverSection, setDragOverSection] = useState(null);
  const [dragOverOrderId,setDragOverOrderId]=useState(null);
  const [isMovingProduct,setIsMovingProduct]=useState(false);
  const [productMoveNotice,setProductMoveNotice]=useState(null);
  const [combineDialog,setCombineDialog]=useState(null);
  const [combineError,setCombineError]=useState("");
  const [isCombining,setIsCombining]=useState(false);
  const [trashProximity,setTrashProximity]=useState(0);
  const [isTrashDragOver,setIsTrashDragOver]=useState(false);
  const [removeDialog,setRemoveDialog]=useState(null);
  const [removeError,setRemoveError]=useState("");
  const [isRemoving,setIsRemoving]=useState(false);
  const [orderChanges, setOrderChanges] = useState(() => getSavedObject(ORDER_CHANGES_STORAGE_KEY));
  const [updatingItemKeys, setUpdatingItemKeys] = useState([]);
  const [approvingOrderIds, setApprovingOrderIds] = useState([]);
  const [scanCode,setScanCode]=useState("");
  const [scanResult,setScanResult]=useState({type:"ready",message:"Scanner ready"});
  const [highlightedItemKey,setHighlightedItemKey]=useState(null);
  const [showProductDescription,setShowProductDescription]=useState(true);
  const ordersRef=useRef([]);
  const updatingItemKeysRef=useRef(new Set());
  const scanQueueRef=useRef(new Map());
  const serverSnapshotRef = useRef(getSavedObject(SERVER_SNAPSHOT_STORAGE_KEY));
  const isFetchingRef = useRef(false);
  const isCombiningRef=useRef(false);
  const isRemovingRef=useRef(false);
  const isMovingProductRef=useRef(false);
  const justDraggedRef = useRef(false);
  const notificationAudioRef=useRef(null);
  const notifiedOrderIdsRef=useRef(new Set());
  const alertedMixedNineTechOrderIdsRef=useRef(new Set());
  const autoScrollFrameRef = useRef(null);
  const dragPointerYRef = useRef(null);
  const dragScrollContainerRef = useRef(null);
  const scanInputRef=useRef(null);
  const scannerBufferRef=useRef("");
  const scannerResetTimerRef=useRef(null);
  const scanHighlightTimerRef=useRef(null);
  const trashZoneRef=useRef(null);

  const navigate=useCallback((path,state={})=>{
    window.history.pushState(state,"",path);
    setNavigationState(state);
    setCurrentPage(getPageFromPath());
    window.scrollTo({top:0,left:0});
  },[]);

  useEffect(()=>{
    const handlePopState=(event)=>{
      setNavigationState(event.state||{});
      setCurrentPage(getPageFromPath());
    };
    window.addEventListener("popstate",handlePopState);
    return()=>window.removeEventListener("popstate",handlePopState);
  },[]);

useEffect(()=>{
  notificationAudioRef.current=new Audio("/sharp_notification.wav");
  notificationAudioRef.current.preload="auto";
  return()=>notificationAudioRef.current?.pause();
},[]);

useEffect(()=>()=>{
  if(autoScrollFrameRef.current)cancelAnimationFrame(autoScrollFrameRef.current);
  if(scannerResetTimerRef.current)clearTimeout(scannerResetTimerRef.current);
  if(scanHighlightTimerRef.current)clearTimeout(scanHighlightTimerRef.current);
},[]);

useEffect(()=>{
  if(currentPage==="packaging")scanInputRef.current?.focus();
},[currentPage]);

const playNotificationSound=useCallback(()=>{
  const audio=notificationAudioRef.current;
  if(!audio)return;
  audio.currentTime=0;
  audio.play().catch(error=>console.warn("Notification sound blocked",error));
},[]);

  // Keep an optimistic value while the PUT request is running to prevent polling from changing the button back.
  const pendingPackagingRef = useRef(new Map());
  const fetchApprovals = useCallback(async (silent = false) => {
    if (isFetchingRef.current||isCombiningRef.current||isRemovingRef.current||isMovingProductRef.current) {
      return;
    }
    isFetchingRef.current = true;
    if (!silent) {
      setLoading(true);
    }
    try {
      const response = await axios.get(APPROVALS_API_URL);
      const responseOrders = Array.isArray(response.data) ? response.data : [];
      const savedTypeOverrides = getSavedObject(ORDER_TYPE_STORAGE_KEY);
      const formattedOrders = responseOrders.map((order, orderIndex) => {
        const items = Array.isArray(order.items) ? order.items : [];
        const orderId = String(
          order.id ||
          order.approval_id ||
          order.link ||
          `${order.dealer}-${order.date}-${orderIndex}`
        );
        const formattedItems = items.map((item, itemIndex) => {
          const itemId = String(item.id || item.code || `${item.name}-${itemIndex}`);
          const storageKey = `${orderId}-${itemId}`;
          const quantity=toQuantity(item.qty);
          const pendingPackedQuantity=pendingPackagingRef.current.get(storageKey);
          const serverPackedQuantity=item.packed_quantity!==undefined?toQuantity(item.packed_quantity):item.packedQuantity!==undefined?toQuantity(item.packedQuantity):item.packaged?quantity:0;
          const packedQuantity=clampPackedQuantity(pendingPackedQuantity??serverPackedQuantity,quantity);
          return {
            itemId,
            record_id:String(item.record_id||""),
            product_id:String(item.product_id||""),
            product_ids:Array.isArray(item.product_ids)?item.product_ids.map(productId=>String(productId||"")).filter(Boolean):[],
            product_code:item.code||"-",
            product_name:item.name||"-",
            product_description:item.product_description||"",
            quantity,
            packedQuantity,
            storageKey,
            packaged:quantity>0&&packedQuantity>=quantity
          };
        });
        return {
          id: orderId,
          dealer_id:String(order.dealer_id||order.dealerId||""),
          name: order.dealer || "Unknown Dealer",
          remark: order.remark,
          date: order.date,
          link: order.link,
          manualType: savedTypeOverrides[orderId] || null,
          items: formattedItems
        };
      });
      const mixedNineTechOrders=formattedOrders.filter(hasMixedNineTechProducts);
      const mixedNineTechOrderIds=new Set(mixedNineTechOrders.map(order=>order.id));
      alertedMixedNineTechOrderIdsRef.current=new Set(
        [...alertedMixedNineTechOrderIdsRef.current].filter(orderId=>mixedNineTechOrderIds.has(orderId))
      );
      const newlyMixedNineTechOrders=mixedNineTechOrders.filter(
        order=>!alertedMixedNineTechOrderIdsRef.current.has(order.id)
      );
      if(newlyMixedNineTechOrders.length>0){
        newlyMixedNineTechOrders.forEach(order=>alertedMixedNineTechOrderIdsRef.current.add(order.id));
        const warningLines=newlyMixedNineTechOrders.map(
          order=>`• ${order.name} (Order ${order.id})`
        );
        setTimeout(()=>window.alert(
          `WARNING: The following order${newlyMixedNineTechOrders.length>1?"s contain":" contains"} both 9 Tech and non-9 Tech products:\n\n${warningLines.join("\n")}`
        ),0);
      }
      const currentSnapshot = buildServerSnapshot(formattedOrders);
      const previousSnapshot = serverSnapshotRef.current;
      const hasPreviousSnapshot = Object.keys(previousSnapshot).length > 0;
      const detectedChanges = hasPreviousSnapshot
        ? detectOrderChanges(previousSnapshot, currentSnapshot)
        : {};
      let shouldPlayNotification=Object.keys(detectedChanges).length>0||newlyMixedNineTechOrders.length>0;
      const fetchedOrderIds = formattedOrders.map((order) => order.id);
      setApprovingOrderIds((currentIds) => currentIds.filter((id) => fetchedOrderIds.includes(id)));
      setOrderChanges((currentChanges) => {
        let nextChanges = mergeOrderChanges(currentChanges, detectedChanges);
        nextChanges = Object.fromEntries(
          Object.entries(nextChanges).filter(([orderId]) => fetchedOrderIds.includes(orderId))
        );
        saveObject(ORDER_CHANGES_STORAGE_KEY, nextChanges);
        return nextChanges;
      });
      serverSnapshotRef.current = currentSnapshot;
      saveObject(SERVER_SNAPSHOT_STORAGE_KEY, currentSnapshot);
      // Detect completely new orders.
      const hasSeenStorage = localStorage.getItem(SEEN_ORDERS_STORAGE_KEY) !== null;
      if (!hasSeenStorage) {
        saveArray(SEEN_ORDERS_STORAGE_KEY, fetchedOrderIds);
        setNewOrderIds([]);
      } else {
        const seenOrderIds = getSavedArray(SEEN_ORDERS_STORAGE_KEY);
        const newlyAddedIds = fetchedOrderIds.filter((id) => !seenOrderIds.includes(id));
        const unnotifiedIds=newlyAddedIds.filter(
          id=>!notifiedOrderIdsRef.current.has(id)
        );

        if(unnotifiedIds.length>0){
          shouldPlayNotification=true;
          unnotifiedIds.forEach(
            id=>notifiedOrderIdsRef.current.add(id)
          );
        }
        setNewOrderIds((currentNewIds) => [
          ...new Set([
            ...currentNewIds.filter((id) => fetchedOrderIds.includes(id)),
            ...newlyAddedIds
          ])
        ]);
      }
      if(shouldPlayNotification){
        playNotificationSound();
      }
      ordersRef.current=formattedOrders;
      setOrders(formattedOrders);
      setLastUpdated(new Date());
    } catch (error) {
      console.error("Request Failed", error);
    } finally {
      isFetchingRef.current = false;
      if (!silent) {
        setLoading(false);
      }
    }
  }, [playNotificationSound]);
  // Automatically request updates every three seconds.
  useEffect(() => {
    if (!["packaging","mobile-scanner"].includes(currentPage)) {
      return undefined;
    }

    fetchApprovals(false);

    const intervalId = setInterval(() => {
      fetchApprovals(true);
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(intervalId);
    };
  }, [currentPage, fetchApprovals]);
  // Build each card while keeping the card order fixed.
  const orderSectionsWithOrders = useMemo(() => {
    return ORDER_SECTIONS.map((section) => {
      const sectionOrders = orders.filter(
        (order) => getResolvedOrderType(order) === section.type
      );
      return {
        ...section,
        orders: sectionOrders
      };
    });
  }, [orders]);
  const markOrderAsSeen = (orderId) => {
    setNewOrderIds((currentNewIds) =>
      currentNewIds.filter((id) => id !== orderId)
    );
    const seenOrderIds = getSavedArray(SEEN_ORDERS_STORAGE_KEY);
    if (!seenOrderIds.includes(orderId)) {
      saveArray(SEEN_ORDERS_STORAGE_KEY, [
        ...seenOrderIds,
        orderId
      ]);
    }
  };
  const clearOrderChanges = (orderId) => {
    setOrderChanges((currentChanges) => {
      if (!currentChanges[orderId]) {
        return currentChanges;
      }
      const nextChanges = {
        ...currentChanges
      };
      delete nextChanges[orderId];
      saveObject(ORDER_CHANGES_STORAGE_KEY, nextChanges);
      return nextChanges;
    });
  };
  const toggleRow = (orderId) => {
    const isCurrentlyOpen = openRows.includes(orderId);
    setOpenRows((currentRows) =>
      currentRows.includes(orderId)
        ? currentRows.filter((id) => id !== orderId)
        : [
            ...currentRows,
            orderId
          ]
    );
    if (!isCurrentlyOpen) {
      // Stop the shining effect.
      markOrderAsSeen(orderId);
      // Clear item-change alerts after the order is opened.
      setTimeout(() => {
        clearOrderChanges(orderId);
      }, 800);
    }
  };
  const setItemPackedQuantity=async(orderId,itemIndex,newPackedQuantity,showAlert=true)=>{
    const selectedOrder=ordersRef.current.find(order=>order.id===orderId);
    const selectedItem=selectedOrder?.items[itemIndex];
    if(!selectedItem||updatingItemKeysRef.current.has(selectedItem.storageKey))return false;
    const previousPackedQuantity=toQuantity(selectedItem.packedQuantity);
    const nextPackedQuantity=clampPackedQuantity(newPackedQuantity,selectedItem.quantity);
    if(previousPackedQuantity===nextPackedQuantity)return true;
    const replaceItemState=(packedQuantity)=>{
      const packaged=selectedItem.quantity>0&&packedQuantity>=selectedItem.quantity;
      const nextOrders=ordersRef.current.map(order=>order.id===orderId?{...order,items:order.items.map(item=>item.itemId===selectedItem.itemId?{...item,packedQuantity,packaged}:item)}:order);
      ordersRef.current=nextOrders;
      setOrders(nextOrders);
    };
    pendingPackagingRef.current.set(selectedItem.storageKey,nextPackedQuantity);
    updatingItemKeysRef.current.add(selectedItem.storageKey);
    setUpdatingItemKeys([...updatingItemKeysRef.current]);
    replaceItemState(nextPackedQuantity);
    try{
      const response=await axios.put(PACKAGING_STATUS_API_URL,{order_id:orderId,item_id:selectedItem.itemId,product_code:selectedItem.product_code,quantity:selectedItem.quantity,action:"step"});
      const responsePackedQuantity=Number(response.data?.packed_quantity);
      const confirmedPackedQuantity=clampPackedQuantity(Number.isFinite(responsePackedQuantity)?responsePackedQuantity:response.data?.packaged?selectedItem.quantity:0,selectedItem.quantity);
      pendingPackagingRef.current.set(selectedItem.storageKey,confirmedPackedQuantity);
      replaceItemState(confirmedPackedQuantity);
      return true;
    }catch(error){
      console.error("Cannot update packaging quantity",error);
      pendingPackagingRef.current.set(selectedItem.storageKey,previousPackedQuantity);
      replaceItemState(previousPackedQuantity);
      if(showAlert)window.alert("Packaging quantity was not saved. Please try again.");
      return false;
    }finally{
      pendingPackagingRef.current.delete(selectedItem.storageKey);
      updatingItemKeysRef.current.delete(selectedItem.storageKey);
      setUpdatingItemKeys([...updatingItemKeysRef.current]);
      fetchApprovals(true);
    }
  };
  const updateItem=(orderId,itemIndex)=>{
    const item=ordersRef.current.find(order=>order.id===orderId)?.items[itemIndex];
    if(item)setItemPackedQuantity(orderId,itemIndex,getNextPackedQuantity(item),true);
  };
  const revealScannedItem=(orderId,storageKey)=>{
    setOpenRows(currentRows=>currentRows.includes(orderId)?currentRows:[...currentRows,orderId]);
    markOrderAsSeen(orderId);
    clearOrderChanges(orderId);
    setHighlightedItemKey(storageKey);
    if(scanHighlightTimerRef.current)clearTimeout(scanHighlightTimerRef.current);
    scanHighlightTimerRef.current=setTimeout(()=>setHighlightedItemKey(null),SCAN_HIGHLIGHT_MS);
    setTimeout(()=>{
      const row=[...document.querySelectorAll("[data-scan-item-key]")].find(element=>element.dataset.scanItemKey===storageKey);
      row?.scrollIntoView({behavior:"smooth",block:"center"});
    },80);
  };
  const processScannedCodeNow=async code=>{
    const matches=[];
    ordersRef.current.forEach(order=>order.items.forEach((item,itemIndex)=>{
      if(normalizeProductCode(item.product_code)===code)matches.push({order,item,itemIndex});
    }));
    if(matches.length===0){
      setScanResult({type:"error",message:`${code} not found in any order`});
      return false;
    }
    const match=matches.find(result=>!isItemFullyPackaged(result.item)&&!updatingItemKeysRef.current.has(result.item.storageKey))||matches.find(result=>!updatingItemKeysRef.current.has(result.item.storageKey))||matches[0];
    if(updatingItemKeysRef.current.has(match.item.storageKey)){
      setScanResult({type:"saving",message:`${code} is waiting for the previous scan`});
      return false;
    }
    revealScannedItem(match.order.id,match.item.storageKey);
    const unpacking=isItemFullyPackaged(match.item);
    const nextPackedQuantity=getNextPackedQuantity(match.item);
    const nextLabel=getProductPackagingLabel(match.item,nextPackedQuantity);
    setScanResult({type:"saving",message:`${unpacking?"Unpacking":"Packing"} ${code} · ${nextLabel} · ${match.order.name}`});
    const saved=await setItemPackedQuantity(match.order.id,match.itemIndex,nextPackedQuantity,false);
    setScanResult(saved?{type:"success",message:`${code} · ${unpacking?"Unpacked · ":""}${nextLabel} · ${match.order.name}`}:{type:"error",message:`Failed to save ${code}`});
    return saved;
  };
  const processScannedCode=useCallback(rawCode=>{
    const code=normalizeProductCode(rawCode);
    setScanCode("");
    if(!code){
      setScanResult({type:"error",message:"No product code received"});
      return Promise.resolve(false);
    }
    const previousTask=scanQueueRef.current.get(code)||Promise.resolve();
    const nextTask=previousTask.catch(()=>{}).then(()=>processScannedCodeNow(code)).finally(()=>{
      if(scanQueueRef.current.get(code)===nextTask)scanQueueRef.current.delete(code);
    });
    scanQueueRef.current.set(code,nextTask);
    return nextTask;
  },[orders]);


  useEffect(()=>{
    if(currentPage!=="packaging")return undefined;
    const handleScannerKeyDown=event=>{
      const target=event.target;
      if(target instanceof HTMLInputElement||target instanceof HTMLTextAreaElement||target?.isContentEditable)return;
      if(event.ctrlKey||event.altKey||event.metaKey)return;
      if(event.key==="Enter"){
        const code=scannerBufferRef.current;
        scannerBufferRef.current="";
        if(scannerResetTimerRef.current)clearTimeout(scannerResetTimerRef.current);
        if(code){event.preventDefault();processScannedCode(code);}
        return;
      }
      if(event.key.length!==1)return;
      event.preventDefault();
      scannerBufferRef.current+=event.key;
      if(scannerResetTimerRef.current)clearTimeout(scannerResetTimerRef.current);
      scannerResetTimerRef.current=setTimeout(()=>{scannerBufferRef.current="";},SCANNER_BUFFER_RESET_MS);
    };
    window.addEventListener("keydown",handleScannerKeyDown);
    return()=>window.removeEventListener("keydown",handleScannerKeyDown);
  },[currentPage,processScannedCode]);
  const getPackagingTotals=items=>items.reduce((totals,item)=>({packed:totals.packed+clampPackedQuantity(item.packedQuantity,item.quantity),total:totals.total+toQuantity(item.quantity)}),{packed:0,total:0});
  const getPackagingStatus=items=>{
    if(items.length===0)return "No Items";
    const {packed,total}=getPackagingTotals(items);
    if(total<=0||packed<=0)return "Not Packed";
    if(packed>=total)return "Packaged";
    return "Ongoing";
  };
  const getPackagingClass=items=>{
    if(items.length===0)return "not-packed-status";
    const {packed,total}=getPackagingTotals(items);
    if(total<=0||packed<=0)return "not-packed-status";
    return packed>=total?"packaged-status":"ongoing-status";
  };
  const isOrderFullyPackaged=order=>Boolean(order?.items?.length)&&order.items.every(isItemFullyPackaged);
  const canDropIntoSection = (order, targetType) => {
    // New, Trip and Hold accept any order.
    if (targetType !== "send_now") {
      return true;
    }
    // Send Now only accepts fully packaged orders.
    return isOrderFullyPackaged(order);
  };
  const approveOrder = async (order) => {
    if (!order || !isOrderFullyPackaged(order)) {
      return;
    }
    if (approvingOrderIds.includes(order.id)) {
      return;
    }
    const selectedItems = [...new Set(
      order.items
        .flatMap(item=>item.product_ids.length>0?item.product_ids:[item.product_id])
        .map(productId=>String(productId||"").trim())
        .filter(Boolean)
    )];
    if (selectedItems.length === 0) {
      window.alert("No product IDs were found for approval.");
      return;
    }
    setApprovingOrderIds((currentIds) => [
      ...currentIds,
      order.id
    ]);
    try {
      await axios.post(APPROVE_ORDER_API_URL, {
        sale_id: String(order.id),
        selected_items: selectedItems,
        sale_remark: String(order.remark || "")
      });
      await fetchApprovals(true);
    } catch (error) {
      setApprovingOrderIds((currentIds) => currentIds.filter((id) => id !== order.id));
      console.error("Cannot approve order", error);
      window.alert(error.response?.data?.error || error.response?.data?.details || "Unable to approve the order. Please try again.");
    }
  };
  const stopDragAutoScroll = () => {
    if (autoScrollFrameRef.current) {
      cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
    dragPointerYRef.current = null;
    dragScrollContainerRef.current = null;
  };
  const runDragAutoScroll = () => {
    const pointerY = dragPointerYRef.current;
    if (pointerY === null) {
      autoScrollFrameRef.current = null;
      return;
    }
    const getSpeed = (distance) => {
      const ratio = Math.min(1, Math.max(0, distance / AUTO_SCROLL_EDGE_PX));
      return Math.ceil(AUTO_SCROLL_MAX_SPEED * ratio);
    };
    const container = dragScrollContainerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      if (pointerY >= rect.top - AUTO_SCROLL_EDGE_PX && pointerY < rect.top + AUTO_SCROLL_EDGE_PX) {
        container.scrollTop -= getSpeed(rect.top + AUTO_SCROLL_EDGE_PX - pointerY);
      } else if (pointerY <= rect.bottom + AUTO_SCROLL_EDGE_PX && pointerY > rect.bottom - AUTO_SCROLL_EDGE_PX) {
        container.scrollTop += getSpeed(pointerY - (rect.bottom - AUTO_SCROLL_EDGE_PX));
      }
    }
    if (pointerY < AUTO_SCROLL_EDGE_PX) {
      window.scrollBy(0, -getSpeed(AUTO_SCROLL_EDGE_PX - pointerY));
    } else if (pointerY > window.innerHeight - AUTO_SCROLL_EDGE_PX) {
      window.scrollBy(0, getSpeed(pointerY - (window.innerHeight - AUTO_SCROLL_EDGE_PX)));
    }
    autoScrollFrameRef.current = requestAnimationFrame(runDragAutoScroll);
  };
  const updateDragAutoScroll = (event) => {
    dragPointerYRef.current = event.clientY;
    dragScrollContainerRef.current = event.currentTarget.closest?.(".table-wrapper")||event.currentTarget.querySelector?.(".table-wrapper")||null;
    if (!autoScrollFrameRef.current) {
      autoScrollFrameRef.current = requestAnimationFrame(runDragAutoScroll);
    }
  };
  const readDraggedProduct=dataTransfer=>{
    if(draggingProduct)return draggingProduct;
    try{
      const raw=dataTransfer?.getData("application/x-sale-product");
      return raw?JSON.parse(raw):null;
    }catch{return null;}
  };
  const getDraggedProductState=productDrag=>{
    const sourceOrder=ordersRef.current.find(order=>order.id===productDrag?.sourceOrderId);
    const item=sourceOrder?.items.find(product=>product.itemId===productDrag?.itemId);
    return sourceOrder&&item?{sourceOrder,item}:null;
  };
  const moveDraggedProduct=async(productDrag,destination)=>{
    if(isMovingProductRef.current)return;
    const current=getDraggedProductState(productDrag);
    if(!current){setProductMoveNotice({type:"error",message:"The dragged product is no longer available. Refresh and try again."});return;}
    if(destination.type==="existing_order"){
      const eligibility=getProductMoveEligibility(current,destination.targetOrder);
      if(!eligibility.allowed)return;
    }
    isMovingProductRef.current=true;
    setIsMovingProduct(true);
    setProductMoveNotice({type:"moving",message:`Moving ${current.item.product_code}...`});
    try{
      const response=await axios.post(MOVE_PRODUCT_API_URL,{source_sale_id:String(current.sourceOrder.id),source_product_id:String(current.item.product_id||""),source_record_id:String(current.item.record_id||""),source_dealer_id:String(current.sourceOrder.dealer_id||""),destination:destination.type,target_sale_id:destination.type==="existing_order"?String(destination.targetOrder.id):undefined});
      if(response.data?.status!==true)throw new Error(response.data?.message||"The server did not confirm the product move.");
      const targetSaleId=String(response.data.target_sale_id||"");
      if(destination.type==="new_order"&&targetSaleId){
        const overrides=getSavedObject(ORDER_TYPE_STORAGE_KEY);
        overrides[targetSaleId]=destination.targetType;
        saveObject(ORDER_TYPE_STORAGE_KEY,overrides);
      }
      const targetLabel=destination.type==="existing_order"?`Order ${destination.targetOrder.id}`:`new Order ${targetSaleId}`;
      const warning=response.data.warning?` ${response.data.warning}`:"";
      setProductMoveNotice({type:response.data.warning?"warning":"success",message:`${current.item.product_code} moved to ${targetLabel}.${warning}`});
    }catch(error){
      console.error("Cannot move product",error);
      const data=error.response?.data;
      const replacement=data?.replacement_sale_id?` A replacement Order ${data.replacement_sale_id} was created for the source product.`:"";
      const partial=data?.source_changed&&!data?.source_restored?" The source order may already have changed; refresh and check both orders.":"";
      setProductMoveNotice({type:"error",message:`${data?.error||data?.message||data?.details||error.message||"Unable to move the product."}${replacement}${partial}`});
    }finally{
      isMovingProductRef.current=false;
      setIsMovingProduct(false);
      fetchApprovals(true);
    }
  };
  const resetDragState = () => {
    stopDragAutoScroll();
    setDraggingOrderId(null);
    setDraggingProduct(null);
    setDragOverSection(null);
    setDragOverOrderId(null);
    setTrashProximity(0);
    setIsTrashDragOver(false);
    // Ignore the accidental click generated immediately after drag.
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 180);
  };
  const handleDragStart = (event, orderId) => {
    if(isCombining||isRemoving||isMovingProduct){event.preventDefault();return;}
    justDraggedRef.current = true;
    setDraggingProduct(null);
    setDraggingOrderId(orderId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", orderId);
    event.dataTransfer.setData("application/x-sale-order-id",orderId);
  };
  const handleProductDragStart=(event,order,item)=>{
    event.stopPropagation();
    if(isCombining||isRemoving||isMovingProduct){event.preventDefault();return;}
    const productDrag={sourceOrderId:order.id,itemId:item.itemId};
    justDraggedRef.current=true;
    setDraggingOrderId(null);
    setDraggingProduct(productDrag);
    event.dataTransfer.effectAllowed="move";
    event.dataTransfer.setData("application/x-sale-product",JSON.stringify(productDrag));
    event.dataTransfer.setData("text/plain",`product:${order.id}:${item.itemId}`);
  };
  const handleDragEnd = () => {
    resetDragState();
  };
  useEffect(()=>{
    if(!draggingOrderId)return undefined;
    const updateTrashProximity=event=>{
      const zone=trashZoneRef.current;
      if(!zone)return;
      const rect=zone.getBoundingClientRect();
      const closestX=Math.max(rect.left,Math.min(event.clientX,rect.right));
      const closestY=Math.max(rect.top,Math.min(event.clientY,rect.bottom));
      const distance=Math.hypot(event.clientX-closestX,event.clientY-closestY);
      const proximity=Math.max(0,Math.min(1,1-distance/TRASH_PROXIMITY_DISTANCE_PX));
      setTrashProximity(proximity);
      setIsTrashDragOver(distance===0);
    };
    window.addEventListener("dragover",updateTrashProximity,true);
    return()=>window.removeEventListener("dragover",updateTrashProximity,true);
  },[draggingOrderId]);
  const handleTrashDragOver=event=>{
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect="move";
    setTrashProximity(1);
    setIsTrashDragOver(true);
    setDragOverSection(null);
    setDragOverOrderId(null);
  };
  const handleTrashDragLeave=event=>{
    if(event.currentTarget.contains(event.relatedTarget))return;
    setIsTrashDragOver(false);
  };
  const handleTrashDrop=event=>{
    event.preventDefault();
    event.stopPropagation();
    const orderId=event.dataTransfer.getData("application/x-sale-order-id")||event.dataTransfer.getData("text/plain")||draggingOrderId;
    const order=ordersRef.current.find(item=>item.id===orderId);
    resetDragState();
    if(!order)return;
    setRemoveError("");
    setRemoveDialog(order);
  };
  const handleOrderDragOver=(event,targetOrder)=>{
    event.preventDefault();
    event.stopPropagation();
    updateDragAutoScroll(event);
    const productDrag=readDraggedProduct(event.dataTransfer);
    if(productDrag){
      const productState=getDraggedProductState(productDrag);
      const eligibility=getProductMoveEligibility(productState,targetOrder);
      event.dataTransfer.dropEffect=eligibility.allowed?"move":"none";
      setDragOverSection(null);
      setDragOverOrderId(targetOrder.id);
      return;
    }
    const sourceOrderId=draggingOrderId||event.dataTransfer.getData("application/x-sale-order-id")||event.dataTransfer.getData("text/plain");
    const sourceOrder=ordersRef.current.find(order=>order.id===sourceOrderId);
    const eligibility=getOrderMergeEligibility(sourceOrder,targetOrder);
    event.dataTransfer.dropEffect=eligibility.allowed?"move":"none";
    setDragOverSection(null);
    setDragOverOrderId(targetOrder.id);
  };
  const handleOrderDragLeave=(event,targetOrderId)=>{
    if(event.currentTarget.contains(event.relatedTarget))return;
    setDragOverOrderId(currentId=>currentId===targetOrderId?null:currentId);
  };
  const handleOrderDrop=(event,targetOrder)=>{
    event.preventDefault();
    event.stopPropagation();
    const productDrag=readDraggedProduct(event.dataTransfer);
    if(productDrag){
      const productState=getDraggedProductState(productDrag);
      const eligibility=getProductMoveEligibility(productState,targetOrder);
      resetDragState();
      if(eligibility.allowed)moveDraggedProduct(productDrag,{type:"existing_order",targetOrder});
      return;
    }
    const sourceOrderId=event.dataTransfer.getData("application/x-sale-order-id")||event.dataTransfer.getData("text/plain")||draggingOrderId;
    const sourceOrder=ordersRef.current.find(order=>order.id===sourceOrderId);
    const eligibility=getOrderMergeEligibility(sourceOrder,targetOrder);
    resetDragState();
    if(!eligibility.allowed)return;
    setCombineError("");
    setCombineDialog({sourceOrder,targetOrder});
  };
  const handleDragOver = (event, sectionType) => {
    updateDragAutoScroll(event);
    setDragOverOrderId(null);
    const productDrag=readDraggedProduct(event.dataTransfer);
    if(productDrag){
      event.preventDefault();
      event.dataTransfer.dropEffect="move";
      setDragOverSection(sectionType);
      return;
    }
    const draggedOrder = orders.find((order) => order.id === draggingOrderId);
    if (!canDropIntoSection(draggedOrder, sectionType)) {
      event.dataTransfer.dropEffect = "none";
      setDragOverSection(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverSection(sectionType);
  };
  const handleDrop = async (event, targetType) => {
    event.preventDefault();
    const productDrag=readDraggedProduct(event.dataTransfer);
    if(productDrag){
      event.stopPropagation();
      resetDragState();
      moveDraggedProduct(productDrag,{type:"new_order",targetType});
      return;
    }
    const orderId =
      event.dataTransfer.getData("text/plain") || draggingOrderId;
    if (!orderId) {
      resetDragState();
      return;
    }
    const selectedOrder = orders.find((order) => order.id === orderId);
    if (!selectedOrder) {
      resetDragState();
      return;
    }
    // Block unpackaged orders from entering Send Now.
    if (!canDropIntoSection(selectedOrder, targetType)) {
      resetDragState();
      return;
    }
    const currentType = getResolvedOrderType(selectedOrder);
    if (currentType !== targetType) {
      const savedOverrides = getSavedObject(ORDER_TYPE_STORAGE_KEY);
      savedOverrides[orderId] = targetType;
      saveObject(ORDER_TYPE_STORAGE_KEY, savedOverrides);
      setOrders((currentOrders) =>
        currentOrders.map((order) =>
          order.id === orderId
            ? {
                ...order,
                manualType: targetType
              }
            : order
        )
      );
    }
    resetDragState();
  };
  const removeOrderFromLocalStorage=orderId=>{
    const overrides=getSavedObject(ORDER_TYPE_STORAGE_KEY);
    delete overrides[orderId];
    saveObject(ORDER_TYPE_STORAGE_KEY,overrides);
    saveArray(SEEN_ORDERS_STORAGE_KEY,getSavedArray(SEEN_ORDERS_STORAGE_KEY).filter(id=>id!==orderId));
    const snapshot={...serverSnapshotRef.current};
    delete snapshot[orderId];
    serverSnapshotRef.current=snapshot;
    saveObject(SERVER_SNAPSHOT_STORAGE_KEY,snapshot);
    const changes=getSavedObject(ORDER_CHANGES_STORAGE_KEY);
    delete changes[orderId];
    saveObject(ORDER_CHANGES_STORAGE_KEY,changes);
  };
  const removeOrderFromView=orderId=>{
    removeOrderFromLocalStorage(orderId);
    setOpenRows(rows=>rows.filter(id=>id!==orderId));
    setNewOrderIds(ids=>ids.filter(id=>id!==orderId));
    setOrderChanges(changes=>{const next={...changes};delete next[orderId];return next;});
    const nextOrders=ordersRef.current.filter(order=>order.id!==orderId);
    ordersRef.current=nextOrders;
    setOrders(nextOrders);
  };
  const confirmRemoveOrder=async()=>{
    if(!removeDialog||isRemoving)return;
    const latestOrder=ordersRef.current.find(order=>order.id===removeDialog.id)||removeDialog;
    setRemoveError("");
    setIsRemoving(true);
    isRemovingRef.current=true;
    try{
      const response=await axios.post(REMOVE_ORDER_API_URL,{sale_id:String(latestOrder.id)});
      if(response.data?.status!==true)throw new Error(response.data?.message||"The server did not confirm the removal.");
      removeOrderFromView(latestOrder.id);
      setRemoveDialog(null);
    }catch(error){
      console.error("Cannot remove order",error);
      const data=error.response?.data;
      setRemoveError(data?.error||data?.message||data?.details||error.message||"Unable to remove the order.");
    }finally{
      isRemovingRef.current=false;
      setIsRemoving(false);
      fetchApprovals(true);
    }
  };
  const confirmCombineOrders=async()=>{
    if(!combineDialog||isCombining)return;
    const {sourceOrder,targetOrder}=combineDialog;
    const latestSource=ordersRef.current.find(order=>order.id===sourceOrder.id)||sourceOrder;
    const latestTarget=ordersRef.current.find(order=>order.id===targetOrder.id)||targetOrder;
    const eligibility=getOrderMergeEligibility(latestSource,latestTarget);
    if(!eligibility.allowed){setCombineError("These orders are no longer eligible to combine.");return;}
    setCombineError("");
    setIsCombining(true);
    isCombiningRef.current=true;
    try{
      const response=await axios.post(COMBINE_ORDERS_API_URL,{source_sale_id:String(latestSource.id),target_sale_id:String(latestTarget.id)});
      if(response.data?.status!==true)throw new Error(response.data?.message||"The server did not confirm the combine operation.");
      removeOrderFromView(latestSource.id);
      setCombineDialog(null);
      window.alert(`Order ${latestSource.id} was combined into Order ${latestTarget.id}.`);
    }catch(error){
      console.error("Cannot combine orders",error);
      const data=error.response?.data;
      const partial=data?.completed_items?` ${data.completed_items} item(s) may already have been added; the source order was not removed.`:"";
      setCombineError(`${data?.error||data?.message||error.message||"Unable to combine the orders."}${partial}`);
    }finally{
      isCombiningRef.current=false;
      setIsCombining(false);
      fetchApprovals(true);
    }
  };
  const renderOrderCard = (section) => {
    const isDragOver = dragOverSection === section.type;
    const draggedOrder = orders.find(
      (order) => order.id === draggingOrderId
    );
    const draggedProductState=getDraggedProductState(draggingProduct);
    const isBlockedSendNowTarget = Boolean(
      draggingOrderId &&
      section.type === "send_now" &&
      draggedOrder &&
      !isOrderFullyPackaged(draggedOrder)
    );
    const isSendNowSection = section.type === "send_now";
    const tableColumnCount = isSendNowSection ? 4 : 3;
    return (
      <section
        className={`
          order-card
          ${section.type}
          ${isDragOver ? "drag-over" : ""}
          ${isBlockedSendNowTarget ? "drop-blocked" : ""}
          ${draggingProduct ? "product-create-enabled" : ""}
          ${draggingProduct&&isDragOver ? "product-create-active" : ""}
        `}
        style={{
          height: `${CARD_HEIGHT_PX}px`,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
        }}
        key={section.type}
        onDragOver={(event) => handleDragOver(event, section.type)}
        onDrop={(event) => handleDrop(event, section.type)}
      >
        <div className="card-heading">
          <h1 className="section-title">{section.title}</h1>
          <span className="order-count">{section.orders.length}</span>
        </div>
        {draggingProduct&&<div className="product-create-zone">＋ Drop here to create a new order</div>}
        {isBlockedSendNowTarget && (
          <div className="drop-warning">
            Complete all packaging before moving the order to Send Now.
          </div>
        )}
        <div className="table-wrapper" style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}>
          <table className="main-table">
            <thead>
              <tr>
                <th>Dealer</th>
                <th>Remark</th>
                <th>Packaging</th>
                {isSendNowSection && <th>Approval</th>}
              </tr>
            </thead>
            <tbody>
              {section.orders.length === 0 ? (
                <tr className="empty-orders">
                  <td colSpan={tableColumnCount}>
                    {draggingProduct
                      ? "Drop here to create a new order"
                      : draggingOrderId && !isBlockedSendNowTarget
                      ? `Drop order into ${section.title}`
                      : `No ${section.title} orders`}
                  </td>
                </tr>
              ) : (
                section.orders.map((order) => {
                  const isOpen = openRows.includes(order.id);
                  const orderType = getResolvedOrderType(order);
                  const isNew = newOrderIds.includes(order.id);
                  const isDragging = draggingOrderId === order.id;
                  const isApproving = approvingOrderIds.includes(order.id);
                  const canApprove =
                    isSendNowSection &&
                    isOrderFullyPackaged(order) &&
                    !isApproving;
                  const hasMixedNineTech=hasMixedNineTechProducts(order);
                  const mergeEligibility=draggedOrder?getOrderMergeEligibility(draggedOrder,order):null;
                  const isMergeCandidate=Boolean(draggingOrderId&&order.id!==draggingOrderId);
                  const isMergeAllowed=Boolean(isMergeCandidate&&mergeEligibility?.allowed);
                  const isMergeBlocked=Boolean(isMergeCandidate&&!mergeEligibility?.allowed);
                  const isMergeHovered=dragOverOrderId===order.id;
                  const productEligibility=draggedProductState?getProductMoveEligibility(draggedProductState,order):null;
                  const isProductSource=Boolean(draggingProduct&&draggingProduct.sourceOrderId===order.id);
                  const isProductTarget=Boolean(draggingProduct&&!isProductSource);
                  const isProductTargetAllowed=Boolean(isProductTarget&&productEligibility?.allowed);
                  const isProductTargetBlocked=Boolean(isProductTarget&&!productEligibility?.allowed);
                  const isProductTargetHovered=Boolean(draggingProduct&&dragOverOrderId===order.id);
                  const blockedReason=draggingProduct?productEligibility?.reason:mergeEligibility?.reason;
                  const isNineTechBlockedHover=Boolean(isMergeHovered&&(isMergeBlocked||isProductTargetBlocked)&&["nine_tech_mismatch","nine_tech_mixed"].includes(blockedReason));
                  return (
                    <Fragment key={order.id}>
                      <tr
                        className={`
                          order-row
                          ${orderType}
                          ${isOpen ? "is-open" : "is-closed"}
                          ${isNew ? "is-new" : ""}
                          ${isDragging ? "is-dragging merge-source" : ""}
                          ${isMergeAllowed ? "merge-target-allowed" : ""}
                          ${isMergeBlocked ? "merge-target-blocked" : ""}
                          ${isMergeHovered&&isMergeAllowed ? "merge-drag-over-allowed" : ""}
                          ${isMergeHovered&&isMergeBlocked ? "merge-drag-over-blocked" : ""}
                          ${isProductSource ? "product-source-order" : ""}
                          ${isProductTargetAllowed ? "product-target-allowed" : ""}
                          ${isProductTargetBlocked ? "product-target-blocked" : ""}
                          ${isProductTargetHovered&&isProductTargetAllowed ? "product-drag-over-allowed" : ""}
                          ${isProductTargetHovered&&isProductTargetBlocked ? "product-drag-over-blocked" : ""}
                        `}
                        draggable={!isCombining&&!isRemoving&&!isMovingProduct}
                        onDragStart={(event) =>
                          handleDragStart(event, order.id)
                        }
                        onDragOver={event=>handleOrderDragOver(event,order)}
                        onDragLeave={event=>handleOrderDragLeave(event,order.id)}
                        onDrop={event=>handleOrderDrop(event,order)}
                        onDragEnd={handleDragEnd}
                        onClick={() => {
                          if (justDraggedRef.current) {
                            return;
                          }
                          toggleRow(order.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            toggleRow(order.id);
                          }
                        }}
                        tabIndex={0}
                      >
                        <td>
                          <div className="dealer-line">
                            <span className="order-name">{order.name}</span>
                            {isNew && <span className="new-badge">NEW</span>}
                            {hasMixedNineTech&&<span title="This order contains both 9 Tech and non-9 Tech products" style={{display:"inline-flex",alignItems:"center",gap:"4px",padding:"3px 7px",borderRadius:"999px",background:"#fef3c7",color:"#b45309",border:"1px solid #f59e0b",fontSize:"11px",fontWeight:"800",whiteSpace:"nowrap"}}>⚠ 9 TECH MIXED</span>}
                            {isNineTechBlockedHover&&<span className="nine-tech-drop-warning">9TECH</span>}
                          </div>
                          {order.date && (
                            <div className="order-date">{order.date}</div>
                          )}
                        </td>
                        <td className="remark-cell">{order.remark || "-"}</td>
                        <td>
                          {orderChanges[order.id]?.length > 0 ? (
                            <div className="change-status-list">
                              {orderChanges[order.id].map((change) => (
                                <span
                                  key={`${change.itemId}-${change.type}`}
                                  className={`change-status ${change.type}`}
                                  title={`${change.product_code}: ${change.product_name}`}
                                >
                                  <strong>{change.label}</strong>
                                  <small>{change.product_code}</small>
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className={`pack-status ${getPackagingClass(order.items)}`}>
                              {getPackagingStatus(order.items)}
                            </span>
                          )}
                        </td>
                        {isSendNowSection && (
                          <td className="approval-cell">
                            <button
                              type="button"
                              className="approval-button"
                              disabled={!canApprove}
                              onClick={(event) => {
                                event.stopPropagation();
                                approveOrder(order);
                              }}
                            >
                              {isApproving ? "Approving..." : "Approve"}
                            </button>
                          </td>
                        )}
                      </tr>
                      {isOpen && (
                        <tr
                          className={`detail ${orderType} ${isMergeAllowed?"merge-target-allowed":""} ${isMergeBlocked?"merge-target-blocked":""} ${isMergeHovered&&isMergeAllowed?"merge-drag-over-allowed":""} ${isMergeHovered&&isMergeBlocked?"merge-drag-over-blocked":""} ${isProductSource?"product-source-order":""} ${isProductTargetAllowed?"product-target-allowed":""} ${isProductTargetBlocked?"product-target-blocked":""} ${isProductTargetHovered&&isProductTargetAllowed?"product-drag-over-allowed":""} ${isProductTargetHovered&&isProductTargetBlocked?"product-drag-over-blocked":""}`}
                          onDragOver={event=>handleOrderDragOver(event,order)}
                          onDragLeave={event=>handleOrderDragLeave(event,order.id)}
                          onDrop={event=>handleOrderDrop(event,order)}
                        >
                          <td colSpan={tableColumnCount}>
                            <div className="item-container">
                              <table className="item-table">
                                <thead>
                                  <tr>
                                    <th>Code</th>
                                    <th><button type="button" className="product-text-toggle" onClick={()=>setShowProductDescription(value=>!value)} title={`Show product ${showProductDescription?"name":"description"}`}>{showProductDescription?"Description":"Name"} ⇄</button></th>
                                    <th>Quantity</th>
                                    <th>Status</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {order.items.length === 0 ? (
                                    <tr>
                                      <td colSpan="4" className="empty-items">
                                        No items found
                                      </td>
                                    </tr>
                                  ) : (
                                    order.items.map((item, itemIndex) => (
                                      <tr
                                        key={item.storageKey}
                                        className={`product-item-row ${draggingProduct?.sourceOrderId===order.id&&draggingProduct?.itemId===item.itemId?"is-product-dragging":""} ${isMovingProduct&&draggingProduct?.sourceOrderId===order.id&&draggingProduct?.itemId===item.itemId?"is-product-moving":""}`}
                                        data-scan-item-key={item.storageKey}
                                        draggable={false}
                                        onMouseDown={event=>{event.currentTarget.draggable=Boolean(event.target.closest(".product-drag-handle"))&&!isCombining&&!isRemoving&&!isMovingProduct&&!updatingItemKeys.includes(item.storageKey);}}
                                        onMouseUp={event=>{event.currentTarget.draggable=false;}}
                                        onDragStart={event=>handleProductDragStart(event,order,item)}
                                        onDragEnd={event=>{event.currentTarget.draggable=false;event.stopPropagation();handleDragEnd();}}
                                        style={highlightedItemKey===item.storageKey?{background:"#dcfce7",outline:"3px solid #22c55e",outlineOffset:"-3px",scrollMarginTop:"120px"}:{scrollMarginTop:"120px"}}
                                      >
                                        <td className="product-code">
                                          <span className="product-drag-handle" title="Drag this product to another order, or drop it on a card to create a new order" aria-label="Drag product">⠿</span>{item.product_code}
                                        </td>
                                        <td className="product-description">
                                          {showProductDescription?(item.product_description||item.product_name):item.product_name}
                                        </td>
                                        <td className="quantity-cell">
                                          {item.quantity}
                                        </td>
                                        <td className="pack-button-cell">
                                          <button
                                            type="button"
                                            className={isItemFullyPackaged(item)?"packed":"not-packed"}
                                            disabled={updatingItemKeys.includes(
                                              item.storageKey
                                            )}
                                            title="One click packs one unit. Click again after fully packed to unpack."
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              updateItem(order.id, itemIndex);
                                            }}
                                          >
                                            {updatingItemKeys.includes(item.storageKey)
                                              ? `Saving ${getProductPackagingLabel(item)}...`
                                              : `${isItemFullyPackaged(item)?"✓ ":""}${getProductPackagingLabel(item)}`}
                                          </button>
                                        </td>
                                      </tr>
                                    ))
                                  )}
                                </tbody>
                              </table>
                            </div>
                          </td>
                        </tr>
                      )}
                      <tr className="order-spacer">
                        <td colSpan={tableColumnCount}></td>
                      </tr>
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  const pageApiBaseUrl=navigationState.apiBaseUrl||API_BASE_URL;

  if (currentPage === "credit-note-report") {
    return <CreditNoteReport apiBaseUrl={pageApiBaseUrl} onBack={()=>navigate("/",{apiBaseUrl:API_BASE_URL})}/>;
  }

  if (currentPage === "open-invoice") {
    return <OpenInvoice apiBaseUrl={pageApiBaseUrl} onBack={()=>navigate("/",{apiBaseUrl:API_BASE_URL})}/>;
  }

  if(currentPage==="mobile-scanner"){
    return <MobileScannerPage loading={loading} scanResult={scanResult} onScan={processScannedCode} onExit={()=>navigate("/",{apiBaseUrl:API_BASE_URL})}/>;
  }

  const trashGlowAlpha=(trashProximity*0.78).toFixed(3);
  const trashGlowSoft=(trashProximity*0.34).toFixed(3);
  const trashGlowSize=`${12+Math.round(trashProximity*44)}px`;
  const pageLeftPadding=12+Math.round(Math.max(0,trashProximity-0.12)/0.88*76);

  return (
    <div
      className={`page packaging-page ${draggingOrderId?"trash-mode":""} ${draggingProduct?"product-drag-mode":""} ${trashProximity>0.12?"trash-near":""}`}
      style={{paddingLeft:`${pageLeftPadding}px`,"--trash-proximity":trashProximity}}
    >
      <div
        ref={trashZoneRef}
        className={`trash-drop-zone ${draggingOrderId?"visible":""} ${isTrashDragOver?"ready":""}`}
        style={{"--trash-glow-alpha":trashGlowAlpha,"--trash-glow-soft":trashGlowSoft,"--trash-glow-size":trashGlowSize}}
        onDragOver={handleTrashDragOver}
        onDragLeave={handleTrashDragLeave}
        onDrop={handleTrashDrop}
        aria-label="Remove order"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-.8 11H7.8L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z"/>
        </svg>
      </div>
      <div className="page-header">
        <div>
          <h2>Packaging Queue</h2>
          <p className="page-description">
            Click an order to expand it. Click or scan to pack; drag a product to move it.
          </p>
        </div>
        <div className="header-actions">
          <button type="button" onClick={()=>navigate("/mobile-scanner",{apiBaseUrl:API_BASE_URL})} style={{padding:"10px 16px",border:"none",borderRadius:"8px",background:"#7c3aed",color:"#fff",cursor:"pointer",fontWeight:"700"}}>Mobile Scan</button>
          <div style={{display:"flex",flexDirection:"column",gap:"5px",minWidth:"280px"}}>
            <div style={{display:"flex",gap:"6px"}}>
              <input
                ref={scanInputRef}
                value={scanCode}
                onChange={event=>setScanCode(event.target.value)}
                onKeyDown={event=>{if(event.key==="Enter"){event.preventDefault();processScannedCode(scanCode);}}}
                placeholder="Scan product QR code"
                autoComplete="off"
                inputMode="none"
                style={{flex:1,minWidth:0,padding:"10px 12px",border:"2px solid #0f766e",borderRadius:"8px",fontWeight:"700"}}
              />
              <button type="button" onClick={()=>processScannedCode(scanCode)} style={{padding:"10px 14px",border:"none",borderRadius:"8px",background:"#0f766e",color:"#fff",cursor:"pointer",fontWeight:"700"}}>Scan</button>
            </div>
            <div style={{fontSize:"12px",fontWeight:"700",color:scanResult.type==="success"?"#15803d":scanResult.type==="error"?"#dc2626":scanResult.type==="warning"?"#b45309":scanResult.type==="saving"?"#2563eb":"#475569"}}>{scanResult.message}</div>
          </div>
          <button
            type="button"
            onClick={() => navigate("/open-invoice",{apiBaseUrl:API_BASE_URL})}
            style={{padding:"10px 16px",border:"none",borderRadius:"8px",background:"#059669",color:"#fff",cursor:"pointer",fontWeight:"700"}}
          >
            Open Invoice
          </button>
          <button
            type="button"
            onClick={() => navigate("/credit-note-report",{apiBaseUrl:API_BASE_URL})}
            style={{
              padding: "10px 16px",
              border: "none",
              borderRadius: "8px",
              background: "#2563eb",
              color: "#ffffff",
              cursor: "pointer",
              fontWeight: "700"
            }}
          >
            Credits Note Report
          </button>

          <PwaInstallButton />
          <div className="live-panel">
            <div className="live-line">
              <span className="live-dot"></span>
              <span>{loading ? "Connecting" : "Live"}</span>
            </div>
            <div className="last-updated">
              {lastUpdated
                ? `Updated ${lastUpdated.toLocaleTimeString()}`
                : "Waiting for data"}
            </div>
          </div>
        </div>
      </div>
      {productMoveNotice&&<div className={`product-move-notice ${productMoveNotice.type}`} role="status" aria-live="polite">{productMoveNotice.message}</div>}
      <div className="card-grid">
        {orderSectionsWithOrders.map(renderOrderCard)}
      </div>
      {removeDialog&&<div className="remove-modal-backdrop" role="presentation">
        <div className="remove-modal" role="dialog" aria-modal="true" aria-labelledby="remove-order-title">
          <div className="remove-modal-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-.8 11H7.8L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z"/></svg>
          </div>
          <h3 id="remove-order-title">Remove Order?</h3>
          <p>Order <strong>{removeDialog.id}</strong> from <strong>{removeDialog.name}</strong> will be rejected and removed.</p>
          {removeError&&<div className="remove-error">{removeError}</div>}
          <div className="remove-actions">
            <button type="button" className="remove-cancel" disabled={isRemoving} onClick={()=>{setRemoveDialog(null);setRemoveError("");}}>Cancel</button>
            <button type="button" className="remove-confirm" disabled={isRemoving} onClick={confirmRemoveOrder}>{isRemoving?"Removing...":"Remove"}</button>
          </div>
        </div>
      </div>}
      {combineDialog&&<div className="combine-modal-backdrop" role="presentation">
        <div className="combine-modal" role="dialog" aria-modal="true" aria-labelledby="combine-order-title">
          <h3 id="combine-order-title">Combine Orders?</h3>
          <p>Move all products and packaging progress from <strong>Order {combineDialog.sourceOrder.id}</strong> to <strong>Order {combineDialog.targetOrder.id}</strong>.</p>
          <div className="combine-summary">
            <div><span>Dealer</span><strong>{combineDialog.sourceOrder.name}</strong></div>
            <div><span>Source remark</span><strong>{combineDialog.sourceOrder.remark||"-"}</strong></div>
            <div><span>Products</span><strong>{combineDialog.sourceOrder.items.length}</strong></div>
          </div>
          <p className="combine-danger">After every product is added successfully, the source order will be rejected and removed.</p>
          {combineError&&<div className="combine-error">{combineError}</div>}
          <div className="combine-actions">
            <button type="button" className="combine-cancel" disabled={isCombining} onClick={()=>{setCombineDialog(null);setCombineError("");}}>Cancel</button>
            <button type="button" className="combine-confirm" disabled={isCombining} onClick={confirmCombineOrders}>{isCombining?"Combining...":"Combine"}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}
export default App;
