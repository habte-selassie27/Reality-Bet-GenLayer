import { fmtGen, shorten } from "../lib/format";
import { useWallet } from "../lib/wallet";

export function ConnectButton() {
  const { address, balanceWei, connect, disconnect } = useWallet();

  if (!address) {
    return (
      <button
        onClick={connect}
        className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500"
      >
        Connect Wallet
      </button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <div className="hidden rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-right sm:block">
        <div className="font-mono text-xs text-zinc-100">{shorten(address)}</div>
        <div className="text-[11px] text-zinc-400">
          {balanceWei !== null ? fmtGen(balanceWei) : "—"}
        </div>
      </div>
      <button
        onClick={disconnect}
        className="rounded-xl border border-white/10 px-3 py-2 text-xs text-zinc-400 transition hover:bg-white/5 hover:text-zinc-200"
      >
        Disconnect
      </button>
    </div>
  );
}
