import { Link, NavLink } from "react-router-dom";
import { NETWORKS, type NetworkKey } from "../lib/chains";
import { isOwnerAddress, useOwner } from "../lib/owner";
import { useWallet } from "../lib/wallet";
import { ConnectButton } from "./ConnectButton";

const LINKS = [
  { to: "/", label: "Home" },
  { to: "/markets", label: "Markets" },
  { to: "/create", label: "Create" },
  { to: "/my-bets", label: "My Bets" },
  { to: "/leaderboard", label: "Leaderboard" },
  { to: "/admin", label: "Admin" },
];

export function Header() {
  const { network, setNetwork, address } = useWallet();
  const { owner } = useOwner(network);
  // Admin link is only visible to the contract owner. This is cosmetic —
  // the contract itself reverts non-owner admin writes on-chain.
  const links = isOwnerAddress(owner, address) ? LINKS : LINKS.filter((l) => l.to !== "/admin");
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0a0b10]/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-violet-600 text-sm font-black text-white">
            Rβ
          </span>
          <span className="text-base font-bold tracking-tight text-white">RealityBet</span>
        </Link>
        <nav className="ml-2 flex flex-wrap items-center gap-1">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 text-sm transition ${
                  isActive ? "bg-white/10 text-white" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={network}
            onChange={(e) => setNetwork(e.target.value as NetworkKey)}
            title="Network"
            className="rounded-xl border border-white/10 bg-black/40 px-2.5 py-2 text-xs text-zinc-200 outline-none"
          >
            {(Object.keys(NETWORKS) as NetworkKey[]).map((k) => (
              <option key={k} value={k}>
                {NETWORKS[k].label}
              </option>
            ))}
          </select>
          <ConnectButton />
        </div>
      </div>
    </header>
  );
}
