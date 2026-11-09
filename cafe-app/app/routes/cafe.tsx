import { actionErrorMessage, useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { useState, type FormEvent } from "react";

function DemandForm({ scenario }: { scenario: { id: string; baseHourlyDemand: number; revision: number } }) {
  const [demand, setDemand] = useState(String(scenario.baseHourlyDemand));
  const update = useActionMutation("set-demand");
  function save(event: FormEvent) {
    event.preventDefault();
    const value = Number(demand);
    if (!Number.isInteger(value) || value < 0 || value > 1000) return;
    update.mutate({ id: scenario.id, baseHourlyDemand: value, expectedRevision: scenario.revision });
  }
  return <form onSubmit={save} className="mt-6 flex max-w-sm flex-col gap-3">
    <label htmlFor="base-demand">Base customers per hour <span className="text-sm">Illustrative</span></label>
    <input id="base-demand" className="rounded border border-[#59534c] bg-[#393530] px-3 py-2 text-[#f7f0e3]" type="number" min="0" max="1000" step="1" value={demand} onChange={(event) => setDemand(event.target.value)} required />
    <button className="rounded bg-orange-600 px-4 py-3 text-white disabled:opacity-50" disabled={update.isPending}>Save demand</button>
    {update.error && <p role="alert">{actionErrorMessage(update.error) ?? "Could not save demand."}</p>}
  </form>;
}

export default function CafeRoute() {
  const query = useActionQuery("list-scenarios", {});
  const create = useActionMutation("create-scenario");
  const scenario = query.data?.scenarios[0];
  return <main className="min-h-full bg-[#20201e] p-8 text-[#f7f0e3]">
    <p className="text-sm uppercase tracking-widest">Café Dry Run</p>
    <h1 className="mt-4 font-serif text-5xl">Open on paper.</h1>
    <p className="mt-4 max-w-xl">Test your café before you sign the lease. Start with an illustrative hourly demand, then refine it with your own estimate.</p>
    {query.isPending && <p className="mt-6">Loading your scenario...</p>}
    {query.error && <p role="alert" className="mt-6">{actionErrorMessage(query.error) ?? "Could not load scenarios."}</p>}
    {!query.isPending && !query.error && !scenario && <button className="mt-6 rounded bg-orange-600 px-4 py-3 text-white disabled:opacity-50" disabled={create.isPending} onClick={() => create.mutate({ baseHourlyDemand: 20 })}>Start a scenario</button>}
    {create.error && <p role="alert">{actionErrorMessage(create.error) ?? "Could not create a scenario."}</p>}
    {scenario && <section aria-label="Your scenario"><p className="mt-8">Current base demand: {scenario.baseHourlyDemand} customers per hour · Illustrative</p><DemandForm key={`${scenario.id}:${scenario.revision}`} scenario={scenario} /></section>}
  </main>;
}
