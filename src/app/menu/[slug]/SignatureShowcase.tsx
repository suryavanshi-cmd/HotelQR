"use client";
import { memo, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { motion } from "framer-motion";
import { ChefHat, Star, Plus, Minus, UtensilsCrossed } from "lucide-react";
import { VegIndicator } from "@/components/ui/VegIndicator";
import type { MenuItem } from "@/types/database";

const BLUR_DATA_URL =
  "data:image/jpeg;base64,/9j/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

export type RatingAgg = Record<string, { sum: number; count: number }>;

// Indian digit grouping (₹1,20,000, not ₹120,000) — the menus this app
// serves are priced in rupees, and most dish prices are under 1,000 so this
// is a no-op there; it only kicks in for the family-thali/buffet-package
// prices where the grouping actually helps at a glance.
const priceFormatter = new Intl.NumberFormat("en-IN");
export function formatPrice(price: number): string {
  return priceFormatter.format(price);
}

interface Props {
  /** Already filtered to available specials by the caller. */
  items: MenuItem[];
  ratings: RatingAgg;
  cartQty: Record<string, number>;
  themeColor: string;
  currencySymbol?: string;
  onAdd: (item: MenuItem) => void;
  onDec: (itemId: string) => void;
  /** Open the dish detail sheet — tapping anywhere on the card. */
  onOpen: (item: MenuItem) => void;
}

/**
 * Real rating only. Renders nothing when nobody has rated the dish, rather than
 * a hopeful "New!" or an empty star row that implies a score nobody gave.
 */
export const RealRating = memo(function RealRating({
  rating,
  size = "sm",
}: {
  rating?: { sum: number; count: number };
  size?: "sm" | "lg";
}) {
  if (!rating || rating.count === 0) return null;
  const avg = rating.sum / rating.count;
  const lg = size === "lg";
  return (
    <span className={`inline-flex items-center gap-1 ${lg ? "text-[13px]" : "text-[11px]"}`}>
      <Star size={lg ? 13 : 10} className="fill-[#16A34A] text-[#16A34A]" />
      <span className="font-bold text-[#16A34A] tabular-nums">{avg.toFixed(1)}</span>
      <span className="text-[#9CA3AF] tabular-nums">({rating.count})</span>
    </span>
  );
});

/**
 * The single dish-photo renderer, shared by every card size (hero, rail,
 * grid, row, detail sheet). A real photo gets a very light saturation lift —
 * the same trick food photography and delivery apps lean on, since a slightly
 * richer tone reads as more appetising without looking edited. It changes how
 * the photo renders, not what the dish is — nothing about the image itself is
 * fabricated.
 *
 * When there is no photo — or the photo URL 404s, which happens when a
 * hotel deletes an image from storage without clearing it from the dish, or
 * an OCR import saves a URL that never resolves — the old placeholder was a
 * flat tint with a plate emoji at half-opacity, and a broken image had no
 * placeholder at all: the browser's own broken-image icon. Both read as an
 * error, not a design choice. Now either case gets the same two-tone
 * gradient plus a monochrome icon tinted to the hotel's own theme color.
 */
export function DishPhoto({
  item,
  themeColor,
  sizes,
  priority = false,
}: {
  item: MenuItem;
  themeColor: string;
  sizes: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  // A new photo URL (admin swapped it, or the customer scrolled to a
  // different dish reusing this instance) deserves a fresh attempt.
  useEffect(() => setFailed(false), [item.image_url]);

  if (!item.image_url || failed) {
    return (
      <div
        className="w-full h-full flex items-center justify-center"
        style={{ background: `linear-gradient(155deg, ${themeColor}1F 0%, ${themeColor}0A 60%, ${themeColor}14 100%)` }}
      >
        <UtensilsCrossed className="w-[30%] h-[30%] max-w-9 max-h-9" style={{ color: `${themeColor}55` }} strokeWidth={1.5} />
      </div>
    );
  }
  return (
    <Image
      src={item.image_url}
      alt={item.name}
      fill
      sizes={sizes}
      // The hero is the largest thing above the fold — lazy-loading it meant the
      // section's whole reason for existing arrived last.
      priority={priority}
      loading={priority ? undefined : "lazy"}
      placeholder="blur"
      blurDataURL={BLUR_DATA_URL}
      onError={() => setFailed(true)}
      className="object-cover saturate-[1.08] contrast-[1.03]"
    />
  );
}

export const AddControl = memo(function AddControl({
  qty,
  onAdd,
  onDec,
  themeColor,
  big = false,
}: {
  qty: number;
  onAdd: () => void;
  onDec: () => void;
  themeColor: string;
  big?: boolean;
}) {
  const h = big ? "h-11" : "h-9";
  if (qty === 0) {
    return (
      <motion.button
        whileTap={{ scale: 0.94 }}
        onClick={onAdd}
        aria-label="Add to order"
        className={`w-full ${h} rounded-xl text-white flex items-center justify-center gap-1.5 font-extrabold ${big ? "text-[15px]" : "text-[13px]"} tracking-wide min-h-0`}
        style={{ backgroundColor: themeColor }}
      >
        ADD
        <Plus size={big ? 17 : 14} strokeWidth={3} />
      </motion.button>
    );
  }
  return (
    <motion.div
      initial={{ scale: 0.94, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      className={`w-full ${h} rounded-xl bg-white border-2 flex items-center justify-between`}
      style={{ borderColor: themeColor }}
    >
      <button
        onClick={onDec}
        aria-label="Decrease quantity"
        className="h-full px-3 flex items-center justify-center min-h-0 min-w-0"
        style={{ color: themeColor }}
      >
        <Minus size={big ? 17 : 15} strokeWidth={3} />
      </button>
      <motion.span
        key={qty}
        initial={{ scale: 1.25 }}
        animate={{ scale: 1 }}
        className={`font-extrabold ${big ? "text-base" : "text-sm"} tabular-nums select-none`}
        style={{ color: themeColor }}
      >
        {qty}
      </motion.span>
      <button
        onClick={onAdd}
        aria-label="Increase quantity"
        className="h-full px-3 flex items-center justify-center min-h-0 min-w-0"
        style={{ color: themeColor }}
      >
        <Plus size={big ? 17 : 15} strokeWidth={3} />
      </button>
    </motion.div>
  );
});

/**
 * The one dish the section leads with. Deliberately restrained: a large photo
 * does the persuading, then name, description, real rating and price sit on
 * clean white. No gradient stack, no glow, no shimmer — those competed with the
 * food and made the card read as an ad rather than as something to eat.
 */
const Hero = memo(function Hero({
  item,
  themeColor,
  currencySymbol,
  rating,
  qty,
  onAdd,
  onDec,
  onOpen,
}: {
  item: MenuItem;
  themeColor: string;
  currencySymbol: string;
  rating?: { sum: number; count: number };
  qty: number;
  onAdd: () => void;
  onDec: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="px-4">
      <div className="rounded-[22px] overflow-hidden bg-white border border-[#EFEFF1] shadow-[0_10px_36px_rgba(17,17,26,0.07)]">
        {/* 4:3 gives a plated dish room to actually look like food. */}
        <div className="relative w-full aspect-[4/3] bg-[#F4F4F6] cursor-pointer" onClick={onOpen}>
          <DishPhoto item={item} themeColor={themeColor} sizes="(max-width: 480px) 100vw, 460px" priority />
          {item.badge && (
            <span className="absolute top-3 left-3 bg-white/95 backdrop-blur-sm text-[11px] font-bold text-[#1C1C2E] px-2.5 py-1 rounded-full shadow-sm">
              {item.badge}
            </span>
          )}
        </div>

        <div className="p-4">
          <div className="flex items-start gap-2">
            <span className="mt-1 shrink-0">
              <VegIndicator type={item.food_type} />
            </span>
            <h3 className="text-[20px] font-extrabold text-[#1C1C2E] leading-[1.2] tracking-[-0.02em] flex-1 min-w-0">
              {item.name}
            </h3>
          </div>

          {item.description && (
            // Given room to be read. At 11.5px clamped to two lines it was
            // decoration; the description is what actually sells a dish.
            <p className="mt-2 text-[13.5px] leading-[1.5] text-[#6B7280] line-clamp-3">{item.description}</p>
          )}

          {rating && rating.count > 0 && (
            <div className="mt-3">
              <RealRating rating={rating} size="lg" />
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-[22px] font-extrabold text-[#1C1C2E] tabular-nums leading-none">
              {currencySymbol}
              {formatPrice(item.price)}
            </span>
            <div className="w-[140px]">
              <AddControl qty={qty} onAdd={onAdd} onDec={onDec} themeColor={themeColor} big />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

const RailCard = memo(function RailCard({
  item,
  themeColor,
  currencySymbol,
  rating,
  qty,
  onAdd,
  onDec,
  onOpen,
}: {
  item: MenuItem;
  themeColor: string;
  currencySymbol: string;
  rating?: { sum: number; count: number };
  qty: number;
  onAdd: () => void;
  onDec: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="flex-shrink-0 w-[168px] snap-start">
      <div
        className="relative w-full aspect-square rounded-2xl overflow-hidden bg-[#F4F4F6] border border-[#EFEFF1] shadow-[0_6px_20px_rgba(17,17,26,0.06)] cursor-pointer"
        onClick={onOpen}
      >
        <DishPhoto item={item} themeColor={themeColor} sizes="168px" />
        {/* A badge only when the owner wrote one. Stamping every dish
            "Chef's Pick" labelled nothing and covered the food it was selling. */}
        {item.badge && (
          <span className="absolute top-2 left-2 bg-white/95 backdrop-blur-sm text-[10px] font-bold text-[#1C1C2E] px-2 py-0.5 rounded-full shadow-sm">
            {item.badge}
          </span>
        )}
      </div>

      <div className="mt-2.5 px-0.5">
        <div className="flex items-center gap-1.5">
          <VegIndicator type={item.food_type} />
          <span className="text-[13.5px] font-bold text-[#1C1C2E] leading-tight line-clamp-1">{item.name}</span>
        </div>
        <div className="mt-1 min-h-[16px]">
          <RealRating rating={rating} />
        </div>
        <p className="text-[15px] font-extrabold text-[#1C1C2E] leading-none tabular-nums mt-1.5">
          {currencySymbol}
          {formatPrice(item.price)}
        </p>
        <div className="mt-2">
          <AddControl qty={qty} onAdd={onAdd} onDec={onDec} themeColor={themeColor} />
        </div>
      </div>
    </div>
  );
});

/**
 * Chef's Signature: one hero dish, then the rest.
 *
 * The old section was a rail of six identically-sized cards. Equal weight gives
 * the eye nowhere to land and makes every special feel interchangeable, so the
 * whole section got swiped past. Leading with a single large dish creates a
 * focal point; the rail below carries the alternatives for anyone who wants one.
 */
export const SignatureShowcase = memo(function SignatureShowcase({
  items,
  ratings,
  cartQty,
  themeColor,
  currencySymbol = "₹",
  onAdd,
  onDec,
  onOpen,
}: Props) {
  // Which special leads. Ranked on things that are actually true: a real rating
  // average, an owner-written badge, whether there is a photo worth showing
  // large. No invented "trending" or "only 2 left" — a customer who orders on a
  // fabricated cue and notices feels tricked, and the hotel wears that.
  const [hero, rest] = useMemo(() => {
    if (items.length === 0) return [null, [] as MenuItem[]];
    const score = (item: MenuItem) => {
      const r = ratings[item.id];
      // Weighted toward the mean so a lone 5★ does not outrank a 4.7 from 40.
      const rated = r && r.count > 0 ? (r.sum + 4 * 5) / (r.count + 5) : 0;
      return rated * 10 + (item.image_url ? 6 : 0) + (item.badge ? 2 : 0);
    };
    const sorted = [...items].sort((a, b) => score(b) - score(a));
    return [sorted[0], sorted.slice(1)];
  }, [items, ratings]);

  if (!hero) return null;

  return (
    <div className="pt-6 pb-2">
      {/* Quiet label — the dish is the headline, not the section name. */}
      <div className="px-4 mb-3 flex items-center gap-1.5">
        <ChefHat size={13} className="text-amber-600" />
        <span className="text-[11px] font-bold uppercase tracking-[0.14em] text-amber-700">
          Chef&apos;s Signature
        </span>
      </div>

      <Hero
        item={hero}
        themeColor={themeColor}
        currencySymbol={currencySymbol}
        rating={ratings[hero.id]}
        qty={cartQty[hero.id] ?? 0}
        onAdd={() => onAdd(hero)}
        onDec={() => onDec(hero.id)}
        onOpen={() => onOpen(hero)}
      />

      {rest.length > 0 && (
        <>
          <p className="px-4 mt-6 mb-3 text-[13px] font-semibold text-[#6B7280]">More from the chef</p>
          <div className="flex gap-3.5 overflow-x-auto scrollbar-hide px-4 pb-1 rail snap-x scroll-px-4">
            {rest.map((item) => (
              <RailCard
                key={item.id}
                item={item}
                themeColor={themeColor}
                currencySymbol={currencySymbol}
                rating={ratings[item.id]}
                qty={cartQty[item.id] ?? 0}
                onAdd={() => onAdd(item)}
                onDec={() => onDec(item.id)}
                onOpen={() => onOpen(item)}
              />
            ))}
          </div>
        </>
      )}
      <div className="h-2 bg-[#F4F4F6] mt-6" />
    </div>
  );
});
