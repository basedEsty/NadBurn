import { apiUrl } from "./api-base";

export type BurnHistoryItem = {
  id: string;
  chainId: number;
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  amount: string;
  mode: "burn" | "recover" | string;
  txHash: string;
  recoveredNative: string | null;
  createdAt: string;
  // NFT-specific fields. All optional — populated only when burning an
  // ERC-721 / ERC-1155. Older rows in the DB have these as null.
  tokenType?: "erc20" | "erc721" | "erc1155" | null;
  tokenId?: string | null;
  collectionName?: string | null;
};

export type SavedTokenItem = {
  id: string;
  chainId: number;
  tokenAddress: string;
  tokenSymbol: string;
  tokenName: string | null;
  decimals: number;
  createdAt: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // `path` is always a server route like "/api/burn-history". We resolve it
  // through apiUrl() so production builds (Vercel) hit the absolute Replit
  // api-server URL instead of Vercel's own 404 page.
  const res = await fetch(apiUrl(path), {
    credentials: "include",
    headers: { "content-type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body?.error) msg = body.error;
    } catch {}
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  listBurnHistory: () =>
    request<{ items: BurnHistoryItem[] }>("/api/burn-history").then((r) => r.items),
  recordBurn: (input: Omit<BurnHistoryItem, "id" | "createdAt">) =>
    request<BurnHistoryItem>("/api/burn-history", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  listSavedTokens: () =>
    request<{ items: SavedTokenItem[] }>("/api/saved-tokens").then((r) => r.items),
  saveToken: (input: {
    chainId: number;
    tokenAddress: string;
    tokenSymbol: string;
    tokenName?: string | null;
    decimals: number;
  }) =>
    request<SavedTokenItem>("/api/saved-tokens", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  deleteSavedToken: (id: string) =>
    request<{ success: true }>(`/api/saved-tokens/${id}`, { method: "DELETE" }),
};
