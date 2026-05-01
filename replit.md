# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## NadBurn — Web3 dust burner

### Split deploy: frontend on Vercel, api-server on Replit

The frontend (`artifacts/ash`) deploys to Vercel at `nadburn.xyz`. The
api-server (`artifacts/api-server`) keeps living on Replit Deployments
because it holds paid-API secrets (`UNISWAP_TRADING_API_KEY`,
`BLOCKVISION_API_KEY`, `SESSION_SECRET`).

`artifacts/ash/vercel.json` ships a SPA rewrite so client-side routes
(`/app`, `/some-other-route`) fall through to `index.html` instead of
returning Vercel's default 404. Set the Vercel project **Root Directory**
to `artifacts/ash`. The rewrite excludes `/api/*` so it doesn't shadow
API calls.

**Two env vars wire the two deploys together:**

1. On the **Vercel** project, set
   `VITE_API_BASE_URL="https://<your-replit-deploy>.replit.app"`. The
   frontend resolves every `/api/*` call through `lib/api-base.ts ->
   apiUrl()`, which prepends this. Without it, relative calls land on
   Vercel's SPA and return Vercel's "NOT_FOUND iad1::…" 404 page.
2. On the **Replit api-server** deploy, set
   `PUBLIC_APP_DOMAIN="nadburn.xyz"`. This single var does three things:
   - Adds `https://nadburn.xyz` to the CORS + CSRF allowlist
     (`src/app.ts:15-106`), so browser requests aren't rejected with
     `Origin not allowed`.
   - Flips the session cookie from `SameSite=Strict` to `SameSite=None;
     Secure` (`src/routes/auth.ts:setSessionCookie`) so the cookie
     actually rides on cross-site fetches from Vercel — Strict drops
     them entirely. CSRF protection still holds because every POST is
     Origin-checked against the allowlist.
   - Tells the OIDC `/login` and `/logout` flows to redirect users back
     to the frontend origin after the round-trip, instead of landing
     them on the api-server's own host (which has no SPA).

In the Replit dev preview leave both vars unset — the local shared proxy
on port 80 routes `/api/*` to the api-server, absolute URLs would only
add a redundant network hop, and the session cookie stays Strict.

Always keep frontend `/api/*` calls behind `apiUrl()` (never inline
`fetch("/api/foo")`) so a future endpoint doesn't quietly bypass the base
URL and re-introduce the Vercel-404 bug. The auth client in
`lib/replit-auth-web/src/use-auth.ts` follows the same pattern via its
own `authUrl()` helper.

### Architecture

Two artifacts make up the app:
- `artifacts/ash` — React + Vite frontend (wallet connect, token discovery, burn/recover UI). Public-facing.
- `artifacts/api-server` — Express backend (auth, burn history, saved tokens, explorer proxy, **Uniswap Trading API proxy**).

Supported chains:
| chainId | Network        | Recovery backend |
|---------|----------------|------------------|
| 1       | Ethereum       | V2 router (on-chain) |
| 143     | Monad mainnet  | Uniswap Trading API (via backend proxy) |
| 10143   | Monad testnet  | V2 router (on-chain), dev only |

### Recovery on Monad mainnet (V4 / Trading API)

Monad mainnet is V4-only — there's no V2 router we can call directly. So
recovery routes through Uniswap's hosted Trading API, which builds the
swap calldata for the proxy Universal Router. We proxy these calls through
our api-server so the API key never reaches the browser.

**To enable recovery on Monad mainnet you need to set one secret on the api-server:**

1. Get a Trading API key:
   - Production / paid: https://hub.uniswap.org
   - Dev / playground: https://api-docs.uniswap.org (free key embedded in their docs site)
2. Add it as a Replit Secret named **`UNISWAP_TRADING_API_KEY`**:
   - In Replit: open the **Secrets** pane (lock icon in the left sidebar), click **New Secret**, set key = `UNISWAP_TRADING_API_KEY`, value = your key.
   - Or via shell: it lives in the same env that the api-server reads at startup.
3. Restart the `artifacts/api-server: API Server` workflow.

Without the secret set, the proxy returns `503 MISSING_UNISWAP_API_KEY` and the
frontend shows a yellow "key not configured" banner on chain 143 — burn
mode keeps working unaffected.

Backend proxy lives in `artifacts/api-server/src/routes/uniswap.ts`:
- Endpoints: `POST /api/uniswap/{check_approval,quote,swap}`
- Forwards to `https://trade-api.gateway.uniswap.org/v1/`
- Always sends `x-permit2-disabled: true` so users get plain
  approve-then-swap UX (no EIP-712 signatures)
- 32KB body cap, 15s timeout, allowlist of three endpoints (no SSRF)

