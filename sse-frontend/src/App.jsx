import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import "./App.css";
import PwaInstallButton from "./PwaInstallButton";
import CreditNoteReport from "./CreditNoteReport";
const API_BASE_URL = "https://sse-sales-check.onrender.com";
// const API_BASE_URL = "http://localhost:5000";
const APPROVALS_API_URL = `${API_BASE_URL}/approvals`;
const PACKAGING_STATUS_API_URL = `${API_BASE_URL}/packaging-status`;
const APPROVE_ORDER_API_URL = `${API_BASE_URL}/approve-order`;
const POLL_INTERVAL_MS = 3000;
const CARD_HEIGHT_PX = 450;
const AUTO_SCROLL_EDGE_PX = 90;
const AUTO_SCROLL_MAX_SPEED = 50;
const ORDER_TYPE_STORAGE_KEY = "order-type-overrides";
const SEEN_ORDERS_STORAGE_KEY = "seen-order-ids";
const SERVER_SNAPSHOT_STORAGE_KEY = "packaging-server-snapshot";
const ORDER_CHANGES_STORAGE_KEY = "packaging-order-changes";
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
  // Any remark containing a number becomes Trip.
  if (/\d/.test(value)) {
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
  const [currentPage, setCurrentPage] = useState("packaging");
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
  const serverSnapshotRef = useRef(getSavedObject(SERVER_SNAPSHOT_STORAGE_KEY));
  const isFetchingRef = useRef(false);
  const justDraggedRef = useRef(false);
  const notificationAudioRef=useRef(null);
  const notifiedOrderIdsRef=useRef(new Set());
  const autoScrollFrameRef = useRef(null);
  const dragPointerYRef = useRef(null);
  const dragScrollContainerRef = useRef(null);

useEffect(()=>{
  notificationAudioRef.current=new Audio("/sharp_notification.wav");
  notificationAudioRef.current.preload="auto";
  return()=>notificationAudioRef.current?.pause();
},[]);

useEffect(()=>()=>{
  if(autoScrollFrameRef.current){
    cancelAnimationFrame(autoScrollFrameRef.current);
  }
},[]);

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
          const quantity = Number(item.qty);
          const pendingStatus = pendingPackagingRef.current.get(storageKey);
          return {
            itemId,
            product_id: String(item.product_id || ""),
            product_code: item.code || "-",
            product_name: item.name || "-",
            quantity: Number.isFinite(quantity) ? quantity : 0,
            storageKey,
            // Backend values are shared by every browser; pending local values remain until the PUT request finishes.
            packaged: pendingStatus ?? Boolean(item.packaged)
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
      const currentSnapshot = buildServerSnapshot(formattedOrders);
      const previousSnapshot = serverSnapshotRef.current;
      const hasPreviousSnapshot = Object.keys(previousSnapshot).length > 0;
      const detectedChanges = hasPreviousSnapshot
        ? detectOrderChanges(previousSnapshot, currentSnapshot)
        : {};
      let shouldPlayNotification=Object.keys(detectedChanges).length>0;
      const fetchedOrderIds = formattedOrders.map((order) => order.id);
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
  const updateItem = async (orderId, itemIndex) => {
    const selectedOrder = orders.find((order) => order.id === orderId);
    const selectedItem = selectedOrder?.items[itemIndex];
    if (!selectedItem) {
      return;
    }
    if (updatingItemKeys.includes(selectedItem.storageKey)) {
      return;
    }
    const previousStatus = Boolean(selectedItem.packaged);
    const newStatus = !previousStatus;
    // Optimistically update this browser immediately while the backend saves the shared status.
    pendingPackagingRef.current.set(selectedItem.storageKey, newStatus);
    setUpdatingItemKeys((currentKeys) => [
      ...currentKeys,
      selectedItem.storageKey
    ]);
    setOrders((currentOrders) =>
      currentOrders.map((order) =>
        order.id === orderId
          ? {
              ...order,
              items: order.items.map((item, currentItemIndex) =>
                currentItemIndex === itemIndex
                  ? {
                      ...item,
                      packaged: newStatus
                    }
                  : item
              )
            }
          : order
      )
    );
    try {
      const response = await axios.put(PACKAGING_STATUS_API_URL, {
        order_id: orderId,
        item_id: selectedItem.itemId,
        product_code: selectedItem.product_code,
        quantity: selectedItem.quantity,
        packaged: newStatus
      });
      const confirmedStatus = Boolean(response.data?.packaged);
      pendingPackagingRef.current.set(selectedItem.storageKey, confirmedStatus);
      setOrders((currentOrders) =>
        currentOrders.map((order) =>
          order.id === orderId
            ? {
                ...order,
                items: order.items.map((item) =>
                  item.itemId === selectedItem.itemId
                    ? {
                        ...item,
                        packaged: confirmedStatus
                      }
                    : item
                )
              }
            : order
        )
      );
    } catch (error) {
      console.error("Cannot update packaging status", error);
      // Roll back the optimistic change when the server cannot save it.
      pendingPackagingRef.current.set(selectedItem.storageKey, previousStatus);
      setOrders((currentOrders) =>
        currentOrders.map((order) =>
          order.id === orderId
            ? {
                ...order,
                items: order.items.map((item) =>
                  item.itemId === selectedItem.itemId
                    ? {
                        ...item,
                        packaged: previousStatus
                      }
                    : item
                )
              }
            : order
        )
      );
      window.alert("Packaging status was not saved. Please try again.");
    } finally {
      pendingPackagingRef.current.delete(selectedItem.storageKey);
      setUpdatingItemKeys((currentKeys) =>
        currentKeys.filter((key) => key !== selectedItem.storageKey)
      );
      // Read the final shared value back from the backend.
      fetchApprovals(true);
    }
  };
  const getPackagingStatus = (items) => {
    if (items.length === 0) {
      return "No Items";
    }
    const packed = items.filter((item) => item.packaged).length;
    if (packed === 0) {
      return "Not Packed";
    }
    if (packed === items.length) {
      return "Packaged";
    }
    return `Ongoing (${packed}/${items.length})`;
  };
  const getPackagingClass = (items) => {
    if (items.length === 0) {
      return "not-packed-status";
    }
    const packed = items.filter((item) => item.packaged).length;
    if (packed === 0) {
      return "not-packed-status";
    }
    if (packed === items.length) {
      return "packaged-status";
    }
    return "ongoing-status";
  };
  const isOrderFullyPackaged = (order) => {
    if (!order || order.items.length === 0) {
      return false;
    }
    return order.items.every((item) => item.packaged);
  };
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
    const selectedItems = order.items
      .map((item) => String(item.product_id).trim())
      .filter(Boolean);
    if (selectedItems.length === 0) {
      window.alert("No product IDs were found for approval.");
      return;
    }
    setApprovingOrderIds((currentIds) => [
      ...currentIds,
      order.id
    ]);
    try {
      const response = await axios.post(APPROVE_ORDER_API_URL, {
        sale_id: String(order.id),
        selected_items: selectedItems,
        sale_remark: String(order.remark || "")
      });
      
      await fetchApprovals(true);
    } catch (error) {
      console.error("Cannot approve order", error);
      window.alert(
        error.response?.data?.error ||
        error.response?.data?.details ||
        "Unable to approve the order. Please try again."
      );
    } finally {
      setApprovingOrderIds((currentIds) =>
        currentIds.filter((id) => id !== order.id)
      );
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
                                      <tr key={item.storageKey}>
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
                                            className={
                                              item.packaged
                                                ? "packed"
                                                : "not-packed"
                                            }
                                            disabled={updatingItemKeys.includes(
                                              item.storageKey
                                            )}
                                            onClick={(event) => {
                                              event.stopPropagation();
                                              updateItem(order.id, itemIndex);
                                            }}
                                          >
                                            {updatingItemKeys.includes(
                                              item.storageKey
                                            )
                                              ? "Saving..."
                                              : item.packaged
                                                ? "✓ Packed"
                                                : "Pack"}
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

  if (currentPage === "credit-note-report") {
    return (
      <CreditNoteReport
        onBack={() => setCurrentPage("packaging")}
      />
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Packaging Queue</h2>
          <p className="page-description">
            Click an order to expand it. Drag an order between the cards.
          </p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            onClick={() => setCurrentPage("credit-note-report")}
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
