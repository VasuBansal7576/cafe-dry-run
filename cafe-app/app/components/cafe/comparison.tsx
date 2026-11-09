import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import {
  actionErrorMessage,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { TAB_ID } from "@/lib/tab-id";

import type {
  DecisionReceipt,
  StoredDecision,
} from "../../../server/lib/cafe/decision-receipt";
import { illustrative } from "../../../server/lib/cafe/provenance";
import { demandLevels } from "../../../server/lib/cafe/scenario";
import type { Scenario } from "../../../server/lib/cafe/scenario-store";
import {
  COMPARISON_REVIEW_CONTEXT,
  COMPARISON_REVIEW_PROMPT,
} from "../../../shared/cafe/structured-review";
import {
  checkingRead,
  pairCalculationScope,
  useCalculationState,
} from "./calculation-state";
import {
  countFormat,
  FinanceLedger,
  SavedCustomerSensitivity,
  scenarioVersion,
  signedCash,
} from "./finance-ledger";
import { Stamp } from "./provenance-stamp";
import { ShopForm, type ShopRerunFeedback } from "./scenario-inputs";
import {
  Playback,
  ServiceFigure,
  ServiceMetrics,
  ServiceTest,
} from "./service-test";

const initialSettings = {
  seed: 42,
  runCount: 24,
  demandLevel: "base" as const,
};
type CompareMutation = ReturnType<
  typeof useActionMutation<undefined, undefined, "compare-scenarios">
>;
const waitDelta = (value: number | null) =>
  value === null
    ? "Unavailable"
    : `${value > 0 ? "+" : ""}${countFormat.format(value / 60)} min`;
const signedCount = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
  signDisplay: "exceptZero",
});
function staleAgainst(
  decision: StoredDecision,
  a: Scenario,
  b?: Scenario,
): StoredDecision {
  const { receipt } = decision;
  const serviceStale =
    decision.serviceStale ||
    receipt.a.service.scenarioRevision !== a.revision ||
    (b
      ? receipt.b?.service.scenarioRevision !== b.revision
      : receipt.a.service.id !== a.latestRunId);
  return {
    ...decision,
    serviceStale,
    cashStale:
      serviceStale ||
      decision.cashStale ||
      receipt.a.financeRevision !== a.financeRevision ||
      (!!b && receipt.b?.financeRevision !== b.financeRevision),
  };
}

function SideStats({
  side,
  label,
  stale,
}: {
  side: DecisionReceipt["a"];
  label: string;
  stale: boolean;
}) {
  const { summary } = side.service;
  return (
    <section className="cafe-comparison-side" aria-label={label}>
      <h3>{label}</h3>
      <p>
        {summary.runCount} {summary.runCount === 1 ? "Saturday" : "Saturdays"}
      </p>
      <ServiceMetrics summary={summary} stale={stale} paired />
      <p className="cafe-run-reference">
        Service revision {side.service.scenarioRevision} · Run {side.service.id}
      </p>
    </section>
  );
}

function MatchedPlayback({
  receipt,
  stale,
}: {
  receipt: DecisionReceipt;
  stale: boolean;
}) {
  const first = useActionQuery("get-simulation", {
    id: receipt.a.service.scenarioId,
    runId: receipt.a.service.id,
    includePlayback: "true",
  });
  const second = useActionQuery(
    "get-simulation",
    {
      id: receipt.b?.service.scenarioId ?? receipt.a.service.scenarioId,
      runId: receipt.b?.service.id ?? receipt.a.service.id,
      includePlayback: "true",
    },
    { enabled: !!receipt.b },
  );
  const a = first.data?.run;
  const b = second.data?.run;
  if (first.error || second.error) {
    return (
      <p className="cafe-notice" role="alert">
        {actionErrorMessage(first.error ?? second.error) ??
          "Could not load paired playback."}{" "}
        <button
          className="cafe-link"
          onClick={() => {
            void first.refetch();
            void second.refetch();
          }}
        >
          Try again
        </button>
      </p>
    );
  }
  if (!a?.playback || !b?.playback) {
    return (
      <p role="status">
        {first.isPending || second.isPending
          ? "Loading paired playback…"
          : "Paired playback is unavailable."}
      </p>
    );
  }
  return (
    <Playback
      receiptId={receipt.id}
      arrivalProvenance={receipt.a.service.summary.arrivalProvenance}
      stale={stale}
      boards={[
        {
          run: { ...a, playback: a.playback },
          label: `A · ${receipt.a.label}`,
        },
        {
          run: { ...b, playback: b.playback },
          label: `B · ${receipt.b?.label}`,
        },
      ]}
    />
  );
}

