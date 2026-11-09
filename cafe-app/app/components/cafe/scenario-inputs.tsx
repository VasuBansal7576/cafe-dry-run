import {
  actionErrorMessage,
  useActionMutation,
} from "@agent-native/core/client/hooks";
import { useEffect, useId, useState, type FormEvent } from "react";

import {
  illustrative,
  sourceTags,
  type Source,
  type SourceTag,
  type TaggedNumber,
} from "../../../server/lib/cafe/provenance";
import {
  demandLevels,
  equipmentLabels,
  equipmentTypes,
  serviceHourCount,
  type ScenarioDemand,
  type ScenarioShop,
} from "../../../server/lib/cafe/scenario";
import type { Scenario } from "../../../server/lib/cafe/scenario-store";

export const sourceLabels: Record<SourceTag, string> = {
  observed: "Observed",
  public: "Public",
  estimate: "Estimate",
  illustrative: "Illustrative",
};

export function formatClock(seconds: number): string {
  return `${String(Math.floor(seconds / 3600)).padStart(2, "0")}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}`;
}

function taggedSource(tag: SourceTag): Source {
  return tag === "public"
    ? { tag, url: "", retrievedAt: "", supportingValue: "" }
    : { tag };
}

function TaggedField({
  label,
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  clock = false,
}: {
  label: string;
  value: TaggedNumber;
  onChange: (next: TaggedNumber) => void;
  min?: number;
  max?: number;
  step?: number | "any";
  clock?: boolean;
}) {
  const id = useId();
  const displayValue = clock ? formatClock(value.value) : String(value.value);
  const [raw, setRaw] = useState(displayValue);
  useEffect(() => setRaw(displayValue), [displayValue]);
  function update(rawValue: string) {
    setRaw(rawValue);
    if (
      !rawValue ||
      (clock && !/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(rawValue))
    )
      return;
    const [hours, minutes] = rawValue.split(":");
    const next = clock
      ? Number(hours) * 3600 + Number(minutes) * 60
      : Number(rawValue);
    if (!Number.isFinite(next) || next === value.value) return;
    onChange({ value: next, source: { tag: "estimate" } });
  }
  function publicField(
    key: "url" | "retrievedAt" | "supportingValue",
    next: string,
  ) {
    if (value.source.tag === "public")
      onChange({ ...value, source: { ...value.source, [key]: next } });
  }
  return (
    <div className="cafe-field">
      <label htmlFor={id}>{label}</label>
      <div className="cafe-field-control">
        <input
          id={id}
          required
          value={raw}
          onChange={(event) => update(event.target.value)}
          {...(clock
            ? {
                type: "text",
                pattern: "(?:[01][0-9]|2[0-3]):[0-5][0-9]|24:00",
                placeholder: "HH:MM",
                title: "24-hour time in HH:MM format",
              }
            : { type: "number", min, max, step })}
        />
        <select
          aria-label={`${label} source`}
          className="cafe-source-control"
          value={value.source.tag}
          onChange={(event) =>
            onChange({
              ...value,
              source: taggedSource(event.target.value as SourceTag),
            })
          }
        >
          {sourceTags.map((tag) => (
            <option key={tag} value={tag}>
              {sourceLabels[tag]}
            </option>
          ))}
        </select>
      </div>
      {value.source.tag === "public" && (
        <div className="cafe-source-detail">
          <label>
            Source URL
            <input
              type="url"
              value={value.source.url}
              required
              onChange={(event) => publicField("url", event.target.value)}
            />
          </label>
          <label>
            Date checked
            <input
              type="date"
              value={value.source.retrievedAt}
              required
              onChange={(event) =>
                publicField("retrievedAt", event.target.value)
              }
            />
          </label>
          <label>
            Published value
            <input
              value={value.source.supportingValue}
              maxLength={300}
              required
              onChange={(event) =>
                publicField("supportingValue", event.target.value)
              }
            />
          </label>
        </div>
      )}
    </div>
  );
}

function FormStatus({
  conflicted,
  error,
  onReset,
}: {
  conflicted: boolean;
  error: Error | null;
  onReset: () => void;
}) {
  if (conflicted)
    return (
      <p role="alert" className="cafe-notice">
        The saved scenario changed while you were editing.{" "}
        <button type="button" className="cafe-link" onClick={onReset}>
          Discard this draft and load the saved version
        </button>
        .
      </p>
    );
  return (
    error && (
      <p role="alert" className="cafe-notice">
        {actionErrorMessage(error) ?? "Could not save the scenario."}
      </p>
    )
  );
}

