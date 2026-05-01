import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { apiUrl } from "@/lib/api-base";

export interface AuthedUser {
  walletAddress: string;
  nadName: string | null;
  displayName: string | null;
}

interface AuthState {
  user: AuthedUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

/**
 * Sign-In with Ethereum (SIWE) hook for nadburn.xyz.
 *
 * - On mount, fetches /api/auth/user to see if a session cookie is already set.
 * - `signIn()` runs the full SIWE handshake:
 *     1. POST /api/auth/nonce  — server issues a nonce
 *     2. wallet signs the SIWE message  (gasless, free)
 *     3. POST /api/auth/verify — server checks signature, sets HttpOnly cookie
 * - `signOut()` clears the cookie via /api/auth/logout.
 *
 * Designed to live alongside the existing useAuth() (Replit) without conflict.
 */
export function useWalletAuth() {
  const { address, chainId, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    error: null,
  });

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/api/auth/user"), { credentials: "include" });
      const data = (await r.json()) as { user: AuthedUser | null; authenticated: boolean };
      setState({
        user: data.user,
        isAuthenticated: !!data.authenticated && !!data.user,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      setState({
        user: null,
        isAuthenticated: false,
        isLoading: false,
        error: err instanceof Error ? err.message : "auth check failed",
      });
    }
  }, []);

  // Initial check on mount
  useEffect(() => { void refresh(); }, [refresh]);

  // If wallet disconnects, drop our local auth state — but don't call /logout
  // unless the user explicitly signs out, since the cookie might still be valid
  // when they reconnect.
  useEffect(() => {
    if (!isConnected) {
      setState((s) => ({ ...s, user: null, isAuthenticated: false }));
    }
  }, [isConnected]);

  /**
   * Run the full SIWE handshake. Throws on failure (caller can show a toast).
   */
  const signIn = useCallback(async (): Promise<AuthedUser> => {
    if (!address) throw new Error("Wallet not connected");

    setState((s) => ({ ...s, isLoading: true, error: null }));

    // 1. Get nonce + message from server
    const nonceResp = await fetch(apiUrl("/api/auth/nonce"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ address, chainId }),
    });
    if (!nonceResp.ok) {
      const errBody = await nonceResp.json().catch(() => ({}));
      throw new Error(errBody.error || `Nonce request failed (${nonceResp.status})`);
    }
    const { nonce, message } = (await nonceResp.json()) as {
      nonce: string;
      message: string;
    };

    // 2. Wallet signs the SIWE message (gasless, just a popup)
    let signature: `0x${string}`;
    try {
      signature = await signMessageAsync({ message });
    } catch (err) {
      setState((s) => ({ ...s, isLoading: false, error: "User rejected signature" }));
      throw err;
    }

    // 3. Verify on the server → sets HttpOnly cookie
    const verifyResp = await fetch(apiUrl("/api/auth/verify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ address, signature, message, nonce }),
    });
    if (!verifyResp.ok) {
      const errBody = await verifyResp.json().catch(() => ({}));
      throw new Error(errBody.error || `Sign-in failed (${verifyResp.status})`);
    }
    const { user } = (await verifyResp.json()) as { user: AuthedUser };

    setState({
      user,
      isAuthenticated: true,
      isLoading: false,
      error: null,
    });
    return user;
  }, [address, chainId, signMessageAsync]);

  const signOut = useCallback(async () => {
    try {
      await fetch(apiUrl("/api/auth/logout"), {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Best-effort; even if the request fails, drop local state.
    }
    setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,
    });
  }, []);

  return {
    user: state.user,
    isAuthenticated: state.isAuthenticated,
    isLoading: state.isLoading,
    error: state.error,
    signIn,
    signOut,
    refresh,
  };
}
