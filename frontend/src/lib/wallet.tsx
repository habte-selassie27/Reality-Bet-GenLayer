import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { DEFAULT_NETWORK, NETWORKS, type NetworkKey } from "./chains";
import { ensureChain as ensureWalletChain, getClient } from "./genlayer";

const NET_KEY = "realitybet.network.v1";

interface Wallet {
  network: NetworkKey;
  setNetwork: (n: NetworkKey) => void;
  address: string | null;
  balanceWei: bigint | null;
  /** EIP-1193 provider (window.ethereum) for MetaMask signing. */
  provider: any;
  /** Chain id currently selected in the wallet, or null while unknown. */
  chainId: number | null;
  /** Chain id the selected app network expects the wallet to be on. */
  expectedChainId: number;
  /** True when a wallet is connected but sitting on the wrong chain. */
  wrongChain: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Ensure MetaMask is on the correct GenLayer chain. */
  ensureChain: () => Promise<void>;
  /** Ask the wallet to switch to the expected chain. Throws if declined. */
  switchChain: () => Promise<void>;
}

const Ctx = createContext<Wallet | null>(null);

/** Read the wallet's active chain id (hex string) and normalise it to a number. */
async function readChainId(eth: any): Promise<number | null> {
  try {
    const hex = await eth.request({ method: "eth_chainId" });
    if (typeof hex !== "string") return null;
    const id = parseInt(hex, 16);
    return Number.isNaN(id) ? null : id;
  } catch {
    return null;
  }
}

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
  const [address, setAddress] = useState<string | null>(null);
  const [provider, setProvider] = useState<any>(null);
  const [balanceWei, setBalanceWei] = useState<bigint | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);

  const expectedChainId = NETWORKS[network].chain.id;

  const setNetwork = useCallback((n: NetworkKey) => {
    setNetworkState(n);
    try {
      localStorage.setItem(NET_KEY, n);
    } catch {
      /* empty */
    }
    // Keep the wallet on the same chain as the selected network, otherwise
    // writes are rejected with a chainId mismatch. Failures are non-fatal:
    // the wrong-chain banner offers a retry.
    const eth = (window as any).ethereum;
    if (eth) {
      void ensureWalletChain(eth, n)
        .then(() => readChainId(eth))
        .then((id) => setChainId(id))
        .catch(() => {
          /* surface via banner */
        });
    }
  }, []);

  /** Switch the wallet to the GenLayer chain for the current network. */
  const ensureChain = useCallback(async () => {
    const eth = (window as any).ethereum;
    if (!eth) return;
    await ensureWalletChain(eth, network);
    setChainId(await readChainId(eth));
  }, [network]);

  /** Switch the wallet to the correct chain, rejecting when the user declines. */
  const switchChain = useCallback(async () => {
    const eth = (window as any).ethereum;
    if (!eth) throw new Error("No EVM wallet detected.");
    await ensureWalletChain(eth, network);
    setChainId(await readChainId(eth));
  }, [network]);

  /** Connect to MetaMask / injected wallet. */
  const connect = useCallback(async () => {
    const eth = (window as any).ethereum;
    if (!eth) {
      alert("Please install MetaMask or another EVM wallet.");
      return;
    }
    try {
      const accounts: string[] = await eth.request({
        method: "eth_requestAccounts",
      });
      if (!accounts || accounts.length === 0) return;
      setAddress(accounts[0]);
      setProvider(eth);
      setChainId(await readChainId(eth));
      // Best-effort switch; if the user declines, the banner prompts them so
      // the wallet stays usable for reads instead of failing silently.
      try {
        await ensureWalletChain(eth, network);
        setChainId(await readChainId(eth));
      } catch (chainErr) {
        console.warn("Chain switch skipped:", chainErr);
      }
    } catch (err: any) {
      console.error("Wallet connection failed:", err);
      alert(err?.message ?? "Failed to connect wallet.");
    }
  }, [network]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setProvider(null);
    setBalanceWei(null);
    setChainId(null);
  }, []);

  // Auto-reconnect if previously connected.
  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth) return;
    eth
      .request({ method: "eth_accounts" })
      .then(async (accounts: string[]) => {
        if (accounts && accounts.length > 0) {
          setAddress(accounts[0]);
          setProvider(eth);
          setChainId(await readChainId(eth));
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
    const onAccounts = async (accs: string[]) => {
      if (accs.length === 0) {
        setAddress(null);
        setProvider(null);
        setBalanceWei(null);
        setChainId(null);
      } else {
        setAddress(accs[0]);
        setProvider(eth);
        setChainId(await readChainId(eth));
      }
    };
    // Track the chain instead of reloading, so the banner can react in place.
    const onChain = (hex: string) => {
      const id = typeof hex === "string" ? parseInt(hex, 16) : NaN;
      setChainId(Number.isNaN(id) ? null : id);
    };
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
  }, [address, network, chainId]);

  const wrongChain = address !== null && chainId !== null && chainId !== expectedChainId;

  const value = useMemo<Wallet>(
    () => ({
      network,
      setNetwork,
      address,
      balanceWei,
      provider,
      chainId,
      expectedChainId,
      wrongChain,
      connect,
      disconnect,
      ensureChain,
      switchChain,
    }),
    [
      network,
      setNetwork,
      address,
      balanceWei,
      provider,
      chainId,
      expectedChainId,
      wrongChain,
      connect,
      disconnect,
      ensureChain,
      switchChain,
    ],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): Wallet {
  const w = useContext(Ctx);
  if (!w) throw new Error("useWallet must be used inside WalletProvider");
  return w;
}
