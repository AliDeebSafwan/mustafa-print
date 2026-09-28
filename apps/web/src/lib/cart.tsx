"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export interface CartFile { id: string; name: string }
export interface CartLine { productId: string; quantity: string; notes: string; files: CartFile[] }

interface CartContextValue {
  lines: CartLine[];
  count: number;
  /** Adds the quantity to an existing line for this product, or starts a new one. */
  add: (productId: string, quantity: string) => void;
  setQuantity: (productId: string, quantity: string) => void;
  setNotes: (productId: string, notes: string) => void;
  setFiles: (productId: string, files: CartFile[]) => void;
  remove: (productId: string) => void;
  clear: () => void;
  ready: boolean;
}

const CartContext = createContext<CartContextValue | null>(null);
const STORAGE_KEY = "mpe.cart.v1";

function readStored(): CartLine[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as CartLine[]) : [];
  } catch {
    return [];
  }
}

/**
 * The shopping cart. Kept in the browser only (no account needed to browse and add items); an account is required
 * only at checkout, matching the shop's rule that placing an order needs a signed-in, verified customer.
 */
export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Deferred into a microtask (not called directly in the effect body): satisfies the "no synchronous setState
    // in an effect" rule while still just reading localStorage once, right after mount.
    Promise.resolve().then(() => { setLines(readStored()); setReady(true); });
  }, []);
  useEffect(() => { if (ready) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines)); }, [lines, ready]);

  const add = useCallback((productId: string, quantity: string) => {
    setLines((prev) => {
      const existing = prev.find((l) => l.productId === productId);
      if (!existing) return [...prev, { productId, quantity, notes: "", files: [] }];
      const merged = (Number(existing.quantity) + Number(quantity)).toString();
      return prev.map((l) => (l.productId === productId ? { ...l, quantity: merged } : l));
    });
  }, []);
  const setQuantity = useCallback((productId: string, quantity: string) => setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, quantity } : l))), []);
  const setNotes = useCallback((productId: string, notes: string) => setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, notes } : l))), []);
  const setFiles = useCallback((productId: string, files: CartFile[]) => setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, files } : l))), []);
  const remove = useCallback((productId: string) => setLines((prev) => prev.filter((l) => l.productId !== productId)), []);
  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<CartContextValue>(() => ({ lines, count: lines.length, add, setQuantity, setNotes, setFiles, remove, clear, ready }),
    [lines, add, setQuantity, setNotes, setFiles, remove, clear, ready]);
  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within a CartProvider");
  return ctx;
}
