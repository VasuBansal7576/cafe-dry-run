import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useEffect } from "react";
import { useSearchParams } from "react-router";

import { DemandForm, ShopForm } from "@/components/cafe/scenario-inputs";
import { ServiceTest } from "@/components/cafe/service-test";

import "@/components/cafe/cafe.css";

export default function CafeRoute() {
  const query = useActionQuery("list-scenarios", {});
  const [params, setParams] = useSearchParams();
  const selected = params.get("scenario");
  const scenario = selected
    ? query.data?.scenarios.find(({ id }) => id === selected)
    : query.data?.scenarios[0];
  const create = useActionMutation("create-scenario", {
    onSuccess: ({ scenario }) =>
      setParams({ scenario: scenario.id }, { replace: true }),
  });
  useEffect(() => {
    if (!selected && scenario)
      setParams(
        (previous) => {
          previous.set("scenario", scenario.id);
          return previous;
        },
        { replace: true, preventScrollReset: true },
      );
  }, [scenario, selected, setParams]);

  return (
    <main className="cafe-workspace">
      <header className="cafe-masthead">
        <span className="cafe-mark" aria-hidden="true" /> <span>DRY RUN</span>
      </header>
      <nav className="cafe-rail" aria-label="Café Dry Run documents">
        <a href="#opening-file">
          <span>00</span> Opening file
        </a>
        <a href="#site-demand">
          <span>01</span> Site & demand
        </a>
        <a href="#service-test">
          <span>02</span> Service test
        </a>
      </nav>
      <div className="cafe-cover" id="opening-file">
        <p className="cafe-kicker">Café Dry Run · Opening file</p>
        <h1>
          Open <em>on paper.</em>
        </h1>
        <p>Test your café before you sign the lease.</p>
      </div>
      {query.isPending && <p role="status">Loading your scenario…</p>}
      {query.error && (
        <p role="alert" className="cafe-notice">
          {actionErrorMessage(query.error) ?? "Could not load scenarios."}{" "}
          <button className="cafe-link" onClick={() => void query.refetch()}>
            Try again
          </button>
        </p>
      )}
      {!query.isPending && !query.error && !scenario && !selected && (
        <button
          className="cafe-primary"
          disabled={create.isPending}
          onClick={() => create.mutate({})}
        >
          {create.isPending ? "Starting scenario…" : "Start a scenario"}
        </button>
      )}
      {!query.isPending && !query.error && selected && !scenario && (
        <p role="status">
          Scenario unavailable.{" "}
          <button className="cafe-link" onClick={() => setParams({})}>
            Open your scenarios
          </button>
        </p>
      )}
      {create.error && (
        <p role="alert" className="cafe-notice">
          {actionErrorMessage(create.error) ?? "Could not create a scenario."}
        </p>
      )}
      {!!query.data && query.data.scenarios.length > 1 && (
        <label className="cafe-picker">
          Scenario
          <select
            value={scenario?.id ?? ""}
            onChange={(event) => setParams({ scenario: event.target.value })}
          >
            {query.data.scenarios.map(({ id, demand }) => (
              <option value={id} key={id}>
                {id.slice(0, 8)} · {demand.hourly.base.value}/hr
              </option>
            ))}
          </select>
        </label>
      )}
      {scenario && (
        <section aria-label="Your scenario" key={scenario.id}>
          <section
            id="site-demand"
            className="cafe-section"
            aria-labelledby="site-title"
          >
            <header>
              <p className="cafe-kicker">01 · Assumptions</p>
              <h2 id="site-title">Site & demand</h2>
            </header>
            <div className="cafe-input-boards">
              <DemandForm scenario={scenario} />
              <ShopForm scenario={scenario} />
            </div>
          </section>
          <ServiceTest scenario={scenario} />
        </section>
      )}
    </main>
  );
}