Frontend client lives in `artifacts/ash/src/lib/uniswap-trading.ts`. The
recovery branching in `BurnerApp.tsx` keys off `RECOVERY_MODE[chainId]`
from `lib/constants.ts`.

### Auto-detect on Monad mainnet (Blockvision indexer)

Monad mainnet has no public Blockscout-compatible API for wallet token
balances (the official explorer is behind Cloudflare). To make
auto-detect actually find tokens in the user's wallet on chain 143, the
backend proxies through **Blockvision** (https://blockvision.org), which
has first-class Monad indexing.

**To enable:**

1. Sign up at https://blockvision.org (free tier is plenty for normal
   auto-detect traffic).
2. Create a project, pick the Monad chain, copy the API key.
3. Add it as a Replit Secret named **`BLOCKVISION_API_KEY`**.
4. Restart the `artifacts/api-server: API Server` workflow.

Without the secret, the proxy returns
`{ source: "missing-key", code: "MISSING_BLOCKVISION_API_KEY" }`, and
the frontend shows a "Monad auto-detect not configured" toast nudging
the user to paste tokens manually. Burn and recovery are unaffected.

Backend lives in the chain-143 branch of
`artifacts/api-server/src/routes/explorer.ts`:
- Endpoint: `GET https://api.blockvision.org/v2/monad/account/tokens`
- Auth: `x-api-key` header (server-side only)
- Filters out the native MON entry (zero address) — it's read separately
  via wagmi
- Successful responses cached for 15s; upstream errors and 429s are NOT
  cached so retries actually re-fetch
- 10s timeout, 1 MiB body cap, validates address format before forwarding

### NFT burn support (ERC-721 + ERC-1155)

Discovery and burn for non-fungible tokens. Same chain matrix as ERC-20
(Ethereum mainnet, Monad mainnet, Monad testnet), burn-only — no
recovery / marketplace path.

**Discovery:** `GET /api/explorer/nfts?chainId&address`
- chain `143` → Blockvision `/v2/monad/account/nfts`. Same
  `MISSING_BLOCKVISION_API_KEY` payload contract as `/explorer/tokens`.
- chains `1` and `10143` → Blockscout
  `/api/v2/addresses/{addr}/nft?type=ERC-721,ERC-1155` (with
  `/tokens?type=…` as a fallback for shards that group differently).
- Normalized to
  `{ source, count, nfts: [{ contractAddress, tokenId, type:'erc721'|'erc1155',
                             balance, name?, collectionName?, imageUrl? }] }`.
- Same caching (15s), 10s timeout, 1 MiB body cap, and SSRF guard as the
  fungible scanner. Both providers are paginated until exhausted; a 5000-
  NFT / 50-page safety ceiling guards against malformed indexer cursors
  but is not a product cap. Blockscout queries both `/nft` and `/tokens`
  and merges results deduped by `contract+tokenId`. `ipfs://` and `ar://`
  URIs are rewritten to `https://ipfs.io/ipfs/` and `https://arweave.net/`
  on the way out.

**Burn UX:** A "Tokens / NFTs" segmented toggle on the Incinerator page
swaps the discovery surface for a `<NftBurner />` (lives in
`artifacts/ash/src/components/NftBurner.tsx`):
- Grid of NFT tiles, each multi-selectable.
- Each tile renders the indexer's image URL with `referrerpolicy=no-referrer`;
  on load failure or absence we drop to a deterministic initials tile —
  no dicebear or third-party fallback service.
- Confirm dialog reuses the "type BURN" phrase pattern.
- Per-NFT signature loop:
  - ERC-721 → `safeTransferFrom(owner, 0x…dEaD, tokenId)`
  - ERC-1155 → `safeTransferFrom(owner, 0x…dEaD, id, balance, "0x")`
- Each signed tx is awaited via `waitForTransactionReceipt` before the
  next, mirroring the ERC-20 burn loop's nonce + UX behavior.

**Persistence:** `burn_history` carries three new optional columns:
- `token_type` (`erc20|erc721|erc1155`, default `erc20` for legacy rows),
- `token_id` (numeric string, nullable),
- `collection_name` (nullable, max 128).

The OpenAPI contract in `lib/api-spec/openapi.yaml` was extended in
parallel — `pnpm --filter @workspace/api-spec run codegen` regenerates
the typed client. `HistoryPanel` detects `tokenType !== "erc20"` and
renders a collection + `#tokenId` row with an ERC-721/ERC-1155 badge
instead of `formatUnits` decimals.

Discord notifications branch on `tokenType` in
`artifacts/api-server/src/lib/discord.ts` — NFT burns post a
collection + token id embed instead of the formatted-amount embed.
