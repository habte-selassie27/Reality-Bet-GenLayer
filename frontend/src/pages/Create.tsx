import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CreateMarketForm } from "../components/CreateMarketForm";
import { Card, PageHeader } from "../components/ui";

export function Create() {
  const navigate = useNavigate();
  const [lastId, setLastId] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Create market" sub="Opens betting immediately. Anyone can lock it after close time; AI resolves after resolve time." />
      <Card>
        <CreateMarketForm
          onCreated={(id) => {
            setLastId(id);
          }}
        />
      </Card>
      {lastId && (
        <div className="mt-4 text-center text-sm">
          <button onClick={() => navigate(`/markets/${encodeURIComponent(lastId)}`)} className="text-violet-300 hover:underline">
            Open {lastId} →
          </button>
        </div>
      )}
    </div>
  );
}
