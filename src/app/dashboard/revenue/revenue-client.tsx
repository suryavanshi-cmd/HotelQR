"use client";
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  X,
  Receipt,
  Clock,
  TrendingUp,
  Search,
  BarChart3,
  ChevronRight,
  UtensilsCrossed,
  IndianRupee,
  CalendarRange,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/client";
import type { Hotel, HotelSettings, Order, TableQR } from "@/types/database";
import { billNumber, computeBill, money, formatBillDate } from "@/lib/billing";
import { BillModal } from "../orders/bill-modal";

interface Props {
  hotel: Pick<Hotel, "id" | "name" | "address" | "phone">;
  settings: HotelSettings | null;
  initialOrders: Order[];
  initialTables: TableQR[];
}

// ── Time-period filtering ───────────────────────────────────
type Period = "today" | "week" | "month" | "quarter" | "all";

const PERIODS: { value: Period; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This Week" },
  { value: "month", label: "This Month" },
  { value: "quarter", label: "Last 3 Months" },
  { value: "all", label: "All Time" },
];

/** Start-of-period timestamp (local time). Returns 0 for "all". */
function periodStart(period: Period, now: Date): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  switch (period) {
    case "today":
      return d.getTime();
    case "week": {
      // Week starts Monday.
      const day = (d.getDay() + 6) % 7;
      d.setDate(d.getDate() - day);
      return d.getTime();
    }
    case "month":
      d.setDate(1);
      return d.getTime();
    case "quarter":
      d.setDate(d.getDate() - 90);
      return d.getTime();
    case "all":
      return 0;
  }
}

// ── Revenue trend buckets (single-series bar trend) ─────────
type Bucket = { label: string; value: number };

function buildTrend(orders: Order[], settings: HotelSettings | null, period: Period, now: Date): Bucket[] {
  const done = orders.filter((o) => o.status === "done");
  const revOf = (o: Order) => computeBill(o, settings).grandTotal;

  if (period === "today") {
    // Hourly buckets for the current day.
    const buckets: Bucket[] = Array.from({ length: 24 }, (_, h) => ({
      label: `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? "am" : "pm"}`,
      value: 0,
    }));
    const start = periodStart("today", now);
    for (const o of done) {
      const t = new Date(o.created_at);
      if (t.getTime() >= start) buckets[t.getHours()].value += revOf(o);
    }
    return buckets;
  }

  if (period === "all") {
    // Last 12 calendar months.
    const buckets: Bucket[] = [];
    const keys: string[] = [];
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      keys.push(`${d.getFullYear()}-${d.getMonth()}`);
      buckets.push({ label: d.toLocaleString("en-IN", { month: "short" }), value: 0 });
    }
    for (const o of done) {
      const t = new Date(o.created_at);
      const idx = keys.indexOf(`${t.getFullYear()}-${t.getMonth()}`);
      if (idx !== -1) buckets[idx].value += revOf(o);
    }
    return buckets;
  }

  // Daily buckets from the period start until today.
  const start = new Date(periodStart(period, now));
  const days = Math.max(1, Math.round((now.getTime() - start.getTime()) / 86_400_000) + 1);
  const buckets: Bucket[] = [];
  const keys: string[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    keys.push(d.toDateString());
    buckets.push({
      label: d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }),
      value: 0,
    });
  }
  for (const o of done) {
    const idx = keys.indexOf(new Date(o.created_at).toDateString());
    if (idx !== -1) buckets[idx].value += revOf(o);
  }
  return buckets;
}

