"use client";
import { useState, useRef, useMemo, useEffect, useCallback, memo } from "react";
import Image from "next/image";
import { Search, X, Plus, Minus, Bell, Star, Sparkles, ChefHat, Clock, CheckCircle2, XCircle, ChevronLeft, List, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { VegIndicator } from "@/components/ui/VegIndicator";
import { SpecialtyPopupPortal } from "./SpecialtyPopupPortal";
import { useCategoryNav } from "./useCategoryNav";
import { createClient } from "@/lib/supabase/client";
import { uuid } from "@/lib/uuid";
import type { Hotel, HotelSettings, Category, MenuItem } from "@/types/database";

// Tiny valid JPEG used as a blur-up placeholder for item images.
const BLUR_DATA_URL =
  "data:image/jpeg;base64,/9j/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

// A QR scan is always a phone — render a single mobile-width column, centered
// in a dark gutter on desktop.
const FRAME = "max-w-[460px]";

interface CartItem {
  itemId: string;
  name: string;
  price: number;
  qty: number;
}

interface Props {
  hotel: Hotel;
  settings: HotelSettings | null;
  categories: Category[];
  items: MenuItem[];
  tableSlug: string;
}

type FoodFilter = "all" | "veg" | "non_veg";
type RatingAgg = Record<string, { sum: number; count: number }>;
type ActiveOrder = {
  id: string;
  token: string;
  placedAt: number;
  items: CartItem[];
  total: number;
  table: string;
  cancelMinutes: number;
  status: "new" | "preparing" | "completed" | "cancelled";
};

function matchesFilters(item: MenuItem, q: string, foodFilter: FoodFilter) {
  if (item.is_available === false) return false;
  if (q && !item.name.toLowerCase().includes(q) && !(item.description ?? "").toLowerCase().includes(q)) return false;
  if (foodFilter === "veg" && item.food_type !== "veg" && item.food_type !== "vegan") return false;
  if (foodFilter === "non_veg" && item.food_type !== "non_veg") return false;
  return true;
}

// Merge newly-added cart lines into an existing order's lines, summing the
// quantity when the same dish is ordered again (for the local status display).
function mergeCartItems(existing: CartItem[], added: CartItem[]): CartItem[] {
  const merged = existing.map((c) => ({ ...c }));
  for (const a of added) {
    const found = merged.find((c) => c.itemId === a.itemId);
    if (found) found.qty += a.qty;
    else merged.push({ ...a });
  }
  return merged;
}

// Derive the table number from a table-specific slug ("hotel-t5-1234" -> "5").
function tableNumberFromSlug(slug: string): string | null {
  const idx = slug.indexOf("-t");
  if (idx === -1) return null;
  const after = slug.slice(idx + 2).replace(/-\d{4}$/, "");
  return after || null;
}

export function PublicMenuClassic({ hotel, settings, categories, items: initialItems, tableSlug }: Props) {
  const themeColor = settings?.theme_color ?? "#F97316";
  const themeLight = `${themeColor}26`;
  const cancelMinutes = settings?.order_cancel_minutes ?? 5;
  const nudgeEnabled = settings?.special_nudge_enabled ?? true;
  const nudgeSeconds = settings?.special_nudge_seconds ?? 5;
  const tableNumber = useMemo(() => tableNumberFromSlug(tableSlug), [tableSlug]);
  const orderKey = `order-${hotel.id}-${tableSlug}`;

  const [items, setItems] = useState<MenuItem[]>(initialItems);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [foodFilter, setFoodFilter] = useState<FoodFilter>("all");
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [manualTable, setManualTable] = useState("");
  const [ratings, setRatings] = useState<RatingAgg>({});
  const [ratingItem, setRatingItem] = useState<MenuItem | null>(null);
  const [activeOrder, setActiveOrder] = useState<ActiveOrder | null>(null);
  // The order-status screen overlays the menu. Hiding it (without clearing the
  // active order) lets the customer browse and add more items to the SAME order.
  const [statusOpen, setStatusOpen] = useState(false);
  // Floating "MENU" jump-to-category sheet (Swiggy/Zomato style).
  const [catSheetOpen, setCatSheetOpen] = useState(false);
  // Measure the sticky filter bar so category headers pin flush beneath it
  // (no hardcoded offset → no gap/overlap as content scrolls under).
  const navRef = useRef<HTMLDivElement | null>(null);
  const [navH, setNavH] = useState(150);
  // A jump requested while its section was filtered out — replayed once the
  // section is back in the DOM (see the effect below).
  const [pendingJump, setPendingJump] = useState<string | null>(null);
  const supabase = createClient();

  const { activeCatId, registerTab, stripRef, scrollToCategory, scrollToTop } = useCategoryNav({
    categories,
    navH,
  });

  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const update = () => setNavH(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Debounce search — prevents re-filtering 200+ items on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 150);
    return () => clearTimeout(timer);
  }, [search]);

  const logoInitial = hotel.name.charAt(0).toUpperCase();

  // Live menu — admin edits/enable/disable/add/delete reflect without a refresh.
  useEffect(() => {
    const channel = supabase
      .channel(`menu-${hotel.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "menu_items", filter: `hotel_id=eq.${hotel.id}` },
        (payload) => {
          if (payload.eventType === "DELETE") {
            const oldId = (payload.old as { id?: string }).id;
            if (oldId) setItems((prev) => prev.filter((i) => i.id !== oldId));
            return;
          }
          const row = payload.new as MenuItem;
          setItems((prev) => {
            const exists = prev.some((i) => i.id === row.id);
            return exists ? prev.map((i) => (i.id === row.id ? { ...i, ...row } : i)) : [...prev, row];
          });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [hotel.id, supabase]);

  // All filtering runs in memory — zero network calls after the initial load.
  const filteredByCat = useMemo(() => {
    return categories.map((cat) => ({
      cat,
      items: items.filter((item) => item.category_id === cat.id && matchesFilters(item, debouncedSearch, foodFilter)),
    }));
  }, [items, categories, debouncedSearch, foodFilter]);

  const specialItems = useMemo(() => {
    return items.filter((item) => item.is_special && matchesFilters(item, debouncedSearch, foodFilter));
  }, [items, debouncedSearch, foodFilter]);

  // Optional "Speciality" category (name contains "special") for jump navigation.
  const specialCat = useMemo(() => categories.find((c) => /special/i.test(c.name)) ?? null, [categories]);

  // Items shown in the popup: prefer named Specials category, else any is_special item.
  const specialtyItems = useMemo(() => {
    const fromCat = specialCat
      ? items.filter((i) => i.category_id === specialCat.id && i.is_available !== false)
      : [];
    if (fromCat.length > 0) return fromCat;
    return items.filter((i) => i.is_special && i.is_available !== false);
  }, [items, specialCat]);

  const hasResults = useMemo(() => filteredByCat.some((g) => g.items.length > 0), [filteredByCat]);

  // Load rating aggregates after mount (non-blocking — menu renders instantly).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data } = await supabase.from("item_ratings").select("item_id,rating").eq("hotel_id", hotel.id);
        if (!active || !data) return;
        const agg: RatingAgg = {};
        for (const r of data as { item_id: string; rating: number }[]) {
          const a = agg[r.item_id] ?? { sum: 0, count: 0 };
          a.sum += r.rating;
          a.count += 1;
          agg[r.item_id] = a;
        }
        setRatings(agg);
      } catch {
        // ratings table may not exist yet — ignore
      }
    })();
    return () => {
      active = false;
    };
  }, [hotel.id, supabase]);

  // Restore a recently placed order (survives an accidental refresh).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(orderKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as ActiveOrder;
      if (Date.now() - saved.placedAt > 60 * 60 * 1000) {
        localStorage.removeItem(orderKey);
        return;
      }
      setActiveOrder(saved);
      setStatusOpen(true);
    } catch {
      /* ignore */
    }
  }, [orderKey]);

  // Live status — poll the token-gated RPC (anon can't SELECT orders) so the
  // customer sees the kitchen move their order through preparing → served
  // without refreshing. Cheap: one tiny RPC every 12s, only while active.
  useEffect(() => {
    if (!activeOrder || activeOrder.status === "cancelled" || activeOrder.status === "completed") return;
    const { id: orderId, token } = activeOrder;

    let stopped = false;
    async function check() {
      if (stopped || document.visibilityState === "hidden") return;
      const { data } = await supabase.rpc("get_order_status", { p_order_id: orderId, p_token: token });
      if (stopped || !data) return;
      const mapped = (data === "done" ? "completed" : data) as ActiveOrder["status"];
      setActiveOrder((prev) => {
        if (!prev || prev.id !== orderId || prev.status === mapped) return prev;
        const next = { ...prev, status: mapped };
        persistOrder(next);
        if (mapped === "preparing") toast("Your order is being prepared 👨‍🍳");
        if (mapped === "completed") toast.success("Your order is served — enjoy! 🍽️");
        return next;
      });
    }
    check();
    const t = setInterval(check, 12_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrder?.id, activeOrder?.status, supabase]);

  // A category section is only in the DOM while it survives the active search
  // and veg filter. Tapping a tab for a filtered-out category used to do
  // nothing at all; now we clear what's hiding it and jump on the next render.
  const selectCat = useCallback(
    (catId: string) => {
      if (scrollToCategory(catId)) return;
      setSearch("");
      setDebouncedSearch("");
      setFoodFilter("all");
      setPendingJump(catId);
    },
    [scrollToCategory],
  );

  useEffect(() => {
    if (!pendingJump) return;
    if (!document.getElementById(`cat-${pendingJump}`)) return;
    setPendingJump(null);
    scrollToCategory(pendingJump);
  }, [pendingJump, filteredByCat, scrollToCategory]);

  // Tapping the nudge jumps straight to the special menu. Hotels without a
  // named "Speciality" category surface their specials in the rail at the top
  // instead, so send the customer there rather than nowhere.
  const openSpecial = useCallback(() => {
    if (specialCat) selectCat(specialCat.id);
    else scrollToTop();
  }, [specialCat, selectCat, scrollToTop]);

  const addToCart = useCallback((item: MenuItem) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.itemId === item.id);
      if (existing) return prev.map((c) => (c.itemId === item.id ? { ...c, qty: c.qty + 1 } : c));
      return [...prev, { itemId: item.id, name: item.name, price: item.price, qty: 1 }];
    });
  }, []);

  const changeQty = useCallback((itemId: string, delta: number) => {
    setCart((prev) =>
      prev.map((c) => (c.itemId === itemId ? { ...c, qty: c.qty + delta } : c)).filter((c) => c.qty > 0)
    );
  }, []);

  const cartTotal = useMemo(() => cart.reduce((sum, c) => sum + c.price * c.qty, 0), [cart]);
  const cartCount = useMemo(() => cart.reduce((sum, c) => sum + c.qty, 0), [cart]);
  // Fast itemId -> qty lookup so each card can show an inline +/- stepper.
  const cartQty = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of cart) m[c.itemId] = c.qty;
    return m;
  }, [cart]);

  async function callWaiter() {
    const COOLDOWN_KEY = `waiter-${hotel.id}-${tableSlug}`;
    const last = localStorage.getItem(COOLDOWN_KEY);
    if (last && Date.now() - parseInt(last) < 5 * 60 * 1000) {
      toast("Already called — your waiter is on their way");
      return;
    }
    toast("Calling your waiter...");
    await supabase.from("waiter_calls").insert({
      hotel_id: hotel.id,
      table_slug: tableSlug,
      table_number: tableNumber,
      status: "pending",
    });
    localStorage.setItem(COOLDOWN_KEY, Date.now().toString());
  }

  function persistOrder(order: ActiveOrder | null) {
    try {
      if (order) localStorage.setItem(orderKey, JSON.stringify(order));
      else localStorage.removeItem(orderKey);
    } catch {
      /* ignore */
    }
  }

  // Try to append the current cart to an already-placed order on this table so
  // the manager sees the SAME order grow (a realtime UPDATE) rather than a
  // second row. Returns false if there's no open order to append to.
  async function appendToActiveOrder(): Promise<boolean> {
    if (!activeOrder || (activeOrder.status !== "new" && activeOrder.status !== "preparing")) return false;
    const newItems = cart.map((c) => ({ item_id: c.itemId, name: c.name, price: c.price, qty: c.qty }));
    const { data, error } = await supabase.rpc("append_to_order", {
      p_order_id: activeOrder.id,
      p_token: activeOrder.token,
      p_items: newItems,
      p_added_total: cartTotal,
    });
    if (error || data !== true) return false;
    const merged = mergeCartItems(activeOrder.items, cart);
    const updated: ActiveOrder = { ...activeOrder, items: merged, total: activeOrder.total + cartTotal };
    persistOrder(updated);
    setActiveOrder(updated);
    setCart([]);
    setCartOpen(false);
    setStatusOpen(true);
    toast.success("Added to your order! 🎉");
    return true;
  }

  async function placeOrder() {
    if (cart.length === 0) return;
    setPlacing(true);

    // Same table, order still open → fold the new items into it.
    if (await appendToActiveOrder()) {
      setPlacing(false);
      return;
    }

    const table = activeOrder?.table ?? tableNumber ?? (manualTable.trim() || null);
    if (!table) {
      setPlacing(false);
      toast.error("Please enter your table number");
      return;
    }
    const id = uuid();
    const token = uuid();
    const row = {
      id,
      hotel_id: hotel.id,
      table_slug: tableSlug,
      table_number: table,
      items: cart.map((c) => ({ item_id: c.itemId, name: c.name, price: c.price, qty: c.qty })),
      total: cartTotal,
      status: "new" as const,
    };
    let { error } = await supabase.from("orders").insert({ ...row, cancel_token: token });
    // Pre-migration fallback (cancel_token column not added yet).
    if (error && (error.code === "42703" || /cancel_token/i.test(error.message))) {
      ({ error } = await supabase.from("orders").insert(row));
    }
    setPlacing(false);
    if (error) {
      // Surface the real cause — almost always a missing RLS INSERT policy on
      // `orders` for the anon role (run migration 0009). See console for code.
      console.error("Order insert failed:", error);
      toast.error(error.message ? `Could not place order: ${error.message}` : "Could not place order. Please try again.");
      return;
    }
    const order: ActiveOrder = {
      id,
      token,
      placedAt: Date.now(),
      items: cart,
      total: cartTotal,
      table,
      cancelMinutes,
      status: "new",
    };
    persistOrder(order);
    setActiveOrder(order);
    setStatusOpen(true);
    setCart([]);
    setCartOpen(false);
    setManualTable("");
    toast.success("Order placed! 🎉");
  }

  async function submitRating(item: MenuItem, value: number) {
    const key = `rated-${item.id}`;
    if (sessionStorage.getItem(key)) {
      toast("You already rated this dish");
      setRatingItem(null);
      return;
    }
    setRatings((prev) => {
      const a = prev[item.id] ?? { sum: 0, count: 0 };
      return { ...prev, [item.id]: { sum: a.sum + value, count: a.count + 1 } };
    });
    sessionStorage.setItem(key, String(value));
    setRatingItem(null);
    toast.success("Thanks for rating! 🙏");
    try {
      await supabase.from("item_ratings").insert({
        item_id: item.id,
        hotel_id: hotel.id,
        rating: value,
        table_slug: tableSlug,
      });
    } catch {
      // ignore — rating already reflected locally
    }
  }

  async function cancelOrder() {
    if (!activeOrder) return;
    const { data, error } = await supabase.rpc("cancel_order", {
      p_order_id: activeOrder.id,
      p_token: activeOrder.token,
    });
    if (error || data !== true) {
      toast.error("Couldn't cancel — the window may have passed.");
      return;
    }
    const cancelled: ActiveOrder = { ...activeOrder, status: "cancelled" };
    persistOrder(cancelled);
    setActiveOrder(cancelled);
    toast.success("Order cancelled");
  }

  // "Add more items" — keep the active order, just drop back to the menu so the
  // next "Place order" appends to it.
  function addMoreItems() {
    setStatusOpen(false);
  }

  function dismissOrder() {
    persistOrder(null);
    setActiveOrder(null);
    setStatusOpen(false);
  }

  return (
    <div className="min-h-screen w-full bg-[#15161F] flex justify-center">
      {/* Mobile-width menu column */}
      <div
        className={`relative w-full ${FRAME} min-h-screen bg-white md:shadow-2xl`}
        style={{ "--theme": themeColor, "--theme-light": themeLight } as React.CSSProperties}
      >
        {/* Header */}
        <div
          className="px-5 pt-6 pb-5"
          style={{
            backgroundColor: themeColor,
            backgroundImage: "linear-gradient(135deg, rgba(255,255,255,0.14), rgba(0,0,0,0.12))",
          }}
        >
          <div className="flex items-center gap-3">
            <div className="w-[52px] h-[52px] rounded-full border-2 border-white/30 overflow-hidden flex items-center justify-center flex-shrink-0 bg-white/20 relative">
              {settings?.logo_url ? (
                <Image src={settings.logo_url} alt="" width={52} height={52} priority className="w-full h-full object-cover" />
              ) : (
                <span className="text-white text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                  {logoInitial}
                </span>
              )}
            </div>
            <div>
              <h1 className="text-white text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
                {hotel.name}
              </h1>
              {hotel.address && <p className="text-white/70 text-xs mt-0.5">{hotel.address}</p>}
              {tableNumber && (
                <span className="inline-block bg-white/20 text-white text-xs px-2 py-0.5 rounded-full mt-2">
                  Table {tableNumber}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Sticky filter bar */}
        <div ref={navRef} className="sticky top-0 z-30 bg-white border-b border-[#E5E7EB] shadow-sm">
          {/* Search */}
          <div className="px-4 pt-3 pb-2 relative">
            <Search size={16} className="absolute left-7 top-1/2 -translate-y-1/2 mt-1 text-[#9CA3AF]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search dishes..."
              className="w-full bg-[#F8F9FA] border border-[#E5E7EB] rounded-2xl pl-9 pr-9 py-2.5 text-sm text-[#0F0E17] placeholder:text-[#9CA3AF] focus:outline-none focus:ring-2 focus:border-transparent transition-all"
              style={{ "--tw-ring-color": themeColor } as React.CSSProperties}
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-7 top-1/2 -translate-y-1/2 mt-1 text-[#9CA3AF] min-h-0 min-w-0 p-0"
              >
                <X size={16} />
              </button>
            )}
          </div>

          {/* Food filter pills */}
          <div className="flex gap-2 px-4 pb-2 overflow-x-auto scrollbar-hide">
            {(["all", "veg", "non_veg"] as FoodFilter[]).map((f) => (
              <button
                key={f}
                onClick={() => setFoodFilter(f)}
                className={[
                  "px-3 py-1.5 rounded-full text-xs font-medium transition-all flex items-center gap-1.5 shrink-0 border min-h-0",
                  foodFilter === f ? "text-white border-transparent" : "bg-white text-[#6B7280] border-[#E5E7EB]",
                ].join(" ")}
                style={foodFilter === f ? { backgroundColor: themeColor } : {}}
              >
                {f === "veg" && <span className="w-2 h-2 rounded-full bg-[#10B981]" />}
                {f === "non_veg" && <span className="w-2 h-2 rounded-full bg-[#EF4444]" />}
                {f === "all" ? "All" : f === "veg" ? "Veg" : "Non-Veg"}
              </button>
            ))}
          </div>

          {/* Category tabs — the strip scrolls itself so the tab the customer
              is currently reading stays centred as they swipe the menu. */}
          <div ref={stripRef} className="flex gap-2 px-4 pb-2 overflow-x-auto scrollbar-hide">
            {categories.map((cat) => {
              const active = activeCatId === cat.id;
              const isSpecial = specialCat?.id === cat.id;
              return (
                <button
                  key={cat.id}
                  ref={(el) => registerTab(cat.id, el)}
                  onClick={() => selectCat(cat.id)}
                  aria-current={active ? "true" : undefined}
                  className={[
                    "px-3 py-1.5 rounded-full text-xs font-medium transition-all shrink-0 border min-h-0 flex items-center gap-1",
                    active
                      ? "text-white border-transparent"
                      : isSpecial
                        ? "bg-amber-50 text-amber-700 border-amber-200"
                        : "bg-white text-[#6B7280] border-[#E5E7EB]",
                  ].join(" ")}
                  style={active ? { backgroundColor: isSpecial ? "#B45309" : themeColor } : {}}
                >
                  {isSpecial && <ChefHat size={11} className={active ? "text-amber-100" : "text-amber-600"} />}
                  {cat.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="pb-32">
          {/* Specials — premium horizontal carousel */}
          {specialItems.length > 0 && (
            <div className="pt-5 pb-2">
              <div className="flex items-center gap-1.5 px-4 mb-3">
                <Sparkles size={17} style={{ color: themeColor }} />
                <span className="text-[16px] font-extrabold text-[#1C1C2E] tracking-tight">Our Specials</span>
              </div>
              <div className="flex gap-3.5 overflow-x-auto scrollbar-hide px-4 pb-1 snap-x">
                {specialItems.map((item) => (
                  <SpecialCard
                    key={item.id}
                    item={item}
                    themeColor={themeColor}
                    rating={ratings[item.id]}
                    qty={cartQty[item.id] ?? 0}
                    onAdd={() => addToCart(item)}
                    onDec={() => changeQty(item.id, -1)}
                    onLongPress={() => setRatingItem(item)}
                  />
                ))}
              </div>
              <div className="h-2 bg-[#F4F4F6] mt-4" />
            </div>
          )}

          {!hasResults ? (
            <div className="flex flex-col items-center text-center py-20 px-4">
              <span className="text-4xl mb-3">🍽️</span>
              <p className="text-[#374151] font-medium">Nothing found</p>
              <p className="text-sm text-[#9CA3AF] mt-1">Try a different search or adjust your filters.</p>
            </div>
          ) : (
            filteredByCat.map(({ cat, items: catItems }, idx) => {
              if (catItems.length === 0) return null;
              return (
                <div key={cat.id} id={`cat-${cat.id}`} style={{ scrollMarginTop: navH }}>
                  {/* Category header */}
                  <div
                    className="flex items-center justify-between px-4 pt-5 pb-3 sticky z-20 bg-white"
                    style={{ top: navH - 1 }}
                  >
                    <h2 className="text-[17px] font-extrabold text-[#1C1C2E] tracking-tight">
                      {cat.name} <span className="text-[#9CA3AF] font-bold">({catItems.length})</span>
                    </h2>
                  </div>

                  <div className="grid grid-cols-2 gap-3 px-4">
                    {catItems.map((item) => (
                      <GridCard
                        key={item.id}
                        item={item}
                        themeColor={themeColor}
                        rating={ratings[item.id]}
                        qty={cartQty[item.id] ?? 0}
                        onAdd={() => addToCart(item)}
                        onDec={() => changeQty(item.id, -1)}
                        onLongPress={() => setRatingItem(item)}
                      />
                    ))}
                  </div>

                  {idx < filteredByCat.length - 1 && <div className="h-2 bg-[#F4F4F6] mt-5" />}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-[#9CA3AF] py-4">Powered by MenuQR</p>
      </div>

      {/* Fixed controls, aligned to the mobile frame */}
      <div className={`fixed inset-0 z-40 mx-auto w-full ${FRAME} pointer-events-none`}>
        {/* Waiter call button */}
        <button
          onClick={callWaiter}
          className={[
            "pointer-events-auto absolute right-4 w-[52px] h-[52px] rounded-full bg-white border-2 shadow-lg flex items-center justify-center min-h-0 min-w-0",
            cartCount > 0 ? "bottom-28" : "bottom-6",
          ].join(" ")}
          style={{ borderColor: themeColor }}
          title="Call waiter"
        >
          <Bell size={22} style={{ color: themeColor }} />
        </button>

        {/* Floating MENU button — jump to any category (Swiggy/Zomato style) */}
        {categories.length > 1 && (
          <button
            onClick={() => setCatSheetOpen(true)}
            className={[
              "pointer-events-auto absolute left-1/2 -translate-x-1/2 bg-[#1C1C2E] text-white rounded-2xl px-4 py-3 shadow-xl flex items-center gap-2 active:scale-95 transition-transform",
              cartCount > 0 || (activeOrder && !statusOpen) ? "bottom-24" : "bottom-6",
            ].join(" ")}
          >
            <List size={17} />
            <span className="text-sm font-bold tracking-wide">MENU</span>
          </button>
        )}

        {/* Re-open the active order when browsing to add more items (cart empty) */}
        {activeOrder && !statusOpen && cartCount === 0 && (
          <button
            onClick={() => setStatusOpen(true)}
            className="pointer-events-auto absolute bottom-0 inset-x-0 flex items-center justify-between px-5 py-4 text-left"
            style={{ backgroundColor: themeColor }}
          >
            <div>
              <p className="text-white text-sm font-medium">Your order · Table {activeOrder.table}</p>
              <p className="text-white/80 text-xs">Tap to view · add more from the menu</p>
            </div>
            <span className="text-white font-semibold text-sm">View order →</span>
          </button>
        )}

        {/* Cart bar */}
        {cartCount > 0 && (
          <button
            onClick={() => setCartOpen(true)}
            className="pointer-events-auto absolute bottom-0 inset-x-0 flex items-center justify-between px-5 py-4 text-left active:brightness-95 transition"
            style={{ backgroundColor: themeColor }}
          >
            <div className="flex items-center gap-3">
              <span className="bg-white/25 text-white text-sm font-bold rounded-full min-w-[28px] h-7 px-1.5 flex items-center justify-center tabular-nums">
                {cartCount}
              </span>
              <div>
                <p className="text-white text-sm font-semibold leading-tight">View order</p>
                <p className="text-white/80 text-xs leading-tight">
                  {cartCount} item{cartCount !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
            <span className="text-white font-bold text-base flex items-center gap-1.5 tabular-nums">
              ₹{cartTotal} <span className="opacity-80 font-semibold">→</span>
            </span>
          </button>
        )}
      </div>

      {/* Cart / order sheet */}
      {cartOpen && (
        <CartSheet
          cart={cart}
          total={cartTotal}
          themeColor={themeColor}
          tableNumber={tableNumber}
          manualTable={manualTable}
          setManualTable={setManualTable}
          placing={placing}
          appendMode={Boolean(activeOrder && (activeOrder.status === "new" || activeOrder.status === "preparing"))}
          onClose={() => setCartOpen(false)}
          onChangeQty={changeQty}
          onPlaceOrder={placeOrder}
        />
      )}

      {/* Category jump sheet */}
      {catSheetOpen && (
        <CategorySheet
          groups={filteredByCat}
          themeColor={themeColor}
          activeCatId={activeCatId}
          onPick={(catId) => {
            selectCat(catId);
            setCatSheetOpen(false);
          }}
          onClose={() => setCatSheetOpen(false)}
        />
      )}

      {/* Special-menu nudge — fully isolated portal, renders above the MENU button. */}
      <SpecialtyPopupPortal
        isEnabled={nudgeEnabled && specialtyItems.length > 0}
        durationSeconds={nudgeSeconds}
        persistent={true}
        items={specialtyItems}
        themeColor={themeColor}
        onAdd={(id) => { const it = items.find((i) => i.id === id); if (it) addToCart(it); }}
        onViewMenu={openSpecial}
        // Ride above whatever is occupying the bottom of the screen so the
        // banner never lands on top of the cart bar or the MENU button.
        offsetBottom={cartCount > 0 || (activeOrder && !statusOpen) ? 156 : 90}
      />

      {/* Rating bottom sheet */}
      {ratingItem && (
        <RatingSheet item={ratingItem} themeColor={themeColor} onClose={() => setRatingItem(null)} onRate={(v) => submitRating(ratingItem, v)} />
      )}

      {/* Order status — shown after placing, covering the menu like a redirect */}
      {activeOrder && statusOpen && (
        <OrderStatus
          order={activeOrder}
          themeColor={themeColor}
          onCancel={cancelOrder}
          onBack={dismissOrder}
          onAddMore={addMoreItems}
        />
      )}
    </div>
  );
}

function useLongPress(onLongPress: () => void, ms = 500) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  const start = () => {
    clear();
    timer.current = setTimeout(onLongPress, ms);
  };
  return {
    onTouchStart: start,
    onTouchEnd: clear,
    onTouchMove: clear,
    onMouseDown: start,
    onMouseUp: clear,
    onMouseLeave: clear,
  };
}

// Compact green rating badge (Zomato style) — a trust signal at a glance.
function RatingPill({ avg, count }: { avg: number; count: number }) {
  return (
    <span className="inline-flex items-center gap-1 bg-[#E7F6EC] text-[#1B7A3D] text-[11px] font-bold px-1.5 py-[3px] rounded-md leading-none">
      <Star size={9} style={{ fill: "#1B7A3D", color: "#1B7A3D" }} />
      {avg.toFixed(1)}
      <span className="text-[#4A9E6A] font-semibold">({count})</span>
    </span>
  );
}

function DishImage({ item, themeColor, sizes }: { item: MenuItem; themeColor: string; sizes: string }) {
  if (item.image_url) {
    return (
      <Image
        src={item.image_url}
        alt={item.name}
        fill
        sizes={sizes}
        loading="lazy"
        placeholder="blur"
        blurDataURL={BLUR_DATA_URL}
        className="object-cover"
      />
    );
  }
  return (
    <div className="w-full h-full flex items-center justify-center" style={{ backgroundColor: `${themeColor}14` }}>
      <span className="text-3xl opacity-50">🍽️</span>
    </div>
  );
}

// Zomato/Swiggy-style ADD control that sits over the dish image: a white "ADD"
// pill until the item is in the cart, then an inline −/qty/+ stepper.
function AddPill({
  qty,
  onAdd,
  onDec,
  themeColor,
}: {
  qty: number;
  onAdd: () => void;
  onDec: () => void;
  themeColor: string;
}) {
  if (qty === 0) {
    return (
      <button
        onClick={onAdd}
        className="w-full h-9 rounded-xl bg-white border shadow-[0_4px_12px_rgba(0,0,0,0.12)] flex items-center justify-center gap-1 font-extrabold text-[13px] tracking-wider active:scale-95 transition-transform min-h-0"
        style={{ borderColor: `${themeColor}40`, color: themeColor }}
        aria-label="Add to order"
      >
        ADD
        <Plus size={14} strokeWidth={3} />
      </button>
    );
  }
  return (
    <div
      className="w-full h-9 rounded-xl bg-white border shadow-[0_4px_12px_rgba(0,0,0,0.12)] flex items-center justify-between"
      style={{ borderColor: themeColor }}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDec();
        }}
        className="h-full px-2.5 flex items-center justify-center min-h-0 min-w-0"
        style={{ color: themeColor }}
        aria-label="Decrease quantity"
      >
        <Minus size={15} strokeWidth={3} />
      </button>
      <span className="font-extrabold text-sm tabular-nums select-none" style={{ color: themeColor }}>
        {qty}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onAdd();
        }}
        className="h-full px-2.5 flex items-center justify-center min-h-0 min-w-0"
        style={{ color: themeColor }}
        aria-label="Increase quantity"
      >
        <Plus size={15} strokeWidth={3} />
      </button>
    </div>
  );
}

// Compact 2-up grid card: image on top with the ADD pill straddling its lower
// edge, details below. Two of these sit side-by-side per row.
const GridCard = memo(function GridCard({
  item,
  themeColor,
  rating,
  qty,
  onAdd,
  onDec,
  onLongPress,
}: {
  item: MenuItem;
  themeColor: string;
  rating?: { sum: number; count: number };
  qty: number;
  onAdd: () => void;
  onDec: () => void;
  onLongPress: () => void;
}) {
  const longPress = useLongPress(onLongPress);
  const avg = rating && rating.count > 0 ? rating.sum / rating.count : 0;

  return (
    <div
      className="bg-white rounded-2xl border overflow-hidden flex flex-col"
      style={{ borderColor: qty > 0 ? themeColor : "#EDEDF0" }}
    >
      {/* Image + overlapping ADD pill */}
      <div className="relative w-full aspect-square bg-[#F4F4F6]">
        <DishImage item={item} themeColor={themeColor} sizes="(max-width: 480px) 45vw, 210px" />
        {item.badge && (
          <span
            className="absolute top-2 left-2 flex items-center gap-0.5 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow"
            style={{ backgroundColor: themeColor }}
          >
            <Star size={9} style={{ fill: "#fff", color: "#fff" }} />
            {item.badge}
          </span>
        )}
        <div className="absolute left-1/2 -translate-x-1/2 -bottom-3 w-[72%] max-w-[120px]">
          <AddPill qty={qty} onAdd={onAdd} onDec={onDec} themeColor={themeColor} />
        </div>
      </div>

      {/* Details */}
      <div className="px-2.5 pt-5 pb-3 flex flex-col flex-1" {...longPress}>
        <div className="flex items-center gap-1.5">
          <VegIndicator type={item.food_type} />
          <h3 className="text-[13.5px] font-semibold text-[#1C1C2E] leading-tight line-clamp-1">{item.name}</h3>
        </div>
        {rating && rating.count >= 3 && (
          <div className="mt-1.5">
            <RatingPill avg={avg} count={rating.count} />
          </div>
        )}
        {item.description && (
          <p className="text-[11px] text-[#6B7280] mt-1.5 leading-snug line-clamp-2">{item.description}</p>
        )}
        <p className="text-[15px] font-bold text-[#1C1C2E] mt-auto pt-2">₹{item.price}</p>
      </div>
    </div>
  );
});

const SpecialCard = memo(function SpecialCard({
  item,
  themeColor,
  rating,
  qty,
  onAdd,
  onDec,
  onLongPress,
}: {
  item: MenuItem;
  themeColor: string;
  rating?: { sum: number; count: number };
  qty: number;
  onAdd: () => void;
  onDec: () => void;
  onLongPress: () => void;
}) {
  const longPress = useLongPress(onLongPress);
  const avg = rating && rating.count > 0 ? rating.sum / rating.count : 0;
  return (
    <div className="flex-shrink-0 w-[168px] snap-start">
      <div className="relative w-full aspect-square rounded-3xl overflow-hidden bg-[#F4F4F6] shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
        <DishImage item={item} themeColor={themeColor} sizes="168px" />
        {/* gradient scrim for legibility */}
        <div className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 to-transparent" />
        <span
          className="absolute top-2.5 left-2.5 flex items-center gap-1 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-md backdrop-blur-sm"
          style={{ backgroundColor: `${themeColor}E6` }}
        >
          <Sparkles size={10} /> SPECIAL
        </span>
        <div className="absolute bottom-2.5 left-2.5 right-2.5">
          <div className="flex items-center gap-1.5">
            <VegIndicator type={item.food_type} />
            <span className="text-white text-sm font-bold leading-tight line-clamp-1 drop-shadow">{item.name}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 mt-2.5 px-0.5" {...longPress}>
        <div className="min-w-0">
          <p className="text-[15px] font-bold text-[#1C1C2E] leading-none">₹{item.price}</p>
          {rating && rating.count >= 3 && (
            <div className="mt-1.5">
              <RatingPill avg={avg} count={rating.count} />
            </div>
          )}
        </div>
        <div className="w-[92px] flex-shrink-0">
          <AddPill qty={qty} onAdd={onAdd} onDec={onDec} themeColor={themeColor} />
        </div>
      </div>
    </div>
  );
});

// Bottom-sheet category index reached from the floating MENU button.
const CategorySheet = memo(function CategorySheet({
  groups,
  themeColor,
  activeCatId,
  onPick,
  onClose,
}: {
  groups: { cat: Category; items: MenuItem[] }[];
  themeColor: string;
  activeCatId: string | null;
  onPick: (catId: string) => void;
  onClose: () => void;
}) {
  const visible = groups.filter((g) => g.items.length > 0);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className={`relative bg-white rounded-t-3xl w-full ${FRAME} p-5 pb-8 max-h-[70vh] flex flex-col`} onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full bg-[#E5E7EB] mx-auto mb-4" />
        <h2 className="text-center text-[13px] font-bold uppercase tracking-[0.12em] text-[#9CA3AF] mb-2">Menu</h2>
        <div className="overflow-y-auto -mx-1 px-1">
          {visible.map(({ cat, items: catItems }) => {
            const active = cat.id === activeCatId;
            return (
              <button
                key={cat.id}
                onClick={() => onPick(cat.id)}
                className="w-full flex items-center justify-between py-3 border-b border-[#F0F0F2] last:border-0 text-left"
              >
                <span
                  className="text-[15px] font-semibold"
                  style={{ color: active ? themeColor : "#1C1C2E" }}
                >
                  {cat.name}
                </span>
                <span className="flex items-center gap-2 text-[#9CA3AF]">
                  <span className="text-sm font-medium tabular-nums">{catItems.length}</span>
                  <ChevronRight size={16} />
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});

const CartSheet = memo(function CartSheet({
  cart,
  total,
  themeColor,
  tableNumber,
  manualTable,
  setManualTable,
  placing,
  appendMode,
  onClose,
  onChangeQty,
  onPlaceOrder,
}: {
  cart: CartItem[];
  total: number;
  themeColor: string;
  tableNumber: string | null;
  manualTable: string;
  setManualTable: (v: string) => void;
  placing: boolean;
  appendMode: boolean;
  onClose: () => void;
  onChangeQty: (itemId: string, delta: number) => void;
  onPlaceOrder: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className={`relative bg-white rounded-t-3xl w-full ${FRAME} p-5 pb-8 max-h-[85vh] flex flex-col`} onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full bg-[#E5E7EB] mx-auto mb-4" />
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-[#0F0E17]">Your order</h2>
          {tableNumber ? (
            <span className="text-xs font-medium text-white px-2.5 py-1 rounded-full" style={{ backgroundColor: themeColor }}>
              Table {tableNumber}
            </span>
          ) : null}
        </div>

        {!tableNumber && (
          <input
            value={manualTable}
            onChange={(e) => setManualTable(e.target.value)}
            placeholder="Enter your table number"
            className="w-full bg-[#F8F9FA] border border-[#E5E7EB] rounded-2xl px-4 py-2.5 text-sm mb-3 focus:outline-none focus:ring-2 focus:border-transparent"
            style={{ "--tw-ring-color": themeColor } as React.CSSProperties}
          />
        )}

        {cart.length === 0 ? (
          <p className="text-sm text-[#9CA3AF] text-center py-10">Your cart is empty.</p>
        ) : (
          <div className="overflow-y-auto -mx-1 px-1 flex-1">
            {cart.map((c) => (
              <div key={c.itemId} className="flex items-center gap-3 py-2.5 border-b border-[#F3F4F6]">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#0F0E17] truncate">{c.name}</p>
                  <p className="text-xs text-[#9CA3AF]">₹{c.price}</p>
                </div>
                <div className="flex items-center gap-2.5">
                  <button
                    onClick={() => onChangeQty(c.itemId, -1)}
                    className="w-7 h-7 rounded-full border border-[#E5E7EB] flex items-center justify-center text-[#374151] min-h-0 min-w-0"
                    aria-label="Decrease"
                  >
                    <Minus size={14} />
                  </button>
                  <span className="text-sm font-semibold w-4 text-center">{c.qty}</span>
                  <button
                    onClick={() => onChangeQty(c.itemId, 1)}
                    className="w-7 h-7 rounded-full flex items-center justify-center text-white min-h-0 min-w-0"
                    style={{ backgroundColor: themeColor }}
                    aria-label="Increase"
                  >
                    <Plus size={14} />
                  </button>
                </div>
                <span className="text-sm font-semibold text-[#0F0E17] w-14 text-right tabular-nums">
                  ₹{c.price * c.qty}
                </span>
              </div>
            ))}
          </div>
        )}

        {cart.length > 0 && (
          <div className="flex items-center justify-between pt-3.5 mt-0.5 border-t border-[#E5E7EB]">
            <span className="text-sm text-[#6B7280]">Total</span>
            <span className="text-lg font-bold text-[#0F0E17] tabular-nums">₹{total}</span>
          </div>
        )}

        <button
          onClick={onPlaceOrder}
          disabled={placing || cart.length === 0}
          className="w-full mt-4 rounded-2xl py-3.5 text-white font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform"
          style={{ backgroundColor: themeColor }}
        >
          {placing
            ? appendMode
              ? "Adding..."
              : "Placing order..."
            : `${appendMode ? "Add to order" : "Place order"} · ₹${total}`}
        </button>
      </div>
    </div>
  );
});

const RatingSheet = memo(function RatingSheet({
  item,
  themeColor,
  onClose,
  onRate,
}: {
  item: MenuItem;
  themeColor: string;
  onClose: () => void;
  onRate: (value: number) => void;
}) {
  const [hover, setHover] = useState(0);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className={`relative bg-white rounded-t-3xl w-full ${FRAME} p-6 pb-9`} onClick={(e) => e.stopPropagation()}>
        <div className="w-10 h-1 rounded-full bg-[#E5E7EB] mx-auto mb-5" />
        <p className="text-center text-sm text-[#6B7280]">How was</p>
        <p className="text-center text-base font-semibold text-[#0F0E17] mb-6">{item.name}</p>
        <div className="flex items-center justify-center gap-2">
          {[1, 2, 3, 4, 5].map((s) => {
            const active = s <= hover;
            return (
              <button
                key={s}
                onMouseEnter={() => setHover(s)}
                onMouseLeave={() => setHover(0)}
                onClick={() => onRate(s)}
                className="w-10 h-10 flex items-center justify-center min-h-0 min-w-0"
                aria-label={`Rate ${s} star${s > 1 ? "s" : ""}`}
              >
                <Star size={34} style={{ color: active ? themeColor : "#E5E7EB", fill: active ? themeColor : "transparent" }} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
});

function OrderStatus({
  order,
  themeColor,
  onCancel,
  onBack,
  onAddMore,
}: {
  order: ActiveOrder;
  themeColor: string;
  onCancel: () => void | Promise<void>;
  onBack: () => void;
  onAddMore: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const remaining = Math.max(0, order.placedAt + order.cancelMinutes * 60_000 - now);
  const cancelled = order.status === "cancelled";
  const completed = order.status === "completed";
  const canCancel = order.status === "new" && order.cancelMinutes > 0 && remaining > 0;
  const mm = Math.floor(remaining / 60000);
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, "0");

  const stepIdx = completed ? 2 : order.status === "preparing" ? 1 : 0;
  const headerColor = cancelled ? "#6B7280" : completed ? "#10B981" : themeColor;
  const title = cancelled
    ? "Order cancelled"
    : completed
    ? "Order served!"
    : order.status === "preparing"
    ? "Being prepared"
    : "Order placed!";

  async function handleCancel() {
    setCancelling(true);
    await onCancel();
    setCancelling(false);
  }

  return (
    <div className={`fixed inset-0 z-[60] mx-auto w-full ${FRAME} bg-[#FFFAF3] flex flex-col`}>
      {/* Header */}
      <div className="px-5 pt-6 pb-6 text-white" style={{ backgroundColor: headerColor }}>
        <button onClick={onBack} className="flex items-center gap-1 text-white/90 text-sm mb-4 min-h-0 min-w-0">
          <ChevronLeft size={16} /> Back to menu
        </button>
        <div className="flex items-center gap-3">
          {cancelled ? <XCircle size={30} className="text-white" /> : <CheckCircle2 size={30} className="text-white" />}
          <div>
            <h1 className="text-white text-xl font-semibold" style={{ fontFamily: "var(--font-display)" }}>
              {title}
            </h1>
            <p className="text-white/80 text-xs mt-0.5">
              Table {order.table} · #{order.id.slice(-4).toUpperCase()}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {/* Live progress stepper — updates as the kitchen moves the order along */}
        {!cancelled && (
          <div className="bg-white rounded-3xl border border-[#E5E7EB] p-4 mb-4">
            <div className="flex items-center">
              {["Placed", "Preparing", "Served"].map((label, i) => {
                const reached = i <= stepIdx;
                const isCurrent = i === stepIdx && !completed;
                return (
                  <div key={label} className="flex items-center flex-1 last:flex-none">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-7 h-7 rounded-full flex items-center justify-center border-2 transition-colors ${
                          isCurrent ? "animate-pulse" : ""
                        }`}
                        style={{
                          backgroundColor: reached ? headerColor : "#fff",
                          borderColor: reached ? headerColor : "#E5E7EB",
                        }}
                      >
                        {reached ? (
                          <CheckCircle2 size={14} className="text-white" />
                        ) : (
                          <span className="w-1.5 h-1.5 rounded-full bg-[#D1D5DB]" />
                        )}
                      </div>
                      <span
                        className="text-[10px] font-semibold mt-1.5"
                        style={{ color: reached ? headerColor : "#9CA3AF" }}
                      >
                        {label}
                      </span>
                    </div>
                    {i < 2 && (
                      <div
                        className="flex-1 h-0.5 mx-1.5 -mt-4 rounded-full transition-colors"
                        style={{ backgroundColor: i < stepIdx ? headerColor : "#E5E7EB" }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Items */}
        <div className="bg-white rounded-3xl border border-[#E5E7EB] p-4">
          {order.items.map((c) => (
            <div key={c.itemId} className="flex justify-between text-sm py-2 border-b border-[#E5E7EB] last:border-0">
              <span className="text-[#374151]">
                {c.name}
              </span>
              <span className="text-[#6B7280]">× {c.qty}</span>
            </div>
          ))}
        </div>

        {/* Cancellation window */}
        {canCancel && (
          <div className="mt-4 bg-white rounded-3xl border border-[#E5E7EB] p-4">
            <div className="flex items-center gap-1.5 text-[#374151] text-sm">
              <Clock size={15} style={{ color: themeColor }} />
              You can cancel for the next{" "}
              <span className="font-bold tabular-nums" style={{ color: themeColor }}>
                {mm}:{ss}
              </span>
            </div>
            <button
              onClick={handleCancel}
              disabled={cancelling}
              className="mt-3 w-full border-2 border-[#EF4444] text-[#EF4444] rounded-2xl py-3 font-semibold text-sm disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              {cancelling ? "Cancelling..." : "Cancel order"}
            </button>
          </div>
        )}

        {!cancelled && !completed && !canCancel && order.cancelMinutes > 0 && (
          <p className="mt-4 text-center text-xs text-[#9CA3AF]">
            Cancellation window has passed — your order is being prepared. 👨‍🍳
          </p>
        )}

        {completed && (
          <p className="mt-4 text-center text-sm text-[#6B7280]">Your order has been served. Enjoy your meal! 🍽️</p>
        )}

        {cancelled && <p className="mt-4 text-center text-sm text-[#6B7280]">This order was cancelled.</p>}

        <button
          onClick={cancelled || completed ? onBack : onAddMore}
          className="mt-5 w-full rounded-2xl py-3.5 text-white font-semibold text-sm active:scale-[0.98] transition-transform"
          style={{ backgroundColor: headerColor }}
        >
          {cancelled ? "Back to menu" : completed ? "Done" : "Add more items"}
        </button>
      </div>
    </div>
  );
}
