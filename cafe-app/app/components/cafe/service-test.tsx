import { sendToAgentChat } from "@agent-native/core/client/agent-chat";
import {
  actionErrorCode,
  actionErrorMessage,
  callAction,
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

import { TAB_ID } from "@/lib/tab-id";

import type { SourceTag } from "../../../server/lib/cafe/provenance";
import {
  demandLevels,
  equipmentLabels,
  stations,
} from "../../../server/lib/cafe/scenario";
import type { Scenario } from "../../../server/lib/cafe/scenario-store";
import { frameAt } from "../../../server/lib/cafe/service-playback";
import type { ServiceRun } from "../../../server/lib/cafe/service-run";
import {
  calibratePlaybackClock,
  changePlayback,
  initialPlaybackSecond,
  playbackBounds,
  playbackFrame,
  playbackSpeeds,
  playbackSpeedSchema,
  restorePlayback,
  type PlaybackChange,
  type PlaybackClockCalibration,
  type PlaybackIdentity,
  type PlaybackState,
} from "../../../shared/cafe/playback-position";
import { useCalculationState } from "./calculation-state";
import { Stamp } from "./provenance-stamp";
import { formatClock } from "./scenario-inputs";

const waitLabels = {
  staff: "shared staff capacity",
  grinder: "grinder capacity",
  groupHead: "espresso group head capacity",
  steamWand: "steam wand capacity",
} as const;

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

type PlaybackBoard = { run: ServiceRun; label?: string };

type PlaybackEdit = {
  change: PlaybackChange;
  when: number;
  bootstrap?: true;
  observedClockRevision?: number;
};
type PlaybackQueue = {
  scope: string;
  epoch: string | null;
  edits: PlaybackEdit[];
};

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
  const bounds = playbackBounds(
    summary.hours,
    boards.map(
      ({
        run: {
          playback: { timeline },
        },
      }) => timeline[timeline.length - 1]?.at ?? 0,
    ),
  );
  const { start, end } = bounds;
  const other = boards[1]?.run;
  const identity: PlaybackIdentity = {
    scenarioId: run.scenarioId,
    runId: run.id,
    ...(stale ? { historical: true } : {}),
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
  const scope = `${location.key}:${resultId}:${stale}`;
  const queryKey = ["app-state", playbackStateKey, scope];
  const queryClient = useQueryClient();
  const savedPosition = useQuery({
    queryKey,
    queryFn: async ({ signal }) => {
      const readOptions = {
        method: "GET" as const,
        signal: AbortSignal.any([
          signal,
          AbortSignal.timeout(playbackReadTimeout),
        ]),
      };
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const sentAt = performance.now();
        const {
          selection,
          playback: incoming,
          sampledAtMs,
        } = await callAction("get-playback-clock", {}, readOptions);
        const receivedAt = performance.now();
        const previous = queryClient.getQueryData<{
          playback: PlaybackState | null;
          calibration: PlaybackClockCalibration;
        }>(queryKey);
        const calibration = calibratePlaybackClock(
          previous?.calibration,
          sentAt,
          receivedAt,
          sampledAtMs,
        );
        if (!calibration) continue;
        return {
          navigationReady:
            selection?.scenarioId === identity.scenarioId &&
            selection.comparisonScenarioId === identity.comparisonScenarioId,
          calibration,
          receivedAt,
          playback:
            (previous?.playback?.clockRevision ?? 0) >
            (incoming?.clockRevision ?? 0)
              ? (previous?.playback ?? null)
              : incoming,
        };
      }
      throw new Error("Couldn’t synchronize the Saturday clock.");
    },
    staleTime: Infinity,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    retry: false,
  });
  const navigationReady =
    savedPosition.isFetchedAfterMount &&
    savedPosition.isSuccess &&
    savedPosition.data.navigationReady;
  const activeScope = useRef<string | null>(null);
  const retriedNavigation = useRef<string | null>(null);
  useEffect(() => {
    activeScope.current = scope;
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
  const stored = savedPosition.data?.playback;
  const epoch = stored?.seekId ?? null;
  const initial = initialPlaybackSecond(bounds, playback.timeline.length > 0);
  const [mountedAt] = useState(() => performance.now());
  const [localNow, setLocalNow] = useState(mountedAt);
  const { calibration, receivedAt = mountedAt } = savedPosition.data ?? {};
  const clockAt = (local: number) =>
    Math.max(0, Math.floor(local + (calibration?.offset ?? 0)));
  const now = clockAt(Math.max(localNow, receivedAt));
  const { state: base, exact: exactResult } = restorePlayback(
    identity,
    stored,
    { ...bounds, initial },
    now,
  );
  const revision = stored?.clockRevision ?? 0;
  const [loadedClock, setLoadedClock] = useState<{
    before: number;
    epoch: string | null;
    revision: number;
  } | null>(null);
  useEffect(() => {
    if (!navigationReady || !calibration || loadedClock) return;
    setLoadedClock({
      before: Math.floor(mountedAt + calibration.earliestOffset),
      epoch,
      revision,
    });
  }, [navigationReady, calibration, loadedClock, mountedAt, epoch, revision]);
  const mountedClock = loadedClock?.before ?? 0;
  const pauseOnLoad =
    exactResult &&
    loadedClock?.epoch === epoch &&
    loadedClock.revision === revision &&
    base.startedAtMs !== undefined &&
    Math.max(base.startedAtMs, base.commandedAtMs ?? 0) < mountedClock &&
    playbackFrame(base, end, now).playing;
  const [queue, setQueue] = useState<PlaybackQueue | null>(null);
  const inFlight = useRef<PlaybackEdit | null>(null);
  const [failure, setFailure] = useState<{
    scope: string;
    message: string;
  } | null>(null);
  const attemptedBootstrap = useRef<string | null>(null);
  const edits =
    queue?.scope === scope && queue.epoch === epoch ? queue.edits : [];
  const current = edits.reduce(
    (state, edit) =>
      edit.bootstrap && "at" in edit.change
        ? state
        : changePlayback(state, edit.change, bounds, edit.when),
    pauseOnLoad
      ? changePlayback(base, { playing: false }, bounds, mountedClock)
      : base,
  );
  const { second, speed, playing } = playbackFrame(current, end, now);
  const playbackReady = navigationReady && loadedClock !== null && !pauseOnLoad;
  const playbackUnavailable =
    (!navigationReady &&
      !savedPosition.isFetching &&
      (savedPosition.isError || savedPosition.isFetchedAfterMount)) ||
    (pauseOnLoad && failure?.scope === scope);
  const playbackStatusId = useId();

  useEffect(() => {
    if (!playing || !playbackReady) return;
    const timer = window.setInterval(() => setLocalNow(performance.now()), 100);
    return () => window.clearInterval(timer);
  }, [playing, playbackReady]);

  function enqueue(change: PlaybackChange) {
    if (!playbackReady) return;
    const local = performance.now();
    const edit = { change, when: clockAt(local) };
    setLocalNow(local);
    setFailure(null);
    setQueue((pending) => {
      const entries =
        pending?.scope === scope && pending.epoch === epoch
          ? pending.edits
          : [];
      const last = entries[entries.length - 1];
      return {
        scope,
        epoch,
        edits:
          last &&
          last !== inFlight.current &&
          !last.bootstrap &&
          "at" in last.change &&
          "at" in change
            ? [...entries.slice(0, -1), edit]
            : [...entries, edit],
      };
    });
  }

  const bootstrap = useEffectEvent(() => {
    const attempt = `${scope}:${savedPosition.dataUpdatedAt}`;
    if (
      !navigationReady ||
      !loadedClock ||
      (exactResult && !pauseOnLoad) ||
      edits.length ||
      attemptedBootstrap.current === attempt
    )
      return;
    attemptedBootstrap.current = attempt;
    setQueue({
      scope,
      epoch,
      edits: [
        pauseOnLoad
          ? {
              change: { playing: false },
              when: mountedClock,
              bootstrap: true,
              observedClockRevision: loadedClock.revision,
            }
          : {
              change: { at: base.second },
              when: clockAt(performance.now()),
              bootstrap: true,
            },
      ],
    });
  });
  useEffect(
    () => bootstrap(),
    [
      scope,
      navigationReady,
      loadedClock,
      exactResult,
      pauseOnLoad,
      savedPosition.dataUpdatedAt,
    ],
  );

  const publish = useEffectEvent((edit: PlaybackEdit) => {
    if (activeScope.current !== scope || inFlight.current === edit) return;
    inFlight.current = edit;
    const options = { signal: AbortSignal.timeout(playbackReadTimeout) };
    const args = {
      ...identity,
      observedSeekId: epoch,
      observedClockRevision:
        edit.observedClockRevision ??
        queryClient.getQueryData<typeof savedPosition.data>(queryKey)?.playback
          ?.clockRevision ??
        0,
      returnPlayback: true as const,
      effectiveAtMs: edit.when,
    };
    const action =
      "at" in edit.change
        ? callAction(
            "set-playback-position",
            { ...args, at: edit.change.at, initialize: edit.bootstrap },
            options,
          )
        : callAction(
            "set-playback-controls",
            { ...args, ...edit.change },
            options,
          );
    function finish(applied: boolean) {
      setQueue((pending) => {
        if (pending?.edits[0] !== edit) return pending;
        return applied && pending.edits.length > 1
          ? { ...pending, edits: pending.edits.slice(1) }
          : null;
      });
      if (inFlight.current === edit) inFlight.current = null;
    }
    void action
      .then(({ applied, playback }) => {
        if (activeScope.current !== scope) return finish(false);
        if (applied && playback) {
          queryClient.setQueryData<typeof savedPosition.data>(
            queryKey,
            (current) => {
              if (
                !current ||
                (current.playback?.clockRevision ?? 0) >
                  (playback.clockRevision ?? 0)
              )
                return current;
              return { ...current, playback };
            },
          );
        } else {
          if (!edit.bootstrap)
            setFailure({
              scope,
              message: "Playback changed. Try the control again.",
            });
          void savedPosition.refetch();
        }
        finish(applied);
      })
      .catch((error: unknown) => {
        finish(false);
        if (activeScope.current !== scope) return;
        setFailure({
          scope,
          message:
            actionErrorMessage(error) ??
            "Couldn’t save playback. Try the control again.",
        });
        if (actionErrorCode(error) === "scenario_conflict")
          refreshNavigationOnce();
      });
  });
  const first = edits[0];
  useEffect(() => {
    if (!navigationReady || !first || inFlight.current === first) return;
    if (!first.bootstrap && "at" in first.change && edits.length === 1) {
      const timer = window.setTimeout(() => publish(first), 300);
      return () => window.clearTimeout(timer);
    }
    publish(first);
  }, [scope, navigationReady, first, edits.length]);

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
                if (playbackUnavailable) {
                  setFailure(null);
                  attemptedBootstrap.current = null;
                  void savedPosition.refetch();
                }
                return;
              }
              enqueue({ playing: !playing });
            }}
          >
            {playbackUnavailable
              ? "Retry playback"
              : playing && playbackReady
                ? "Pause"
                : second >= end
                  ? "Replay Saturday"
                  : "Play Saturday"}
          </button>
          <label>
            Playback speed
            <select
              value={speed}
              disabled={!playbackReady}
              onChange={(event) =>
                enqueue({
                  speed: playbackSpeedSchema.parse(Number(event.target.value)),
                })
              }
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
            onChange={(event) => enqueue({ at: Number(event.target.value) })}
          />
        </label>
        {(!playbackReady || failure?.scope === scope) && (
          <span
            className="cafe-playback-status"
            id={playbackStatusId}
            role="status"
          >
            {playbackUnavailable
              ? "Couldn’t load the saved playback position."
              : failure?.scope === scope
                ? failure.message
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
  const wait = frame.currentWait;
  const waitingFor = wait?.blockedBy
    .map((resource) => waitLabels[resource])
    .join(" and ");
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
            wait
              ? `${wait.station} has the longest current wait · ${displayWait(wait.seconds)}${waitingFor ? `. Waiting for ${waitingFor}.` : ""}`
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
                station === wait?.station
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
