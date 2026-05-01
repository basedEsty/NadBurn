-- =====================================================================
-- Mass Solutions / Nadburn — Supabase schema for wallet-based auth
--
-- Run this in the Supabase Dashboard:
--   1. Go to https://supabase.com/dashboard/project/<project-id>/sql/new
--   2. Paste this whole file
--   3. Click "Run"
--
-- Idempotent — safe to re-run if you change something later.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- USERS — wallet address IS the account
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.users (
  wallet_address  text primary key check (wallet_address ~ '^0x[a-f0-9]{40}$'),
  nad_name        text,
  display_name    text,
  created_at      timestamptz not null default now(),
  last_login      timestamptz not null default now()
);

create index if not exists idx_users_nad_name on public.users(nad_name) where nad_name is not null;

-- ─────────────────────────────────────────────────────────────────────
-- AUTH NONCES — short-lived nonces for SIWE message signing
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.auth_nonces (
  nonce       text primary key,
  wallet_address text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create index if not exists idx_auth_nonces_expires on public.auth_nonces(expires_at);

-- ─────────────────────────────────────────────────────────────────────
-- BURN HISTORY — every burn is keyed to the wallet that did it
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.burns (
  id                uuid primary key default gen_random_uuid(),
  wallet_address    text not null references public.users(wallet_address) on delete cascade,
  chain_id          int not null,
  token_address     text not null,
  token_symbol      text not null,
  token_decimals    int not null default 18,
  amount            text not null,
  mode              text not null check (mode in ('burn', 'recover')),
  tx_hash           text not null,
  recovered_native  text,
  created_at        timestamptz not null default now()
);

create index if not exists idx_burns_wallet_created on public.burns(wallet_address, created_at desc);
create index if not exists idx_burns_chain          on public.burns(chain_id);
create index if not exists idx_burns_token          on public.burns(token_address);

-- ─────────────────────────────────────────────────────────────────────
-- SAVED TOKENS — user's "favorites" list
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.saved_tokens (
  id              uuid primary key default gen_random_uuid(),
  wallet_address  text not null references public.users(wallet_address) on delete cascade,
  chain_id        int not null,
  token_address   text not null,
  token_symbol    text not null,
  token_name      text,
  decimals        int not null default 18,
  created_at      timestamptz not null default now(),
  unique (wallet_address, chain_id, token_address)
);

create index if not exists idx_saved_tokens_wallet on public.saved_tokens(wallet_address);

-- ─────────────────────────────────────────────────────────────────────
-- DISCORD LINKS — cross-platform identity (for $MASS rewards & RPG later)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.discord_links (
  wallet_address    text primary key references public.users(wallet_address) on delete cascade,
  discord_user_id   text not null,
  discord_username  text,
  linked_at         timestamptz not null default now()
);

create index if not exists idx_discord_links_user on public.discord_links(discord_user_id);

-- ─────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — locks down direct PostgREST access
-- All API access goes through our Vercel serverless functions which
-- use the service role key, so RLS protects against direct anon access.
-- ─────────────────────────────────────────────────────────────────────
alter table public.users         enable row level security;
alter table public.auth_nonces   enable row level security;
alter table public.burns         enable row level security;
alter table public.saved_tokens  enable row level security;
alter table public.discord_links enable row level security;

-- No public policies — all access requires the service role key (server-only).

-- ─────────────────────────────────────────────────────────────────────
-- HELPER: cleanup expired nonces (run via Supabase scheduled function or cron)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.cleanup_expired_nonces()
returns void
language sql
as $$
  delete from public.auth_nonces where expires_at < now() - interval '1 hour';
$$;
