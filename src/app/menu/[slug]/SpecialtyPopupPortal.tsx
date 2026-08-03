"use client";
import { useEffect, useState, useCallback, useRef, memo } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChefHat, X, Plus, Sparkles } from "lucide-react";
import Image from "next/image";

const BLUR_PLACEHOLDER =
  "data:image/jpeg;base64,/9j/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

export interface SpecialtyItem {
  id: string;
  name: string;
  price: number;
  description?: string | null;
  food_type?: string | null;
  /** Passed through from MenuItem — rendered as card image when present. */
  image_url?: string | null;
  /** Passed through from MenuItem.badge — shown as an accent chip. */
  badge?: string | null;
}

interface SpecialtyPopupPortalProps {
  isEnabled: boolean;
  durationSeconds: number;
  items: SpecialtyItem[];
  themeColor: string;
  currencySymbol?: string;
  onAdd?: (itemId: string) => void;
  onViewMenu?: () => void;
  persistent?: boolean;
  /**
   * Distance in px to float the banner above the viewport bottom. The parent
   * raises it when the cart bar or the MENU button moves up, so the two never
   * sit on top of each other.
   */
  offsetBottom?: number;
}

// ─── animation variants ──────────────────────────────────────────────────────

const bannerVariants = {
  hidden: { opacity: 0, y: 28, scale: 0.9 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { type: "spring", stiffness: 300, damping: 22 },
  },
  exit: {
    opacity: 0,
    y: 14,
    scale: 0.94,
    transition: { duration: 0.2, ease: "easeIn" },
  },
} as const;

const sheetVariants = {
  hidden: { y: "100%" },
  visible: {
    y: 0,
    transition: { type: "spring", stiffness: 380, damping: 34 },
  },
  exit: {
    y: "100%",
    transition: { type: "spring", stiffness: 380, damping: 34 },
  },
} as const;

// 0.07s per card meant the 14th special landed a full second after the first —
// the list read as still loading. Tightened so a long menu finishes with the
// sheet's own slide-in rather than trailing behind it.
const listVariants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.035, delayChildren: 0.06 } },
} as const;

const cardVariants = {
  hidden: { opacity: 0, y: 18 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 320, damping: 26 },
  },
} as const;

// ─── helpers ─────────────────────────────────────────────────────────────────

function foodColor(type?: string | null) {
  if (type === "non_veg") return "#EF4444";
  if (type === "egg") return "#F59E0B";
  return "#10B981";
}

function FoodDot({ type }: { type?: string | null }) {
  const c = foodColor(type);
  return (
    <span
      className="inline-flex w-[14px] h-[14px] rounded-[3px] border-[2px] items-center justify-center shrink-0"
      style={{ borderColor: c }}
    >
      <span className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: c }} />
    </span>
  );
}

// ─── tactile ADD button ───────────────────────────────────────────────────────