export function DemandForm({ scenario }: { scenario: Scenario }) {
  const [draft, setDraft] = useState<{
    value: ScenarioDemand;
    revision: number;
  } | null>(null);
  const update = useActionMutation("set-demand", {
    onSuccess: () => setDraft(null),
  });
  const demand = draft?.value ?? scenario.demand;
  const conflicted = !!draft && draft.revision !== scenario.revision;
  const base = scenario.demand.hourly.base;
  function edit(value: ScenarioDemand) {
    setDraft({ value, revision: draft?.revision ?? scenario.revision });
  }
  function editTime(field: "opensAt" | "closesAt", next: TaggedNumber) {
    const changed = { ...demand, [field]: next };
    changed.hourlyMultipliers = Array.from(
      { length: serviceHourCount(changed) },
      (_, index) => demand.hourlyMultipliers[index] ?? illustrative(1),
    );
    edit(changed);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || conflicted || update.isPending) return;
    update.mutate({
      id: scenario.id,
      expectedRevision: draft.revision,
      demand: draft.value,
    });
  }
  return (
    <form onSubmit={submit} aria-labelledby="demand-heading">
      <fieldset className="cafe-board cafe-form" disabled={update.isPending}>
        <header>
          <h3 id="demand-heading">Saturday demand</h3>
          <p>
            Current base demand: {base.value} customers per hour ·{" "}
            {sourceLabels[base.source.tag]}
          </p>
        </header>
        <div className="cafe-fields">
          {demandLevels.map((level) => (
            <TaggedField
              key={level}
              label={`${level[0]!.toUpperCase()}${level.slice(1)} customers per hour`}
              max={1000}
              value={demand.hourly[level]}
              onChange={(next) =>
                edit({ ...demand, hourly: { ...demand.hourly, [level]: next } })
              }
            />
          ))}
          <TaggedField
            label="Saturday opens"
            clock
            value={demand.opensAt}
            onChange={(value) => editTime("opensAt", value)}
          />
          <TaggedField
            label="Saturday closes"
            clock
            value={demand.closesAt}
            onChange={(value) => editTime("closesAt", value)}
          />
        </div>
        <details>
          <summary>Saturday arrival curve</summary>
          <p>
            Multiply hourly demand by these amounts. Use 1 for the full rate and
            0 for no arrivals.
          </p>
          <div className="cafe-fields">
            {demand.hourlyMultipliers.map((value, index) => (
              <TaggedField
                key={index}
                label={`${formatClock(demand.opensAt.value + index * 3600)} multiplier`}
                value={value}
                max={5}
                step="any"
                onChange={(next) =>
                  edit({
                    ...demand,
                    hourlyMultipliers: demand.hourlyMultipliers.map(
                      (entry, i) => (i === index ? next : entry),
                    ),
                  })
                }
              />
            ))}
          </div>
        </details>
        <button
          className="cafe-primary"
          disabled={!draft || conflicted || update.isPending}
        >
          {update.isPending ? "Saving demand…" : "Save demand"}
        </button>
        <FormStatus
          conflicted={conflicted}
          error={update.error}
          onReset={() => setDraft(null)}
        />
      </fieldset>
    </form>
  );
}

