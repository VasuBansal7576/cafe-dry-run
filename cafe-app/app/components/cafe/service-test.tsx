import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import {
  actionErrorCode,
  actionErrorMessage,
  callAction,
  readClientAppStateMany,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useEffect,
  useEffectEvent,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useLocation } from "react-router";

import type { NavigationState } from "@/hooks/use-navigation-state";
import { TAB_ID } from "@/lib/tab-id";

import type { SourceTag } from "../../../server/lib/cafe/provenance";
import {
  demandLevels,
  equipmentLabels,
  stations,
} from "../../../server/lib/cafe/scenario";
import type { Scenario } from "../../../server/lib/cafe/scenario-store";
import type { ServiceRun } from "../../../server/lib/cafe/service-run";
import {
  playbackBounds,
  playbackStateSchema,
  samePlayback,
  type PlaybackIdentity,
} from "../../../shared/cafe/playback-position";
import { useCalculationState } from "./calculation-state";
import { Stamp } from "./provenance-stamp";
import { formatClock } from "./scenario-inputs";

const playbackSpeeds = [30, 120, 600] as const;
const playbackSyncInterval = 1000;
const playbackReadTimeout = 10_000;
const playbackStateKey = `cafe-playback:${TAB_ID}`;
const number = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 1 });
const comparisonNumber = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
});
export const displayWait = (seconds: number | null) =>
  seconds === null ? "Unavailable" : `${number.format(seconds / 60)} min`;

export function ServiceFigure({
  value,
  tag,
  stale,
}: {
  value: string | number;
  tag?: SourceTag | undefined;
  stale: boolean;
}) {
  return (
    <span className="cafe-service-figure">
      <span>{value}</span> <Stamp tag={tag} stale={stale} />
    </span>
  );
}

export function ServiceMetrics({
  summary,
  stale,
  paired = false,
}: {
  summary: ServiceRun["summary"];
  stale: boolean;
  paired?: boolean;
}) {
  const { stats, provenance: tag } = summary;
  const waits = [
    ["Median wait · p50", stats.waitP50Seconds],
    ["Long wait · p90", stats.waitP90Seconds],
  ] as const;
  const counts = [
    [
      paired ? "Average served" : "Average orders served",
      stats.meanOrdersServed,
    ],
    [
      paired ? "Average lost" : "Average customers lost",
      stats.meanCustomersLost,
    ],
  ] as const;
  return (
    <>
      <dl
        className="cafe-metrics"
        aria-label={
          paired ? undefined : "Metrics across all simulated Saturdays"
        }
      >
        {waits.map(([label, seconds]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <ServiceFigure
                value={displayWait(seconds)}
                tag={seconds === null ? undefined : tag}
                stale={stale}
              />
            </dd>
          </div>
        ))}
        {counts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <ServiceFigure
                value={(paired ? comparisonNumber : number).format(value)}
                tag={tag}
                stale={stale}
              />
            </dd>
          </div>
        ))}
      </dl>
      {waits.some(([, seconds]) => seconds === null) && (
        <p>Wait percentiles need at least one served order.</p>
      )}
      <p className="cafe-pressure">
        <strong>Bottleneck</strong> ·{" "}
        <ServiceFigure
          value={
            stats.bottleneck
              ? `${stats.bottleneck.label} · longest task wait ${displayWait(stats.bottleneck.longestTaskWaitSeconds)}`
              : "No resource delays recorded"
          }
          tag={tag}
          stale={stale}
        />
      </p>
    </>
  );
}

type Ticket = {
  itemId: string;
  station?: (typeof stations)[number];
  queuedAt?: number;
  active: boolean;
};

