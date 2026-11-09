import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useEffect } from "react";
import { useLocation, useSearchParams } from "react-router";

import { OpeningFile } from "@/components/cafe/opening-file";
import { DemandForm, ShopForm } from "@/components/cafe/scenario-inputs";
import { ServiceTest } from "@/components/cafe/service-test";
import { SiteMap } from "@/components/cafe/site-map";

import "@/components/cafe/cafe.css";

export default function CafeRoute() {
  const query = useActionQuery("list-scenarios", {});
  const { hash } = useLocation();
  const [params, setParams] = useSearchParams();
  const selected = params.get("scenario");
  const scenario = selected
    ? query.data?.scenarios.find(({ id }) => id === selected)
    : query.data?.scenarios[0];
  const create = useActionMutation("create-scenario", {
    onSuccess: ({ scenario }) =>
      setParams({ scenario: scenario.id }, { replace: true }),
  });
  const setSpot = useActionMutation("set-spot");
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
            tabIndex={-1}
          >
            <header>
              <p className="cafe-kicker">01 · Assumptions</p>
              <h2 id="site-title">Site & demand</h2>
            </header>
            <div className="cafe-input-boards">
              <SiteMap
                key={scenario.id}
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
              <DemandForm scenario={scenario} />
            </div>
            <div className="cafe-shop-board">
              <ShopForm scenario={scenario} />
            </div>
          </section>
          <ServiceTest scenario={scenario} />
        </section>
      )}
    </div>
  );
}