function ComparisonPlayback({
  decision,
  disabled,
}: {
  decision: StoredDecision;
  disabled: boolean;
}) {
  const { receipt, serviceStale, cashStale } = decision;
  const { a, b, settings } = receipt;
  if (!b || !receipt.delta) return null;
  const sample = receipt.weekend[settings.demandLevel];
  return (
    <>
      <div className="cafe-run-heading cafe-paired-heading">
        <h3>Matched Saturday results</h3>
        <p>
          Seed {settings.seed} · {settings.demandLevel} demand ·{" "}
          <ServiceFigure
            value={`${countFormat.format(sample.arrivals)} shared arrivals`}
            tag={a.service.summary.arrivalProvenance}
            stale={serviceStale}
          />{" "}
          across {settings.runCount}{" "}
          {settings.runCount === 1 ? "Saturday" : "Saturdays"}
        </p>
        <button
          type="button"
          className="cafe-secondary"
          aria-disabled={cashStale || disabled}
          onClick={() => {
            if (cashStale || disabled) return;
            const scope = {
              kind: "cafe-comparison-review",
              aId: a.service.scenarioId,
              bId: b.service.scenarioId,
              receiptId: receipt.id,
            };
            sendToAgentChat({
              message: COMPARISON_REVIEW_PROMPT,
              context: COMPARISON_REVIEW_CONTEXT + JSON.stringify(scope),
              actionScope: scope,
              contextLabel: "Matched Saturday result",
              openSidebar: true,
              submit: true,
              tabId: TAB_ID,
            });
          }}
        >
          Explain
        </button>
      </div>
      {serviceStale && (
        <p className="cafe-notice" role="status">
          <strong>Stale service result.</strong> Rerun both Saturdays to apply
          the saved inputs.
        </p>
      )}
      {cashStale && (
        <p className="cafe-notice" role="status">
          <strong>Stale cash deltas.</strong> Refresh the comparison to include
          current cash assumptions.
        </p>
      )}
      <MatchedPlayback
        key={`${a.service.id}:${b.service.id}`}
        receipt={receipt}
        stale={serviceStale}
      />
    </>
  );
}

function ComparisonMetrics({
  decision,
  disabled,
  setSavedCustomers,
}: {
  decision: StoredDecision;
  disabled: boolean;
  setSavedCustomers: (enabled: boolean) => void;
}) {
  const { receipt, cashStale, serviceStale } = decision;
  const { a, b, delta, savedCustomers, cashBaseline } = receipt;
  if (!b || !delta) return null;
  const moneyDeltas = [
    ["Monthly staff cost", delta.staffPerMonth],
    ["Monthly cash change", delta.monthlyCash],
    ["Cash after startup", delta.closingCashAfterStartup],
  ] as const;
  return (
    <>
      {cashBaseline && (
        <p>
          Shared arrival and cash baseline · {cashBaseline.label} · revision{" "}
          {cashBaseline.revision}
        </p>
      )}
      <div
        className="cafe-paired-boards"
        role="group"
        aria-label="Metrics across all simulated Saturdays"
      >
        <SideStats side={a} label={`A · ${a.label}`} stale={serviceStale} />
        <SideStats side={b} label={`B · ${b.label}`} stale={serviceStale} />
      </div>
      <div className="cafe-decision-summary">
        <h3>What changes in B?</h3>
        {delta.higherMonthlyCash && (
          <p>
            {cashStale && "Saved projection. "}
            {delta.higherMonthlyCash.current === "tie"
              ? "Monthly cash is tied."
              : `${delta.higherMonthlyCash.current === "a" ? a.label : b.label} has higher monthly cash with the saved-customer switch ${savedCustomers.enabled ? "on" : "off"}.`}{" "}
            <Stamp tag={delta.monthlyCash.tag} stale={cashStale} />
          </p>
        )}
        <dl className="cafe-metrics" aria-label="B minus A">
          <div>
            <dt>Median wait</dt>
            <dd>
              <ServiceFigure
                value={waitDelta(delta.waitP50Seconds.value)}
                tag={
                  delta.waitP50Seconds.value === null
                    ? undefined
                    : delta.waitP50Seconds.tag
                }
                stale={serviceStale}
              />
            </dd>
          </div>
          <div>
            <dt>Long wait · p90</dt>
            <dd>
              <ServiceFigure
                value={waitDelta(delta.waitP90Seconds.value)}
                tag={
                  delta.waitP90Seconds.value === null
                    ? undefined
                    : delta.waitP90Seconds.tag
                }
                stale={serviceStale}
              />
            </dd>
          </div>
          <div>
            <dt>Lost per Saturday</dt>
            <dd>
              <ServiceFigure
                value={signedCount.format(delta.customersLostPerSaturday.value)}
                tag={delta.customersLostPerSaturday.tag}
                stale={serviceStale}
              />
            </dd>
          </div>
          {moneyDeltas.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>
                <ServiceFigure
                  value={signedCash.format(value.value)}
                  tag={value.tag}
                  stale={cashStale}
                />
              </dd>
            </div>
          ))}
        </dl>
      </div>
      <aside className="cafe-customer-assumption">
        <h4>Assumption that can change the decision</h4>
        <label className="cafe-checkbox-label">
          <input
            type="checkbox"
            checked={savedCustomers.enabled}
            aria-disabled={disabled || cashStale}
            onChange={(event) => {
              if (!disabled && !cashStale)
                setSavedCustomers(event.currentTarget.checked);
            }}
          />
          Count weekend customers who would have left but now place an order
        </label>
        <p>
          Assumption source <Stamp tag={savedCustomers.tag} />
        </p>
        <SavedCustomerSensitivity receipt={receipt} stale={cashStale} />
      </aside>
    </>
  );
}

