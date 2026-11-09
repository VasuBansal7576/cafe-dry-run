import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useEffect } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import { ComparisonWorkspace } from "@/components/cafe/comparison";
import { OpeningFile } from "@/components/cafe/opening-file";
import { scenarioVersion } from "@/components/cafe/finance-ledger";
import { DemandForm, ShopForm } from "@/components/cafe/scenario-inputs";
import { SiteMap } from "@/components/cafe/site-map";

import type { Scenario } from "../../server/lib/cafe/scenario-store.js";

import "@/components/cafe/cafe.css";

export default function CafeRoute() {
  const query = useActionQuery("list-scenarios", {});
  const { hash } = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const selected = params.get("scenario");
  const comparisonId = params.get("compare");
  const scenario = selected
    ? query.data?.scenarios.find(({ id }) => id === selected)
    : query.data?.scenarios[0];
  const alternatives =
    query.data?.scenarios.filter(({ id }) => id !== scenario?.id) ?? [];
  const comparison = alternatives.find(({ id }) => id === comparisonId);
  const pair = useActionQuery(
    "get-comparison",
    { aId: scenario?.id ?? "", bId: comparison?.id },
    { enabled: !!scenario && !!comparison },
  );
  const demandScenario = comparison ? pair.data?.arrivalSource : scenario;
  const compare = useActionMutation("compare-scenarios");
  async function rerunAfterShopSave(updated: Scenario) {
    const decision = pair.data?.decision;
    if (!scenario || !comparison || !decision) return;
    const { data } = await query.refetch();
    const current = (side: Scenario) =>
      data?.scenarios.find(({ id }) => id === side.id) ??
      (updated.id === side.id ? updated : side);
    compare.mutate({
      a: scenarioVersion(current(scenario)),
      b: scenarioVersion(current(comparison)),
      ...decision.receipt.settings,
    });
  }
  const create = useActionMutation("create-scenario", {
    onSuccess: ({ scenario }) =>
      setParams({ scenario: scenario.id }, { replace: true }),
  });
  const setSpot = useActionMutation("set-spot");
  useEffect(() => {
    if (selected || !scenario) return;
    const next = new URLSearchParams(params);
    next.set("scenario", scenario.id);
    void navigate(
      { search: next.toString(), hash },
      { replace: true, preventScrollReset: true },
    );
  }, [scenario, selected, params, hash, navigate]);

  return (
    <div className="cafe-workspace">
      <header className="cafe-masthead">
        <span className="cafe-wordmark">
          <span className="cafe-mark" aria-hidden="true" /> DRY RUN
        </span>
        <span className="cafe-masthead-note">Café opening simulator</span>
      </header>
      <nav className="cafe-rail" aria-label="Café Dry Run documents">
        <a
          href="#opening-file"
          aria-current={
            !hash || hash === "#opening-file" ? "location" : undefined
          }
        >
          <span>00</span> Opening file
        </a>
        <a
          href="#site-demand"
          aria-current={hash === "#site-demand" ? "location" : undefined}
        >
          <span>01</span> Site & demand
        </a>
        <a
          href="#service-test"
          aria-current={hash === "#service-test" ? "location" : undefined}
        >
          <span>02</span> Service test
        </a>
        <a
          href="#cash-ledger"
          aria-current={hash === "#cash-ledger" ? "location" : undefined}
        >
          <span>03</span> Cash ledger
        </a>
      </nav>
      <OpeningFile
        action={
          scenario ? (
            <a className="cafe-opening-action" href="#site-demand">
              Open your scenario <span aria-hidden="true">↗</span>
            </a>
          ) : !query.isPending && !query.error && !selected ? (
            <button
              className="cafe-opening-action"
              disabled={create.isPending}
              onClick={() => create.mutate({})}
            >
              {create.isPending ? "Starting scenario…" : "Start a scenario"}{" "}
              <span aria-hidden="true">↗</span>
            </button>
          ) : null
        }
      />
      {query.isPending && <p role="status">Loading your scenario…</p>}
      {query.error && (
        <p role="alert" className="cafe-notice">
          {actionErrorMessage(query.error) ?? "Could not load scenarios."}{" "}
          <button className="cafe-link" onClick={() => void query.refetch()}>
            Try again
          </button>
        </p>
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
            {query.data.scenarios.map(({ id, demand, label }) => (
              <option value={id} key={id}>
                {label} · {demand.hourly.base.value}/hr
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
            tabIndex={-1}
          >
            <header>
              <p className="cafe-kicker">01 · Assumptions</p>
              <h2 id="site-title">Site & demand</h2>
            </header>
            <div className="cafe-input-boards">
              <SiteMap
                key={`site:${scenario.id}`}
                spot={scenario.spot}
                spotRevision={scenario.spotRevision}
                onSetSpot={(location) =>
                  setSpot.mutate({
                    id: scenario.id,
                    expectedSpotRevision: scenario.spotRevision,
                    location,
                  })
                }
                pending={setSpot.isPending}
                error={
                  setSpot.variables?.id === scenario.id
                    ? actionErrorMessage(setSpot.error)
                    : null
                }
              />
              {demandScenario ? (
                <DemandForm
                  key={`demand:${demandScenario.id}`}
                  scenario={demandScenario}
                  shared={!!comparison}
                  separateMenu={demandScenario.id !== scenario.id}
                />
              ) : pair.error ? (
                <p className="cafe-notice" role="alert">
                  {actionErrorMessage(pair.error) ??
                    "Could not load the shared demand source."}{" "}
                  <button
                    className="cafe-link"
                    onClick={() => void pair.refetch()}
                  >
                    Try again
                  </button>
                </p>
              ) : (
                <p role="status">
                  {pair.isPending
                    ? "Loading shared Saturday demand…"
                    : "Shared demand source unavailable."}
                </p>
              )}
            </div>
            <div className="cafe-shop-board">
              <ShopForm scenario={scenario} onSaved={rerunAfterShopSave} />
            </div>
          </section>
          <ComparisonWorkspace
            a={scenario}
            b={comparison}
            options={alternatives}
            compare={compare}
            rerunAfterShopSave={rerunAfterShopSave}
            select={(id) => {
              const next = new URLSearchParams(params);
              if (id) next.set("compare", id);
              else next.delete("compare");
              void navigate(
                { search: next.toString(), hash },
                { replace: true, preventScrollReset: true },
              );
            }}
          />
        </section>
      )}
    </div>
  );
}
