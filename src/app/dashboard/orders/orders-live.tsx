"use client";
import { useState, useEffect, useMemo } from "react";
import { 
  Bell, 
  Search, 
  Receipt, 
  X, 
  Plus, 
  Minus, 
  Trash2, 
  Clock, 
  DollarSign,
  Utensils,
  SearchCode,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import type { Hotel, HotelSettings, Order, TableQR, MenuItem, OrderItem, WaiterCall } from "@/types/database";
import { billNumber, computeBill, money, formatBillDate } from "@/lib/billing";
import { BillModal } from "./bill-modal";

interface Props {
  hotel: Pick<Hotel, "id" | "name" | "address" | "phone">;
  settings: HotelSettings | null;
  initialOrders: Order[];
  initialTables: TableQR[];
  menuItems: MenuItem[];
}

function playBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
  } catch {
    // audio not available
  }
}

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// Table birds-eye view component
const TableIllustration = ({ status }: { status: "empty" | "occupied" }) => {
  const isOccupied = status === "occupied";
  return (
    <div className="relative w-20 h-20 flex items-center justify-center mx-auto my-2">
      {/* Chairs around the table */}
      <div className={`absolute top-0 w-6 h-2.5 rounded-t-md transition-colors duration-300 ${isOccupied ? "bg-amber-500" : "bg-neutral-200"}`} />
      <div className={`absolute bottom-0 w-6 h-2.5 rounded-b-md transition-colors duration-300 ${isOccupied ? "bg-amber-500" : "bg-neutral-200"}`} />
      <div className={`absolute left-0 w-2.5 h-6 rounded-l-md transition-colors duration-300 ${isOccupied ? "bg-amber-500" : "bg-neutral-200"}`} />
      <div className={`absolute right-0 w-2.5 h-6 rounded-r-md transition-colors duration-300 ${isOccupied ? "bg-amber-500" : "bg-neutral-200"}`} />

      {/* Central Table */}
      <div
        className={`w-11 h-11 rounded-full flex items-center justify-center z-10 transition-all duration-300 border-2 ${
          isOccupied
            ? "bg-amber-50 border-amber-500 shadow-md scale-105"
            : "bg-white border-neutral-300 border-dashed"
        }`}
      >
        {isOccupied ? (
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
          </span>
        ) : (
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
        )}
      </div>
    </div>
  );
};