function PairedWorkspace({
  a,
  b,
  controls,
  compare,
  scenarioRequirement,
  rerunAfterShopSave,
  rerunFeedback,
}: {
  a: Scenario;
  b: Scenario;
  controls: ReactNode;
  compare: CompareMutation;
  scenarioRequirement: string | null;
  rerunAfterShopSave: (scenario: Scenario) => void;
  rerunFeedback?: ShopRerunFeedback | undefined;
}) {
  const saved = useActionQuery("get-comparison", { aId: a.id, bId: b.id });
  const scope = pairCalculationScope(a.id, b.id);
  const calculation = useCalculationState(scope);
  const compute = useActionMutation("compute-runway", {
    mutationKey: [...scope, "compute-runway"],
    onError: () => void saved.refetch(),
  });
  const requirementId = useId();
  const compareButton = useRef<HTMLButtonElement>(null);
  const checking = checkingRead(saved);
  const comparisonError = !checking && saved.isError;
  const readRequirement = checking
    ? saved.data
      ? "Checking the saved comparison…"
      : "Loading the comparison…"
    : comparisonError
      ? (actionErrorMessage(saved.error) ?? "Could not verify the saved comparison.")
      : scenarioRequirement ??
        (!saved.data?.arrivalSource ? "Shared Saturday demand is unavailable." : null);
  const currentPair =
    compare.variables?.a.id === a.id && compare.variables?.b.id === b.id;
  const busy = calculation.pending;
  const actionsUnavailable = busy || !!readRequirement;
  const switchEdit = !!compute.variables?.comparison?.savedCustomers;
  const [draft, setDraft] = useState<{
    seed?: string;
    runCount?: string;
    demandLevel?: DecisionReceipt["settings"]["demandLevel"];
  }>({});
  const previous = saved.data?.decision;
  const decision = previous ? staleAgainst(previous, a, b) : previous;
  const settings = {
    ...(decision?.receipt.settings ?? initialSettings),
    ...draft,
  };
  function refresh(assumption?: boolean) {
    if (
      readRequirement ||
      calculation.inFlight() ||
      !decision ||
      decision.serviceStale
    )
      return;
    compute.mutate({
      comparison: {
        a: scenarioVersion(a),
        b: scenarioVersion(b),
        receiptId: decision.receipt.id,
        ...(assumption === undefined
          ? {}
          : { savedCustomers: { enabled: assumption, tag: "estimate" } }),
      },
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (readRequirement || calculation.inFlight()) return;
    compare.mutate({
      a: scenarioVersion(a),
      b: scenarioVersion(b),
      seed: Number(settings.seed),
      runCount: Number(settings.runCount),
      demandLevel: settings.demandLevel,
    });
  }
  return (
    <>
      <section
        id="service-test"
        className="cafe-section"
        aria-labelledby="service-title"
        tabIndex={-1}
      >
        <header>
          <p className="cafe-kicker">02 · Saturday rehearsal</p>
          <h2 id="service-title">Service test</h2>
        </header>
        <div className="cafe-board cafe-service">
          {decision && (
            <ComparisonPlayback
              decision={decision}
              disabled={actionsUnavailable}
            />
          )}
          {controls}
          {saved.data?.arrivalSource && (
            <p className="cafe-shared-demand">
              Both shops use Saturday arrivals from{" "}
              {saved.data.arrivalSource.label}.{" "}
              <a href="#site-demand">Edit shared demand</a>
            </p>
          )}
          <form
            className="cafe-service-settings"
            onSubmit={submit}
            aria-label="Comparison settings"
          >
            <label>
              Demand case
              <select
                value={settings.demandLevel}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    demandLevel: event.currentTarget
                      .value as typeof settings.demandLevel,
                  })
                }
              >
                {demandLevels.map((level) => (
                  <option key={level} value={level}>
                    {level[0]!.toUpperCase() + level.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Random seed
              <input
                type="number"
                required
                min={0}
                max={4294967295}
                step={1}
                value={settings.seed}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    seed: event.currentTarget.value,
                  })
                }
              />
            </label>
            <label>
              Saturdays to run
              <input
                type="number"
                required
                min={1}
                max={100}
                step={1}
                value={settings.runCount}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    runCount: event.currentTarget.value,
                  })
                }
              />
            </label>
            <button
              ref={compareButton}
              className="cafe-primary"
              aria-disabled={actionsUnavailable}
              aria-describedby={readRequirement ? requirementId : undefined}
            >
              {currentPair && compare.isPending
                ? "Comparing Saturdays…"
                : decision
                  ? "Rerun comparison"
                  : "Compare Saturdays"}
            </button>
          </form>
          {currentPair && compare.error && (
            <p className="cafe-notice" role="alert">
              {actionErrorMessage(compare.error) ??
                "Could not compare these scenarios."}
            </p>
          )}
          {readRequirement && (
            <div
              className="cafe-notice"
              role={comparisonError ? "alert" : "status"}
            >
              <p id={requirementId}>{readRequirement}</p>
              {comparisonError && (
                <button
                  className="cafe-link"
                  onClick={(event) => {
                    if (document.activeElement === event.currentTarget)
                      compareButton.current?.focus({ preventScroll: true });
                    void saved.refetch();
                  }}
                >
                  Try again
                </button>
              )}
            </div>
          )}
          {!decision && !readRequirement && (
            <p>Compare to see the same customers pass through both shops.</p>
          )}
          {decision && (
            <ComparisonMetrics
              decision={decision}
              disabled={actionsUnavailable}
              setSavedCustomers={refresh}
            />
          )}
          {switchEdit && compute.error && (
            <p className="cafe-notice" role="alert">
              {actionErrorMessage(compute.error) ??
                "Could not change the saved-customer assumption."}
            </p>
          )}
          <details className="cafe-alternative-edit">
            <summary>Edit B · {b.label}</summary>
            <ShopForm
              scenario={b}
              heading={`B · ${b.label} staff & equipment`}
              onSaved={rerunAfterShopSave}
              rerunFeedback={rerunFeedback}
            />
          </details>
        </div>
      </section>
      <FinanceLedger
        a={a}
        b={b}
        decision={decision}
        pending={busy}
        serviceRequirement={
          comparisonError
            ? "Could not verify the saved comparison. Retry in Service test."
            : readRequirement ??
              (!decision || decision.serviceStale
                ? "Run a fresh Saturday comparison to compute paired runway."
                : null)
        }
        error={switchEdit ? null : compute.error}
        onCompute={() => refresh()}
      />
    </>
  );
}

