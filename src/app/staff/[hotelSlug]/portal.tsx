"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  Bell, Search, Plus, Minus, LogOut, UtensilsCrossed, ClipboardList,
  ConciergeBell, X, Loader2, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { EmptyState } from "@/components/ui/EmptyState";
import { VegIndicator } from "@/components/ui/VegIndicator";
import { createClient } from "@/lib/supabase/client";
import { money } from "@/lib/billing";
import { getStaffToken, clearStaffToken, staffMe } from "@/lib/staff/session";
import type { StaffSession } from "@/types/database";

type FoodType = "veg" | "non_veg" | "egg" | "vegan";
function safeFoodType(t: string): FoodType {
  return (["veg", "non_veg", "egg", "vegan"].includes(t) ? t : "veg") as FoodType;
}

// ── RPC payload shapes ──────────────────────────────────────
type MenuCategory = { id: string; name: string; sort_order: number };
type MenuItem = {
  id: string; category_id: string | null; name: string; description: string | null;
  price: number; image_url: string | null; food_type: string;
  is_available: boolean; is_special: boolean; badge: string | null; sort_order: number;
};
type OrderItem = { item_id: string; name: string; price: number; qty: number };
type ActiveOrder = {
  id: string; table_number: string | null; items: OrderItem[]; total: number;
  status: "new" | "preparing" | "done" | "cancelled"; notes: string | null;
  created_at: string; assigned_staff_id: string | null; assigned_staff_name: string | null;
};
type WaiterCall = { id: string; table_number: string | null; created_at: string; assigned_staff_id: string | null };

type Tab = "menu" | "orders" | "new" | "calls";

function playBeep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.25);
  } catch {
    /* no audio */
  }
}

