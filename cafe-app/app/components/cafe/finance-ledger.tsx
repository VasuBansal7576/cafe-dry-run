import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useId, useState, type FormEvent } from "react";

import type {
  DecisionReceipt,
  StoredDecision,
} from "../../../server/lib/cafe/decision-receipt";
import type { ScenarioFinance } from "../../../server/lib/cafe/finance";
import type { SourceTag } from "../../../server/lib/cafe/provenance";
import { demandLevels } from "../../../server/lib/cafe/scenario";
import type { Scenario } from "../../../server/lib/cafe/scenario-store";
import { FormStatus, sourceLabels, TaggedField } from "./scenario-inputs";

export const cashFormat = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});
export const countFormat = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
});
const caseLabels = { low: "Low", base: "Base", high: "High" };
const percentageFormat = new Intl.NumberFormat("en-IN", {
  style: "percent",
  maximumFractionDigits: 2,
});
type Side = DecisionReceipt["a"];

const financeGroups = [
  {
    label: "Opening cash & startup",
    fields: [
      { key: "cash", label: "Opening cash (₹)" },
      { key: "fitOut", label: "Fit-out & other startup costs (₹)" },
      { key: "equipmentUpfront", label: "Base startup equipment (₹)" },
    ],
  },
  {
    label: "Monthly costs",
    fields: [
      { key: "rent", label: "Rent per month (₹)" },
      { key: "otherRecurring", label: "Other recurring costs per month (₹)" },
      { key: "hourlyWage", label: "Wage per staff hour (₹)" },
    ],
  },
  {
    label:
      "Legacy blended amounts · used for drinks without their own price and cost",
    fields: [
      { key: "averagePrice", label: "Legacy blended order price (₹)" },
      {
        key: "averageIngredientCost",
        label: "Legacy blended ingredients per order (₹)",
      },
    ],
  },
  {
    label: "Weekday & weekend calendar",
    fields: [
      {
        key: "weekdaysPerMonth",
        label: "Open weekdays per month",
        step: 1,
        max: 23,
      },
      {
        key: "weekendsPerMonth",
        label: "Open weekend days per month",
        step: 1,
        max: 10,
      },
      {
        key: "weekdayStaffCount",
        label: "Weekday staff count",
        step: 1,
        max: 20,
      },
      {
        key: "weekdayHoursPerWorker",
        label: "Paid hours per weekday worker",
        max: 24,
      },
      {
        key: "weekdayLossPercent",
        label: "Weekday customers lost (%)",
        max: 100,
      },
    ],
  },
] as const;

export function scenarioVersion(scenario: Scenario) {
  return {
    id: scenario.id,
    expectedRevision: scenario.revision,
    expectedFinanceRevision: scenario.financeRevision,
  };
}