function SingleWorkspace({
  scenario,
  controls,
  scenarioRequirement,
}: {
  scenario: Scenario;
  controls: ReactNode;
  scenarioRequirement: string | null;
}) {
  const saved = useActionQuery("get-comparison", { aId: scenario.id });
  const latest = useActionQuery(
    "get-simulation",
    { id: scenario.id, includePlayback: "true" },
    { enabled: !!scenario.latestRunId },
  );
  const mutationKey = ["cafe-calculation", "compute-runway", scenario.id];
  const compute = useActionMutation("compute-runway", { mutationKey });
  const calculation = useCalculationState(mutationKey);
  const previous = saved.data?.decision;
  const decision = previous ? staleAgainst(previous, scenario) : previous;
  const run = latest.data?.run;
  const checkingRun = !!scenario.latestRunId && checkingRead(latest);
  const readyRun =
    !scenarioRequirement &&
    !checkingRun &&
    !latest.error &&
    run &&
    !run.stale &&
    run.id === scenario.latestRunId &&
    run.scenarioRevision === scenario.revision
      ? run
      : null;
  const serviceRequirement = readyRun
    ? null
    : !checkingRun && latest.isError
      ? "Could not verify the saved Saturday simulation. Try loading it again in Service test."
      : scenarioRequirement ??
        (checkingRun
          ? "Checking the saved Saturday simulation…"
          : "Run a fresh Saturday simulation to compute runway.");
  return (
    <>
      <ServiceTest
        scenario={scenario}
        controls={controls}
        latest={latest}
        scenarioRequirement={scenarioRequirement}
      />
      {saved.error && (
        <p className="cafe-notice" role="alert">
          {actionErrorMessage(saved.error) ?? "Could not load saved runway."}
        </p>
      )}
      <FinanceLedger
        a={scenario}
        decision={decision}
        pending={calculation.pending}
        serviceRequirement={serviceRequirement}
        error={compute.error}
        onCompute={() => {
          if (readyRun && !calculation.inFlight())
            compute.mutate({
              ...scenarioVersion(scenario),
              runId: readyRun.id,
            });
        }}
      />
    </>
  );
}

