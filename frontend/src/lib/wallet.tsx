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
import { getClient } from "./genlayer";

const NET_KEY = "realitybet.network.v1";

interface Wallet {
  network: NetworkKey;
  setNetwork: (n: NetworkKey) => void;
  address: string | null;
  balanceWei: bigint | null;
  /** EIP-1193 provider (window.ethereum) for MetaMask signing. */
  provider: any;
  connect: () => Promise<void>;
  disconnect: () => void;
  /** Ensure MetaMask is on the correct GenLayer chain. */
  ensureChain: () => Promise<void>;
}

const Ctx = createContext<Wallet | null>(null);

/** Hex chain ID for MetaMask wallet_switchEthereumChain. */
function chainIdHex(network: NetworkKey): string {
  return "0x" + NETWORKS[network].chain.id.toString(16);
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

  const setNetwork = useCallback((n: NetworkKey) => {
    setNetworkState(n);
    try {
      localStorage.setItem(NET_KEY, n);
    } catch {
      /* empty */
    }
  }, []);

  /** Switch MetaMask to the GenLayer chain for the current network. */
  const ensureChain = useCallback(async () => {
    const eth = (window as any).ethereum;
    if (!eth) return;
    const targetId = chainIdHex(network);
    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetId }] });
    } catch (err: any) {
      // Error code 4902 = chain not added yet — add it
      if (err?.code === 4902) {
        const cfg = NETWORKS[network];
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: targetId,
            chainName: cfg.chain.name,
            rpcUrls: [cfg.chain.rpcUrls.default.http[0]],
          }],
        });
      } else {
        throw err;
      }
    }
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
      // Switch to correct chain before proceeding
      const targetId = chainIdHex(network);
      try {
        await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: targetId }] });
      } catch (chainErr: any) {
        if (chainErr?.code === 4902) {
          const cfg = NETWORKS[network];
          await eth.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: targetId,
              chainName: cfg.chain.name,
              rpcUrls: [cfg.chain.rpcUrls.default.http[0]],
            }],
          });
        } else {
          throw chainErr;
        }
      }
      setAddress(accounts[0]);
      setProvider(eth);
    } catch (err: any) {
      console.error("Wallet connection failed:", err);
      alert(err?.message ?? "Failed to connect wallet.");
    }
  }, [network]);

  const disconnect = useCallback(() => {
    setAddress(null);
    setProvider(null);
    setBalanceWei(null);
  }, []);

  // Auto-reconnect if previously connected.
  useEffect(() => {
    const eth = (window as any).ethereum;
    if (!eth) return;
    eth
      .request({ method: "eth_accounts" })
      .then((accounts: string[]) => {
        if (accounts && accounts.length > 0) {
          setAddress(accounts[0]);
          setProvider(eth);
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
        setAddress(null);
        setProvider(null);
        setBalanceWei(null);
      } else {
        setAddress(accs[0]);
        setProvider(eth);
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
      address,
      balanceWei,
      provider,
      connect,
      disconnect,
      ensureChain,
    }),
    [network, setNetwork, address, balanceWei, provider, connect, disconnect, ensureChain],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWallet(): Wallet {
  const w = useContext(Ctx);
  if (!w) throw new Error("useWallet must be used inside WalletProvider");
  return w;
}