export function OrdersLive({ hotel, settings, initialOrders, initialTables, menuItems }: Props) {
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [tables, setTables] = useState<TableQR[]>(initialTables);
  const [waiterCalls, setWaiterCalls] = useState<WaiterCall[]>([]);
  const [selectedTable, setSelectedTable] = useState<TableQR | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "empty" | "occupied">("all");
  const [billOrder, setBillOrder] = useState<Order | null>(null);

  // Search and selector inside the active drawer
  const [itemSearchQuery, setItemSearchQuery] = useState("");
  
  // Last completed order cache for the selected table
  const [lastCompletedOrder, setLastCompletedOrder] = useState<Order | null>(null);
  const [loadingLastCompleted, setLoadingLastCompleted] = useState(false);

  const supabase = createClient();

  // Load any waiter calls that were already pending before this page opened —
  // the realtime listener below only catches NEW ones.
  useEffect(() => {
    supabase
      .from("waiter_calls")
      .select("*")
      .eq("hotel_id", hotel.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (data && data.length > 0) setWaiterCalls(data as WaiterCall[]);
      });
  }, [hotel.id, supabase]);

  // Setup real-time listeners for orders and waiter calls
  useEffect(() => {
    const channel = supabase
      .channel(`orders-live-${hotel.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders", filter: `hotel_id=eq.${hotel.id}` },
        (payload) => {
          const order = payload.new as Order;
          setOrders((prev) => [order, ...prev]);
          playBeep();
          toast.success(`New order from Table ${order.table_number ?? "?"}! 🛎️`);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `hotel_id=eq.${hotel.id}` },
        (payload) => {
          const updated = payload.new as Order;
          setOrders((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)));
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "waiter_calls", filter: `hotel_id=eq.${hotel.id}` },
        (payload) => {
          setWaiterCalls((prev) => [payload.new as WaiterCall, ...prev]);
          playBeep();
          toast.info(`Table ${payload.new.table_number ?? "?"} is calling a waiter! 🛎️`);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [hotel.id, supabase]);

  // Fetch tables dynamically in case they get created/deleted
  useEffect(() => {
    const channel = supabase
      .channel(`tables-live-${hotel.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tables", filter: `hotel_id=eq.${hotel.id}` },
        () => {
          supabase
            .from("tables")
            .select("*")
            .eq("hotel_id", hotel.id)
            .order("created_at")
            .then(({ data }) => {
              if (data) setTables(data);
            });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [hotel.id, supabase]);

  // Derive status and details for each table in real-time
  const tableDataList = useMemo(() => {
    return tables.map((t) => {
      // Find any order belonging to this table that is active (new or preparing)
      const activeOrdersForTable = orders.filter(
        (o) =>
          o.table_number === t.table_number &&
          (o.status === "new" || o.status === "preparing")
      );
      
      const isOccupied = activeOrdersForTable.length > 0;
      const primaryOrder = isOccupied ? activeOrdersForTable[0] : null;
      // Card total covers ALL active orders on the table (e.g. staff-created +
      // customer-created), so the floor map never under-reports a table.
      const billTotal = activeOrdersForTable.reduce(
        (sum, o) => sum + computeBill(o, settings).grandTotal,
        0
      );

      return {
        table: t,
        isOccupied,
        activeOrder: primaryOrder,
        activeCount: activeOrdersForTable.length,
        billTotal,
        orderTime: primaryOrder ? primaryOrder.created_at : null,
      };
    });
  }, [tables, orders, settings]);

  // Fetch last completed order for the selected table when the drawer opens
  useEffect(() => {
    if (!selectedTable) {
      setLastCompletedOrder(null);
      return;
    }

    const tableNum = selectedTable.table_number;

    async function fetchLastCompleted() {
      setLoadingLastCompleted(true);
      const { data, error } = await supabase
        .from("orders")
        .select("*")
        .eq("hotel_id", hotel.id)
        .eq("table_number", tableNum)
        .eq("status", "done")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      setLoadingLastCompleted(false);
      if (!error && data) {
        setLastCompletedOrder(data as Order);
      } else {
        setLastCompletedOrder(null);
      }
    }

    fetchLastCompleted();
  }, [selectedTable, hotel.id, orders, supabase]);

  // Sync item updates instantly with Supabase (Optimistic Updates)
  async function updateOrderItems(orderId: string, updatedItems: OrderItem[]) {
    const newTotal = updatedItems.reduce((sum, item) => sum + item.price * item.qty, 0);

    // Save previous state for rollback if error
    const previousOrders = [...orders];

    // Optimistically update state
    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId ? { ...o, items: updatedItems, total: newTotal } : o
      )
    );

    const { error } = await supabase
      .from("orders")
      .update({ items: updatedItems, total: newTotal })
      .eq("id", orderId);

    if (error) {
      toast.error("Failed to update order items");
      setOrders(previousOrders);
    } else {
      toast.success("Order updated successfully");
    }
  }

  // Update quantity of an item
  function handleUpdateQty(order: Order, item_id: string, delta: number) {
    const updated = (order.items ?? [])
      .map((item) => {
        if (item.item_id === item_id) {
          const nextQty = item.qty + delta;
          return { ...item, qty: nextQty };
        }
        return item;
      })
      .filter((item) => item.qty > 0);

    updateOrderItems(order.id, updated);
  }

  // Remove an item
  function handleRemoveItem(order: Order, item_id: string) {
    const updated = (order.items ?? []).filter((item) => item.item_id !== item_id);
    updateOrderItems(order.id, updated);
  }

  // Add item from menu selection
  function handleAddItem(order: Order, menuItem: MenuItem) {
    const existing = (order.items ?? []).find((i) => i.item_id === menuItem.id);
    let updated: OrderItem[] = [];

    if (existing) {
      updated = (order.items ?? []).map((item) =>
        item.item_id === menuItem.id ? { ...item, qty: item.qty + 1 } : item
      );
    } else {
      updated = [
        ...(order.items ?? []),
        {
          item_id: menuItem.id,
          name: menuItem.name,
          price: menuItem.price,
          qty: 1,
        },
      ];
    }

    updateOrderItems(order.id, updated);
    setItemSearchQuery("");
  }

  // Acknowledge/dismiss waiter calls
  async function acknowledgeWaiter(callId: string) {
    await supabase.from("waiter_calls").update({ status: "acknowledged" }).eq("id", callId);
    setWaiterCalls((prev) => prev.filter((c) => c.id !== callId));
  }

  // Update workflow status of active order
  async function updateStatus(orderId: string, status: Order["status"]) {
    // If setting to done, mark table empty by changing order to "done"
    const { error } = await supabase.from("orders").update({ status }).eq("id", orderId);
    
    if (error) {
      toast.error("Failed to update status");
      return;
    }

    setOrders((prev) =>
      prev.map((o) => (o.id === orderId ? { ...o, status } : o))
    );

    if (status === "done") {
      toast.success("Order completed! Table is now empty.");
      setSelectedTable(null);
    } else {
      toast.success(`Order status updated to ${status}`);
    }
  }

  function handleMobileSaved(orderId: string, mobile: string) {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, customer_mobile: mobile || null } : o)));
    setBillOrder((prev) => (prev && prev.id === orderId ? { ...prev, customer_mobile: mobile || null } : prev));
    // update cache if needed
    if (lastCompletedOrder && lastCompletedOrder.id === orderId) {
      setLastCompletedOrder(prev => prev ? { ...prev, customer_mobile: mobile || null } : null);
    }
  }

  // Filter tables list based on search query and status filter
  const filteredTableData = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tableDataList.filter((td) => {
      const matchSearch = td.table.table_number.toLowerCase().includes(q);
      const matchStatus =
        statusFilter === "all" ||
        (statusFilter === "empty" && !td.isOccupied) ||
        (statusFilter === "occupied" && td.isOccupied);

      return matchSearch && matchStatus;
    });
  }, [tableDataList, query, statusFilter]);

  // Filter menu items for Add Item search inside the drawer
  const filteredMenuItems = useMemo(() => {
    if (!itemSearchQuery.trim()) return [];
    const q = itemSearchQuery.toLowerCase();
    return menuItems.filter((item) => item.name.toLowerCase().includes(q));
  }, [menuItems, itemSearchQuery]);

  // Get active order details of currently selected table
  const selectedTableInfo = useMemo(() => {
    if (!selectedTable) return null;
    return tableDataList.find((td) => td.table.id === selectedTable.id);
  }, [selectedTable, tableDataList]);

  return (
    <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Restaurant Floor Map</h1>
          <p className="text-sm text-neutral-500">Live top-down table statuses and order coordinator.</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="green" className="px-3 py-1.5 text-xs font-semibold">
            {tableDataList.filter((t) => !t.isOccupied).length} Empty
          </Badge>
          <Badge variant="orange" className="px-3 py-1.5 text-xs font-semibold animate-pulse">
            {tableDataList.filter((t) => t.isOccupied).length} Occupied
          </Badge>
        </div>
      </div>

      {/* Search & Status Filters */}
      <div className="flex flex-col md:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by table number..."
            className="w-full bg-white border border-neutral-200 rounded-2xl pl-9 pr-4 py-2.5 text-sm text-neutral-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all shadow-sm"
          />
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {(["all", "occupied", "empty"] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={`px-4 py-2 rounded-full text-xs font-semibold capitalize whitespace-nowrap transition-all border shadow-sm ${
                statusFilter === filter
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white text-neutral-600 border-neutral-200 hover:border-neutral-900"
              }`}
            >
              {filter === "all" ? "All Tables" : `${filter} Tables`}
            </button>
          ))}
        </div>
      </div>

      {/* Waiter calls Banners */}
      {waiterCalls.length > 0 && (
        <div className="space-y-2.5 mb-6">
          {waiterCalls.map((call) => (
            <div
              key={call.id}
              className="bg-amber-50/70 border border-amber-200 rounded-2xl p-4 flex items-center justify-between shadow-sm animate-pulse"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-amber-100 text-amber-700">
                  <Bell size={18} />
                </div>
                <div>
                  <p className="text-sm font-bold text-neutral-900">
                    Table {call.table_number ?? "?"} requested a waiter
                  </p>
                  <p className="text-xs text-neutral-500">Acknowledge this call immediately</p>
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => acknowledgeWaiter(call.id)}
                className="bg-white border-neutral-200 hover:bg-neutral-50"
              >
                Acknowledge
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Floor Grid Map */}
      {filteredTableData.length === 0 ? (
        <div className="bg-white border border-neutral-100 rounded-3xl p-12 text-center shadow-sm">
          <div className="w-12 h-12 bg-neutral-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Utensils className="text-neutral-400" size={24} />
          </div>
          <h3 className="text-sm font-semibold text-neutral-800">No tables found</h3>
          <p className="text-xs text-neutral-500 mt-1">Try adjusting your filters or search query.</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
          {filteredTableData.map(({ table, isOccupied, activeOrder, activeCount, billTotal, orderTime }) => {
            return (
              <motion.div
                key={table.id}
                whileHover={isOccupied ? { scale: 1.02 } : {}}
                onClick={() => {
                  if (isOccupied) setSelectedTable(table);
                }}
                className={`bg-white border rounded-3xl p-4 flex flex-col justify-between h-48 transition-all ${
                  isOccupied
                    ? "cursor-pointer border-amber-200 shadow-md hover:shadow-lg ring-1 ring-amber-100/30"
                    : "opacity-60 border-neutral-200 bg-neutral-50/50 cursor-not-allowed select-none"
                }`}
              >
                {/* Header info */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-neutral-800 bg-neutral-100 px-2.5 py-1 rounded-full">
                    {table.table_number}
                  </span>
                  <Badge variant={isOccupied ? "orange" : "green"} className="text-[10px] px-2 py-0.5">
                    {isOccupied ? activeOrder?.status ?? "Occupied" : "Empty"}
                  </Badge>
                </div>

                {/* Table top illustration */}
                <TableIllustration status={isOccupied ? "occupied" : "empty"} />

                {/* Footer values */}
                <div className="mt-2 text-center">
                  {isOccupied && activeOrder ? (
                    <div>
                      <p className="text-sm font-extrabold text-neutral-900">
                        {money(billTotal, settings?.currency)}
                      </p>
                      <p className="text-[10px] text-neutral-400 mt-0.5 flex items-center justify-center gap-1">
                        <Clock size={10} />
                        {orderTime ? timeAgo(orderTime) : ""}
                        {activeCount > 1 && (
                          <span className="text-amber-600 font-bold">· {activeCount} orders</span>
                        )}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-neutral-400 font-medium">Ready</p>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Side Slide-Over Drawer */}
      <AnimatePresence>
        {selectedTableInfo && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.4 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedTable(null)}
              className="fixed inset-0 bg-black z-40"
            />

            {/* Slide Sheet */}
            <motion.aside
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 220 }}
              className="fixed right-0 top-0 bottom-0 w-full max-w-md bg-[#FAFAFA] border-l border-neutral-200 z-50 flex flex-col shadow-2xl overflow-hidden"
            >
              {/* Drawer Header */}
              <div className="px-5 py-4 bg-neutral-900 text-white flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold flex items-center gap-2">
                    <span className="bg-amber-500 text-neutral-900 text-xs px-2 py-1 rounded-full font-extrabold">
                      {selectedTableInfo.table.table_number}
                    </span>
                    Active Order
                  </h2>
                  {selectedTableInfo.orderTime && (
                    <p className="text-[10px] text-neutral-400 mt-1 flex items-center gap-1">
                      <Clock size={10} /> Ordered {timeAgo(selectedTableInfo.orderTime)}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setSelectedTable(null)}
                  className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Drawer Body Scroll */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Active Order Workflow Controls */}
                {selectedTableInfo.activeOrder && (
                  <div className="bg-white border border-neutral-200 rounded-3xl p-4 shadow-sm">
                    <p className="text-xs font-semibold text-neutral-500 mb-3">Order Status workflow</p>
                    <div className="grid grid-cols-3 gap-2">
                      {(["new", "preparing", "done"] as const).map((status) => {
                        const isCurrent = selectedTableInfo.activeOrder?.status === status;
                        const label = status === "new" ? "New" : status === "preparing" ? "Preparing" : "Done";
                        return (
                          <button
                            key={status}
                            onClick={() => updateStatus(selectedTableInfo.activeOrder!.id, status)}
                            className={`py-2 px-1 text-xs font-bold rounded-2xl border transition-all ${
                              isCurrent
                                ? status === "new"
                                  ? "bg-orange-50 border-orange-400 text-orange-700 shadow-sm"
                                  : status === "preparing"
                                  ? "bg-yellow-50 border-yellow-400 text-yellow-700 shadow-sm"
                                  : "bg-emerald-50 border-emerald-400 text-emerald-700 shadow-sm"
                                : "bg-neutral-50 border-neutral-200 text-neutral-600 hover:bg-neutral-100"
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Current Ordered Items List */}
                {selectedTableInfo.activeOrder && (
                  <div className="bg-white border border-neutral-200 rounded-3xl p-4 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-bold text-neutral-800 uppercase tracking-wider">Items in Order</p>
                      <Badge variant="gray" className="text-[10px]">
                        Bill #{billNumber(selectedTableInfo.activeOrder)}
                      </Badge>
                    </div>

                    {(selectedTableInfo.activeOrder.items ?? []).length === 0 ? (
                      <p className="text-xs text-neutral-400 text-center py-4">No items added to this order.</p>
                    ) : (
                      <div className="divide-y divide-neutral-100">
                        {(selectedTableInfo.activeOrder.items ?? []).map((item) => (
                          <div key={item.item_id} className="py-3 flex items-center justify-between">
                            <div className="flex-1 min-w-0 pr-2">
                              <p className="text-sm font-semibold text-neutral-800 truncate">{item.name}</p>
                              <p className="text-xs text-neutral-400">
                                {money(item.price, settings?.currency)} each
                              </p>
                            </div>
                            <div className="flex items-center gap-3">
                              {/* Quantity selectors */}
                              <div className="flex items-center border border-neutral-200 rounded-xl bg-neutral-50/50">
                                <button
                                  onClick={() => handleUpdateQty(selectedTableInfo.activeOrder!, item.item_id, -1)}
                                  className="p-1 hover:bg-neutral-100 rounded-l-xl text-neutral-600"
                                >
                                  <Minus size={12} />
                                </button>
                                <span className="px-2.5 text-xs font-extrabold text-neutral-800 min-w-[20px] text-center">
                                  {item.qty}
                                </span>
                                <button
                                  onClick={() => handleUpdateQty(selectedTableInfo.activeOrder!, item.item_id, 1)}
                                  className="p-1 hover:bg-neutral-100 rounded-r-xl text-neutral-600"
                                >
                                  <Plus size={12} />
                                </button>
                              </div>
                              <button
                                onClick={() => handleRemoveItem(selectedTableInfo.activeOrder!, item.item_id)}
                                className="text-neutral-400 hover:text-red-500 p-1.5 transition-colors"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Totals Breakdown */}
                    {selectedTableInfo.activeOrder && (
                      <div className="border-t border-dashed border-neutral-200 mt-3 pt-3 space-y-1.5">
                        {(() => {
                          const t = computeBill(selectedTableInfo.activeOrder, settings);
                          return (
                            <>
                              <div className="flex justify-between text-xs text-neutral-500">
                                <span>Subtotal</span>
                                <span>{money(t.subtotal, settings?.currency)}</span>
                              </div>
                              {t.gstEnabled && (
                                <div className="flex justify-between text-xs text-neutral-500">
                                  <span>GST ({t.gstPercent}%)</span>
                                  <span>{money(t.gstAmount, settings?.currency)}</span>
                                </div>
                              )}
                              <div className="flex justify-between text-sm font-extrabold text-neutral-900 pt-1.5 border-t border-neutral-100">
                                <span>Grand Total</span>
                                <span>{money(t.grandTotal, settings?.currency)}</span>
                              </div>
                            </>
                          );
                        })()}
                      </div>
                    )}

                    {/* Bill print & share toggle */}
                    {selectedTableInfo.activeOrder && (
                      <div className="mt-4 pt-1">
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Receipt size={14} />}
                          className="w-full text-xs font-bold border-neutral-200"
                          onClick={() => setBillOrder(selectedTableInfo.activeOrder)}
                        >
                          View Bill / Share Receipt
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* Add new item searching interface */}
                {selectedTableInfo.activeOrder && (
                  <div className="bg-white border border-neutral-200 rounded-3xl p-4 shadow-sm">
                    <p className="text-xs font-bold text-neutral-800 uppercase tracking-wider mb-2">Add Items to Order</p>
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                      <input
                        value={itemSearchQuery}
                        onChange={(e) => setItemSearchQuery(e.target.value)}
                        placeholder="Search menu e.g. Pasta, Salad..."
                        className="w-full bg-neutral-50 border border-neutral-200 rounded-2xl pl-8 pr-3 py-2 text-xs text-neutral-800 focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-transparent transition-all"
                      />
                    </div>

                    {filteredMenuItems.length > 0 && (
                      <div className="mt-2 max-h-48 overflow-y-auto border border-neutral-100 rounded-2xl bg-white divide-y divide-neutral-50 shadow-inner">
                        {filteredMenuItems.map((item) => (
                          <div
                            key={item.id}
                            onClick={() => handleAddItem(selectedTableInfo.activeOrder!, item)}
                            className="p-2.5 flex items-center justify-between cursor-pointer hover:bg-neutral-50 transition-colors"
                          >
                            <div>
                              <p className="text-xs font-semibold text-neutral-800">{item.name}</p>
                              <p className="text-[10px] text-neutral-400">
                                {money(item.price, settings?.currency)}
                              </p>
                            </div>
                            <span className="p-1 rounded-lg bg-amber-100 text-amber-700">
                              <Plus size={12} />
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {itemSearchQuery.trim() !== "" && filteredMenuItems.length === 0 && (
                      <p className="text-[11px] text-neutral-400 text-center py-3 mt-1 bg-neutral-50 rounded-2xl">
                        No matching menu items found.
                      </p>
                    )}
                  </div>
                )}

                {/* Last Completed Order Section */}
                <div className="bg-white border border-neutral-200 rounded-3xl p-4 shadow-sm">
                  <h3 className="text-xs font-bold text-neutral-800 uppercase tracking-wider mb-3">Last Completed Order</h3>
                  
                  {loadingLastCompleted ? (
                    <p className="text-xs text-neutral-400 text-center py-4">Loading past transaction...</p>
                  ) : lastCompletedOrder ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs text-neutral-500">
                        <span className="font-semibold text-neutral-800">Bill #{billNumber(lastCompletedOrder)}</span>
                        <span>{formatBillDate(lastCompletedOrder.created_at)}</span>
                      </div>
                      <div className="text-[11px] text-neutral-400 leading-normal border-t border-b border-neutral-100 py-2">
                        {(lastCompletedOrder.items ?? []).map((i) => `${i.name} × ${i.qty}`).join(" · ")}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-neutral-500 font-medium">Bill Total:</span>
                        <span className="text-sm font-bold text-neutral-900">
                          {money(computeBill(lastCompletedOrder, settings).grandTotal, settings?.currency)}
                        </span>
                      </div>
                      <div className="pt-1.5">
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Receipt size={12} />}
                          className="w-full text-xs font-bold border-neutral-200 bg-neutral-50/50 hover:bg-neutral-50"
                          onClick={() => setBillOrder(lastCompletedOrder)}
                        >
                          Invoice Details (Print / Share)
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-4 bg-neutral-50/50 rounded-2xl border border-neutral-100">
                      <p className="text-xs text-neutral-400">No completed orders found for Table {selectedTableInfo.table.table_number}.</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Bill Print/Share Modal Overlay */}
      {billOrder && (
        <BillModal
          order={billOrder}
          hotel={hotel}
          settings={settings}
          onClose={() => setBillOrder(null)}
          onMobileSaved={handleMobileSaved}
        />
      )}
    </div>
  );
}