export function ShopForm({ scenario }: { scenario: Scenario }) {
  const [draft, setDraft] = useState<{
    value: ScenarioShop;
    revision: number;
  } | null>(null);
  const update = useActionMutation("configure-shop", {
    onSuccess: () => setDraft(null),
  });
  const shop = draft?.value ?? scenario.shop;
  const conflicted = !!draft && draft.revision !== scenario.revision;
  const shiftForHours = () => ({
    startsAt: illustrative(scenario.demand.opensAt.value),
    endsAt: illustrative(scenario.demand.closesAt.value),
  });
  function edit(value: ScenarioShop) {
    setDraft({ value, revision: draft?.revision ?? scenario.revision });
  }
  function editWorker(
    workerId: string,
    replace: (
      worker: ScenarioShop["workers"][number],
    ) => ScenarioShop["workers"][number],
  ) {
    edit({
      ...shop,
      workers: shop.workers.map((worker) =>
        worker.id === workerId ? replace(worker) : worker,
      ),
    });
  }
  function addWorker() {
    let index = 1;
    while (shop.workers.some(({ id }) => id === `barista-${index}`)) index++;
    edit({
      ...shop,
      workers: [
        ...shop.workers,
        {
          id: `barista-${index}`,
          name: `Barista ${index}`,
          shifts: [shiftForHours()],
        },
      ],
    });
  }
  function editDrink(
    drinkId: string,
    replace: (
      drink: ScenarioShop["menu"][number],
    ) => ScenarioShop["menu"][number],
  ) {
    edit({
      ...shop,
      menu: shop.menu.map((drink) =>
        drink.id === drinkId ? replace(drink) : drink,
      ),
    });
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft || conflicted || update.isPending) return;
    update.mutate({
      id: scenario.id,
      expectedRevision: draft.revision,
      shop: draft.value,
    });
  }
  return (
    <form onSubmit={submit} aria-labelledby="shop-heading">
      <fieldset className="cafe-board cafe-form" disabled={update.isPending}>
        <header>
          <h3 id="shop-heading">Staff & equipment</h3>
          <p>Set who works the shift and how they share equipment.</p>
        </header>
        <div className="cafe-fields">
          {equipmentTypes.map((equipment) => (
            <TaggedField
              key={equipment}
              label={equipmentLabels[equipment]}
              max={20}
              value={shop.equipment[equipment]}
              onChange={(value) =>
                edit({
                  ...shop,
                  equipment: { ...shop.equipment, [equipment]: value },
                })
              }
            />
          ))}
          <TaggedField
            label="Customer patience (seconds)"
            value={shop.patienceSeconds}
            max={86400}
            onChange={(value) => edit({ ...shop, patienceSeconds: value })}
          />
        </div>
        {shop.workers.map((worker) => (
          <fieldset key={worker.id} className="cafe-subboard">
            <legend>{worker.name}</legend>
            {worker.shifts.map((shift, index) => (
              <div key={index} className="cafe-shift">
                {(["startsAt", "endsAt"] as const).map((field) => (
                  <TaggedField
                    key={field}
                    clock
                    label={`${worker.name} ${worker.shifts.length > 1 ? `shift ${index + 1} ` : ""}${field === "startsAt" ? "starts" : "ends"}`}
                    value={shift[field]}
                    onChange={(value) =>
                      editWorker(worker.id, (current) => ({
                        ...current,
                        shifts: current.shifts.map((entry, i) =>
                          i === index ? { ...entry, [field]: value } : entry,
                        ),
                      }))
                    }
                  />
                ))}
                {worker.shifts.length > 1 && (
                  <button
                    type="button"
                    className="cafe-secondary"
                    onClick={() =>
                      editWorker(worker.id, (current) => ({
                        ...current,
                        shifts: current.shifts.filter((_, i) => i !== index),
                      }))
                    }
                  >
                    Remove shift {index + 1}
                  </button>
                )}
              </div>
            ))}
            <div className="cafe-controls">
              <button
                type="button"
                className="cafe-secondary"
                disabled={worker.shifts.length >= 8}
                onClick={() =>
                  editWorker(worker.id, (current) => ({
                    ...current,
                    shifts: [...current.shifts, shiftForHours()],
                  }))
                }
              >
                Add shift
              </button>
              <button
                type="button"
                className="cafe-secondary"
                onClick={() =>
                  edit({
                    ...shop,
                    workers: shop.workers.filter(({ id }) => id !== worker.id),
                  })
                }
              >
                Remove {worker.name}
              </button>
            </div>
          </fieldset>
        ))}
        <button
          type="button"
          className="cafe-secondary"
          disabled={shop.workers.length >= 20}
          onClick={addWorker}
        >
          Add barista
        </button>
        <details>
          <summary>Menu mix & service times</summary>
          <p>
            Service times are seconds. Unattended time occupies the machine
            while the barista can help someone else.
          </p>
          {shop.menu.map((drink) => (
            <fieldset key={drink.id} className="cafe-subboard">
              <legend>{drink.name}</legend>
              <TaggedField
                label={`${drink.name} mix weight`}
                value={drink.weight}
                max={100}
                step="any"
                onChange={(weight) =>
                  editDrink(drink.id, (current) => ({ ...current, weight }))
                }
              />
              {drink.tasks.map((task, index) => (
                <div key={task.station} className="cafe-shift">
                  <TaggedField
                    label={`${drink.name} · ${task.station} staff seconds`}
                    min={1}
                    max={86400}
                    value={task.staffSeconds}
                    onChange={(staffSeconds) =>
                      editDrink(drink.id, (current) => ({
                        ...current,
                        tasks: current.tasks.map((entry, i) =>
                          i === index ? { ...entry, staffSeconds } : entry,
                        ),
                      }))
                    }
                  />
                  {"unattendedSeconds" in task && (
                    <TaggedField
                      label={`${drink.name} · ${task.station} unattended seconds`}
                      max={86400}
                      value={task.unattendedSeconds}
                      onChange={(unattendedSeconds) =>
                        editDrink(drink.id, (current) => ({
                          ...current,
                          tasks: current.tasks.map((entry, i) =>
                            i === index
                              ? { ...task, unattendedSeconds }
                              : entry,
                          ),
                        }))
                      }
                    />
                  )}
                </div>
              ))}
            </fieldset>
          ))}
        </details>
        <button
          className="cafe-primary"
          disabled={!draft || conflicted || update.isPending}
        >
          {update.isPending ? "Saving shop…" : "Save shop"}
        </button>
        <FormStatus
          conflicted={conflicted}
          error={update.error}
          onReset={() => setDraft(null)}
        />
      </fieldset>
    </form>
  );
}
