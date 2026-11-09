import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import {
  checkingRead,
  pairCalculationScope,
  useCalculationState,
} from "@/components/cafe/calculation-state";
import { ComparisonWorkspace } from "@/components/cafe/comparison";
import { scenarioVersion } from "@/components/cafe/finance-ledger";
import { OpeningFile } from "@/components/cafe/opening-file";
import { Stamp } from "@/components/cafe/provenance-stamp";
import {
  DemandForm,
  ShopForm,
  sourceLabels,
  type ShopRerunFeedback,
} from "@/components/cafe/scenario-inputs";
import { SiteMap } from "@/components/cafe/site-map";
import {
  cafeDocuments,
  useCafeDocument,
  type CafeDocument,
} from "@/hooks/use-cafe-document";

import type { Scenario } from "../../server/lib/cafe/scenario-store.js";

import "@/components/cafe/cafe.css";

const documentLabels: Record<CafeDocument, string> = {
  "opening-file": "Opening file",
  "site-demand": "Site & demand",
  "service-test": "Service test",
  "cash-ledger": "Cash ledger",
};

type ScenarioVersion = ReturnType<typeof scenarioVersion>;
type PairSelection = { aId: string; bId: string };
type ShopRerun = { pair: PairSelection; saved: ScenarioVersion };

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
  const currentDocument = hasScenario ? activeDocument : "opening-file";
  const workspace = useRef<HTMLDivElement>(null);
  const documentRail = useRef<HTMLElement>(null);
  const lastFragment = useRef<{
    location: typeof location;
    id: string;
  } | null>(null);
  const alternatives =
    query.data?.scenarios.filter(({ id }) => id !== scenario?.id) ?? [];
  const comparison = alternatives.find(({ id }) => id === comparisonId);
  const aId = scenario?.id;
  const bId = comparison?.id;
  const selection = useMemo(
    () => (aId && bId ? { aId, bId } : null),
    [aId, bId],
  );
  const activePair = useRef<PairSelection | null>(null);
  const latestRerun = useRef<ShopRerun | null>(null);
  useLayoutEffect(() => {
    activePair.current = selection;
    return () => {
      activePair.current = null;
      latestRerun.current = null;
    };
  }, [selection]);
  const pair = useActionQuery(
    "get-comparison",
    { aId: scenario?.id ?? "", bId: comparison?.id },
    { enabled: !!scenario && !!comparison },
  );
  const demandScenario = comparison ? pair.data?.arrivalSource : scenario;
  const scope = pairCalculationScope(aId, bId);
  const compare = useActionMutation("compare-scenarios", {
    mutationKey: [...scope, "compare-scenarios"],
  });
  const client = useQueryClient();
  const rerunKey = [...scope, "shop-rerun"];
  const rerunState = useCalculationState(rerunKey);
  const rerun = useMutation({
    mutationKey: rerunKey,
    mutationFn: async (intent: ShopRerun) => {
      if (activePair.current !== intent.pair) return;
      const [scenariosRead, pairRead] = await Promise.all([
        query.refetch(),
        pair.refetch(),
      ]);
      if (activePair.current !== intent.pair || latestRerun.current !== intent)
        return;
      if (
        !scenariosRead.isSuccess ||
        !pairRead.isSuccess ||
        checkingRead(scenariosRead) ||
        checkingRead(pairRead)
      )
        throw new Error("Could not verify the current comparison inputs.");

      const { decision, rerunComparison, arrivalSource } = pairRead.data;
      if (!decision) return;
      const rows = scenariosRead.data.scenarios;
      const source = rows.find(({ id }) => id === arrivalSource?.id);
      const sides = rerunComparison && [rerunComparison.a, rerunComparison.b];
      const saved = sides?.find(({ id }) => id === intent.saved.id);
      if (
        !rerunComparison ||
        rerunComparison.a.id !== intent.pair.aId ||
        rerunComparison.b.id !== intent.pair.bId ||
        !source ||
        source.revision !== arrivalSource?.revision ||
        !saved ||
        saved.expectedRevision < intent.saved.expectedRevision ||
        saved.expectedFinanceRevision < intent.saved.expectedFinanceRevision ||
        sides?.some((version) => {
          const row = rows.find(({ id }) => id === version.id);
          return (
            row?.revision !== version.expectedRevision ||
            row.financeRevision !== version.expectedFinanceRevision
          );
        })
      )
        throw new Error("The comparison inputs changed while checking them.");
      if (!decision.serviceStale && !decision.cashStale) return;

      const writing = ["compare-scenarios", "compute-runway"].some((action) =>
        client.isMutating({ mutationKey: [...scope, action], exact: true }),
      );
      if (writing) throw new Error("Another calculation is still running.");
      try {
        await compare.mutateAsync({
          ...rerunComparison,
          expectedReceiptId: decision.receipt.id,
        });
      } catch (error) {
        throw new Error(
          actionErrorMessage(error) ?? "Could not rerun the comparison.",
        );
      }
    },
  });
  const scenarioRequirement = checkingRead(query)
    ? "Checking the saved scenarios…"
    : query.isError
      ? "Could not verify the saved scenarios. Retry near the opening file."
      : null;
  function rerunAfterShopSave(updated: Scenario) {
    if (!selection || activePair.current !== selection) return;
    if (pair.isSuccess && !checkingRead(pair) && !pair.data.decision) return;
    const intent = { pair: selection, saved: scenarioVersion(updated) };
    latestRerun.current = intent;
    rerun.mutate(intent);
  }
  function rerunFeedback(id?: string): ShopRerunFeedback | undefined {
    const intent = rerun.variables;
    if (!intent || intent.pair !== selection || intent.saved.id !== id) return;
    if (rerun.isPending) return { status: "pending" };
    if (rerun.error)
      return {
        status: "failed",
        message: rerun.error.message,
        retry: () => {
          if (activePair.current !== intent.pair || rerunState.inFlight()) return;
          latestRerun.current = intent;
          rerun.mutate(intent);
        },
      };
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
    if (!hasScenario) reportScroll("opening-file");
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
    const visible = cafeDocuments.find((name) => name === id);
    if (visible) reportScroll(visible);
    const focused = document.activeElement;
    if (
      focused === document.body ||
      (previous && previous.id !== id && focused?.id === previous.id)
    ) {
      target.focus({ preventScroll: true });
    }
  }, [hasScenario, location, reportScroll]);

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
      const canvasTop = scrollArea.getBoundingClientRect().top;
      const line =
        Math.max(rail.getBoundingClientRect().bottom - canvasTop, padding) + 8;
      let position:
        | { name: CafeDocument; section: Element; top: number }
        | undefined;
      for (const document of documents) {
        const top = document.section.getBoundingClientRect().top - canvasTop;
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
          position.section.getBoundingClientRect().top -
          scrollArea.getBoundingClientRect().top -
          position.top;
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
        {cafeDocuments.map((name, index) => {
          const available = hasScenario || name === "opening-file";
          return (
            <a
              key={name}
              href={available ? `#${name}` : undefined}
              role={available ? undefined : "link"}
              tabIndex={available ? undefined : 0}
              aria-current={currentDocument === name ? "location" : undefined}
              aria-disabled={available ? undefined : true}
              aria-describedby={available ? undefined : "cafe-documents-help"}
            >
              <span>{String(index).padStart(2, "0")}</span> {documentLabels[name]}
            </a>
          );
        })}
      </nav>
      {!hasScenario && (
        <p id="cafe-documents-help" className="sr-only">
          Open or start a scenario to use this document.
        </p>
      )}
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
        <div className="cafe-picker">
          <label htmlFor="cafe-scenario-picker">Scenario</label>
          <select
            id="cafe-scenario-picker"
            value={scenario?.id ?? ""}
            onChange={(event) => selectScenario(event.currentTarget.value)}
          >
            {query.data.scenarios.map(({ id, demand, label }) => (
              <option value={id} key={id}>
                {label} · {demand.hourly.base.value}/hr ·{" "}
                {sourceLabels[demand.hourly.base.source.tag]}
              </option>
            ))}
          </select>
          {scenario && (
            <p className="cafe-picker-demand">
              Base demand · {scenario.demand.hourly.base.value}/hr{" "}
              <Stamp tag={scenario.demand.hourly.base.source.tag} />
            </p>
          )}
        </div>
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
              <ShopForm
                scenario={scenario}
                onSaved={rerunAfterShopSave}
                rerunFeedback={rerunFeedback(scenario.id)}
              />
            </div>
          </section>
          <ComparisonWorkspace
            a={scenario}
            b={comparison}
            options={alternatives}
            compare={compare}
            scenarioRequirement={scenarioRequirement}
            rerunAfterShopSave={rerunAfterShopSave}
            rerunFeedback={rerunFeedback(comparison?.id)}
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
