import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Header } from "./components/Header";
import { WalletProvider } from "./lib/wallet";
import { Admin } from "./pages/Admin";
import { Create } from "./pages/Create";
import { Home } from "./pages/Home";
import { MarketDetail } from "./pages/MarketDetail";
import { Markets } from "./pages/Markets";
import { MyBets } from "./pages/MyBets";

export default function App() {
  return (
    <WalletProvider>
      <BrowserRouter>
        <div className="min-h-screen">
          <Header />
          <main className="mx-auto max-w-6xl px-4 py-6">
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/markets" element={<Markets />} />
              <Route path="/markets/:id" element={<MarketDetail />} />
              <Route path="/create" element={<Create />} />
              <Route path="/my-bets" element={<MyBets />} />
              <Route path="/admin" element={<Admin />} />
            </Routes>
          </main>
          <footer className="mx-auto max-w-6xl px-4 pb-8 pt-4 text-center font-mono text-xs text-zinc-600">
            RealityBet · GenLayer Intelligent Contract · consensus-settled prediction markets
          </footer>
        </div>
      </BrowserRouter>
    </WalletProvider>
  );
}