export function ComparisonWorkspace({
  a,
  b,
  options,
  select,
  compare,
  scenarioRequirement,
  rerunAfterShopSave,
  rerunFeedback,
}: {
  a: Scenario;
  b?: Scenario | undefined;
  options: Scenario[];
  select: (id: string | null) => void;
  compare: CompareMutation;
  scenarioRequirement: string | null;
  rerunAfterShopSave: (scenario: Scenario) => void;
  rerunFeedback?: ShopRerunFeedback | undefined;
}) {
  const copy = useActionMutation("configure-shop", {
    onSuccess: ({ scenario }) => select(scenario.id),
  });
  const [grinderQuote, setGrinderQuote] = useState("");
  function addBarista() {
    let index = 1;
    while (a.shop.workers.some(({ id }) => id === `barista-${index}`)) index++;
    copy.mutate({
      ...scenarioVersion(a),
      variantLabel:
        a.shop.workers.length === 1 ? "Two baristas" : "Extra barista",
      shop: {
        workers: [
          ...a.shop.workers,
          {
            id: `barista-${index}`,
            name: `Barista ${index}`,
            shifts: [{ startsAt: a.demand.opensAt, endsAt: a.demand.closesAt }],
          },
        ],
      },
    });
  }
  function addGrinder(event: FormEvent) {
    event.preventDefault();
    const cost = Number(grinderQuote);
    copy.mutate({
      ...scenarioVersion(a),
      variantLabel: "Extra grinder",
      shop: {
        equipment: {
          ...a.shop.equipment,
          grinder: illustrative(a.shop.equipment.grinder.value + 1),
        },
      },
      variantFinance: {
        equipmentAdditions: [
          ...a.finance.equipmentAdditions,
          { value: cost, source: { tag: "estimate" } },
        ],
      },
    });
  }
  const controls = (
    <div className="cafe-comparison-controls">
      <div className="cafe-controls">
        <p className="cafe-kicker">A · {a.label}</p>
        <label>
          Scenario B{" "}
          <select
            value={b?.id ?? ""}
            onChange={(event) => select(event.currentTarget.value || null)}
          >
            <option value="">Single Saturday</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
                {option.parentId !== a.id ? ` · ${option.id.slice(0, 8)}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <details>
        <summary>Create a variant</summary>
        <div className="cafe-controls">
          <button
            type="button"
            className="cafe-secondary"
            disabled={copy.isPending || a.shop.workers.length >= 20}
            onClick={addBarista}
          >
            Add barista variant
          </button>
          <form onSubmit={addGrinder} className="cafe-controls">
            <label>
              <span>
                Extra grinder price (₹) <Stamp tag="estimate" />
              </span>
              <input
                required
                type="number"
                min={0}
                max={1_000_000_000}
                step="any"
                placeholder="Enter your estimate"
                value={grinderQuote}
                onChange={(event) => setGrinderQuote(event.currentTarget.value)}
              />
            </label>
            <button
              className="cafe-secondary"
              disabled={
                copy.isPending ||
                a.shop.equipment.grinder.value >= 20 ||
                a.finance.equipmentAdditions.length >= 20
              }
            >
              Add grinder variant
            </button>
          </form>
        </div>
        <p>
          The extra barista starts with a full Saturday shift. Enter the price
          of the extra grinder before creating that variant.
        </p>
      </details>
      {copy.error && (
        <p className="cafe-notice" role="alert">
          {actionErrorMessage(copy.error) ?? "Could not create a variant."}
        </p>
      )}
    </div>
  );
  return b ? (
    <PairedWorkspace
      key={`${a.id}:${b.id}`}
      a={a}
      b={b}
      controls={controls}
      compare={compare}
      scenarioRequirement={scenarioRequirement}
      rerunAfterShopSave={rerunAfterShopSave}
      rerunFeedback={rerunFeedback}
    />
  ) : (
    <SingleWorkspace
      scenario={a}
      controls={controls}
      scenarioRequirement={scenarioRequirement}
    />
  );
}
