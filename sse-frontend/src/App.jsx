import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import axios from "axios";
import "./App.css";

const API_URL = "http://localhost:5000/approvals";
const POLL_INTERVAL_MS = 3000;

const PACKAGING_STORAGE_KEY = "packaging-status";
const ORDER_TYPE_STORAGE_KEY = "order-type-overrides";
const SEEN_ORDERS_STORAGE_KEY = "seen-order-ids";

const SERVER_SNAPSHOT_STORAGE_KEY =
  "packaging-server-snapshot";

const ORDER_CHANGES_STORAGE_KEY =
  "packaging-order-changes";

/*
  Fixed card placement:

  New       Trip
  Send Now  Hold
*/
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
    title: "Send Now",
    type: "send_now"
  },
  {
    title: "Hold",
    type: "hold"
  }
];

const getSavedObject = (storageKey) => {
  try {
    return (
      JSON.parse(
        localStorage.getItem(storageKey)
      ) || {}
    );
  } catch (error) {
    console.error(
      `Cannot read ${storageKey}`,
      error
    );

    return {};
  }
};

const saveObject = (
  storageKey,
  value
) => {
  localStorage.setItem(
    storageKey,
    JSON.stringify(value)
  );
};

const getSavedArray = (storageKey) => {
  try {
    const result = JSON.parse(
      localStorage.getItem(storageKey)
    );

    return Array.isArray(result)
      ? result
      : [];
  } catch (error) {
    console.error(
      `Cannot read ${storageKey}`,
      error
    );

    return [];
  }
};

const saveArray = (
  storageKey,
  value
) => {
  localStorage.setItem(
    storageKey,
    JSON.stringify(value)
  );
};

const getOrderType = (remark) => {
  const value = String(remark || "")
    .toLowerCase()
    .trim();

  /*
    Send Now must exactly equal
    "send now".
  */
  if (value === "send now") {
    return "send_now";
  }

  /*
    Any remark containing a number
    becomes Trip.
  */
  if (/\d/.test(value)) {
    return "trip";
  }

  if (value.includes("hold")) {
    return "hold";
  }

  /*
    Empty or other remarks become New.
  */
  return "new";
};

const getResolvedOrderType = (order) => {
  return (
    order.manualType ||
    getOrderType(order.remark)
  );
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
              product_code:
                item.product_code,

              product_name:
                item.product_name,

              quantity:
                item.quantity
            }
          ])
        )
      }
    ])
  );
};

const detectOrderChanges = (
  previousSnapshot,
  currentSnapshot
) => {
  const detectedChanges = {};

  Object.entries(
    currentSnapshot
  ).forEach(
    ([orderId, currentOrder]) => {
      const previousOrder =
        previousSnapshot[orderId];

      /*
        A completely new order uses
        the shining row effect.
      */
      if (!previousOrder) {
        return;
      }

      const previousItems =
        previousOrder.items || {};

      const currentItems =
        currentOrder.items || {};

      const changes = [];

      /*
        Detect new items and
        quantity changes.
      */
      Object.entries(
        currentItems
      ).forEach(
        ([itemId, currentItem]) => {
          const previousItem =
            previousItems[itemId];

          if (!previousItem) {
            changes.push({
              type: "new-item",
              group: "presence",
              itemId,
              label: "New Item",

              product_code:
                currentItem.product_code,

              product_name:
                currentItem.product_name
            });

            return;
          }

          const quantityDifference =
            currentItem.quantity -
            previousItem.quantity;

          if (quantityDifference > 0) {
            changes.push({
              type: "quantity-add",
              group: "quantity",
              itemId,

              label:
                `+${quantityDifference}`,

              product_code:
                currentItem.product_code,

              product_name:
                currentItem.product_name
            });
          }

          if (quantityDifference < 0) {
            changes.push({
              type: "quantity-remove",
              group: "quantity",
              itemId,

              label:
                `${quantityDifference}`,

              product_code:
                currentItem.product_code,

              product_name:
                currentItem.product_name
            });
          }
        }
      );

      /*
        Detect removed items.
      */
      Object.entries(
        previousItems
      ).forEach(
        ([itemId, previousItem]) => {
          if (!currentItems[itemId]) {
            changes.push({
              type: "remove-item",
              group: "presence",
              itemId,
              label: "Remove Item",

              product_code:
                previousItem.product_code,

              product_name:
                previousItem.product_name
            });
          }
        }
      );

      if (changes.length > 0) {
        detectedChanges[orderId] =
          changes;
      }
    }
  );

  return detectedChanges;
};