function timeAgo(dateStr: string) {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function StaffPortal({ slug }: { slug: string }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const tokenRef = useRef<string | null>(null);

  const [staff, setStaff] = useState<StaffSession | null>(null);
  const [booting, setBooting] = useState(true);

  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [orders, setOrders] = useState<ActiveOrder[]>([]);
  const [calls, setCalls] = useState<WaiterCall[]>([]);

  const [tab, setTab] = useState<Tab>("orders");

  const role = (staff?.role ?? "").toLowerCase();
  const canCreateOrders = role !== "chef" && role !== "cleaner";

  const refetchToken = useCallback(() => tokenRef.current, []);

  const loadOrders = useCallback(async () => {
    const token = refetchToken();
    if (!token) return;
    const { data } = await supabase.rpc("staff_active_orders", { p_token: token });
    if (data) setOrders(data as ActiveOrder[]);
  }, [supabase, refetchToken]);

  const loadCalls = useCallback(async () => {
    const token = refetchToken();
    if (!token) return;
    const { data } = await supabase.rpc("staff_waiter_calls", { p_token: token });
    if (data) setCalls(data as WaiterCall[]);
  }, [supabase, refetchToken]);

  // Boot: validate token, load profile + menu + orders + calls.
  useEffect(() => {
    let active = true;
    (async () => {
      const token = getStaffToken(slug);
      if (!token) { router.replace(`/staff/${slug}/login`); return; }
      const me = await staffMe(token);
      if (!active) return;
      if (!me) { clearStaffToken(slug); router.replace(`/staff/${slug}/login`); return; }
      tokenRef.current = token;
      setStaff(me);

      const [menuRes] = await Promise.all([
        supabase.rpc("staff_menu", { p_token: token }),
        loadOrders(),
        loadCalls(),
      ]);
      if (!active) return;
      const menu = menuRes.data as { categories: MenuCategory[]; items: MenuItem[] } | null;
      if (menu) { setCategories(menu.categories ?? []); setItems(menu.items ?? []); }
      setBooting(false);
    })();
    return () => { active = false; };
  }, [slug, supabase, router, loadOrders, loadCalls]);

  // Realtime: hotel-scoped broadcast from the DB triggers (see migration 0012).
  useEffect(() => {
    if (!staff) return;
    const channel = supabase
      .channel(`staff:${staff.hotel_id}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "staff_event" }, (msg) => {
        const data = (msg.payload ?? {}) as { src?: string; table_number?: string | null };
        if (data.src === "waiter_calls") {
          loadCalls();
          playBeep();
          navigator.vibrate?.([200, 100, 200]);
          toast(`🔔 Table ${data.table_number ?? "?"} is calling`);
        } else if (data.src === "orders") {
          loadOrders();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [staff, supabase, loadOrders, loadCalls]);

  // Reliability + offline-pending: refetch when the tab regains focus + a slow poll.
  useEffect(() => {
    if (!staff) return;
    const onFocus = () => { loadOrders(); loadCalls(); };
    window.addEventListener("focus", onFocus);
    const id = setInterval(onFocus, 20000);
    return () => { window.removeEventListener("focus", onFocus); clearInterval(id); };
  }, [staff, loadOrders, loadCalls]);

  async function logout() {
    const token = tokenRef.current;
    if (token) await supabase.rpc("staff_logout", { p_token: token });
    clearStaffToken(slug);
    router.replace(`/staff/${slug}/login`);
  }

  async function ackCall(id: string) {
    const token = tokenRef.current;
    if (!token) return;
    setCalls((prev) => prev.filter((c) => c.id !== id));
    await supabase.rpc("staff_ack_waiter", { p_token: token, p_call_id: id });
  }

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFFAF3]">
        <Loader2 size={24} className="animate-spin text-[#F97316]" />
      </div>
    );
  }
  if (!staff) return null;

  return (
    <div className="min-h-screen bg-[#FFFAF3] flex flex-col">
      {/* Header */}
      <div className="sticky top-0 z-30 bg-[#1C1C2E] text-white px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-[#F97316] flex items-center justify-center shrink-0">
            <UtensilsCrossed size={16} className="text-white" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{staff.full_name}</p>
            <p className="text-[11px] text-white/60 truncate">
              {staff.staff_code} · {staff.role}
            </p>
          </div>
        </div>
        <button onClick={logout} className="text-white/70 hover:text-white flex items-center gap-1.5 text-sm min-h-0 min-w-0 p-1">
          <LogOut size={16} /> Logout
        </button>
      </div>

      {/* Waiter call banners (hidden on the Calls tab — it shows the full list) */}
      {tab !== "calls" && calls.length > 0 && (
        <div className="px-4 pt-3 space-y-2">
          {calls.map((c) => (
            <div key={c.id} className="bg-[#FEFCE8] border border-[#FEF08A] rounded-2xl p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <Bell size={16} className="text-[#D97706] shrink-0" />
                <p className="text-sm font-medium text-[#854D0E] truncate">
                  Table {c.table_number ?? "?"} needs you · {timeAgo(c.created_at)}
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => ackCall(c.id)}>Got it</Button>
            </div>
          ))}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 pb-20">
        {tab === "menu" && <MenuView categories={categories} items={items} />}
        {tab === "orders" && (
          <OrdersView
            orders={orders}
            staffId={staff.id}
            getToken={() => tokenRef.current}
            onChanged={loadOrders}
          />
        )}
        {tab === "new" && canCreateOrders && (
          <NewOrderView
            items={items}
            categories={categories}
            assignedTables={staff.assigned_tables}
            getToken={() => tokenRef.current}
            onPlaced={() => { loadOrders(); setTab("orders"); }}
          />
        )}
        {tab === "calls" && <CallsView calls={calls} onAck={ackCall} />}
      </div>

      {/* Bottom tab bar */}
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-[#E5E7EB] flex items-stretch h-[60px]">
        <TabButton active={tab === "orders"} onClick={() => setTab("orders")} icon={<ClipboardList size={20} />} label="Orders" badge={orders.length} />
        <TabButton active={tab === "menu"} onClick={() => setTab("menu")} icon={<UtensilsCrossed size={20} />} label="Menu" />
        {canCreateOrders && (
          <TabButton active={tab === "new"} onClick={() => setTab("new")} icon={<Plus size={20} />} label="New order" />
        )}
        <TabButton active={tab === "calls"} onClick={() => { setTab("calls"); loadCalls(); }} icon={<ConciergeBell size={20} />} label="Calls" badge={calls.length} />
      </nav>
    </div>
  );
}

function TabButton({
  active, onClick, icon, label, badge,
}: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; badge?: number }) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex-1 flex flex-col items-center justify-center gap-0.5 relative",
        active ? "text-[#F97316]" : "text-[#9CA3AF]",
      ].join(" ")}
    >
      <span className="relative">
        {icon}
        {badge != null && badge > 0 && (
          <span className="absolute -top-1.5 -right-2 bg-[#EF4444] text-white text-[9px] font-bold rounded-full min-w-[15px] h-[15px] px-0.5 flex items-center justify-center">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </span>
      <span className="text-[10px] font-medium">{label}</span>
    </button>
  );
}

// ── Shared item UI (mirrors the customer menu look) ─────────
type FoodFilter = "all" | "veg" | "non_veg";

function matchFilter(i: MenuItem, q: string, f: FoodFilter): boolean {
  if (q && !i.name.toLowerCase().includes(q) && !(i.description ?? "").toLowerCase().includes(q)) return false;
  if (f === "veg") return i.food_type === "veg" || i.food_type === "vegan";
  if (f === "non_veg") return i.food_type === "non_veg";
  return true;
}

// Group items by category, with a trailing "Other items" bucket so NOTHING is
// ever hidden when an item's category is inactive or missing.
type ItemGroup = { id: string; name: string; list: MenuItem[] };
function groupItems(items: MenuItem[], categories: MenuCategory[]): ItemGroup[] {
  const order = new Map<string, number>();
  const groups: ItemGroup[] = categories.map((c, idx) => {
    order.set(c.id, idx);
    return { id: c.id, name: c.name, list: [] as MenuItem[] };
  });
  let other: ItemGroup | null = null;
  for (const it of items) {
    const gi = it.category_id != null ? order.get(it.category_id) : undefined;
    if (gi != null) groups[gi].list.push(it);
    else {
      if (!other) other = { id: "__other", name: "Other items", list: [] };
      other.list.push(it);
    }
  }
  const result = groups.filter((g) => g.list.length > 0);
  if (other) result.push(other);
  return result;
}

function SearchBar({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative mb-3">
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-white border border-[#E5E7EB] rounded-2xl pl-9 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent"
      />
    </div>
  );
}

function FoodFilterPills({ value, onChange }: { value: FoodFilter; onChange: (f: FoodFilter) => void }) {
  const opts: { v: FoodFilter; label: string; dot?: string }[] = [
    { v: "all", label: "All" },
    { v: "veg", label: "Veg", dot: "#10B981" },
    { v: "non_veg", label: "Non-Veg", dot: "#EF4444" },
  ];
  return (
    <div className="flex gap-2 mb-3">
      {opts.map((o) => (
        <button
          key={o.v}
          onClick={() => onChange(o.v)}
          className={[
            "px-3 py-1.5 rounded-full text-xs font-medium border flex items-center gap-1.5",
            value === o.v ? "bg-[#F97316] text-white border-transparent" : "bg-white text-[#6B7280] border-[#E5E7EB]",
          ].join(" ")}
        >
          {o.dot && <span className="w-2 h-2 rounded-full" style={{ backgroundColor: o.dot }} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CategoryHeader({ name, count }: { name: string; count: number }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="w-1 h-5 rounded-full bg-[#F97316]" />
      <span className="text-xs font-bold text-[#1C1C2E] uppercase tracking-[0.08em]">{name}</span>
      <div className="flex-1 h-px bg-[#E5E7EB]" />
      <span className="text-xs text-[#9CA3AF]">{count}</span>
    </div>
  );
}

function ItemImage({ item }: { item: MenuItem }) {
  if (item.image_url) {
    return (
      <Image src={item.image_url} alt={item.name} fill sizes="(max-width:480px) 45vw, 220px" className="object-cover" />
    );
  }
  return (
    <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: "#F9731614" }}>
      <span className="text-3xl opacity-50">🍽️</span>
    </div>
  );
}

// One card, used for both browsing (no actions) and order-taking (qty stepper).
function ItemCard({ item, qty, onAdd, onSub }: { item: MenuItem; qty?: number; onAdd?: () => void; onSub?: () => void }) {
  const orderMode = onAdd != null;
  const q = qty ?? 0;
  return (
    <div className="bg-white rounded-2xl border border-[#E5E7EB] shadow-sm overflow-hidden flex flex-col relative">
      <div className="relative w-full aspect-[4/3]">
        <ItemImage item={item} />
        {item.badge && (
          <span className="absolute top-2 left-2 bg-[#F97316] text-white text-[10px] font-semibold px-2 py-0.5 rounded-full shadow">{item.badge}</span>
        )}
        {!item.is_available && (
          <span className="absolute inset-0 bg-white/55 flex items-center justify-center">
            <span className="bg-[#1C1C2E] text-white text-[10px] font-semibold px-2 py-0.5 rounded-full">Unavailable</span>
          </span>
        )}
        {orderMode && item.is_available && q === 0 && (
          <button onClick={onAdd} className="absolute bottom-2 right-2 w-8 h-8 rounded-full bg-[#F97316] text-white flex items-center justify-center shadow-md min-h-0 min-w-0" aria-label="Add">
            <Plus size={16} />
          </button>
        )}
        {orderMode && q > 0 && (
          <div className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-white rounded-full shadow-md px-1 py-1">
            <button onClick={onSub} className="w-6 h-6 rounded-full border border-[#E5E7EB] flex items-center justify-center min-h-0 min-w-0"><Minus size={12} /></button>
            <span className="text-xs font-semibold w-4 text-center">{q}</span>
            <button onClick={onAdd} className="w-6 h-6 rounded-full bg-[#F97316] text-white flex items-center justify-center min-h-0 min-w-0"><Plus size={12} /></button>
          </div>
        )}
      </div>
      <div className="p-2.5 flex flex-col flex-1">
        <div className="flex items-center gap-1">
          <VegIndicator type={safeFoodType(item.food_type)} />
          <span className="text-sm font-semibold text-[#0F0E17] leading-tight line-clamp-1">{item.name}</span>
        </div>
        {item.description && <p className="text-[11px] text-[#6B7280] mt-1 leading-snug line-clamp-2">{item.description}</p>}
        <div className="flex items-center justify-between mt-auto pt-2">
          <p className="text-sm font-bold text-[#F97316]">{money(item.price)}</p>
          {!orderMode && <Badge variant={item.is_available ? "green" : "gray"}>{item.is_available ? "Available" : "Off"}</Badge>}
        </div>
      </div>
    </div>
  );
}

// ── Calls view — pending waiter calls for your tables ───────
function CallsView({ calls, onAck }: { calls: WaiterCall[]; onAck: (id: string) => void }) {
  if (calls.length === 0) {
    return (
      <EmptyState
        icon={<ConciergeBell size={24} />}
        title="No pending calls"
        description="When a customer at your tables taps 'Call waiter', it shows up here instantly."
      />
    );
  }
  return (
    <div className="px-4 py-4 space-y-3">
      {calls.map((c) => (
        <div key={c.id} className="bg-white border border-[#E5E7EB] rounded-3xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-[#FEF3C7] flex items-center justify-center shrink-0">
              <Bell size={18} className="text-[#D97706]" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-[#0F0E17]">Table {c.table_number ?? "?"}</p>
              <p className="text-xs text-[#9CA3AF]">Called {timeAgo(c.created_at)}</p>
            </div>
          </div>
          <Button variant="primary" size="sm" onClick={() => onAck(c.id)}>Got it</Button>
        </div>
      ))}
    </div>
  );
}

// ── Menu view (browse) ──────────────────────────────────────
function MenuView({ categories, items }: { categories: MenuCategory[]; items: MenuItem[] }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FoodFilter>("all");
  const query = q.trim().toLowerCase();
  const groups = useMemo(
    () => groupItems(items.filter((i) => matchFilter(i, query, filter)), categories),
    [categories, items, query, filter]
  );

  return (
    <div className="px-4 py-4">
      <SearchBar value={q} onChange={setQ} placeholder="Search menu items…" />
      <FoodFilterPills value={filter} onChange={setFilter} />
      {groups.length === 0 ? (
        <EmptyState icon={<UtensilsCrossed size={24} />} title="No items" description="No menu items match your search." />
      ) : (
        groups.map((g) => (
          <div key={g.id} className="mb-5">
            <CategoryHeader name={g.name} count={g.list.length} />
            <div className="grid grid-cols-2 gap-3">
              {g.list.map((i) => <ItemCard key={i.id} item={i} />)}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Active orders view ──────────────────────────────────────
const statusVariant: Record<string, "orange" | "yellow" | "green" | "gray"> = {
  new: "orange", preparing: "yellow", done: "green", cancelled: "gray",
};

function OrdersView({
  orders, staffId, getToken, onChanged,
}: {
  orders: ActiveOrder[]; staffId: string; getToken: () => string | null; onChanged: () => void;
}) {
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);

  async function setStatus(order: ActiveOrder, status: string) {
    const token = getToken();
    if (!token) return;
    setBusy(order.id);
    const { error } = await supabase.rpc("staff_update_order_status", {
      p_token: token, p_order_id: order.id, p_status: status,
    });
    setBusy(null);
    if (error) return toast.error(error.message || "Could not update");
    toast.success(`Marked ${status}`);
    onChanged();
  }

  async function removeItem(order: ActiveOrder, idx: number) {
    const token = getToken();
    if (!token) return;
    const next = order.items.filter((_, i) => i !== idx);
    if (next.length === 0) return toast.error("An order needs at least one item — cancel it instead");
    await mutateItems(order, next);
  }
  async function changeQty(order: ActiveOrder, idx: number, delta: number) {
    const next = order.items
      .map((it, i) => (i === idx ? { ...it, qty: it.qty + delta } : it))
      .filter((it) => it.qty > 0);
    if (next.length === 0) return;
    await mutateItems(order, next);
  }
  async function mutateItems(order: ActiveOrder, next: OrderItem[]) {
    const token = getToken();
    if (!token) return;
    const total = next.reduce((s, it) => s + it.price * it.qty, 0);
    setBusy(order.id);
    const { error } = await supabase.rpc("staff_update_order_items", {
      p_token: token, p_order_id: order.id, p_items: next, p_total: total,
    });
    setBusy(null);
    if (error) return toast.error(error.message || "Could not update");
    onChanged();
  }

  if (orders.length === 0) {
    return <EmptyState icon={<ClipboardList size={24} />} title="No active orders" description="New and in-progress orders for your tables show up here." />;
  }

  return (
    <div className="px-4 py-4 space-y-3">
      {orders.map((o) => {
        const editable = o.status === "new";
        return (
          <div key={o.id} className="bg-white border border-[#E5E7EB] rounded-3xl p-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-[#0F0E17]">
                Table {o.table_number ?? "?"} · #{o.id.slice(-6).toUpperCase()}
              </p>
              <Badge variant={statusVariant[o.status] ?? "gray"}>{o.status}</Badge>
            </div>
            <p className="text-xs text-[#9CA3AF] mt-1">
              {timeAgo(o.created_at)}
              {o.assigned_staff_name ? ` · ${o.assigned_staff_id === staffId ? "You" : o.assigned_staff_name}` : ""}
            </p>

            <div className="mt-3 space-y-1.5">
              {o.items?.map((it, idx) => (
                <div key={idx} className="flex items-center justify-between text-sm">
                  <span className="text-[#374151] min-w-0 truncate">{it.name}</span>
                  {editable ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <button onClick={() => changeQty(o, idx, -1)} className="w-6 h-6 rounded-full border border-[#E5E7EB] flex items-center justify-center min-h-0 min-w-0"><Minus size={12} /></button>
                      <span className="w-4 text-center text-sm font-semibold">{it.qty}</span>
                      <button onClick={() => changeQty(o, idx, 1)} className="w-6 h-6 rounded-full bg-[#1C1C2E] text-white flex items-center justify-center min-h-0 min-w-0"><Plus size={12} /></button>
                      <button onClick={() => removeItem(o, idx)} className="text-[#9CA3AF] hover:text-[#EF4444] min-h-0 min-w-0 p-1"><X size={14} /></button>
                    </div>
                  ) : (
                    <span className="text-[#6B7280] shrink-0">× {it.qty}</span>
                  )}
                </div>
              ))}
            </div>
            {o.notes && <p className="text-xs text-[#6B7280] mt-2 italic">Note: {o.notes}</p>}

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#F3F4F6]">
              <p className="text-sm font-semibold text-[#F97316]">{money(o.total)}</p>
              <div className="flex gap-2">
                {o.status === "new" && (
                  <>
                    <Button variant="ghost" size="sm" disabled={busy === o.id} onClick={() => setStatus(o, "cancelled")}>Cancel</Button>
                    <Button variant="primary" size="sm" loading={busy === o.id} onClick={() => setStatus(o, "preparing")}>Start preparing</Button>
                  </>
                )}
                {o.status === "preparing" && (
                  <>
                    <Button variant="ghost" size="sm" disabled={busy === o.id} onClick={() => setStatus(o, "cancelled")}>Cancel</Button>
                    <Button variant="primary" size="sm" loading={busy === o.id} icon={<CheckCircle2 size={14} />} onClick={() => setStatus(o, "done")}>Mark done</Button>
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── New order view ──────────────────────────────────────────
type Cart = Record<string, { item: MenuItem; qty: number }>;

function NewOrderView({
  items, categories, assignedTables, getToken, onPlaced,
}: {
  items: MenuItem[];
  categories: MenuCategory[];
  assignedTables: { table_id: string; table_number: string }[];
  getToken: () => string | null;
  onPlaced: () => void;
}) {
  const supabase = createClient();
  const [table, setTable] = useState(assignedTables[0]?.table_number ?? "");
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState<Cart>({});
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FoodFilter>("all");
  const [placing, setPlacing] = useState(false);
  const query = q.trim().toLowerCase();

  // Only available items can be added to a new order.
  const groups = useMemo(
    () => groupItems(items.filter((i) => i.is_available && matchFilter(i, query, filter)), categories),
    [items, categories, query, filter]
  );

  const add = (it: MenuItem) =>
    setCart((p) => ({ ...p, [it.id]: { item: it, qty: (p[it.id]?.qty ?? 0) + 1 } }));
  const sub = (it: MenuItem) =>
    setCart((p) => {
      const qty = (p[it.id]?.qty ?? 0) - 1;
      const next = { ...p };
      if (qty <= 0) delete next[it.id];
      else next[it.id] = { item: it, qty };
      return next;
    });

  const lines = Object.values(cart);
  const total = lines.reduce((s, l) => s + l.item.price * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);

  async function place() {
    const token = getToken();
    if (!token) return;
    if (!table.trim()) return toast.error("Select or enter a table");
    if (lines.length === 0) return toast.error("Add at least one item");
    setPlacing(true);
    const payload = lines.map((l) => ({ item_id: l.item.id, name: l.item.name, price: l.item.price, qty: l.qty }));
    const { error } = await supabase.rpc("staff_create_order", {
      p_token: token, p_table_number: table.trim(), p_items: payload, p_total: total, p_notes: notes || null,
    });
    setPlacing(false);
    if (error) return toast.error(error.message || "Could not place order");
    toast.success("Order placed 🎉");
    setCart({}); setNotes("");
    onPlaced();
  }

  return (
    <div className="px-4 py-4 pb-28">
      {/* Table picker */}
      <div className="mb-3">
        <label className="text-xs font-semibold text-[#374151]">Table</label>
        {assignedTables.length > 0 ? (
          <div className="flex flex-wrap gap-2 mt-1.5">
            {assignedTables.map((t) => (
              <button
                key={t.table_id}
                onClick={() => setTable(t.table_number)}
                className={[
                  "px-3 py-1.5 rounded-full text-sm font-medium border",
                  table === t.table_number ? "bg-[#1C1C2E] text-white border-[#1C1C2E]" : "bg-white text-[#374151] border-[#E5E7EB]",
                ].join(" ")}
              >
                {t.table_number}
              </button>
            ))}
          </div>
        ) : (
          <input
            value={table}
            onChange={(e) => setTable(e.target.value)}
            placeholder="Enter table number"
            className="w-full mt-1.5 bg-white border border-[#E5E7EB] rounded-2xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent"
          />
        )}
      </div>

      <SearchBar value={q} onChange={setQ} placeholder="Search items to add…" />
      <FoodFilterPills value={filter} onChange={setFilter} />

      {groups.length === 0 ? (
        <EmptyState icon={<UtensilsCrossed size={24} />} title="No items" description="No available items match your search." />
      ) : (
        groups.map((g) => (
          <div key={g.id} className="mb-4">
            <CategoryHeader name={g.name} count={g.list.length} />
            <div className="grid grid-cols-2 gap-3">
              {g.list.map((i) => (
                <ItemCard key={i.id} item={i} qty={cart[i.id]?.qty ?? 0} onAdd={() => add(i)} onSub={() => sub(i)} />
              ))}
            </div>
          </div>
        ))
      )}

      {/* Special instructions */}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="Special instructions (optional)"
        className="w-full bg-white border border-[#E5E7EB] rounded-2xl px-4 py-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#F97316] focus:border-transparent"
      />

      {/* Place bar */}
      {count > 0 && (
        <div className="fixed bottom-[60px] inset-x-0 px-4 pb-3">
          <button
            onClick={place}
            disabled={placing}
            className="w-full rounded-2xl py-3.5 bg-[#F97316] text-white font-semibold text-sm flex items-center justify-center gap-2 shadow-lg disabled:opacity-50 active:scale-[0.98] transition-transform"
          >
            {placing ? <Loader2 size={16} className="animate-spin" /> : `Place order · ${count} item${count !== 1 ? "s" : ""} · ${money(total)}`}
          </button>
        </div>
      )}
    </div>
  );
}
