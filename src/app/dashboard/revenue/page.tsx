import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAuthUser, getHotelByOwner } from "@/lib/supabase/cached-queries";
import { RevenueClient } from "./revenue-client";
import type { HotelSettings, Order, TableQR } from "@/types/database";

export default async function RevenuePage() {
  const user = await getAuthUser();
  if (!user) redirect("/login");

  const hotel = await getHotelByOwner(user.id);
  if (!hotel) redirect("/login");

  const supabase = await createClient();

  const [ordersRes, settingsRes, tablesRes] = await Promise.all([
    supabase
      .from("orders")
      .select("*")
      .eq("hotel_id", hotel.id)
      .order("created_at", { ascending: false })
      .limit(1000),
    supabase.from("hotel_settings").select("*").eq("hotel_id", hotel.id).maybeSingle(),
    supabase.from("tables").select("*").eq("hotel_id", hotel.id).order("created_at"),
  ]);

  return (
    <RevenueClient
      hotel={hotel}
      settings={(settingsRes.data as HotelSettings | null) ?? null}
      initialOrders={(ordersRes.data as Order[]) ?? []}
      initialTables={(tablesRes.data as TableQR[]) ?? []}
    />
  );
}
