import { redirect } from "next/navigation";
import Link from "next/link";
import {
  ExternalLink,
  UtensilsCrossed,
  Palette,
  QrCode,
  FolderPlus,
  Wallet,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser, getHotelByOwner } from "@/lib/supabase/cached-queries";
import { MenuLinkActions } from "./menu-link-actions";
import { TodayStats } from "./today-stats";
import type { HotelSettings, Order } from "@/types/database";

type Step = {
  key: string;
  done: boolean;
  title: string;
  desc: string;
  href: string;
  icon: LucideIcon;
};

export default async function DashboardPage() {
  // Cache hits — layout already called these; no extra DB round-trips.
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const hotel = await getHotelByOwner(user.id);
  if (!hotel) redirect("/login");

  const supabase = await createClient();

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  // Counts + onboarding signals, all in parallel.
  const [itemRes, catRes, availRes, settingsRes, paymentRes, todayOrdersRes] = await Promise.all([
    supabase.from("menu_items").select("*", { count: "exact", head: true }).eq("hotel_id", hotel.id),
    supabase.from("categories").select("*", { count: "exact", head: true }).eq("hotel_id", hotel.id),
    supabase.from("menu_items").select("*", { count: "exact", head: true }).eq("hotel_id", hotel.id).eq("is_available", true),
    supabase.from("hotel_settings").select("logo_url,currency,gst_enabled,gst_percent").eq("hotel_id", hotel.id).maybeSingle(),
    supabase.from("hotel_payment_secrets").select("hotel_id").eq("hotel_id", hotel.id).maybeSingle(),
    supabase
      .from("orders")
      .select("id,items,total,status,created_at,table_number")
      .eq("hotel_id", hotel.id)
      .gte("created_at", startOfDay.toISOString())
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const itemCount = itemRes.count ?? 0;
  const catCount = catRes.count ?? 0;
  const availCount = availRes.count ?? 0;
  const hasLogo = Boolean(settingsRes.data?.logo_url);
  const paymentApplicable = !paymentRes.error; // table may not be migrated yet
  const hasPayment = Boolean(paymentRes.data);

  // Onboarding steps — only the incomplete ones are shown, and they drop off
  // one by one as they're completed. The whole block disappears when done.
  const steps: Step[] = [
    { key: "category", done: catCount > 0, title: "Create a category", desc: "Group dishes into sections like Starters or Mains.", href: "/dashboard/menu", icon: FolderPlus },
    { key: "items", done: itemCount > 0, title: "Add menu items", desc: "Add dishes with prices & photos — or scan a printed menu.", href: "/dashboard/menu", icon: UtensilsCrossed },
    { key: "branding", done: hasLogo, title: "Upload your logo", desc: "Brand the menu with your logo and theme color.", href: "/dashboard/branding", icon: Palette },
    ...(paymentApplicable
      ? [{ key: "payment", done: hasPayment, title: "Add your UPI", desc: "Let customers pay you directly via UPI.", href: "/dashboard/payments", icon: Wallet } as Step]
      : []),
  ];

  const remaining = steps.filter((s) => !s.done);
  const doneCount = steps.length - remaining.length;
  const showChecklist = remaining.length > 0;
  const pct = Math.round((doneCount / steps.length) * 100);

  const menuUrl = `${process.env.NEXT_PUBLIC_SITE_URL ?? ""}/menu/${hotel.slug}`;

  const quickTiles = [
    { icon: UtensilsCrossed, label: "Menu", href: "/dashboard/menu" },
    { icon: Palette, label: "Branding", href: "/dashboard/branding" },
    { icon: QrCode, label: "QR Code", href: "/dashboard/qr" },
  ];

  return (
    <div className="px-4 md:px-8 py-6">
      <div>
        <h1 className="text-xl font-bold text-[#0F0E17]">Good day! 👋</h1>
        <p className="text-sm text-[#6B7280] mt-0.5">{hotel.name}</p>
      </div>

      <TodayStats
        hotelId={hotel.id}
        settings={(settingsRes.data as Pick<HotelSettings, "gst_enabled" | "gst_percent" | "currency" | "logo_url"> | null) ?? null}
        initialOrders={(todayOrdersRes.data as Order[]) ?? []}
      />

      {showChecklist && (
        <div className="bg-white border border-[#FED7AA] rounded-3xl p-5 mt-5 shadow-sm">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-bold text-[#0F0E17]">Let&apos;s get started 🚀</h2>
            <span className="text-xs font-semibold text-[#C2410C]">
              {doneCount}/{steps.length} done
            </span>
          </div>
          <p className="text-sm text-[#6B7280] mb-3">Complete the next step to launch your digital menu.</p>

          <div className="w-full h-1.5 bg-[#F3F4F6] rounded-full mb-4 overflow-hidden">
            <div className="h-full bg-[#F97316] rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>

          <div className="space-y-2">
            {remaining.slice(0, 1).map((s) => {
              const Icon = s.icon;
              return (
                <Link
                  key={s.key}
                  href={s.href}
                  className="group flex items-center gap-3 p-3 rounded-2xl border border-[#E5E7EB] hover:border-[#F97316] hover:bg-[#FFF7ED] transition-all"
                >
                  <div className="w-9 h-9 rounded-xl bg-[#FFF7ED] flex items-center justify-center flex-shrink-0">
                    <Icon size={18} className="text-[#F97316]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#0F0E17]">{s.title}</p>
                    <p className="text-xs text-[#6B7280]">{s.desc}</p>
                  </div>
                  <ArrowRight size={16} className="text-[#9CA3AF] group-hover:text-[#F97316] flex-shrink-0" />
                </Link>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mt-5">
        <StatCard label="Total Items" value={itemCount} sub="on your menu" />
        <StatCard label="Categories" value={catCount} sub="sections" />
        <StatCard label="Available" value={availCount} sub="visible to customers" />
        <div className="bg-white rounded-3xl border border-[#E5E7EB] p-5">
          <p className="text-[10px] font-medium text-[#6B7280] uppercase tracking-widest">Status</p>
          <p
            className={[
              "text-3xl font-bold mt-1",
              hotel.status === "active" ? "text-[#10B981]" : "text-[#1C1C2E]",
            ].join(" ")}
          >
            {hotel.status === "active" ? "Live" : "Trial"}
          </p>
          <p className="text-xs text-[#9CA3AF] mt-0.5 capitalize">{hotel.status}</p>
        </div>
      </div>

      <div className="bg-[#1C1C2E] rounded-3xl p-5 mt-4">
        <p className="text-[10px] uppercase tracking-widest text-[#6B7280] mb-1">Your menu link</p>
        <p className="text-sm font-medium text-white break-all mb-3">{menuUrl}</p>
        <div className="flex flex-wrap gap-2">
          <a
            href={`/menu/${hotel.slug}`}
            target="_blank"
            rel="noopener noreferrer"
            className="bg-[#F97316] text-white rounded-2xl px-4 py-2.5 text-sm font-medium inline-flex items-center gap-2 min-h-0"
          >
            <ExternalLink size={14} /> Preview
          </a>
          <MenuLinkActions url={menuUrl} name={hotel.name} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-4">
        {quickTiles.map(({ icon: Icon, label, href }) => (
          <Link
            key={href}
            href={href}
            className="bg-white border border-[#E5E7EB] rounded-3xl p-4 flex flex-col items-center gap-2 hover:border-[#F97316] hover:shadow-sm transition-all cursor-pointer"
          >
            <Icon size={22} className="text-[#F97316]" />
            <span className="text-xs font-medium text-[#374151] text-center">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div className="bg-white rounded-3xl border border-[#E5E7EB] p-5">
      <p className="text-[10px] font-medium text-[#6B7280] uppercase tracking-widest">{label}</p>
      <p className="text-3xl font-bold text-[#1C1C2E] mt-1">{value}</p>
      <p className="text-xs text-[#9CA3AF] mt-0.5">{sub}</p>
    </div>
  );
}