function frameAt(playback: ServiceRun["playback"], time: number) {
  const tickets = new Map<string, Ticket>();
  let arrived = 0;
  let served = 0;
  let lost = 0;
  let latest = "";
  for (const event of playback.timeline) {
    if (event.at > time) break;
    if (event.kind === "arrived") {
      arrived++;
      latest = `${event.arrivalId} arrived`;
      tickets.set(event.arrivalId, { itemId: event.itemId, active: false });
      continue;
    }
    const ticket = tickets.get(event.arrivalId);
    if (!ticket) continue;
    switch (event.kind) {
      case "task_queued":
        ticket.station = event.taskId;
        ticket.queuedAt = event.at;
        ticket.active = false;
        break;
      case "task_started":
        ticket.active = true;
        break;
      case "task_completed":
        delete ticket.station;
        ticket.active = false;
        break;
      case "order_served":
        served++;
        latest = `${event.arrivalId} picked up their order`;
        tickets.delete(event.arrivalId);
        break;
      case "customer_lost":
        lost++;
        latest = `${event.arrivalId} left the queue`;
        tickets.delete(event.arrivalId);
        break;
    }
  }
  const waiting = [...tickets.values()].filter(
    (ticket) => !ticket.active,
  ).length;
  return {
    tickets: [...tickets.entries()],
    arrived,
    waiting,
    served,
    lost,
    active: tickets.size - waiting,
    latest,
  };
}

type PlaybackBoard = { run: ServiceRun; label?: string };

