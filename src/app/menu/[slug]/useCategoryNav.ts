"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Category navigation for the public menu — the shared brain behind the sticky
 * tab strip, the MENU jump sheet and the Speciality nudge.
 *
 * Three things make the jump feel smooth, and each one is a bug fix:
 *
 * 1. **Scroll spy.** The active tab used to change only on tap, so scrolling
 *    left it pointing at the wrong category. An IntersectionObserver watching a
 *    1px band just under the sticky header keeps it honest.
 * 2. **No drift.** Menu sections use `content-visibility: auto`, so an unpainted
 *    section is only ~480px tall as far as layout is concerned. Smooth-scrolling
 *    past a few of those made the page land on the wrong dish. We un-skip every
 *    section for the duration of the jump so the target offset is real.
 * 3. **One scroll at a time.** The tab strip used to be centred with
 *    `scrollIntoView`, which also nudges the page — two smooth scrolls fighting
 *    each other. It now scrolls its own container directly.
 */

/** Max frames to wait for a smooth scroll to settle (~1s at 60fps). */
const SETTLE_FRAME_BUDGET = 60;
/** Frames of an unchanged scrollY that count as "the animation is done". */
const SETTLE_STILL_FRAMES = 3;

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function categorySectionId(catId: string): string {
  return `cat-${catId}`;
}

interface Options {
  categories: { id: string }[];
  /** Live height of the sticky nav — targets land flush beneath it. */
  navH: number;
}

export function useCategoryNav({ categories, navH }: Options) {
  const [activeCatId, setActiveCatId] = useState<string | null>(categories[0]?.id ?? null);

  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const stripRef = useRef<HTMLDivElement | null>(null);

  /** True while a programmatic jump is in flight — the spy stands down. */
  const jumpingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const navHRef = useRef(navH);
  const orderRef = useRef(categories.map((c) => c.id));

  useEffect(() => {
    navHRef.current = navH;
  }, [navH]);

  useEffect(() => {
    orderRef.current = categories.map((c) => c.id);
  }, [categories]);

  const registerTab = useCallback((catId: string, el: HTMLButtonElement | null) => {
    tabRefs.current[catId] = el;
  }, []);

  // ── horizontal tab strip ──────────────────────────────────────────────────
  // Scroll the strip's own scroll box. `scrollIntoView` would also scroll the
  // page, which is what made tapping a tab feel like it overshot.
  const centreTab = useCallback((catId: string, instant = false) => {
    const strip = stripRef.current;
    const tab = tabRefs.current[catId];
    if (!strip || !tab) return;
    const left = tab.offsetLeft - (strip.clientWidth - tab.offsetWidth) / 2;
    const max = strip.scrollWidth - strip.clientWidth;
    const next = Math.max(0, Math.min(left, max));
    if (Math.abs(strip.scrollLeft - next) < 2) return;
    strip.scrollTo({ left: next, behavior: instant || prefersReducedMotion() ? "auto" : "smooth" });
  }, []);

  // Keep the active tab in view no matter who changed it (tap or scroll spy).
  useEffect(() => {
    if (activeCatId) centreTab(activeCatId);
  }, [activeCatId, centreTab]);

  // ── scroll spy ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const sections = orderRef.current
      .map((id) => document.getElementById(categorySectionId(id)))
      .filter((el): el is HTMLElement => Boolean(el));
    if (sections.length === 0) return;

    const intersecting = new Set<string>();
    const viewportH = window.innerHeight;
    // A 1px band sitting immediately below the sticky nav: whichever section
    // crosses it is the one the customer is actually looking at.
    const bottomInset = Math.max(0, viewportH - navH - 2);

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.replace(/^cat-/, "");
          if (entry.isIntersecting) intersecting.add(id);
          else intersecting.delete(id);
        }
        if (jumpingRef.current) return;
        // Prefer the earliest category in menu order — at a section boundary two
        // can touch the band for a frame, and the upper one owns the header.
        const next = orderRef.current.find((id) => intersecting.has(id));
        // Empty means we're above the first section (the specials rail) or in a
        // gap; keep the last known tab rather than flickering back to the top.
        if (next) setActiveCatId((prev) => (prev === next ? prev : next));
      },
      { rootMargin: `-${navH}px 0px -${bottomInset}px 0px`, threshold: 0 },
    );

    for (const section of sections) io.observe(section);
    return () => io.disconnect();
    // Re-observe when the rendered section list changes (search/filter) or when
    // the sticky nav resizes, since both move the observation band.
  }, [categories, navH]);

  // ── programmatic jump ─────────────────────────────────────────────────────
  const endJump = useCallback(() => {
    jumpingRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    document.body.classList.remove("cv-measure");
  }, []);

  useEffect(() => endJump, [endJump]);

  /**
   * Scroll a category header flush under the sticky nav.
   * Returns false when the section isn't in the DOM (filtered out), so callers
   * can clear filters and retry instead of leaving a dead tap.
   */
  const scrollToCategory = useCallback(
    (catId: string): boolean => {
      const el = document.getElementById(categorySectionId(catId));
      setActiveCatId(catId);
      centreTab(catId);
      if (!el) return false;

      endJump();
      jumpingRef.current = true;

      // Turn off content-visibility skipping for the whole menu so every section
      // reports its true height; without this the target offset moves under the
      // running animation and the jump lands short.
      document.body.classList.add("cv-measure");
      void document.documentElement.offsetHeight; // force the layout to commit

      const top = el.getBoundingClientRect().top + window.scrollY - navHRef.current;
      const reduce = prefersReducedMotion();

      if (reduce) {
        window.scrollTo({ top, behavior: "auto" });
        endJump();
        return true;
      }

      window.scrollTo({ top, behavior: "smooth" });

      // Release once the page stops moving (or the budget runs out) so the spy
      // takes over again and content-visibility goes back to saving frames.
      let frames = 0;
      let still = 0;
      let last = window.scrollY;
      const tick = () => {
        const now = window.scrollY;
        still = Math.abs(now - last) < 1 ? still + 1 : 0;
        last = now;
        if (still >= SETTLE_STILL_FRAMES || ++frames > SETTLE_FRAME_BUDGET) {
          endJump();
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
      return true;
    },
    [centreTab, endJump],
  );

  // A touch or wheel mid-flight means the customer took over — hand the scroll
  // back immediately instead of finishing an animation they interrupted.
  useEffect(() => {
    const abort = () => {
      if (jumpingRef.current) endJump();
    };
    window.addEventListener("touchstart", abort, { passive: true });
    window.addEventListener("wheel", abort, { passive: true });
    return () => {
      window.removeEventListener("touchstart", abort);
      window.removeEventListener("wheel", abort);
    };
  }, [endJump]);

  const scrollToTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, []);

  return { activeCatId, setActiveCatId, registerTab, stripRef, scrollToCategory, scrollToTop };
}
