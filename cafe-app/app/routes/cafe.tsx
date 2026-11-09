import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import { ComparisonWorkspace } from "@/components/cafe/comparison";
import { scenarioVersion } from "@/components/cafe/finance-ledger";
import { OpeningFile } from "@/components/cafe/opening-file";
import { DemandForm, ShopForm } from "@/components/cafe/scenario-inputs";
import { SiteMap } from "@/components/cafe/site-map";
import {
  cafeDocuments,
  useCafeDocument,
  type CafeDocument,
} from "@/hooks/use-cafe-document";

import type { Scenario } from "../../server/lib/cafe/scenario-store.js";

import "@/components/cafe/cafe.css";

export default function CafeRoute() {
  const query = useActionQuery("list-scenarios", {});
  const location = useLocation();
  const { hash } = location;
  const { document: activeDocument, reportScroll } = useCafeDocument();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const selected = params.get("scenario");
  const comparisonId = params.get("compare");
  const scenario = selected
    ? query.data?.scenarios.find(({ id }) => id === selected)
    : query.data?.scenarios[0];
  const hasScenario = !!scenario;
  const workspace = useRef<HTMLDivElement>(null);
  const documentRail = useRef<HTMLElement>(null);
  const lastFragment = useRef<{
    location: typeof location;
    id: string;
  } | null>(null);
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
  function selectScenario(id: string | null, replace = false) {
    const next = new URLSearchParams(params);
    if (id) next.set("scenario", id);
    else next.delete("scenario");
    if (!id || id === comparisonId) next.delete("compare");
    void navigate(
      { search: next.toString(), hash },
      { replace, preventScrollReset: true },
    );
  }
  const create = useActionMutation("create-scenario", {
    onSuccess: ({ scenario }) => selectScenario(scenario.id, true),
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

  // Scenario documents mount after the router's first scroll attempt.
  useLayoutEffect(() => {
    const { hash } = location;
    const previous = lastFragment.current;
    if (!hash || previous?.location === location) return;
    let id: string;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      return;
    }
    if (!hasScenario && id !== "opening-file") return;
    const target = document.getElementById(id);
    if (!target || !workspace.current?.contains(target)) return;
    lastFragment.current = { location, id };
    target.scrollIntoView();
    const focused = document.activeElement;
    if (
      focused === document.body ||
      (previous && previous.id !== id && focused?.id === previous.id)
    ) {
      target.focus({ preventScroll: true });
    }
  }, [hasScenario, location]);

  useEffect(() => {
    const node = workspace.current;
    const rail = documentRail.current;
    const scrollArea = node?.closest("main");
    if (!node || !rail || !scrollArea) return;
    const padding =
      Number.parseFloat(getComputedStyle(scrollArea).scrollPaddingBlockStart) ||
      0;
    const documents = cafeDocuments.flatMap((name) => {
      const section = node.querySelector(`#${name}`);
      return section ? [{ name, section }] : [];
    });
    const readPosition = () => {
      const line =
        Math.max(
          rail.getBoundingClientRect().bottom,
          scrollArea.getBoundingClientRect().top + padding,
        ) + 8;
      let position:
        | { name: CafeDocument; section: Element; top: number }
        | undefined;
      for (const document of documents) {
        const top = document.section.getBoundingClientRect().top;
        if (!position || top <= line) position = { ...document, top };
      }
      return position;
    };
    let width = scrollArea.clientWidth;
    let position = readPosition();
    let frame = 0;
    let lastVisible: CafeDocument | undefined;
    const trackDocument = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (scrollArea.clientWidth !== width) return;
        position = readPosition();
        if (position && position.name !== lastVisible) {
          lastVisible = position.name;
          reportScroll(position.name);
        }
      });
    };
    const resize = new ResizeObserver(() => {
      const nextWidth = scrollArea.clientWidth;
      if (width === nextWidth) return;
      width = nextWidth;
      if (position && scrollArea.scrollTop > 0) {
        scrollArea.scrollTop +=
          position.section.getBoundingClientRect().top - position.top;
      }
      trackDocument();
    });
    resize.observe(scrollArea);
    scrollArea.addEventListener("scroll", trackDocument, { passive: true });
    if (!hash) trackDocument();
    return () => {
      scrollArea.removeEventListener("scroll", trackDocument);
      resize.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [hash, hasScenario, reportScroll]);

  return (
    <div className="cafe-workspace" ref={workspace}>
      <header className="cafe-masthead">
        <span className="cafe-wordmark">
          <span className="cafe-mark" aria-hidden="true" /> DRY RUN
        </span>
        <span className="cafe-masthead-note">Café opening simulator</span>
      </header>
      <nav
        ref={documentRail}
        className="cafe-rail"
        aria-label="Café Dry Run documents"
      >
        <a
          href="#opening-file"
          aria-current={
            activeDocument === "opening-file" ? "location" : undefined
          }
        >
          <span>00</span> Opening file
        </a>
        <a
          href="#site-demand"
          aria-current={
            activeDocument === "site-demand" ? "location" : undefined
          }
        >
          <span>01</span> Site & demand
        </a>
        <a
          href="#service-test"
          aria-current={
            activeDocument === "service-test" ? "location" : undefined
          }
        >
          <span>02</span> Service test
        </a>
        <a
          href="#cash-ledger"
          aria-current={
            activeDocument === "cash-ledger" ? "location" : undefined
          }
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
          <button className="cafe-link" onClick={() => selectScenario(null)}>
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
            onChange={(event) => selectScenario(event.currentTarget.value)}
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
