import { type Account, type Hex, toHex } from "viem";
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

const NET_KEY = "realitybet.network.v1";

/** Build a viem-compatible Account that signs via MetaMask / injected provider. */
function accountFromProvider(
  addr: `0x${string}`,
  provider: any,
): Account {
  return {
    address: addr,
    type: "json-rpc" as const,
    source: "custom" as const,
    async signTransaction(tx: any) {
      const raw = await provider.request({
        method: "eth_signTransaction",
        params: [{ ...tx, from: addr }],
      });
      return raw as Hex;
    },
    async signMessage({ message }: { message: any }) {
      const msg = typeof message === "string" ? message : toHex(message.raw);
      const sig = await provider.request({
        method: "personal_sign",
        params: [msg, addr],
      });
      return sig as Hex;
    },
    async signTypedData(_arg: any) {
      throw new Error("signTypedData not implemented");
    },
  } as unknown as Account;
}

interface Wallet {
  network: NetworkKey;
  setNetwork: (n: NetworkKey) => void;
  account: Account | null;
  address: string | null;
  balanceWei: bigint | null;
  connect: () => Promise<void>;
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
  const [account, setAccount] = useState<Account | null>(null);
  const [balanceWei, setBalanceWei] = useState<bigint | null>(null);

  const address = account?.address ?? null;

  const setNetwork = useCallback((n: NetworkKey) => {
    setNetworkState(n);
    try {
      localStorage.setItem(NET_KEY, n);
    } catch {
      /* empty */
    }
  }, []);

  /** Connect to MetaMask / injected wallet. */
  const connect = useCallback(async () => {
    const eth = (window as any).ethereum;
    if (!eth) {
      alert("Please install MetaMask or another EVM wallet.");
      return;
    }
    try {
      // Request accounts — triggers the wallet popup
      const accounts: string[] = await eth.request({
        method: "eth_requestAccounts",
      });
      if (!accounts || accounts.length === 0) return;
      const addr = accounts[0] as `0x${string}`;
      const acc = accountFromProvider(addr, eth);
      setAccount(acc);
    } catch (err: any) {
      console.error("Wallet connection failed:", err);
      alert(err?.message ?? "Failed to connect wallet.");
    }
  }, []);

  const disconnect = useCallback(() => {
    setAccount(null);
    setBalanceWei(null);
  }, []);

  // Reconnect if address was previously stored (session restore).
  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth) return;
    eth
      .request({ method: "eth_accounts" })
      .then((accounts: string[]) => {
        if (accounts && accounts.length > 0) {
          const addr = accounts[0] as `0x${string}`;
          setAccount(accountFromProvider(addr, eth));
        }
      })
      .catch(() => {
        /* empty */
      });
  }, []);

  // Listen for account / chain changes.
  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth) return;
    const onAccounts = (accs: string[]) => {
      if (accs.length === 0) {
        setAccount(null);
        setBalanceWei(null);
      } else {
        setAccount(accountFromProvider(accs[0] as `0x${string}`, eth));
      }
    };
    const onChain = () => window.location.reload();
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener("accountsChanged", onAccounts);
      eth.removeListener("chainChanged", onChain);
    };
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
      connect,
      disconnect,
    }),
    [network, setNetwork, account, address, balanceWei, connect, disconnect],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): Wallet {
  const w = useContext(Ctx);
  if (!w) throw new Error("useWallet must be used inside WalletProvider");
  return w;
}
