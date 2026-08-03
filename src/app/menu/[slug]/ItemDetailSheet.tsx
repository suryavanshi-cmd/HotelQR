"use client";
import { useEffect, useState, memo } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { X, Star } from "lucide-react";
import { VegIndicator } from "@/components/ui/VegIndicator";
import { DishPhoto, AddControl, RealRating } from "./SignatureShowcase";
import type { MenuItem } from "@/types/database";

/** The one source of truth for "has this device rated this dish already". */
export function storedRating(itemId: string): number {
  if (typeof window === "undefined") return 0;
  return Number(sessionStorage.getItem(`rated-${itemId}`)) || 0;
}

/**
 * Tappable five-star row. Shows the value this device already gave (from
 * sessionStorage, same key submitRating writes) and locks after one rating —
 * matching the one-rating-per-session rule enforced upstream.
 */
export const StarRater = memo(function StarRater({
  itemId,
  themeColor,
  onRate,
  size = 26,
}: {
  itemId: string;
  themeColor: string;
  onRate: (value: number) => void;
  size?: number;
}) {
  const [given, setGiven] = useState(() => storedRating(itemId));
  const [hover, setHover] = useState(0);
  const shown = given || hover;

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((s) => (
        <button
          key={s}
          disabled={given > 0}
          onMouseEnter={() => setHover(s)}
          onMouseLeave={() => setHover(0)}
          onClick={() => {
            if (given) return;
            setGiven(s);
            onRate(s);
          }}
          className="min-h-0 min-w-0 p-0.5 disabled:cursor-default"
          aria-label={given ? `You rated ${given} star${given > 1 ? "s" : ""}` : `Rate ${s} star${s > 1 ? "s" : ""}`}
        >
          <Star
            size={size}
            style={{
              color: s <= shown ? themeColor : "#E5E7EB",
              fill: s <= shown ? themeColor : "transparent",
              transition: "color 120ms, fill 120ms",
            }}
          />
        </button>
      ))}
      {given > 0 && <span className="ml-1.5 text-[12px] font-semibold text-[#6B7280]">Thanks!</span>}
    </div>
  );
});

/**
 * Post-serve rating block for the order-status screen. Each dish the customer
 * actually ordered gets a star row — ratings collected here come from someone
 * who verifiably ate the food, which is what makes them worth showing.
 */
export const RateDishes = memo(function RateDishes({
  items,
  themeColor,
  onRate,
}: {
  items: { itemId: string; name: string }[];
  themeColor: string;
  onRate: (itemId: string, value: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="bg-white rounded-3xl border border-[#E5E7EB] p-4 mt-4">
      <p className="text-[14px] font-bold text-[#1C1C2E]">How was the food?</p>
      <p className="text-[11.5px] text-[#9CA3AF] mt-0.5 mb-1">
        Your rating helps the next guest choose.
      </p>
      {items.map((it) => (
        <div key={it.itemId} className="flex items-center justify-between gap-3 py-2.5 border-b border-[#F0F0F2] last:border-0 last:pb-0">
          <span className="text-[13px] font-semibold text-[#374151] line-clamp-1 flex-1 min-w-0">{it.name}</span>
          <StarRater itemId={it.itemId} themeColor={themeColor} onRate={(v) => onRate(it.itemId, v)} size={20} />
        </div>
      ))}
    </div>
  );
});

/**
 * Dish detail sheet — what opens when a customer taps a dish card.
 *
 * Before this existed, tapping a card did nothing: the only interactions were
 * the ADD button and an undiscoverable 500ms long-press. This is the standard
 * food-app core loop (tap → look properly → decide), and it is where the
 * full-size photo, the unclamped description, and the rating UI live.
 */
export function ItemDetailSheet({
  item,
  rating,
  qty,
  themeColor,
  currencySymbol = "₹",
  onAdd,
  onDec,
  onRate,
  onClose,
}: {
  item: MenuItem;
  rating?: { sum: number; count: number };
  qty: number;
  themeColor: string;
  currencySymbol?: string;
  onAdd: () => void;
  onDec: () => void;
  onRate: (value: number) => void;
  onClose: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Same discipline as the Speciality sheet: lock the page, close on Escape.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="item-detail-backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[9999] flex items-end justify-center"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/55 backdrop-blur-[4px]" />

        <motion.div
          initial={reduceMotion ? false : { y: "100%" }}
          animate={{ y: 0 }}
          transition={{ type: "spring", stiffness: 380, damping: 36 }}
          drag={reduceMotion ? false : "y"}
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0, bottom: 0.35 }}
          dragMomentum={false}
          onDragEnd={(_, info) => {
            if (info.offset.y > 90 || info.velocity.y > 450) onClose();
          }}
          role="dialog"
          aria-modal="true"
          aria-label={item.name}
          className="relative w-full max-w-[460px] max-h-[92vh] flex flex-col rounded-t-[28px] overflow-hidden bg-white shadow-[0_-16px_64px_rgba(0,0,0,0.22)]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Photo with close button overlaid — the image goes to the very top
              edge so the food, not chrome, is the first thing seen. */}
          <div className="relative w-full aspect-[4/3] bg-[#F4F4F6] shrink-0">
            <DishPhoto item={item} themeColor={themeColor} sizes="(max-width: 480px) 100vw, 460px" priority />
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute top-3 right-3 w-8 h-8 rounded-full bg-white/95 backdrop-blur-sm text-[#374151] flex items-center justify-center shadow-md min-h-0 min-w-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <X size={16} />
            </button>
            {item.badge && (
              <span className="absolute top-3 left-3 bg-white/95 backdrop-blur-sm text-[11px] font-bold text-[#1C1C2E] px-2.5 py-1 rounded-full shadow-sm">
                {item.badge}
              </span>
            )}
          </div>

          <div className="overflow-y-auto overscroll-contain p-5">
            <div className="flex items-start gap-2">
              <span className="mt-1 shrink-0">
                <VegIndicator type={item.food_type} />
              </span>
              <h2 className="text-[21px] font-extrabold text-[#1C1C2E] leading-[1.2] tracking-[-0.02em] flex-1 min-w-0">
                {item.name}
              </h2>
            </div>

            {rating && rating.count > 0 && (
              <div className="mt-2">
                <RealRating rating={rating} size="lg" />
              </div>
            )}

            {item.description && (
              // Unclamped — this is the one place the whole description fits.
              <p className="mt-3 text-[14px] leading-[1.6] text-[#4B5563]">{item.description}</p>
            )}

            {/* Rating moved here from the hidden long-press. */}
            <div className="mt-5 pt-4 border-t border-[#F0F0F2]">
              <p className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#9CA3AF] mb-2">
                Tried it? Rate it
              </p>
              <StarRater itemId={item.id} themeColor={themeColor} onRate={onRate} />
            </div>
          </div>

          {/* Sticky action bar: price + add, always reachable */}
          <div className="shrink-0 px-5 py-4 border-t border-[#F0F0F2] bg-white flex items-center justify-between gap-4">
            <span className="text-[22px] font-extrabold text-[#1C1C2E] tabular-nums leading-none">
              {currencySymbol}
              {item.price}
            </span>
            <div className="w-[150px]">
              <AddControl qty={qty} onAdd={onAdd} onDec={onDec} themeColor={themeColor} big />
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