/** Single-series bar trend — brand hue, thin rounded bars, native hover tooltips. */
function RevenueTrend({ buckets, currency }: { buckets: Bucket[]; currency?: string | null }) {
  const max = Math.max(...buckets.map((b) => b.value), 0);
  if (max === 0) {
    return (
      <div className="h-32 flex items-center justify-center">
        <p className="text-xs text-neutral-400">No completed orders in this period yet.</p>
      </div>
    );
  }
  // Show at most ~8 x-tick labels so they never collide.
  const tickEvery = Math.max(1, Math.ceil(buckets.length / 8));
  return (
    <div>
      <div className="flex items-end gap-[3px] h-32">
        {buckets.map((b, i) => {
          const h = b.value > 0 ? Math.max(4, (b.value / max) * 100) : 0;
          return (
            <div
              key={i}
              className="flex-1 flex flex-col justify-end h-full group cursor-default"
              title={`${b.label}: ${money(b.value, currency)}`}
            >
              <div
                className="w-full rounded-t-[4px] transition-colors"
                style={{
                  height: `${h}%`,
                  minHeight: b.value > 0 ? 4 : 2,
                  backgroundColor: b.value > 0 ? "#F97316" : "#F3F4F6",
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="flex gap-[3px] mt-1.5">
        {buckets.map((b, i) => (
          <div key={i} className="flex-1 text-center">
            {i % tickEvery === 0 ? (
              <span className="text-[9px] text-neutral-400 whitespace-nowrap">{b.label}</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

// Table birds-eye view component for revenue dashboard
const TableRevenueIllustration = () => {
  return (
    <div className="relative w-16 h-16 flex items-center justify-center mx-auto my-2">
      {/* Chairs around the table */}
      <div className="absolute top-0 w-5 h-2 rounded-t-md bg-neutral-300" />
      <div className="absolute bottom-0 w-5 h-2 rounded-b-md bg-neutral-300" />
      <div className="absolute left-0 w-2 h-5 rounded-l-md bg-neutral-300" />
      <div className="absolute right-0 w-2 h-5 rounded-r-md bg-neutral-300" />

      {/* Central Table */}
      <div className="w-10 h-10 rounded-full flex items-center justify-center z-10 border-2 bg-white border-neutral-300 shadow-sm">
        <TrendingUp className="text-neutral-400" size={14} />
      </div>
    </div>
  );
};

type HistoryStatus = "all" | "done" | "active" | "cancelled";
const HISTORY_PAGE = 20;

export function RevenueClient({ hotel, settings, initialOrders, initialTables }: Props) {
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [tables, setTables] = useState<TableQR[]>(initialTables);
  const [selectedTable, setSelectedTable] = useState<TableQR | null>(null);
  const [billOrder, setBillOrder] = useState<Order | null>(null);

  const [period, setPeriod] = useState<Period>("today");
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyStatus, setHistoryStatus] = useState<HistoryStatus>("all");
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);

  const supabase = createClient();

  const refetchOrders = useCallback(() => {
    supabase
      .from("orders")
      .select("*")
      .eq("hotel_id", hotel.id)
      .order("created_at", { ascending: false })
      .limit(1000)
      .then(({ data }) => {
        if (data) setOrders(data as Order[]);
      });
  }, [hotel.id, supabase]);

  // Listen to postgres updates to orders to keep history fresh
  useEffect(() => {
    const channel = supabase
      .channel(`revenue-history-${hotel.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "orders", filter: `hotel_id=eq.${hotel.id}` },
        refetchOrders
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [hotel.id, supabase, refetchOrders]);

  // Period boundary — recomputed when the filter changes.
  const now = useMemo(() => new Date(), []);
  const startTs = useMemo(() => periodStart(period, now), [period, now]);

  // Orders inside the selected period (all statuses).
  const periodOrders = useMemo(() => {
    if (period === "all") return orders;
    return orders.filter((o) => new Date(o.created_at).getTime() >= startTs);
  }, [orders, period, startTs]);

  // Overall restaurant-wide aggregates for the period
  const statsSummary = useMemo(() => {
    const completed = periodOrders.filter((o) => o.status === "done");
    const totalRev = completed.reduce((sum, o) => sum + computeBill(o, settings).grandTotal, 0);
    const avgTicket = completed.length > 0 ? totalRev / completed.length : 0;

    return {
      revenue: totalRev,
      ordersCount: completed.length,
      avgTicketSize: avgTicket,
    };
  }, [periodOrders, settings]);

  const trendBuckets = useMemo(
    () => buildTrend(periodOrders, settings, period, now),
    [periodOrders, settings, period, now]
  );

  // Aggregate stats per table (respects the period filter)
  const tableDataList = useMemo(() => {
    return tables.map((t) => {
      const tableOrders = periodOrders.filter((o) => o.table_number === t.table_number);
      const completed = tableOrders.filter((o) => o.status === "done");
      const rev = completed.reduce((sum, o) => sum + computeBill(o, settings).grandTotal, 0);

      return {
        table: t,
        ordersCount: completed.length,
        revenue: rev,
        allOrders: tableOrders,
      };
    });
  }, [tables, periodOrders, settings]);

  // Active table detail view
  const selectedTableInfo = useMemo(() => {
    if (!selectedTable) return null;
    return tableDataList.find((td) => td.table.id === selectedTable.id);
  }, [selectedTable, tableDataList]);

  // Full order history (period + search + status filters), newest first.
  const historyOrders = useMemo(() => {
    const q = historyQuery.trim().toLowerCase();
    return periodOrders.filter((o) => {
      if (historyStatus === "done" && o.status !== "done") return false;
      if (historyStatus === "cancelled" && o.status !== "cancelled") return false;
      if (historyStatus === "active" && o.status !== "new" && o.status !== "preparing") return false;
      if (!q) return true;
      const bill = billNumber(o).toLowerCase();
      const table = (o.table_number ?? "").toLowerCase();
      const itemNames = (o.items ?? []).map((i) => i.name.toLowerCase()).join(" ");
      return bill.includes(q) || table.includes(q) || itemNames.includes(q);
    });
  }, [periodOrders, historyQuery, historyStatus]);

  const visibleHistory = historyOrders.slice(0, historyLimit);

  // Reset pagination when filters change.
  useEffect(() => {
    setHistoryLimit(HISTORY_PAGE);
  }, [period, historyQuery, historyStatus]);

  function handleMobileSaved(orderId: string, mobile: string) {
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, customer_mobile: mobile || null } : o)));
    setBillOrder((prev) => (prev && prev.id === orderId ? { ...prev, customer_mobile: mobile || null } : prev));
  }

  return (
    <div className="px-4 md:px-8 py-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">Revenue & History</h1>
          <p className="text-sm text-neutral-500">Track restaurant performance and previous table orders.</p>
        </div>
      </div>

      {/* Period filter */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <CalendarRange size={16} className="text-neutral-400 shrink-0" />
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all border shadow-sm ${
              period === p.value
                ? "bg-neutral-900 text-white border-neutral-900"
                : "bg-white text-neutral-600 border-neutral-200 hover:border-neutral-900"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Aggregate Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card padding="md" className="flex items-center gap-4 bg-white border border-neutral-200 shadow-sm">
          <div className="p-3 rounded-2xl bg-amber-50 text-amber-600">
            <IndianRupee size={24} />
          </div>
          <div>
            <p className="text-xs text-neutral-400 font-semibold uppercase tracking-wider">Revenue</p>
            <p className="text-xl font-bold text-neutral-900">
              {money(statsSummary.revenue, settings?.currency)}
            </p>
          </div>
        </Card>

        <Card padding="md" className="flex items-center gap-4 bg-white border border-neutral-200 shadow-sm">
          <div className="p-3 rounded-2xl bg-emerald-50 text-emerald-600">
            <Receipt size={24} />
          </div>
          <div>
            <p className="text-xs text-neutral-400 font-semibold uppercase tracking-wider">Completed Orders</p>
            <p className="text-xl font-bold text-neutral-900">{statsSummary.ordersCount}</p>
          </div>
        </Card>

        <Card padding="md" className="flex items-center gap-4 bg-white border border-neutral-200 shadow-sm">
          <div className="p-3 rounded-2xl bg-blue-50 text-blue-600">
            <BarChart3 size={24} />
          </div>
          <div>
            <p className="text-xs text-neutral-400 font-semibold uppercase tracking-wider">Avg Order Value</p>
            <p className="text-xl font-bold text-neutral-900">
              {money(statsSummary.avgTicketSize, settings?.currency)}
            </p>
          </div>
        </Card>
      </div>

      {/* Revenue trend */}
      <Card padding="md" className="bg-white border border-neutral-200 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-neutral-800 flex items-center gap-2">
            <TrendingUp size={15} className="text-neutral-400" />
            Revenue Trend · {PERIODS.find((p) => p.value === period)?.label}
          </h2>
        </div>
        <RevenueTrend buckets={trendBuckets} currency={settings?.currency} />
      </Card>

      {/* Floor Plan Visualizer */}
      <div>
        <h2 className="text-base font-bold text-neutral-800 mb-4 flex items-center gap-2">
          <UtensilsCrossed size={16} /> Table Performance (Select any table)
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-5">
          {tableDataList.map(({ table, ordersCount, revenue }) => {
            return (
              <motion.div
                key={table.id}
                whileHover={{ scale: 1.02 }}
                onClick={() => setSelectedTable(table)}
                className="bg-white border border-neutral-200 hover:border-neutral-900 rounded-3xl p-4 flex flex-col justify-between h-44 cursor-pointer transition-all shadow-sm hover:shadow-md"
              >
                {/* Table Number */}
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-neutral-800 bg-neutral-100 px-2.5 py-1 rounded-full">
                    {table.table_number}
                  </span>
                  <Badge variant="gray" className="text-[10px] px-2 py-0.5 font-bold">
                    {ordersCount} {ordersCount === 1 ? "order" : "orders"}
                  </Badge>
                </div>

                {/* Table graphic */}
                <TableRevenueIllustration />

                {/* Foot stats */}
                <div className="text-center mt-1">
                  <p className="text-[10px] text-neutral-400 uppercase tracking-wider font-semibold">Revenue</p>
                  <p className="text-sm font-extrabold text-neutral-900 mt-0.5">
                    {money(revenue, settings?.currency)}
                  </p>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>

      {/* Full Order History */}
      <div>
        <h2 className="text-base font-bold text-neutral-800 mb-4 flex items-center gap-2">
          <Receipt size={16} /> Order History
          <span className="text-xs font-semibold text-neutral-400">({historyOrders.length})</span>
        </h2>

        {/* Search + status filters */}
        <div className="flex flex-col md:flex-row gap-3 mb-4">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input
              value={historyQuery}
              onChange={(e) => setHistoryQuery(e.target.value)}
              placeholder="Search by bill no, table or dish..."
              className="w-full bg-white border border-neutral-200 rounded-2xl pl-9 pr-4 py-2.5 text-sm text-neutral-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition-all shadow-sm"
            />
          </div>
          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {([
              { value: "all", label: "All" },
              { value: "done", label: "Completed" },
              { value: "active", label: "Active" },
              { value: "cancelled", label: "Cancelled" },
            ] as { value: HistoryStatus; label: string }[]).map((f) => (
              <button
                key={f.value}
                onClick={() => setHistoryStatus(f.value)}
                className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-all border shadow-sm ${
                  historyStatus === f.value
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "bg-white text-neutral-600 border-neutral-200 hover:border-neutral-900"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {visibleHistory.length === 0 ? (
          <div className="bg-white border border-neutral-100 rounded-3xl p-12 text-center shadow-sm">
            <div className="w-12 h-12 bg-neutral-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <Receipt className="text-neutral-400" size={24} />
            </div>
            <h3 className="text-sm font-semibold text-neutral-800">No orders found</h3>
            <p className="text-xs text-neutral-500 mt-1">Try a different period, search or status filter.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {visibleHistory.map((order) => {
                const breakdown = computeBill(order, settings);
                const isCancelled = order.status === "cancelled";
                return (
                  <div
                    key={order.id}
                    onClick={() => {
                      if (!isCancelled) setBillOrder(order);
                    }}
                    className={`bg-white border rounded-3xl p-4 shadow-sm transition-all flex flex-col ${
                      isCancelled
                        ? "border-neutral-100 opacity-60 cursor-not-allowed select-none"
                        : "border-neutral-200 hover:border-neutral-400 cursor-pointer"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-neutral-800">#{billNumber(order)}</span>
                        {order.table_number && (
                          <span className="text-[10px] font-bold text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-full">
                            Table {order.table_number}
                          </span>
                        )}
                        <Badge
                          variant={
                            order.status === "done" ? "green" : isCancelled ? "red" : "orange"
                          }
                          className="text-[9px] px-1.5 py-0"
                        >
                          {order.status}
                        </Badge>
                      </div>
                      <span className="text-[10px] text-neutral-400 flex items-center gap-1 shrink-0">
                        <Clock size={10} />
                        {formatBillDate(order.created_at)}
                      </span>
                    </div>

                    <div className="text-xs text-neutral-500 my-2.5 leading-normal line-clamp-2">
                      {(order.items ?? []).map((i) => `${i.name} × ${i.qty}`).join(" · ")}
                    </div>

                    <div className="flex items-center justify-between pt-2 mt-auto border-t border-dashed border-neutral-100">
                      <span className="text-xs text-neutral-500 font-semibold">Grand Total:</span>
                      <span className="text-sm font-extrabold text-neutral-900">
                        {money(breakdown.grandTotal, settings?.currency)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            {historyOrders.length > historyLimit && (
              <div className="flex justify-center mt-4">
                <button
                  onClick={() => setHistoryLimit((n) => n + HISTORY_PAGE)}
                  className="px-5 py-2.5 rounded-full text-xs font-semibold bg-white text-neutral-700 border border-neutral-200 hover:border-neutral-900 transition-all shadow-sm"
                >
                  Load more ({historyOrders.length - historyLimit} remaining)
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Side History Drawer */}
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
              {/* Header */}
              <div className="px-5 py-4 bg-neutral-900 text-white flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold flex items-center gap-2">
                    <span className="bg-amber-500 text-neutral-900 text-xs px-2.5 py-1 rounded-full font-extrabold">
                      {selectedTableInfo.table.table_number}
                    </span>
                    History Logs
                  </h2>
                  <p className="text-[10px] text-neutral-400 mt-1 uppercase tracking-wide font-semibold">
                    {PERIODS.find((p) => p.value === period)?.label} transactions
                  </p>
                </div>
                <button
                  onClick={() => setSelectedTable(null)}
                  className="p-1 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Drawer Body */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* Stats Summary Card for Table */}
                <div className="grid grid-cols-2 gap-3 bg-white border border-neutral-200 rounded-3xl p-4 shadow-sm">
                  <div>
                    <p className="text-[10px] text-neutral-400 uppercase tracking-wider font-semibold">Orders</p>
                    <p className="text-base font-extrabold text-neutral-800 mt-0.5">
                      {selectedTableInfo.ordersCount} Completed
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] text-neutral-400 uppercase tracking-wider font-semibold">Revenue</p>
                    <p className="text-base font-extrabold text-neutral-800 mt-0.5">
                      {money(selectedTableInfo.revenue, settings?.currency)}
                    </p>
                  </div>
                </div>

                {/* Orders history list */}
                <div className="space-y-3">
                  <p className="text-xs font-bold text-neutral-800 uppercase tracking-wider px-1">Past Transactions</p>

                  {selectedTableInfo.allOrders.length === 0 ? (
                    <div className="text-center py-8 bg-white border border-neutral-200 rounded-3xl">
                      <p className="text-xs text-neutral-400">No transactions in this period.</p>
                    </div>
                  ) : (
                    selectedTableInfo.allOrders.map((order) => {
                      const breakdown = computeBill(order, settings);
                      const isCompleted = order.status === "done";
                      const isCancelled = order.status === "cancelled";

                      return (
                        <div
                          key={order.id}
                          onClick={() => {
                            if (!isCancelled) setBillOrder(order);
                          }}
                          className={`bg-white border rounded-3xl p-4 shadow-sm transition-all flex flex-col justify-between ${
                            isCancelled
                              ? "border-neutral-100 opacity-60 cursor-not-allowed select-none"
                              : "border-neutral-200 hover:border-neutral-400 cursor-pointer"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-neutral-800">
                                #{order.id.slice(-6).toUpperCase()}
                              </span>
                              <Badge
                                variant={
                                  isCompleted ? "green" : isCancelled ? "red" : "orange"
                                }
                                className="text-[9px] px-1.5 py-0"
                              >
                                {order.status}
                              </Badge>
                            </div>
                            <span className="text-[10px] text-neutral-400 flex items-center gap-1">
                              <Clock size={10} />
                              {formatBillDate(order.created_at)}
                            </span>
                          </div>

                          <div className="text-xs text-neutral-500 my-2.5 leading-normal">
                            {(order.items ?? []).map((i) => `${i.name} × ${i.qty}`).join(" · ")}
                          </div>

                          <div className="flex items-center justify-between pt-2 border-t border-dashed border-neutral-100">
                            <span className="text-xs text-neutral-500 font-semibold">Grand Total:</span>
                            <span className="text-sm font-extrabold text-neutral-900">
                              {money(breakdown.grandTotal, settings?.currency)}
                            </span>
                          </div>

                          {!isCancelled && (
                            <div className="mt-3 flex items-center text-[11px] text-amber-600 font-bold justify-end gap-1">
                              Invoice options <ChevronRight size={12} />
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Bill Print/Share overlay */}
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
