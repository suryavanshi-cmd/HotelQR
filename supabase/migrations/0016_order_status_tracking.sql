-- 0016_order_status_tracking.sql
--
-- Live order-status tracking for customers. The anon role has no SELECT on
-- `orders` (owner-readable only, see 0009), so the customer's "order placed"
-- screen cannot use realtime to see the kitchen move their order to
-- preparing/done. This token-gated lookup lets the customer poll for exactly
-- their own order's status — nothing else is exposed.
--
-- Safe to re-run.

create or replace function public.get_order_status(p_order_id uuid, p_token text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if p_token is null or p_token = '' then return null; end if;
  select status into v_status
  from public.orders
  where id = p_order_id and cancel_token = p_token;
  return v_status; -- null when the order doesn't exist or the token is wrong
end;
$$;

grant execute on function public.get_order_status(uuid, text) to anon, authenticated;