const AddButton = memo(function AddButton({
  itemId,
  onAdd,
}: {
  itemId: string;
  onAdd: (id: string) => void;
}) {
  const [flash, setFlash] = useState(false);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const handleClick = useCallback(() => {
    onAdd(itemId);
    setFlash(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlash(false), 650);
  }, [itemId, onAdd]);

  return (
    <motion.button
      whileHover={{ scale: 1.06 }}
      whileTap={{ scale: 0.91 }}
      transition={{ type: "spring", stiffness: 400, damping: 20 }}
      onClick={handleClick}
      aria-label="Add to order"
      className="flex items-center gap-1.5 text-white text-[11.5px] font-bold px-3.5 py-1.5 rounded-full shrink-0 min-h-0 transition-all duration-200"
      style={{
        background: flash
          ? "linear-gradient(135deg, #10B981 0%, #059669 100%)"
          : "linear-gradient(135deg, #F59E0B 0%, #EA580C 100%)",
        boxShadow: flash
          ? "0 4px 16px rgba(16,185,129,0.45)"
          : "0 4px 16px rgba(245,158,11,0.40)",
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {flash ? (
          <motion.span
            key="check"
            initial={{ scale: 0, rotate: -20 }}
            animate={{ scale: 1, rotate: 0 }}
            exit={{ scale: 0 }}
            transition={{ type: "spring", stiffness: 500, damping: 22 }}
            className="text-white leading-none"
          >
            ✓
          </motion.span>
        ) : (
          <motion.span
            key="plus"
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.7, opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="flex items-center gap-1"
          >
            <Plus size={12} strokeWidth={3} />
          </motion.span>
        )}
      </AnimatePresence>
      {flash ? "Added!" : "ADD"}
    </motion.button>
  );
});

// ─── premium item card ────────────────────────────────────────────────────────

const SpecialtyCard = memo(function SpecialtyCard({
  item,
  currencySymbol,
  onAdd,
}: {
  item: SpecialtyItem;
  currencySymbol: string;
  onAdd: (id: string) => void;
}) {
  return (
    <motion.div
      variants={cardVariants}
      className="flex gap-3.5 py-4 border-b border-amber-50/80 last:border-0"
    >
      {/* Thumbnail */}
      <div className="relative w-[78px] h-[78px] rounded-2xl overflow-hidden bg-gradient-to-br from-amber-50 to-orange-50 shrink-0 border border-amber-100/70 shadow-sm">
        {item.image_url ? (
          <Image
            src={item.image_url}
            alt={item.name}
            fill
            sizes="78px"
            loading="lazy"
            placeholder="blur"
            blurDataURL={BLUR_PLACEHOLDER}
            className="object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[26px]">🍽️</div>
        )}
        {/* Subtle inset ring to lift image off background */}
        <div className="absolute inset-0 ring-inset ring-1 ring-black/[0.06] rounded-2xl pointer-events-none" />
        {/* "Chef's Pick" micro-badge */}
        <div className="absolute -top-0.5 -right-0.5 bg-gradient-to-br from-amber-500 to-orange-500 rounded-bl-xl rounded-tr-2xl px-1.5 py-0.5">
          <ChefHat size={9} className="text-white" />
        </div>
      </div>

      {/* Details */}
      <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
        <div>
          <div className="flex items-center gap-1.5 mb-1">
            <FoodDot type={item.food_type} />
            <h3 className="text-[14px] font-bold text-[#1C1C2E] leading-tight line-clamp-1 flex-1 min-w-0">
              {item.name}
            </h3>
          </div>
          {item.badge && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200/60 px-1.5 py-0.5 rounded-full mb-1">
              <Sparkles size={8} />
              {item.badge}
            </span>
          )}
          {item.description && (
            <p className="text-[11.5px] text-[#6B7280] leading-snug line-clamp-2 mt-0.5">{item.description}</p>
          )}
        </div>
        <div className="flex items-center justify-between mt-2 gap-2">
          <span className="text-[16px] font-extrabold text-amber-700 tabular-nums leading-none">
            {currencySymbol}{item.price}
          </span>
          <AddButton itemId={item.id} onAdd={onAdd} />
        </div>
      </div>
    </motion.div>
  );
});

// ─── main portal ─────────────────────────────────────────────────────────────

export function SpecialtyPopupPortal({
  isEnabled,
  durationSeconds,
  items,
  themeColor,
  currencySymbol = "₹",
  onAdd,
  onViewMenu,
  persistent = false,
  offsetBottom = 90,
}: SpecialtyPopupPortalProps) {
  const [mounted, setMounted] = useState(false);
  const [barVisible, setBarVisible] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const reopenTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!isEnabled) return;
    const showTimer = setTimeout(() => setBarVisible(true), 500);
    if (persistent) return () => clearTimeout(showTimer);
    const hideTimer = setTimeout(() => setBarVisible(false), 500 + Math.max(1, durationSeconds) * 1000);
    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, [isEnabled, durationSeconds, persistent]);

  useEffect(
    () => () => {
      if (reopenTimer.current) clearTimeout(reopenTimer.current);
    },
    [],
  );

  const openSheet = useCallback(() => {
    if (reopenTimer.current) clearTimeout(reopenTimer.current);
    setBarVisible(false);
    setSheetOpen(true);
  }, []);

  const closeSheet = useCallback(() => {
    setSheetOpen(false);
    // In persistent mode, bring the banner back so it remains discoverable.
    if (!persistent) return;
    if (reopenTimer.current) clearTimeout(reopenTimer.current);
    reopenTimer.current = setTimeout(() => setBarVisible(true), 350);
  }, [persistent]);

  // Lock the page behind the sheet. Without this the menu scrolls under the
  // backdrop on iOS as soon as a drag overshoots the item list.
  useEffect(() => {
    if (!sheetOpen) return;
    // `overflow` only — never `touch-action: none` here: the sheet is portalled
    // into <body>, and touch-action walks up the ancestor chain, so that would
    // also kill scrolling inside the dish list.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [sheetOpen]);

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeSheet();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sheetOpen, closeSheet]);

  const handleAdd = useCallback(
    (itemId: string) => {
      const found = items.find((i) => i.id === itemId);
      if (found && onAdd) onAdd(itemId);
    },
    [items, onAdd],
  );

  if (!mounted || !isEnabled) return null;

  return createPortal(
    <>
      {/* ─── Floating premium banner ──────────────────────────────────────── */}
      <div
        className="fixed left-1/2 -translate-x-1/2 z-[9999] pointer-events-none transition-[bottom] duration-300 ease-out"
        style={{ bottom: offsetBottom }}
      >
        <AnimatePresence>
          {barVisible && (
            <motion.div
              key="specialty-banner"
              variants={bannerVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="pointer-events-auto relative"
            >
              {/* A few bobs to catch the eye, then it settles. Looping forever
                  kept a tap target permanently in motion — annoying to hit on a
                  phone — and burned compositor frames for the whole session. */}
              <motion.div
                animate={reduceMotion ? undefined : { y: [0, -6, 0] }}
                transition={{ duration: 3.2, repeat: 2, ease: "easeInOut" }}
              >
                <button
                  onClick={openSheet}
                  aria-label="View Chef's Specialities"
                  className="group relative flex items-center gap-3 rounded-[20px] overflow-hidden min-w-[260px] max-w-[340px] px-4 py-3 border border-amber-600/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                  style={{
                    background: "linear-gradient(135deg, #92400E 0%, #B45309 55%, #D97706 100%)",
                    boxShadow:
                      "0 8px 32px rgba(180,83,9,0.45), 0 2px 8px rgba(180,83,9,0.25), inset 0 1px 0 rgba(255,255,255,0.12)",
                  }}
                >
                  {/* Animated shimmer sweep */}
                  {!reduceMotion && (
                    <motion.div
                      className="absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent pointer-events-none"
                      animate={{ x: ["-100%", "200%"] }}
                      transition={{ duration: 2.8, repeat: 2, ease: "linear", repeatDelay: 1.8 }}
                    />
                  )}

                  {/* Radial glow at top-left */}
                  <div
                    className="absolute -top-6 -left-6 w-20 h-20 rounded-full pointer-events-none"
                    style={{ background: "radial-gradient(circle, rgba(253,230,138,0.25) 0%, transparent 70%)" }}
                  />

                  {/* Icon */}
                  <span className="relative w-10 h-10 rounded-[14px] flex items-center justify-center shrink-0 border border-amber-500/30"
                    style={{ background: "rgba(255,255,255,0.12)", backdropFilter: "blur(4px)" }}>
                    <ChefHat size={19} className="text-amber-100" />
                  </span>

                  {/* Copy */}
                  <span className="relative flex-1 min-w-0 text-left">
                    <span className="block text-[13.5px] font-extrabold text-white leading-tight tracking-[-0.01em]">
                      Chef&apos;s Signature Collection
                    </span>
                    <span className="block text-[11px] text-amber-200/85 mt-0.5 leading-tight">
                      Handpicked by our master chefs
                    </span>
                  </span>

                  {/* Trailing sparkle */}
                  <Sparkles size={15} className="relative text-amber-300 shrink-0" />
                </button>
              </motion.div>

              {/* Dismiss ✕ — hidden in persistent mode */}
              {!persistent && (
                <motion.button
                  whileTap={{ scale: 0.87 }}
                  onClick={() => setBarVisible(false)}
                  aria-label="Dismiss"
                  className="absolute -top-2.5 -right-2.5 w-[22px] h-[22px] rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.18)] text-gray-400 flex items-center justify-center border border-gray-100"
                >
                  <X size={11} />
                </motion.button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ─── Premium bottom sheet ─────────────────────────────────────────── */}
      <AnimatePresence>
        {sheetOpen && (
          <motion.div
            key="specialty-sheet-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-[9999] flex items-end justify-center"
            onClick={closeSheet}
          >
            {/* Backdrop */}
            <div className="absolute inset-0 bg-black/55 backdrop-blur-[6px]" />

            {/* Sheet */}
            <motion.div
              variants={sheetVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              drag={reduceMotion ? false : "y"}
              // `bottom: 0` gives dragElastic something to rubber-band against;
              // without it the sheet tracked the finger 1:1 with no resistance.
              dragConstraints={{ top: 0, bottom: 0 }}
              dragElastic={{ top: 0, bottom: 0.35 }}
              dragMomentum={false}
              onDragEnd={(_, info) => {
                if (info.offset.y > 90 || info.velocity.y > 450) closeSheet();
              }}
              role="dialog"
              aria-modal="true"
              aria-label="Chef's Specialities"
              className="relative w-full max-w-[460px] max-h-[88vh] flex flex-col rounded-t-[28px] overflow-hidden"
              style={{
                background: "#FFFFFF",
                boxShadow: "0 -16px 64px rgba(0,0,0,0.22), 0 -2px 12px rgba(0,0,0,0.08)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Drag handle */}
              <div className="pt-3 pb-2 flex justify-center shrink-0 cursor-grab active:cursor-grabbing">
                <div className="w-10 h-[5px] rounded-full bg-gray-200" />
              </div>

              {/* Header row */}
              <div className="flex items-center justify-between px-5 pb-3 shrink-0">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg, #F59E0B 0%, #EA580C 100%)" }}>
                    <ChefHat size={15} className="text-white" />
                  </div>
                  <h2 className="text-[17px] font-extrabold text-[#1C1C2E] tracking-[-0.02em]">
                    Chef&apos;s Specialities
                  </h2>
                </div>
                <motion.button
                  whileTap={{ scale: 0.88 }}
                  onClick={closeSheet}
                  aria-label="Close sheet"
                  className="w-8 h-8 rounded-full bg-[#F3F4F6] text-[#6B7280] flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                >
                  <X size={15} />
                </motion.button>
              </div>

              {/* ── Storytelling hero ──────────────────────────────────────── */}
              <div className="mx-4 mb-4 rounded-2xl border border-amber-100 overflow-hidden shrink-0"
                style={{ background: "linear-gradient(135deg, #FFFBEB 0%, #FFF7ED 50%, #FFFBEB 100%)" }}>
                <div className="flex gap-3.5 p-4">
                  {/* Chef icon with glow */}
                  <div className="shrink-0 relative">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center shadow-md"
                      style={{ background: "linear-gradient(135deg, #F59E0B 0%, #D97706 100%)" }}
                    >
                      <ChefHat size={22} className="text-white" />
                    </div>
                    {/* Glow */}
                    <div className="absolute inset-0 rounded-xl blur-md opacity-40"
                      style={{ background: "linear-gradient(135deg, #F59E0B, #EA580C)" }} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-extrabold text-amber-900 tracking-[-0.01em] mb-1 leading-snug">
                      Crafted by our Master Chefs
                    </p>
                    <p className="text-[11.5px] text-amber-800/70 leading-relaxed">
                      Using authentic locally sourced ingredients and traditional recipes
                      perfected through generations. Every dish is prepared fresh to deliver
                      unforgettable flavour in every bite.
                    </p>
                  </div>
                </div>

                {/* Subtle decorative bottom bar */}
                <div className="h-[3px]"
                  style={{ background: "linear-gradient(90deg, #F59E0B 0%, #EA580C 50%, #F59E0B 100%)" }} />
              </div>

              {/* ── Items ──────────────────────────────────────────────────── */}
              <div className="overflow-y-auto flex-1 px-4 pb-2 overscroll-contain">
                {items.length === 0 ? (
                  <div className="flex flex-col items-center py-14">
                    <span className="text-4xl mb-3 opacity-60">🍽️</span>
                    <p className="text-[13px] font-semibold text-gray-400">No specials right now.</p>
                  </div>
                ) : (
                  <motion.div
                    variants={listVariants}
                    initial={reduceMotion ? false : "hidden"}
                    animate="visible"
                  >
                    {items.map((item) => (
                      <SpecialtyCard
                        key={item.id}
                        item={item}
                        currencySymbol={currencySymbol}
                        onAdd={handleAdd}
                      />
                    ))}
                  </motion.div>
                )}
              </div>

              {/* ── Footer CTA ─────────────────────────────────────────────── */}
              {onViewMenu && (
                <div className="shrink-0 px-4 pb-6 pt-3 border-t border-amber-50">
                  <motion.button
                    whileHover={{ scale: 1.015 }}
                    whileTap={{ scale: 0.975 }}
                    transition={{ type: "spring", stiffness: 400, damping: 24 }}
                    onClick={() => {
                      closeSheet();
                      onViewMenu();
                    }}
                    className="w-full py-3.5 rounded-2xl text-white text-[14px] font-extrabold tracking-[-0.01em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                    style={{
                      background: "linear-gradient(135deg, #F59E0B 0%, #EA580C 100%)",
                      boxShadow: "0 6px 24px rgba(245,158,11,0.38), 0 2px 6px rgba(234,88,12,0.2)",
                    }}
                  >
                    View in Full Menu →
                  </motion.button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>,
    document.body,
  );
}
