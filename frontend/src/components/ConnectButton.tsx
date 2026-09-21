import { useState } from "react";
import { fmtGen, shorten } from "../lib/format";
import { useWallet } from "../lib/wallet";
import { inputCls } from "./ui";

export function ConnectButton() {
  const { address, balanceWei, importKey, newBurner, disconnect } = useWallet();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | null>(null);

  if (!address) {
    return (
      <>
        <button
          onClick={() => {
            setOpen(true);
            setErr(null);
          }}
          className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-violet-500"
        >
          Connect Wallet
        </button>
        {open && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => setOpen(false)}
          >
            <div
              className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#12131a] p-6 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-white">Connect wallet</h2>
                <button
                  onClick={() => setOpen(false)}
                  className="text-zinc-500 hover:text-zinc-300"
                >
                  ✕
                </button>
              </div>
              <p className="mt-2 text-xs leading-relaxed text-zinc-400">
                GenLayer uses its own signing protocol. Import a private key or generate a burner wallet. The key stays in this browser only.
              </p>

              <div className="mt-5 space-y-3">
                <div>
                  <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                    Private key
                  </label>
                  <input
                    type="password"
                    value={key}
                    onChange={(e) => {
                      setKey(e.target.value);
                      setErr(null);
                    }}
                    placeholder="0x..."
                    className={`${inputCls} font-mono text-sm`}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && key.trim()) {
                        if (importKey(key)) {
                          setOpen(false);
                          setKey("");
                        } else {
                          setErr("Invalid key — expected 64 hex characters.");
                        }
                      }
                    }}
                  />
                </div>

                {err && (
                  <div className="rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-300">
                    {err}
                  </div>
                )}

                <button
                  onClick={() => {
                    if (importKey(key)) {
                      setOpen(false);
                      setKey("");
                    } else {
                      setErr("Invalid key — expected 64 hex characters.");
                    }
                  }}
                  disabled={!key.trim()}
                  className="w-full rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-violet-500 disabled:opacity-40"
                >
                  Import
                </button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-white/10" />
                  </div>
                  <div className="relative flex justify-center text-[11px]">
                    <span className="bg-[#12131a] px-2 text-zinc-500">or</span>
                  </div>
                </div>

                <button
                  onClick={() => {
                    newBurner();
                    setOpen(false);
                    setKey("");
                  }}
                  className="w-full rounded-xl border border-white/10 px-4 py-2.5 text-sm font-medium text-zinc-300 transition hover:bg-white/5"
                >
                  Generate burner wallet
                </button>
              </div>

              <p className="mt-4 text-center text-[10px] text-zinc-600">
                Burner wallets are for testing only. Fund it via the GenLayer Studio faucet.
              </p>
            </div>
          </div>
        )}
      </>
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
