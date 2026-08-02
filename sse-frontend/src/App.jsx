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
const POLL_INTERVAL_MS = 3000;
const CARD_HEIGHT_PX = 450;
const AUTO_SCROLL_EDGE_PX = 90;
const AUTO_SCROLL_MAX_SPEED = 50;
const SCANNER_BUFFER_RESET_MS = 300;
const SCAN_HIGHLIGHT_MS = 2500;
const ORDER_TYPE_STORAGE_KEY = "order-type-overrides";
const SEEN_ORDERS_STORAGE_KEY = "seen-order-ids";
const SERVER_SNAPSHOT_STORAGE_KEY = "packaging-server-snapshot";
const ORDER_CHANGES_STORAGE_KEY = "packaging-order-changes";
const NINE_TECH_PATTERN=/\b9[\s_-]*tech\b/i;

const getPageFromPath=()=>location.pathname==="/credit-note-report"?"credit-note-report":location.pathname==="/open-invoice"?"open-invoice":"packaging";
const normalizeProductCode=value=>String(value||"").replace(/[\r\n\t]/g,"").trim().toUpperCase();
const toQuantity=value=>Math.max(0,Number(value)||0);
const clampPackedQuantity=(value,quantity)=>Math.min(toQuantity(quantity),toQuantity(value));
const isItemFullyPackaged=item=>toQuantity(item?.quantity)>0&&toQuantity(item?.packedQuantity)>=toQuantity(item?.quantity);
const getNextPackedQuantity=item=>isItemFullyPackaged(item)?0:Math.min(toQuantity(item?.quantity),toQuantity(item?.packedQuantity)+1);
const isNineTechItem=item=>NINE_TECH_PATTERN.test(`${item?.product_code||""} ${item?.product_name||""}`);
const hasMixedNineTechProducts=order=>{
  const items=(order?.items||[]).filter(item=>toQuantity(item.quantity)>0);
  return items.some(isNineTechItem)&&items.some(item=>!isNineTechItem(item));
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
function App() {
  const [currentPage,setCurrentPage]=useState(getPageFromPath);
  const [navigationState,setNavigationState]=useState(()=>window.history.state||{});
  const [orders, setOrders] = useState([]);
  const [openRows, setOpenRows] = useState([]);
  const [newOrderIds, setNewOrderIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [draggingOrderId, setDraggingOrderId] = useState(null);
  const [dragOverSection, setDragOverSection] = useState(null);
  const [orderChanges, setOrderChanges] = useState(() => getSavedObject(ORDER_CHANGES_STORAGE_KEY));
  const [updatingItemKeys, setUpdatingItemKeys] = useState([]);
  const [approvingOrderIds, setApprovingOrderIds] = useState([]);
  const [scanCode,setScanCode]=useState("");
  const [scanResult,setScanResult]=useState({type:"ready",message:"Scanner ready"});
  const [highlightedItemKey,setHighlightedItemKey]=useState(null);
  const ordersRef=useRef([]);
  const updatingItemKeysRef=useRef(new Set());
  const scanQueueRef=useRef(new Map());
  const serverSnapshotRef = useRef(getSavedObject(SERVER_SNAPSHOT_STORAGE_KEY));
  const isFetchingRef = useRef(false);
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
    if (isFetchingRef.current) {
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
            product_id:String(item.product_id||""),
            product_ids:Array.isArray(item.product_ids)?item.product_ids.map(productId=>String(productId||"")).filter(Boolean):[],
            product_code:item.code||"-",
            product_name:item.name||"-",
            quantity,
            packedQuantity,
            storageKey,
            packaged:quantity>0&&packedQuantity>=quantity
          };
        });
        return {
          id: orderId,
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
    if (currentPage !== "packaging") {
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
      return;
    }
    const match=matches.find(result=>!isItemFullyPackaged(result.item)&&!updatingItemKeysRef.current.has(result.item.storageKey))||matches.find(result=>!updatingItemKeysRef.current.has(result.item.storageKey))||matches[0];
    if(updatingItemKeysRef.current.has(match.item.storageKey)){
      setScanResult({type:"saving",message:`${code} is waiting for the previous scan`});
      return;
    }
    revealScannedItem(match.order.id,match.item.storageKey);
    const unpacking=isItemFullyPackaged(match.item);
    const nextPackedQuantity=getNextPackedQuantity(match.item);
    const nextLabel=getProductPackagingLabel(match.item,nextPackedQuantity);
    setScanResult({type:"saving",message:`${unpacking?"Unpacking":"Packing"} ${code} · ${nextLabel} · ${match.order.name}`});
    const saved=await setItemPackedQuantity(match.order.id,match.itemIndex,nextPackedQuantity,false);
    setScanResult(saved?{type:"success",message:`${code} · ${unpacking?"Unpacked · ":""}${nextLabel} · ${match.order.name}`}:{type:"error",message:`Failed to save ${code}`});
  };
  const processScannedCode=useCallback(rawCode=>{
    const code=normalizeProductCode(rawCode);
    setScanCode("");
    if(!code){
      setScanResult({type:"error",message:"No product code received"});
      return;
    }
    const previousTask=scanQueueRef.current.get(code)||Promise.resolve();
    const nextTask=previousTask.catch(()=>{}).then(()=>processScannedCodeNow(code)).finally(()=>{
      if(scanQueueRef.current.get(code)===nextTask)scanQueueRef.current.delete(code);
    });
    scanQueueRef.current.set(code,nextTask);
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
    dragScrollContainerRef.current = event.currentTarget.querySelector(".table-wrapper");
    if (!autoScrollFrameRef.current) {
      autoScrollFrameRef.current = requestAnimationFrame(runDragAutoScroll);
    }
  };
  const resetDragState = () => {
    stopDragAutoScroll();
    setDraggingOrderId(null);
    setDragOverSection(null);
    // Ignore the accidental click generated immediately after drag.
    setTimeout(() => {
      justDraggedRef.current = false;
    }, 180);
  };
  const handleDragStart = (event, orderId) => {
    justDraggedRef.current = true;
    setDraggingOrderId(orderId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", orderId);
  };
  const handleDragEnd = () => {
    resetDragState();
  };
  const handleDragOver = (event, sectionType) => {
    updateDragAutoScroll(event);
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
  const renderOrderCard = (section) => {
    const isDragOver = dragOverSection === section.type;
    const draggedOrder = orders.find(
      (order) => order.id === draggingOrderId
    );
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
                    {draggingOrderId && !isBlockedSendNowTarget
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
                  return (
                    <Fragment key={order.id}>
                      <tr
                        className={`
                          order-row
                          ${orderType}
                          ${isOpen ? "is-open" : "is-closed"}
                          ${isNew ? "is-new" : ""}
                          ${isDragging ? "is-dragging" : ""}
                        `}
                        draggable
                        onDragStart={(event) =>
                          handleDragStart(event, order.id)
                        }
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
                        <tr className={`detail ${orderType}`}>
                          <td colSpan={tableColumnCount}>
                            <div className="item-container">
                              <table className="item-table">
                                <thead>
                                  <tr>
                                    <th>Code</th>
                                    <th>Description</th>
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
                                        data-scan-item-key={item.storageKey}
                                        style={highlightedItemKey===item.storageKey?{background:"#dcfce7",outline:"3px solid #22c55e",outlineOffset:"-3px",scrollMarginTop:"120px"}:{scrollMarginTop:"120px"}}
                                      >
                                        <td className="product-code">
                                          {item.product_code}
                                        </td>
                                        <td className="product-description">
                                          {item.product_name}
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

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Packaging Queue</h2>
          <p className="page-description">
            Click an order to expand it. Each product click or scan packs one unit.
          </p>
        </div>
        <div className="header-actions">
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
      <div className="card-grid">
        {orderSectionsWithOrders.map(renderOrderCard)}
      </div>
    </div>
  );
}
export default App;