const mergeOrderChanges = (
  currentChanges,
  detectedChanges
) => {
  const nextChanges = {
    ...currentChanges
  };

  Object.entries(
    detectedChanges
  ).forEach(
    ([orderId, changes]) => {
      const changeMap = new Map();

      /*
        Keep existing changes that
        have not been acknowledged.
      */
      (
        nextChanges[orderId] || []
      ).forEach((change) => {
        const changeKey =
          `${change.itemId}-` +
          `${change.group}`;

        changeMap.set(
          changeKey,
          change
        );
      });

      /*
        Replace the earlier change
        for the same product.
      */
      changes.forEach((change) => {
        const changeKey =
          `${change.itemId}-` +
          `${change.group}`;

        changeMap.set(
          changeKey,
          change
        );
      });

      nextChanges[orderId] =
        Array.from(
          changeMap.values()
        );
    }
  );

  return nextChanges;
};

function App() {
  const [orders, setOrders] =
    useState([]);

  const [openRows, setOpenRows] =
    useState([]);

  const [newOrderIds, setNewOrderIds] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [lastUpdated, setLastUpdated] =
    useState(null);

  const [
    draggingOrderId,
    setDraggingOrderId
  ] = useState(null);

  const [
    dragOverSection,
    setDragOverSection
  ] = useState(null);

  const [
    orderChanges,
    setOrderChanges
  ] = useState(() =>
    getSavedObject(
      ORDER_CHANGES_STORAGE_KEY
    )
  );

  const serverSnapshotRef = useRef(
    getSavedObject(
      SERVER_SNAPSHOT_STORAGE_KEY
    )
  );

  const isFetchingRef = useRef(false);
  const justDraggedRef = useRef(false);

  const fetchApprovals = useCallback(
    async (silent = false) => {
      if (isFetchingRef.current) {
        return;
      }

      isFetchingRef.current = true;

      if (!silent) {
        setLoading(true);
      }

      try {
        const response =
          await axios.get(API_URL);

        const responseOrders =
          Array.isArray(response.data)
            ? response.data
            : [];

        const savedStatuses =
          getSavedObject(
            PACKAGING_STORAGE_KEY
          );

        const savedTypeOverrides =
          getSavedObject(
            ORDER_TYPE_STORAGE_KEY
          );

        const formattedOrders =
          responseOrders.map(
            (order, orderIndex) => {
              const items =
                Array.isArray(order.items)
                  ? order.items
                  : [];

              /*
                A stable backend order ID is
                recommended.

                Priority:
                1. order.id
                2. order.approval_id
                3. order.link
                4. generated fallback
              */
              const orderId = String(
                order.id ||
                order.approval_id ||
                order.link ||
                `${order.dealer}-` +
                  `${order.date}-` +
                  `${orderIndex}`
              );

              const formattedItems =
                items.map(
                  (item, itemIndex) => {
                    /*
                      Product code is used as
                      the item identity.
                    */
                    const itemId = String(
                      item.id ||
                      item.code ||
                      `${item.name}-` +
                        `${itemIndex}`
                    );

                    const storageKey =
                      `${orderId}-` +
                      `${itemId}`;

                    const quantity =
                      Number(item.qty);

                    return {
                      itemId,

                      product_code:
                        item.code || "-",

                      product_name:
                        item.name || "-",

                      quantity:
                        Number.isFinite(
                          quantity
                        )
                          ? quantity
                          : 0,

                      storageKey,

                      packaged:
                        savedStatuses[
                          storageKey
                        ] ?? false
                    };
                  }
                );

              return {
                id: orderId,

                name:
                  order.dealer ||
                  "Unknown Dealer",

                remark: order.remark,
                date: order.date,
                link: order.link,

                manualType:
                  savedTypeOverrides[
                    orderId
                  ] || null,

                items: formattedItems
              };
            }
          );

        const currentSnapshot =
          buildServerSnapshot(
            formattedOrders
          );

        const previousSnapshot =
          serverSnapshotRef.current;

        const hasPreviousSnapshot =
          Object.keys(
            previousSnapshot
          ).length > 0;

        const detectedChanges =
          hasPreviousSnapshot
            ? detectOrderChanges(
                previousSnapshot,
                currentSnapshot
              )
            : {};

        /*
          Reset item packaging when:
          1. A new product is added
          2. Product quantity increases
        */
        Object.entries(
          detectedChanges
        ).forEach(
          ([orderId, changes]) => {
            const changedOrder =
              formattedOrders.find(
                (order) =>
                  order.id === orderId
              );

            if (!changedOrder) {
              return;
            }

            changes.forEach(
              (change) => {
                const needsRepacking =
                  change.type ===
                    "new-item" ||
                  change.type ===
                    "quantity-add";

                if (!needsRepacking) {
                  return;
                }

                const changedItem =
                  changedOrder.items.find(
                    (item) =>
                      item.itemId ===
                      change.itemId
                  );

                if (!changedItem) {
                  return;
                }

                changedItem.packaged =
                  false;

                savedStatuses[
                  changedItem.storageKey
                ] = false;
              }
            );
          }
        );

        saveObject(
          PACKAGING_STORAGE_KEY,
          savedStatuses
        );

        const fetchedOrderIds =
          formattedOrders.map(
            (order) => order.id
          );

        /*
          Save and display item or
          quantity changes.
        */
        setOrderChanges(
          (currentChanges) => {
            let nextChanges =
              mergeOrderChanges(
                currentChanges,
                detectedChanges
              );

            /*
              Remove change alerts belonging
              to orders no longer returned
              by the server.
            */
            nextChanges =
              Object.fromEntries(
                Object.entries(
                  nextChanges
                ).filter(
                  ([orderId]) =>
                    fetchedOrderIds.includes(
                      orderId
                    )
                )
              );

            saveObject(
              ORDER_CHANGES_STORAGE_KEY,
              nextChanges
            );

            return nextChanges;
          }
        );

        serverSnapshotRef.current =
          currentSnapshot;

        saveObject(
          SERVER_SNAPSHOT_STORAGE_KEY,
          currentSnapshot
        );

        /*
          Detect completely new orders.
        */
        const hasSeenStorage =
          localStorage.getItem(
            SEEN_ORDERS_STORAGE_KEY
          ) !== null;

        if (!hasSeenStorage) {
          saveArray(
            SEEN_ORDERS_STORAGE_KEY,
            fetchedOrderIds
          );

          setNewOrderIds([]);
        } else {
          const seenOrderIds =
            getSavedArray(
              SEEN_ORDERS_STORAGE_KEY
            );

          const newlyAddedIds =
            fetchedOrderIds.filter(
              (id) =>
                !seenOrderIds.includes(
                  id
                )
            );

          setNewOrderIds(
            (currentNewIds) => [
              ...new Set([
                ...currentNewIds.filter(
                  (id) =>
                    fetchedOrderIds.includes(
                      id
                    )
                ),
                ...newlyAddedIds
              ])
            ]
          );
        }

        setOrders(formattedOrders);
        setLastUpdated(new Date());
      } catch (error) {
        console.error(
          "Request Failed",
          error
        );
      } finally {
        isFetchingRef.current =
          false;

        if (!silent) {
          setLoading(false);
        }
      }
    },
    []
  );

  /*
    Automatically retrieve orders
    every three seconds.
  */
  useEffect(() => {
    fetchApprovals(false);

    const intervalId = setInterval(
      () => {
        fetchApprovals(true);
      },
      POLL_INTERVAL_MS
    );

    return () => {
      clearInterval(intervalId);
    };
  }, [fetchApprovals]);

  /*
    Fixed card order.
    Empty cards do not move.
  */
  const orderSectionsWithOrders =
    useMemo(() => {
      return ORDER_SECTIONS.map(
        (section) => {
          const sectionOrders =
            orders.filter(
              (order) =>
                getResolvedOrderType(
                  order
                ) === section.type
            );

          return {
            ...section,
            orders: sectionOrders
          };
        }
      );
    }, [orders]);

  const markOrderAsSeen = (
    orderId
  ) => {
    setNewOrderIds(
      (currentNewIds) =>
        currentNewIds.filter(
          (id) => id !== orderId
        )
    );

    const seenOrderIds =
      getSavedArray(
        SEEN_ORDERS_STORAGE_KEY
      );

    if (
      !seenOrderIds.includes(orderId)
    ) {
      saveArray(
        SEEN_ORDERS_STORAGE_KEY,
        [
          ...seenOrderIds,
          orderId
        ]
      );
    }
  };

  const clearOrderChanges = (
    orderId
  ) => {
    setOrderChanges(
      (currentChanges) => {
        if (
          !currentChanges[orderId]
        ) {
          return currentChanges;
        }

        const nextChanges = {
          ...currentChanges
        };

        delete nextChanges[orderId];

        saveObject(
          ORDER_CHANGES_STORAGE_KEY,
          nextChanges
        );

        return nextChanges;
      }
    );
  };

  const toggleRow = (orderId) => {
    const isCurrentlyOpen =
      openRows.includes(orderId);

    setOpenRows(
      (currentRows) =>
        currentRows.includes(orderId)
          ? currentRows.filter(
              (id) => id !== orderId
            )
          : [
              ...currentRows,
              orderId
            ]
    );

    if (!isCurrentlyOpen) {
      /*
        Stop new-order shining when
        the order is opened.
      */
      markOrderAsSeen(orderId);

      /*
        Clear item-change alerts shortly
        after the order is opened.
      */
      setTimeout(() => {
        clearOrderChanges(orderId);
      }, 800);
    }
  };

  const updateItem = (
    orderId,
    itemIndex
  ) => {
    setOrders(
      (currentOrders) =>
        currentOrders.map(
          (order) => {
            if (
              order.id !== orderId
            ) {
              return order;
            }

            const updatedItems =
              order.items.map(
                (
                  item,
                  currentItemIndex
                ) => {
                  if (
                    currentItemIndex !==
                    itemIndex
                  ) {
                    return item;
                  }

                  const newStatus =
                    !item.packaged;

                  const savedStatuses =
                    getSavedObject(
                      PACKAGING_STORAGE_KEY
                    );

                  savedStatuses[
                    item.storageKey
                  ] = newStatus;

                  saveObject(
                    PACKAGING_STORAGE_KEY,
                    savedStatuses
                  );

                  return {
                    ...item,
                    packaged: newStatus
                  };
                }
              );

            return {
              ...order,
              items: updatedItems
            };
          }
        )
    );
  };

  const getPackagingStatus = (
    items
  ) => {
    if (items.length === 0) {
      return "No Items";
    }

    const packed =
      items.filter(
        (item) => item.packaged
      ).length;

    if (packed === 0) {
      return "Not Packed";
    }

    if (
      packed === items.length
    ) {
      return "Packaged";
    }

    return (
      `Ongoing ` +
      `(${packed}/${items.length})`
    );
  };

  const getPackagingClass = (
    items
  ) => {
    if (items.length === 0) {
      return "not-packed-status";
    }

    const packed =
      items.filter(
        (item) => item.packaged
      ).length;

    if (packed === 0) {
      return "not-packed-status";
    }

    if (
      packed === items.length
    ) {
      return "packaged-status";
    }

    return "ongoing-status";
  };

  const isOrderFullyPackaged = (
    order
  ) => {
    if (
      !order ||
      order.items.length === 0
    ) {
      return false;
    }

    return order.items.every(
      (item) => item.packaged
    );
  };

  const canDropIntoSection = (
    order,
    targetType
  ) => {
    /*
      Any order can move to New,
      Trip or Hold.
    */
    if (targetType !== "send_now") {
      return true;
    }

    /*
      Send Now only accepts fully
      packaged orders.
    */
    return isOrderFullyPackaged(
      order
    );
  };

  /*
    Approval action will be added here
    later.

    Currently this function performs
    no action.
  */
  const approveOrder = async () => {};

  const resetDragState = () => {
    setDraggingOrderId(null);
    setDragOverSection(null);

    /*
      Ignore only the accidental click
      immediately after dragging.
    */
    setTimeout(() => {
      justDraggedRef.current =
        false;
    }, 180);
  };

  const handleDragStart = (
    event,
    orderId
  ) => {
    justDraggedRef.current = true;

    setDraggingOrderId(orderId);

    event.dataTransfer.effectAllowed =
      "move";

    event.dataTransfer.setData(
      "text/plain",
      orderId
    );
  };

  const handleDragEnd = () => {
    resetDragState();
  };

  const handleDragOver = (
    event,
    sectionType
  ) => {
    const draggedOrder =
      orders.find(
        (order) =>
          order.id === draggingOrderId
      );

    if (
      !canDropIntoSection(
        draggedOrder,
        sectionType
      )
    ) {
      event.dataTransfer.dropEffect =
        "none";

      setDragOverSection(null);
      return;
    }

    /*
      Preventing the default action
      enables dropping.
    */
    event.preventDefault();

    event.dataTransfer.dropEffect =
      "move";

    setDragOverSection(
      sectionType
    );
  };

  const handleDrop = async (
    event,
    targetType
  ) => {
    event.preventDefault();

    const orderId =
      event.dataTransfer.getData(
        "text/plain"
      ) || draggingOrderId;

    if (!orderId) {
      resetDragState();
      return;
    }

    const selectedOrder =
      orders.find(
        (order) =>
          order.id === orderId
      );

    if (!selectedOrder) {
      resetDragState();
      return;
    }

    /*
      Block unpackaged orders from
      entering Send Now.
    */
    if (
      !canDropIntoSection(
        selectedOrder,
        targetType
      )
    ) {
      resetDragState();
      return;
    }

    const currentType =
      getResolvedOrderType(
        selectedOrder
      );

    if (currentType !== targetType) {
      const savedOverrides =
        getSavedObject(
          ORDER_TYPE_STORAGE_KEY
        );

      savedOverrides[orderId] =
        targetType;

      saveObject(
        ORDER_TYPE_STORAGE_KEY,
        savedOverrides
      );

      setOrders(
        (currentOrders) =>
          currentOrders.map(
            (order) =>
              order.id === orderId
                ? {
                    ...order,
                    manualType:
                      targetType
                  }
                : order
          )
      );
    }

    /*
      A fully packaged order dropped
      into Send Now will call the
      approval function immediately.

      The approval function is currently
      empty.
    */
    if (
      targetType === "send_now"
    ) {
      await approveOrder(
        selectedOrder
      );
    }

    resetDragState();
  };

  const renderOrderCard = (
    section
  ) => {
    const isDragOver =
      dragOverSection ===
      section.type;

    const draggedOrder =
      orders.find(
        (order) =>
          order.id ===
          draggingOrderId
      );

    const isBlockedSendNowTarget =
      Boolean(
        draggingOrderId &&
        section.type ===
          "send_now" &&
        draggedOrder &&
        !isOrderFullyPackaged(
          draggedOrder
        )
      );

    return (
      <section
        className={`
          order-card
          ${section.type}
          ${
            isDragOver
              ? "drag-over"
              : ""
          }
          ${
            isBlockedSendNowTarget
              ? "drop-blocked"
              : ""
          }
        `}
        key={section.type}
        onDragOver={(event) =>
          handleDragOver(
            event,
            section.type
          )
        }
        onDrop={(event) =>
          handleDrop(
            event,
            section.type
          )
        }
      >
        <div className="card-heading">
          <h1 className="section-title">
            {section.title}
          </h1>

          <span className="order-count">
            {section.orders.length}
          </span>
        </div>

        {isBlockedSendNowTarget && (
          <div className="drop-warning">
            Complete all packaging before
            moving the order to Send Now.
          </div>
        )}

        <div className="table-wrapper">
          <table className="main-table">
            <thead>
              <tr>
                <th>Dealer</th>
                <th>Remark</th>
                <th>Packaging</th>
              </tr>
            </thead>

            <tbody>
              {section.orders.length ===
              0 ? (
                <tr className="empty-orders">
                  <td colSpan="3">
                    {draggingOrderId &&
                    !isBlockedSendNowTarget
                      ? `Drop order into ${section.title}`
                      : `No ${section.title} orders`}
                  </td>
                </tr>
              ) : (
                section.orders.map(
                  (order) => {
                    const isOpen =
                      openRows.includes(
                        order.id
                      );

                    const orderType =
                      getResolvedOrderType(
                        order
                      );

                    const isNew =
                      newOrderIds.includes(
                        order.id
                      );

                    const isDragging =
                      draggingOrderId ===
                      order.id;

                    return (
                      <Fragment
                        key={order.id}
                      >
                        <tr
                          className={`
                            order-row
                            ${orderType}
                            ${
                              isOpen
                                ? "is-open"
                                : "is-closed"
                            }
                            ${
                              isNew
                                ? "is-new"
                                : ""
                            }
                            ${
                              isDragging
                                ? "is-dragging"
                                : ""
                            }
                          `}
                          draggable
                          onDragStart={(
                            event
                          ) =>
                            handleDragStart(
                              event,
                              order.id
                            )
                          }
                          onDragEnd={
                            handleDragEnd
                          }
                          onClick={() => {
                            if (
                              justDraggedRef.current
                            ) {
                              return;
                            }

                            toggleRow(
                              order.id
                            );
                          }}
                          onKeyDown={(
                            event
                          ) => {
                            if (
                              event.key ===
                                "Enter" ||
                              event.key ===
                                " "
                            ) {
                              event.preventDefault();

                              toggleRow(
                                order.id
                              );
                            }
                          }}
                          tabIndex={0}
                        >
                          <td>
                            <div className="dealer-line">
                              <span className="order-name">
                                {order.name}
                              </span>

                              {isNew && (
                                <span className="new-badge">
                                  NEW
                                </span>
                              )}
                            </div>

                            {order.date && (
                              <div className="order-date">
                                {order.date}
                              </div>
                            )}
                          </td>

                          <td className="remark-cell">
                            {order.remark || "-"}
                          </td>

                          <td>
                            {orderChanges[
                              order.id
                            ]?.length > 0 ? (
                              <div className="change-status-list">
                                {orderChanges[
                                  order.id
                                ].map(
                                  (change) => (
                                    <span
                                      key={
                                        `${change.itemId}-` +
                                        `${change.type}`
                                      }
                                      className={`
                                        change-status
                                        ${change.type}
                                      `}
                                      title={
                                        `${change.product_code}: ` +
                                        `${change.product_name}`
                                      }
                                    >
                                      <strong>
                                        {
                                          change.label
                                        }
                                      </strong>

                                      <small>
                                        {
                                          change.product_code
                                        }
                                      </small>
                                    </span>
                                  )
                                )}
                              </div>
                            ) : (
                              <span
                                className={`
                                  pack-status
                                  ${getPackagingClass(
                                    order.items
                                  )}
                                `}
                              >
                                {getPackagingStatus(
                                  order.items
                                )}
                              </span>
                            )}
                          </td>
                        </tr>

                        {isOpen && (
                          <tr
                            className={`
                              detail
                              ${orderType}
                            `}
                          >
                            <td colSpan="3">
                              <div className="item-container">
                                <table className="item-table">
                                  <thead>
                                    <tr>
                                      <th>
                                        Code
                                      </th>

                                      <th>
                                        Description
                                      </th>

                                      <th>
                                        Quantity
                                      </th>

                                      <th>
                                        Status
                                      </th>
                                    </tr>
                                  </thead>

                                  <tbody>
                                    {order.items
                                      .length ===
                                    0 ? (
                                      <tr>
                                        <td
                                          colSpan="4"
                                          className="empty-items"
                                        >
                                          No items found
                                        </td>
                                      </tr>
                                    ) : (
                                      order.items.map(
                                        (
                                          item,
                                          itemIndex
                                        ) => (
                                          <tr
                                            key={
                                              item.storageKey
                                            }
                                          >
                                            <td className="product-code">
                                              {
                                                item.product_code
                                              }
                                            </td>

                                            <td className="product-description">
                                              {
                                                item.product_name
                                              }
                                            </td>

                                            <td className="quantity-cell">
                                              {
                                                item.quantity
                                              }
                                            </td>

                                            <td className="pack-button-cell">
                                              <button
                                                type="button"
                                                className={
                                                  item.packaged
                                                    ? "packed"
                                                    : "not-packed"
                                                }
                                                onClick={(
                                                  event
                                                ) => {
                                                  event.stopPropagation();

                                                  updateItem(
                                                    order.id,
                                                    itemIndex
                                                  );
                                                }}
                                              >
                                                {item.packaged
                                                  ? "✓ Packed"
                                                  : "Pack"}
                                              </button>
                                            </td>
                                          </tr>
                                        )
                                      )
                                    )}
                                  </tbody>
                                </table>
                              </div>
                            </td>
                          </tr>
                        )}

                        <tr className="order-spacer">
                          <td colSpan="3"></td>
                        </tr>
                      </Fragment>
                    );
                  }
                )
              )}
            </tbody>
          </table>
        </div>
      </section>
    );
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2>Packaging Queue</h2>

          <p className="page-description">
            Click an order to expand it.
            Drag an order to move it into
            another card.
          </p>
        </div>

        <div className="live-panel">
          <div className="live-line">
            <span className="live-dot"></span>

            <span>
              {loading
                ? "Connecting"
                : "Live"}
            </span>
          </div>

          <div className="last-updated">
            {lastUpdated
              ? `Updated ${lastUpdated.toLocaleTimeString()}`
              : "Waiting for data"}
          </div>
        </div>
      </div>

      <div className="card-grid">
        {orderSectionsWithOrders.map(
          renderOrderCard
        )}
      </div>
    </div>
  );
}

export default App;