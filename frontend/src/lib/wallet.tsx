import { createAccount, generatePrivateKey } from "genlayer-js";
import type { Account } from "viem";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_NETWORK, type NetworkKey } from "./chains";
import { getClient } from "./genlayer";

const PK_KEY = "realitybet.pk.v1";
const NET_KEY = "realitybet.network.v1";

function normalizeKey(input: string): `0x${string}` | null {
  const s = input.trim().toLowerCase();
  const hex = s.startsWith("0x") ? s : `0x${s}`;
  if (/^0x[0-9a-f]{64}$/.test(hex)) return hex as `0x${string}`;
  return null;
}

interface Wallet {
  network: NetworkKey;
  setNetwork: (n: NetworkKey) => void;
  account: Account | null;
  address: string | null;
  balanceWei: bigint | null;
  importKey: (raw: string) => boolean;
  newBurner: () => string;
  disconnect: () => void;
}

const Ctx = createContext<Wallet | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const [network, setNetworkState] = useState<NetworkKey>(() => {
    try {
      const v = localStorage.getItem(NET_KEY);
      if (
        v === "testnetAsimov" ||
        v === "testnetBradbury" ||
        v === "localnet"
      )
        return v;
    } catch {
      /* empty */
    }
    return DEFAULT_NETWORK;
  });
  const [pk, setPk] = useState<string | null>(() => {
    try {
      return localStorage.getItem(PK_KEY);
    } catch {
      return null;
    }
  });
  const [balanceWei, setBalanceWei] = useState<bigint | null>(null);

  const account = useMemo<Account | null>(() => {
    if (!pk) return null;
    const norm = normalizeKey(pk);
    if (!norm) return null;
    try {
      return createAccount(norm);
    } catch {
      return null;
    }
  }, [pk]);

  const address = account?.address ?? null;

  const setNetwork = useCallback((n: NetworkKey) => {
    setNetworkState(n);
    try {
      localStorage.setItem(NET_KEY, n);
    } catch {
      /* empty */
    }
  }, []);

  const importKey = useCallback((raw: string) => {
    const norm = normalizeKey(raw);
    if (!norm) return false;
    try {
      localStorage.setItem(PK_KEY, norm);
    } catch {
      /* empty */
    }
    setPk(norm);
    return true;
  }, []);

  const newBurner = useCallback(() => {
    const key = generatePrivateKey();
    try {
      localStorage.setItem(PK_KEY, key);
    } catch {
      /* empty */
    }
    setPk(key);
    return key;
  }, []);

  const disconnect = useCallback(() => {
    try {
      localStorage.removeItem(PK_KEY);
    } catch {
      /* empty */
    }
    setPk(null);
    setBalanceWei(null);
  }, []);

  // Refresh native balance.
  useEffect(() => {
    if (!address) {
      setBalanceWei(null);
      return;
    }
    let cancelled = false;
    const client = getClient(network) as unknown as {
      getBalance?: (a: { address: string }) => Promise<bigint>;
    };
    if (typeof client.getBalance !== "function") {
      setBalanceWei(null);
      return;
    }
    client
      .getBalance({ address })
      .then((b) => {
        if (!cancelled) setBalanceWei(BigInt(b));
      })
      .catch(() => {
        if (!cancelled) setBalanceWei(null);
      });
    return () => {
      cancelled = true;
    };
  }, [address, network]);

  const value = useMemo<Wallet>(
    () => ({
      network,
      setNetwork,
      account,
      address,
      balanceWei,
      importKey,
      newBurner,
      disconnect,
    }),
    [network, setNetwork, account, address, balanceWei, importKey, newBurner, disconnect],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): Wallet {
  const w = useContext(Ctx);
  if (!w) throw new Error("useWallet must be used inside WalletProvider");
  return w;
}
