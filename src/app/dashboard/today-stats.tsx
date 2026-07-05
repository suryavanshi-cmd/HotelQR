"use client";
import { useState, useEffect, useMemo } from "react";
import Link from "next/link";
import { ArrowRight, Flame } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { computeBill, money } from "@/lib/billing";
import type { HotelSettings, Order } from "@/types/database";

interface Props {
  hotelId: string;
  settings: Pick<HotelSettings, "gst_enabled" | "gst_percent" | "currency"> | null;
  initialOrders: Order[];
}

/**
 * Live "today at a glance" strip for the dashboard home. Subscribes to order
 * INSERT/UPDATE so a customer placing an order (or the kitchen completing one)
 * reflects here instantly — no refresh needed.
 */
export function TodayStats({ hotelId, settings, initialOrders }: Props) {
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const supabase = createClient();

  useEffect(() => {
    const channel = supabase
      .channel(`today-stats-${hotelId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders", filter: `hotel_id=eq.${hotelId}` },
        (payload) => {
          const order = payload.new as Order;
          setOrders((prev) => (prev.some((o) => o.id === order.id) ? prev : [order, ...prev]));
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders", filter: `hotel_id=eq.${hotelId}` },
        (payload) => {
          const updated = payload.new as Order;
          setOrders((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)));
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [hotelId, supabase]);

  const stats = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const today = orders.filter((o) => new Date(o.created_at).getTime() >= startOfDay.getTime());
    const completed = today.filter((o) => o.status === "done");
    const active = today.filter((o) => o.status === "new" || o.status === "preparing");
    const revenue = completed.reduce((sum, o) => sum + computeBill(o, settings).grandTotal, 0);
    return { revenue, ordersToday: today.length, completed: completed.length, active: active.length };
  }, [orders, settings]);

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-3xl p-5 mt-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-[#0F0E17] flex items-center gap-2">
          <Flame size={15} className="text-[#F97316]" />
          Today, live
        </h2>
        <Link
          href="/dashboard/revenue"
          className="text-xs font-semibold text-[#F97316] flex items-center gap-1 hover:underline"
        >
          Revenue & History <ArrowRight size={12} />
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div>
          <p className="text-[10px] font-medium text-[#6B7280] uppercase tracking-widest">Revenue</p>
          <p className="text-2xl font-bold text-[#1C1C2E] mt-1 tabular-nums">
            {money(stats.revenue, settings?.currency)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium text-[#6B7280] uppercase tracking-widest">Orders</p>
          <p className="text-2xl font-bold text-[#1C1C2E] mt-1 tabular-nums">{stats.ordersToday}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium text-[#6B7280] uppercase tracking-widest">Completed</p>
          <p className="text-2xl font-bold text-[#10B981] mt-1 tabular-nums">{stats.completed}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium text-[#6B7280] uppercase tracking-widest">Active now</p>
          <p className="text-2xl font-bold text-[#F97316] mt-1 tabular-nums">{stats.active}</p>
        </div>
      </div>
    </div>
  );
}