function FinanceForm({
  scenario,
  side,
}: {
  scenario: Scenario;
  side: "A" | "B";
}) {
  const [draft, setDraft] = useState<{
    value: ScenarioFinance;
    financeRevision: number;
  } | null>(null);
  const change = useActionMutation("configure-finance", {
    onSuccess: () => setDraft(null),
  });
  const heading = useId();
  const current = draft?.value ?? scenario.finance;
  const conflict =
    !!draft && draft.financeRevision !== scenario.financeRevision;
  function edit(value: ScenarioFinance) {
    setDraft({
      value,
      financeRevision: draft?.financeRevision ?? scenario.financeRevision,
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft && !conflict && !change.isPending) {
      change.mutate({
        id: scenario.id,
        expectedFinanceRevision: draft.financeRevision,
        finance: draft.value,
      });
    }
  }

  return (
    <form aria-labelledby={heading} onSubmit={submit}>
      <fieldset className="cafe-board cafe-form" disabled={change.isPending}>
        <h3 id={heading}>
          {side} · {scenario.label}
        </h3>
        {financeGroups.map(({ label, fields }) => (
          <fieldset className="cafe-subboard" key={label}>
            <legend>{label}</legend>
            <div className="cafe-fields">
              {fields.map((field) => (
                <TaggedField
                  key={field.key}
                  label={field.label}
                  value={current[field.key]}
                  step={"step" in field ? field.step : "any"}
                  max={"max" in field ? field.max : 1_000_000_000}
                  onChange={(value) => edit({ ...current, [field.key]: value })}
                />
              ))}
            </div>
            {label === "Opening cash & startup" &&
              current.equipmentAdditions.map((quote, index) => (
                <TaggedField
                  key={index}
                  label={`Additional equipment purchase ${index + 1} (₹)`}
                  value={quote}
                  step="any"
                  max={1_000_000_000}
                  onChange={(value) =>
                    edit({
                      ...current,
                      equipmentAdditions: current.equipmentAdditions.map(
                        (entry, quoteIndex) =>
                          quoteIndex === index ? value : entry,
                      ),
                    })
                  }
                />
              ))}
          </fieldset>
        ))}
        <fieldset className="cafe-subboard">
          <legend>Weekday arrivals per open day</legend>
          <div className="cafe-fields">
            {demandLevels.map((level) => (
              <TaggedField
                key={level}
                label={`${caseLabels[level]} weekday arrivals`}
                value={current.weekdayDemand[level]}
                max={120000}
                step="any"
                onChange={(value) =>
                  edit({
                    ...current,
                    weekdayDemand: { ...current.weekdayDemand, [level]: value },
                  })
                }
              />
            ))}
          </div>
          <p>
            Weekend demand comes from the hourly Saturday curve. Weekend wages
            use the saved Saturday shifts.
          </p>
        </fieldset>
        <button className="cafe-primary" disabled={!draft || conflict}>
          {change.isPending ? "Saving money inputs…" : "Save money inputs"}
        </button>
        <FormStatus
          conflicted={conflict}
          error={change.error}
          onReset={() => setDraft(null)}
        />
      </fieldset>
    </form>
  );
}

export function Stamp({ tag }: { tag: SourceTag }) {
  return <span className="cafe-stamp">{sourceLabels[tag]}</span>;
}

function Figure({
  figure,
  format,
}: {
  figure: { value: number | null; tag: SourceTag };
  format: Intl.NumberFormat;
}) {
  return (
    <>
      {figure.value === null ? "Unavailable" : format.format(figure.value)}{" "}
      <Stamp tag={figure.tag} />
    </>
  );
}

function CashChart({ receipt }: { receipt: DecisionReceipt }) {
  const title = useId();
  const { demandLevel } = receipt.settings;
  const a = receipt.a.cash.outcomes[demandLevel].closingCash;
  const b = receipt.b?.cash.outcomes[demandLevel].closingCash;
  const min = Math.min(
    0,
    ...a.map(({ value }) => value),
    ...(b?.map(({ value }) => value) ?? []),
  );
  const max = Math.max(
    0,
    ...a.map(({ value }) => value),
    ...(b?.map(({ value }) => value) ?? []),
  );
  const x = (index: number) => 20 + index * 47;
  const y = (value: number) => 18 + ((max - value) / (max - min || 1)) * 120;
  const labelX = (position: number) => `${(position / 390) * 100}%`;
  const labelY = (position: number) => `${(position / 164) * 100}%`;
  const labelColumn = labelX(309);
  const aEnd = y(a[a.length - 1]!.value);
  const bEnd = b ? y(b[b.length - 1]!.value) : null;
  const zeroY = y(0);
  const endLabelsOverlap = bEnd !== null && Math.abs(aEnd - bEnd) < 16;
  const points = (figures: typeof a) =>
    figures.map(({ value }, index) => `${x(index)},${y(value)}`).join(" ");
  return (
    <div className="cafe-cash-chart">
      <h4>Cash after startup and each month</h4>
      <svg role="img" aria-labelledby={title}>
        <title id={title}>
          {caseLabels[demandLevel]} case closing cash projection. Exact values
          follow.
        </title>
        <svg viewBox="0 0 390 164" width="100%" height="100%">
          <line
            x1={x(0)}
            y1={zeroY}
            x2={x(a.length - 1)}
            y2={zeroY}
            className="cafe-zero-line"
          />
          <polyline points={points(a)} className="cafe-chart-a" />
          {b && <polyline points={points(b)} className="cafe-chart-b" />}
        </svg>
        <text x={labelColumn} y={labelY(zeroY)} dy="4">
          ₹0 cash
        </text>
        <text
          className="cafe-chart-label-a"
          x={labelColumn}
          y={labelY(aEnd)}
          dy={endLabelsOverlap || Math.abs(aEnd - zeroY) < 16 ? -8 : 4}
        >
          A
        </text>
        {bEnd !== null && (
          <text
            className="cafe-chart-label-b"
            x={labelColumn}
            y={labelY(bEnd)}
            dy={endLabelsOverlap || Math.abs(bEnd - zeroY) < 16 ? 16 : 4}
          >
            B
          </text>
        )}
        {a.map((_, index) => (
          <text
            key={index}
            x={labelX(x(index))}
            y={labelY(158)}
            textAnchor="middle"
          >
            {index}
          </text>
        ))}
      </svg>
      <p>
        Month 0 is cash left after startup. Negative balances show the funding
        shortfall.
      </p>
      <details>
        <summary>Exact monthly balances</summary>
        <table>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">A</th>
              {b && <th scope="col">B</th>}
            </tr>
          </thead>
          <tbody>
            {a.map((value, index) => (
              <tr key={index}>
                <th scope="row">{index}</th>
                <td>
                  <Figure figure={value} format={cashFormat} />
                </td>
                {b && (
                  <td>
                    <Figure figure={b[index]!} format={cashFormat} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function Receipt({ decision }: { decision: StoredDecision }) {
  const {
    receipt,
    cashStale,
    historical,
    assumptionStale,
    currentSavedCustomers,
  } = decision;
  const {
    a,
    b,
    settings: { demandLevel },
  } = receipt;
  const unsampled = demandLevels.filter(
    (level) =>
      receipt.weekendDemand[level].value > 0 &&
      receipt.weekend[level].arrivals === 0,
  );
  const rows: {
    label: string;
    get: (side: Side) => { value: number | null; tag: SourceTag };
    format: Intl.NumberFormat;
  }[] = [
    {
      label: "Break-even orders per open day",
      get: ({ cash }) => cash.breakEvenOrdersPerDay,
      format: countFormat,
    },
    {
      label: "Startup costs",
      get: ({ cash }) => cash.costs.startup,
      format: cashFormat,
    },
    {
      label: "Recurring costs excluding staff",
      get: ({ cash }) => cash.costs.recurring,
      format: cashFormat,
    },
    {
      label: "Weekday wages per month",
      get: ({ cash }) => cash.costs.weekdayStaff,
      format: cashFormat,
    },
    {
      label: "Weekend wages per month",
      get: ({ cash }) => cash.costs.weekendStaff,
      format: cashFormat,
    },
    {
      label: "Open weekdays per month",
      get: ({ finance }) => ({
        value: finance.weekdaysPerMonth.value,
        tag: finance.weekdaysPerMonth.source.tag,
      }),
      format: countFormat,
    },
    {
      label: "Open weekend days per month",
      get: ({ finance }) => ({
        value: finance.weekendsPerMonth.value,
        tag: finance.weekendsPerMonth.source.tag,
      }),
      format: countFormat,
    },
    {
      label: "Weekday arrivals per open day",
      get: ({ finance }) => ({
        value: finance.weekdayDemand[demandLevel].value,
        tag: finance.weekdayDemand[demandLevel].source.tag,
      }),
      format: countFormat,
    },
    {
      label: "Weekend arrivals per open day",
      get: () => receipt.weekendDemand[demandLevel],
      format: countFormat,
    },
    {
      label: "Weekend orders per open day",
      get: ({ cash }) => cash.outcomes[demandLevel].weekendOrdersPerDay,
      format: countFormat,
    },
    {
      label: "Monthly revenue",
      get: ({ cash }) => cash.outcomes[demandLevel].monthlyRevenue,
      format: cashFormat,
    },
    {
      label: "Monthly ingredient costs",
      get: ({ cash }) => cash.outcomes[demandLevel].monthlyIngredientCost,
      format: cashFormat,
    },
    {
      label: "Monthly cash change",
      get: ({ cash }) => cash.outcomes[demandLevel].monthlyCash,
      format: cashFormat,
    },
    {
      label: "Monthly burn",
      get: ({ cash }) => cash.outcomes[demandLevel].burn,
      format: cashFormat,
    },
  ];
  return (
    <article className="cafe-receipt" aria-label="Cash runway receipt">
      <div className="cafe-receipt-main">
        <header>
          <p className="cafe-kicker">
            Opening assumptions · {caseLabels[demandLevel]} case
          </p>
          <h3>What must be true for this café to work?</h3>
        </header>
        {cashStale && (
          <p className="cafe-notice" role="status">
            <strong>Stale cash receipt.</strong>{" "}
            {assumptionStale
              ? `This receipt used an earlier saved-customer assumption. The current setting is ${currentSavedCustomers.enabled ? "on" : "off"}.`
              : "Refresh the cash projection to use current inputs."}
          </p>
        )}
        {historical && <p>Historical receipt</p>}
        <table>
          <thead>
            <tr>
              <th scope="col">Ledger</th>
              <th scope="col">A · {a.label}</th>
              {b && <th scope="col">B · {b.label}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ label, get, format }) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>
                  <Figure figure={get(a)} format={format} />
                </td>
                {b && (
                  <td>
                    <Figure figure={get(b)} format={format} />
                  </td>
                )}
              </tr>
            ))}
            {demandLevels.map((level) => (
              <tr key={level}>
                <th scope="row">{caseLabels[level]} case runway</th>
                {(b ? [a, b] : [a]).map(({ cash, service }) => {
                  const { value, tag } = cash.outcomes[level].runway;
                  return (
                    <td key={service.scenarioId}>
                      {value.kind === "no-burn"
                        ? "No burn"
                        : `${countFormat.format(value.months)} mo`}{" "}
                      <Stamp tag={tag} />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Break-even is the first whole number of orders per open day that
          produces nonnegative posted monthly cash. Revenue and ingredients are
          rounded to the nearest paise as separate monthly lines. At very small
          margins, nearby volumes may dip below break-even again. Startup costs
          are paid before month one.
        </p>
        <p>
          Weekend sales use completed drinks from the matched Saturdays, scaled
          to expected daily arrivals. Weekdays use their own arrivals and loss
          assumptions.
        </p>
        {receipt.cashBaseline && (
          <p>
            Shared arrival and cash baseline · {receipt.cashBaseline.label} ·
            revision {receipt.cashBaseline.revision}
          </p>
        )}
        {receipt.pedestrian && (
          <p>
            {countFormat.format(receipt.pedestrian.count.value)} counted
            Saturday passers-by <Stamp tag="observed" />
            {" · "}
            {percentageFormat.format(
              receipt.pedestrian.conversionPercent.value / 100,
            )}{" "}
            expected conversion{" "}
            <Stamp tag={receipt.pedestrian.conversionPercent.source.tag} />
          </p>
        )}
        <details>
          <summary>Prices and ingredient costs by day type</summary>
          <p>
            Break-even assumes the same order count each open day. It uses each
            café's weekday menu mix and its projected completed-drink mix in the
            base Saturday demand case.
          </p>
          {(b ? [a, b] : [a]).map(({ label, cash, service }) => (
            <div key={service.scenarioId}>
              <strong>{label}</strong>
              {(
                [
                  [
                    "Weekday",
                    cash.assumptions.weekdayUnitEconomics,
                    cash.assumptions.weekdayLegacyDrinks,
                  ],
                  [
                    cash.assumptions.breakEvenWeekendMix ===
                    "base-case-completed"
                      ? "Weekend break-even · base case"
                      : cash.assumptions.breakEvenWeekendMix ===
                          "arrival-mix-fallback"
                        ? "Weekend break-even · arrival mix used because no orders are projected"
                        : "Weekend break-even · saved arrival mix",
                    cash.assumptions.weekendUnitEconomics,
                    cash.assumptions.weekendLegacyDrinks,
                  ],
                ] as const
              ).map(([period, units, legacy]) => (
                <p key={period}>
                  {period} ·{" "}
                  {units ? (
                    <>
                      <Figure figure={units.price} format={cashFormat} /> sale
                      price ·{" "}
                      <Figure
                        figure={units.ingredientCost}
                        format={cashFormat}
                      />{" "}
                      ingredients per order
                      {!!legacy?.length &&
                        ` · Legacy blended amounts for ${legacy.join(", ")}`}
                    </>
                  ) : (
                    "Legacy blended amounts"
                  )}
                </p>
              ))}
            </div>
          ))}
        </details>
        {!!unsampled.length && (
          <p>
            <strong>
              No sampled weekend arrivals for{" "}
              {unsampled.map((level) => caseLabels[level]).join(", ")}.
            </strong>{" "}
            These cases project zero Saturday sales. Run more Saturdays to
            sample this demand.
          </p>
        )}
        {b && (
          <p>
            Count recovered weekend customers ·{" "}
            {receipt.savedCustomers.enabled ? "On" : "Off"}{" "}
            <Stamp tag={receipt.savedCustomers.tag} />
          </p>
        )}
        <details>
          <summary>Break-even capture rates</summary>
          <p>
            {receipt.pedestrian
              ? "This benchmark applies the counted Saturday footfall to break-even orders per open day. The weekday cash forecast uses separate demand."
              : "Examples use assumed passers-by per open day."}
          </p>
          {(b ? [a, b] : [a]).map((side, index) => (
            <p key={side.service.scenarioId}>
              {index ? "B" : "A"} ·{" "}
              {side.cash.requiredCaptureRate ? (
                side.cash.requiredCaptureRate.value === null ? (
                  "Required conversion unavailable with this footfall or break-even volume."
                ) : (
                  <Figure
                    figure={side.cash.requiredCaptureRate}
                    format={percentageFormat}
                  />
                )
              ) : side.cash.illustrativeCaptureRates.length ? (
                side.cash.illustrativeCaptureRates
                  .map(
                    ({ passersByPerOpenDay, rate }) =>
                      `${countFormat.format(rate.value * 100)}% of ${countFormat.format(passersByPerOpenDay.value)} passers-by`,
                  )
                  .join(" · ")
              ) : (
                "No break-even volume under these assumptions."
              )}{" "}
              {!!side.cash.illustrativeCaptureRates.length && (
                <Stamp tag="illustrative" />
              )}
            </p>
          ))}
        </details>
        <footer>
          <p>Receipt {receipt.id}</p>
          {(b ? [a, b] : [a]).map(({ service, financeRevision }, index) => (
            <p key={service.id}>
              {index ? "B" : "A"} · Scenario {service.scenarioId} · service
              revision {service.scenarioRevision} · cash revision{" "}
              {financeRevision} · run {service.id}
            </p>
          ))}
          <button
            type="button"
            className="cafe-secondary"
            onClick={() => window.print()}
          >
            Print receipt
          </button>
        </footer>
      </div>
      <CashChart receipt={receipt} />
    </article>
  );
}

export function FinanceLedger({
  a,
  b,
  decision,
  busy,
  refreshPair,
}: {
  a: Scenario;
  b?: Scenario;
  decision: StoredDecision | null | undefined;
  busy: boolean;
  refreshPair: () => void;
}) {
  const compute = useActionMutation("compute-runway");
  return (
    <section
      id="cash-ledger"
      className="cafe-section"
      aria-labelledby="cash-title"
    >
      <header>
        <p className="cafe-kicker">03 · Opening assumptions</p>
        <h2 id="cash-title">Cash ledger</h2>
      </header>
      <details className="cafe-finance-details" open={!decision || undefined}>
        <summary>Money & demand assumptions</summary>
        <div className="cafe-input-boards">
          <FinanceForm key={a.id} scenario={a} side="A" />
          {b && <FinanceForm key={b.id} scenario={b} side="B" />}
        </div>
      </details>
      <div className="cafe-controls cafe-ledger-controls">
        <button
          className="cafe-primary"
          disabled={busy || compute.isPending || (!b && !a.latestRunId)}
          onClick={() => {
            if (b) refreshPair();
            else if (a.latestRunId)
              compute.mutate({ ...scenarioVersion(a), runId: a.latestRunId });
          }}
        >
          {busy || compute.isPending
            ? "Calculating cash…"
            : decision
              ? "Refresh cash projection"
              : "Compute runway"}
        </button>
        {!b && !a.latestRunId && (
          <p>Run a Saturday simulation to compute runway.</p>
        )}
        {compute.error && (
          <p className="cafe-notice" role="alert">
            {actionErrorMessage(compute.error) ?? "Could not calculate runway."}
          </p>
        )}
      </div>
      {decision && <Receipt decision={decision} />}
    </section>
  );
}