export function Playback({
  boards,
  receiptId,
  arrivalProvenance,
  stale,
}: {
  boards: readonly [PlaybackBoard, ...PlaybackBoard[]];
  receiptId?: string;
  arrivalProvenance?: SourceTag | undefined;
  stale: boolean;
}) {
  const [{ run }] = boards;
  const { summary, playback } = run;
  const { start, end } = playbackBounds(
    summary.hours,
    boards.map(
      ({
        run: {
          playback: { timeline },
        },
      }) => timeline[timeline.length - 1]?.at ?? 0,
    ),
  );
  const other = boards[1]?.run;
  const identity: PlaybackIdentity = {
    scenarioId: run.scenarioId,
    runId: run.id,
    ...(receiptId && other
      ? {
          receiptId,
          comparisonScenarioId: other.scenarioId,
          comparisonRunId: other.id,
        }
      : {}),
  };
  const location = useLocation();
  const resultId = receiptId ?? run.id;
  const scope = `${location.key}:${resultId}`;
  const queryKey = ["app-state", playbackStateKey, scope];
  const queryClient = useQueryClient();
  const savedPosition = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const { values } = await readClientAppStateMany(
        ["navigation", playbackStateKey],
        {
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(playbackReadTimeout),
          ]),
        },
      );
      const navigation = values.navigation as NavigationState | undefined;
      const stored = playbackStateSchema.safeParse(values[playbackStateKey]);
      return {
        navigationReady:
          navigation?.view === "cafe" &&
          navigation.scenarioId === identity.scenarioId &&
          navigation.comparisonScenarioId === identity.comparisonScenarioId,
        playback: stored.success ? stored.data : null,
      };
    },
    enabled: !stale,
    staleTime: Infinity,
    refetchOnMount: "always",
    retry: false,
  });
  const navigationReady =
    savedPosition.isFetchedAfterMount &&
    savedPosition.isSuccess &&
    savedPosition.data.navigationReady;
  const activeScope = useRef<string | null>(null);
  const retriedNavigation = useRef<string | null>(null);
  useEffect(() => {
    activeScope.current = stale ? null : scope;
    retriedNavigation.current = null;
    return () => {
      activeScope.current = null;
    };
  }, [scope, stale]);
  const refreshNavigationOnce = useEffectEvent(() => {
    if (activeScope.current !== scope || retriedNavigation.current === scope)
      return;
    retriedNavigation.current = scope;
    void savedPosition.refetch();
  });
  useEffect(() => {
    if (
      !stale &&
      savedPosition.data &&
      !navigationReady &&
      savedPosition.isFetchedAfterMount
    )
      refreshNavigationOnce();
  }, [
    scope,
    stale,
    navigationReady,
    savedPosition.data,
    savedPosition.isFetchedAfterMount,
  ]);
  const initialSecond = playback.timeline.length
    ? Math.min(end, start + 25 * 60)
    : start;
  const [time, setTime] = useState(initialSecond);
  const [baselineScope, setBaselineScope] = useState<string | null>(null);
  const playbackReady = stale || (navigationReady && baselineScope === scope);
  const playbackUnavailable =
    !playbackReady &&
    !navigationReady &&
    !savedPosition.isFetching &&
    (savedPosition.isError || savedPosition.isFetchedAfterMount);
  const playbackStatusId = useId();
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(120);
  const second = Math.floor(time);
  const clockGeneration = useRef(0);
  useEffect(() => {
    if (!playing || !playbackReady) return;
    const generation = clockGeneration.current;
    let previous = performance.now();
    const timer = window.setInterval(() => {
      if (generation !== clockGeneration.current) return;
      const now = performance.now();
      const elapsed = (now - previous) / 1000;
      previous = now;
      setTime((value) => Math.min(end, value + elapsed * speed));
    }, 100);
    return () => window.clearInterval(timer);
  }, [end, playbackReady, playing, speed]);
  useEffect(() => {
    if (time >= end) setPlaying(false);
  }, [end, time]);
  const synced = useRef({
    scope: null as string | null,
    seekId: null as string | null,
    applied: null as string | null,
    remoteSecond: null as number | null,
  });
  const pending = useRef<{ position: string; queued: boolean } | null>(null);
  const positionKey = (value: number) => `${resultId}:${value}`;
  const applySavedPosition = useEffectEvent(() => {
    if (!navigationReady || stale) return;
    const stored = savedPosition.data?.playback;
    const state = synced.current;
    const seekId = stored?.seekId ?? null;
    const initial = state.scope !== scope;
    const agentSeek = seekId !== null && state.seekId !== seekId;
    state.scope = scope;
    state.seekId = seekId;
    const restored =
      stored &&
      samePlayback(stored, identity) &&
      stored.second >= start &&
      stored.second <= end
        ? stored.second
        : null;
    if (!initial && (!agentSeek || restored === null)) return;
    const nextSecond = restored ?? initialSecond;
    state.applied = restored === null ? null : positionKey(restored);
    state.remoteSecond = nextSecond;
    clockGeneration.current += 1;
    setTime(nextSecond);
    setPlaying(false);
    setBaselineScope(scope);
  });
  useEffect(
    () => applySavedPosition(),
    [scope, navigationReady, savedPosition.data?.playback, stale],
  );

  const publishPosition = useEffectEvent((): void => {
    const state = synced.current;
    if (
      activeScope.current !== scope ||
      state.scope !== scope ||
      !playbackReady ||
      stale
    )
      return;
    if (state.remoteSecond !== null) {
      if (state.remoteSecond !== second) return;
      state.remoteSecond = null;
    }
    const position = positionKey(second);
    if (state.applied === position) return;
    if (pending.current) {
      if (pending.current.position !== position) pending.current.queued = true;
      return;
    }
    const request = { position, queued: false };
    pending.current = request;
    const seekId = state.seekId;
    void callAction("set-playback-position", {
      ...identity,
      at: second,
      observedSeekId: seekId,
    })
      .then(({ applied }) => {
        if (activeScope.current !== scope) return;
        if (!applied) {
          void savedPosition.refetch();
        } else if (state.seekId === seekId) {
          state.applied = position;
          queryClient.setQueryData<typeof savedPosition.data>(
            queryKey,
            (current) =>
              current && {
                ...current,
                playback: {
                  ...identity,
                  second,
                  ...(seekId ? { seekId } : {}),
                },
              },
          );
        }
      })
      .catch((error: unknown) => {
        if (
          activeScope.current === scope &&
          actionErrorCode(error) === "scenario_conflict"
        )
          refreshNavigationOnce();
      })
      .finally(() => {
        pending.current = null;
        if (request.queued) publishPosition();
      });
  });
  useEffect(() => {
    if (!playing || stale) return;
    const timer = window.setInterval(
      () => publishPosition(),
      playbackSyncInterval,
    );
    return () => window.clearInterval(timer);
  }, [playing, stale]);
  useEffect(() => {
    if (playing || stale || !playbackReady) return;
    const timer = window.setTimeout(() => publishPosition(), 300);
    return () => window.clearTimeout(timer);
  }, [
    playing,
    scope,
    second,
    playbackReady,
    savedPosition.dataUpdatedAt,
    stale,
  ]);

  return (
    <div className="cafe-playback">
      <div className="cafe-clock">
        <p>
          <span className="cafe-kicker">First simulated Saturday</span>
          <strong>{formatClock(second)}</strong>
        </p>
        <div className="cafe-controls">
          <button
            className="cafe-primary"
            type="button"
            aria-disabled={!playbackReady && !playbackUnavailable}
            aria-describedby={playbackReady ? undefined : playbackStatusId}
            onClick={() => {
              if (!playbackReady) {
                if (playbackUnavailable) void savedPosition.refetch();
                return;
              }
              synced.current.remoteSecond = null;
              if (time >= end) setTime(start);
              setPlaying(!playing);
            }}
          >
            {playbackUnavailable
              ? "Retry playback"
              : playing && playbackReady
                ? "Pause"
                : time >= end
                  ? "Replay Saturday"
                  : "Play Saturday"}
          </button>
          <label>
            Playback speed
            <select
              value={speed}
              onChange={(event) => setSpeed(Number(event.target.value))}
            >
              {playbackSpeeds.map((rate) => (
                <option key={rate} value={rate}>
                  {rate}×
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="cafe-seek">
          Saturday timeline
          <input
            type="range"
            min={start}
            max={end}
            step={1}
            value={second}
            disabled={!playbackReady}
            aria-describedby={playbackReady ? undefined : playbackStatusId}
            aria-valuetext={`${formatClock(second)}:${String(second % 60).padStart(2, "0")}`}
            onChange={(event) => {
              synced.current.remoteSecond = null;
              setTime(Number(event.target.value));
            }}
          />
        </label>
        {!playbackReady && (
          <span
            className="cafe-playback-status"
            id={playbackStatusId}
            role="status"
          >
            {playbackUnavailable
              ? "Couldn’t load the saved playback position."
              : "Loading saved playback position…"}
          </span>
        )}
      </div>
      <div className={boards.length > 1 ? "cafe-paired-boards" : undefined}>
        {boards.map((board) => (
          <StationBoard
            key={board.run.id}
            board={board}
            second={second}
            arrivalProvenance={arrivalProvenance}
            stale={stale}
          />
        ))}
      </div>
    </div>
  );
}

function StationBoard({
  board: {
    run: { summary, playback },
    label,
  },
  second,
  arrivalProvenance,
  stale,
}: {
  board: PlaybackBoard;
  second: number;
  arrivalProvenance: SourceTag | undefined;
  stale: boolean;
}) {
  const frame = useMemo(() => frameAt(playback, second), [playback, second]);
  const tag = summary.provenance;
  const arrivalTag = arrivalProvenance ?? summary.arrivalProvenance;
  const longest = frame.tickets
    .filter(
      ([, ticket]) =>
        !ticket.active && ticket.station && ticket.queuedAt !== undefined,
    )
    .reduce<Ticket | undefined>(
      (oldest, [, ticket]) =>
        oldest && oldest.queuedAt! <= ticket.queuedAt! ? oldest : ticket,
      undefined,
    );
  return (
    <section
      className="cafe-station-board"
      aria-label={label ?? "Saturday board"}
    >
      {label && <h3>{label}</h3>}
      <dl
        className="cafe-frame-counts"
        aria-label="Counts at the selected time"
      >
        {(
          [
            [
              "Arrived",
              arrivalTag
                ? frame.arrived
                : `${frame.arrived} · source unavailable`,
              arrivalTag,
            ],
            ["Waiting", frame.waiting, tag],
            ["In service", frame.active, tag],
            ["Served", frame.served, tag],
            ["Lost", frame.lost, tag],
          ] as const
        ).map(([label, value, source]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>
              <ServiceFigure value={value} tag={source} stale={stale} />
            </dd>
          </div>
        ))}
      </dl>
      <p className="cafe-pressure">
        <ServiceFigure
          value={
            longest
              ? `${longest.station} has the longest current wait · ${displayWait(second - longest.queuedAt!)}`
              : "No orders waiting at this time."
          }
          tag={tag}
          stale={stale}
        />
      </p>
      <ol className="cafe-stations" aria-label="Service stations">
        {stations.map((station) => {
          const tickets = frame.tickets.filter(
            ([, ticket]) => ticket.station === station,
          );
          const active = tickets.filter(([, ticket]) => ticket.active);
          const queued = tickets.filter(([, ticket]) => !ticket.active);
          return (
            <li
              key={station}
              className={
                station === longest?.station
                  ? "cafe-station cafe-station-pressure"
                  : "cafe-station"
              }
            >
              <h4>{station}</h4>
              <p className="cafe-station-counts">
                <span>{active.length} active</span>{" "}
                <span aria-hidden="true">·</span>{" "}
                <span>{queued.length} waiting</span>{" "}
                <Stamp tag={tag} stale={stale} />
              </p>
              {[...active.slice(0, 2), ...queued.slice(0, 3)].map(
                ([id, ticket]) => (
                  <span
                    className={`cafe-ticket${ticket.active ? " cafe-ticket-active" : ""}`}
                    key={id}
                  >
                    <span>{id.replace(/^r1-a/, "#")}</span>{" "}
                    {summary.itemNames[ticket.itemId] ?? ticket.itemId}{" "}
                    <span className="sr-only">
                      {ticket.active ? "in service" : "waiting"}
                    </span>
                  </span>
                ),
              )}
            </li>
          );
        })}
      </ol>
      <p className="cafe-latest">
        {frame.latest || "The first customer has yet to arrive."}
      </p>
    </section>
  );
}

export function ServiceTest({
  scenario,
  controls,
  latest,
  scenarioRequirement,
}: {
  scenario: Scenario;
  controls?: ReactNode;
  latest: ReturnType<typeof useActionQuery<undefined, "get-simulation">>;
  scenarioRequirement: string | null;
}) {
  const mutationKey = ["cafe-calculation", "run-simulation", scenario.id];
  const simulate = useActionMutation("run-simulation", { mutationKey });
  const calculation = useCalculationState(mutationKey);
  const requirementId = useId();
  const run = latest.data?.run;
  const stale =
    !!run && (run.stale || run.scenarioRevision !== scenario.revision);
  const [seed, setSeed] = useState("42");
  const [count, setCount] = useState("24");
  const [level, setLevel] = useState<(typeof demandLevels)[number]>("base");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (scenarioRequirement || calculation.inFlight()) return;
    simulate.mutate({
      id: scenario.id,
      expectedRevision: scenario.revision,
      seed: Number(seed),
      runCount: Number(count),
      demandLevel: level,
    });
  }
  function explain() {
    if (!run || stale) return;
    sendToAgentChat({
      message:
        "Explain the current Saturday service result. Read the saved run. Tell me what limits service and what I could change, citing the run's results and the quality of its inputs.",
      context: `Café scenario ${scenario.id}, revision ${scenario.revision}, saved service run ${run.id}. Use get-simulation before explaining.`,
      contextLabel: "Saturday service result",
      openSidebar: true,
      submit: true,
      tabId: TAB_ID,
    });
  }
  const stats = run?.summary.stats;
  return (
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
        {controls}
        <form
          className="cafe-service-settings"
          onSubmit={submit}
          aria-label="Run settings"
        >
          <label>
            Demand case
            <select
              value={level}
              onChange={(event) => setLevel(event.target.value as typeof level)}
            >
              {demandLevels.map((demand) => (
                <option value={demand} key={demand}>
                  {demand[0]!.toUpperCase() + demand.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Random seed
            <input
              type="number"
              min={0}
              max={4294967295}
              step={1}
              required
              value={seed}
              onChange={(event) => setSeed(event.target.value)}
            />
          </label>
          <label>
            Saturdays to run
            <input
              type="number"
              min={1}
              max={100}
              step={1}
              required
              value={count}
              onChange={(event) => setCount(event.target.value)}
            />
          </label>
          <button
            className="cafe-primary"
            aria-disabled={calculation.pending || !!scenarioRequirement}
            aria-describedby={scenarioRequirement ? requirementId : undefined}
          >
            {calculation.pending
              ? "Running Saturday…"
              : stale
                ? "Rerun simulation"
                : "Run simulation"}
          </button>
        </form>
        {scenarioRequirement && (
          <p id={requirementId} role="status">
            {scenarioRequirement}
          </p>
        )}
        {simulate.error && (
          <p className="cafe-notice" role="alert">
            {actionErrorMessage(simulate.error) ??
              "Could not run the simulation."}
          </p>
        )}
        {latest.error && (
          <p className="cafe-notice" role="alert">
            {actionErrorMessage(latest.error) ??
              "Could not load the saved service result."}{" "}
            <button className="cafe-link" onClick={() => void latest.refetch()}>
              Try again
            </button>
          </p>
        )}
        {!run && scenario.latestRunId && latest.isPending && (
          <p role="status">Loading the saved service result…</p>
        )}
        {!run && !scenario.latestRunId && (
          <p>
            Run Saturday to see the queue, wait times, and where service backs
            up.
          </p>
        )}
        {run && stats && (
          <>
            <div className="cafe-run-heading">
              <div>
                <h3>Saturday results</h3>
                <p>
                  {run.summary.runCount}{" "}
                  {run.summary.runCount === 1 ? "Saturday" : "Saturdays"} ·{" "}
                  {run.summary.demandLevel} demand · seed {run.summary.seed} ·
                  revision {run.scenarioRevision}{" "}
                  <Stamp tag={run.summary.provenance} stale={stale} />
                </p>
              </div>
              <button
                className="cafe-secondary"
                disabled={stale}
                onClick={explain}
              >
                Explain
              </button>
            </div>
            {stale && (
              <p className="cafe-notice" role="status">
                <strong>Stale.</strong> Demand or shop settings changed. Rerun
                to see the new result.
              </p>
            )}
            <ServiceMetrics summary={run.summary} stale={stale} />
            {run.playback && (
              <Playback
                key={run.id}
                boards={[{ run: { ...run, playback: run.playback } }]}
                stale={stale}
              />
            )}
            <details>
              <summary>Staff & equipment utilization</summary>
              <dl className="cafe-resource-list">
                {stats.utilization.map((resource) => (
                  <div key={`${resource.kind}:${resource.id}`}>
                    <dt>
                      {resource.kind === "worker"
                        ? (run.summary.staffNames[resource.id] ?? resource.id)
                        : `${equipmentLabels[resource.kind]} · ${resource.id.split("-").pop()}`}
                    </dt>
                    <dd>
                      <ServiceFigure
                        value={`${number.format(resource.fraction * 100)}%`}
                        tag={run.summary.provenance}
                        stale={stale}
                      />
                    </dd>
                  </div>
                ))}
              </dl>
            </details>
            <p className="cafe-run-reference">Run {run.id}</p>
          </>
        )}
      </div>
    </section>
  );
}
