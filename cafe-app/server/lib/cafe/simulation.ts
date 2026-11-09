import {
  assertServiceHours,
  SECONDS_PER_DAY,
  type Arrival,
  type ArrivalPlan,
  type DemandLevel,
  type ServiceHours,
} from "./arrivals";

const machines = ["grinder", "groupHead", "steamWand"] as const;
const resources = ["staff", ...machines] as const;
const resourceLabels = {
  staff: "Barista time",
  grinder: "Grinder",
  groupHead: "Espresso group head",
  steamWand: "Steam wand",
} as const;

export type Machine = (typeof machines)[number];
export type Resource = (typeof resources)[number];

export interface Shift {
  readonly startsAt: number;
  readonly endsAt: number;
}

export interface Worker {
  readonly id: string;
  readonly shifts: readonly Shift[];
}

export type Task = Readonly<{ id: string; staffSeconds: number }> &
  (
    | Readonly<{ machine?: undefined; unattendedSeconds?: never }>
    | Readonly<{ machine: Machine; unattendedSeconds?: number }>
  );

export interface MenuItem {
  readonly id: string;
  readonly tasks: readonly Task[];
}

export interface Shop {
  readonly workers: readonly Worker[];
  readonly equipment: Readonly<Record<Machine, number>>;
  readonly menu: readonly MenuItem[];
  readonly patienceSeconds: number;
}

export interface Saturday {
  readonly hours: ServiceHours;
  readonly arrivals: readonly Arrival[];
}

export type SimulationEvent = Readonly<{ at: number; arrivalId: string }> &
  (
    | Readonly<{ kind: "arrived"; itemId: string }>
    | Readonly<{ kind: "task_queued" | "task_completed"; taskId: string }>
    | Readonly<{
        kind: "task_started";
        taskId: string;
        workerId: string;
        workerReleasedAt: number;
        endsAt: number;
        machineId?: string;
      }>
    | Readonly<{ kind: "order_served" | "customer_lost"; waitSeconds: number }>
  );

export interface Utilization {
  readonly id: string;
  readonly kind: "worker" | Machine;
  readonly busySeconds: number;
  readonly availableSeconds: number;
  readonly fraction: number;
}

export interface ResourceWait {
  readonly resource: Resource;
  readonly label: string;
  readonly blockedTasks: number;
  readonly totalWaitSeconds: number;
  readonly longestTaskWaitSeconds: number;
}

interface WaitStats {
  readonly waitP50Seconds: number | null;
  readonly waitP90Seconds: number | null;
  readonly utilization: readonly Utilization[];
  readonly resourceWaits: readonly ResourceWait[];
  readonly bottleneck: ResourceWait | null;
}

export interface SaturdayResult {
  readonly arrivals: readonly Arrival[];
  readonly timeline: readonly SimulationEvent[];
  readonly stats: WaitStats &
    Readonly<{ ordersServed: number; customersLost: number }>;
}

export interface SeriesResult {
  readonly seed: number;
  readonly demandLevel: DemandLevel;
  readonly runCount: number;
  readonly playback: SaturdayResult;
  readonly stats: WaitStats &
    Readonly<{ meanOrdersServed: number; meanCustomersLost: number }>;
}

interface PreparedShop {
  workers: readonly Worker[];
  equipment: Shop["equipment"];
  menu: ReadonlyMap<string, NonemptyTasks>;
  patienceSeconds: number;
  shiftBoundaries: readonly number[];
}

type NonemptyTasks = readonly [Task, ...Task[]];

interface Order {
  arrivalId: string;
  tasks: readonly Task[];
  nextTask: number;
  waitSeconds: number;
}

interface Waiting {
  order: Order;
  task: Task;
  queuedAt: number;
  expiresAt: number;
  blocked: Record<Resource, number>;
}

interface Running {
  order: Order;
  task: Task;
  endsAt: number;
}

interface ResourceUnit {
  id: string;
  busyUntil: number;
  busySeconds: number;
}

type MutableResourceWait = {
  -readonly [Key in keyof ResourceWait]: ResourceWait[Key];
};

function prepareShop(shop: Shop): PreparedShop {
  const { equipment, patienceSeconds } = shop;
  if (
    !Number.isFinite(patienceSeconds) ||
    patienceSeconds < 0 ||
    patienceSeconds > SECONDS_PER_DAY
  ) {
    throw new RangeError(
      "Customer patience must be between zero seconds and one day.",
    );
  }
  for (const machine of machines) {
    if (!Number.isSafeInteger(equipment[machine]) || equipment[machine] < 0) {
      throw new RangeError(
        "Equipment capacities must be nonnegative integers.",
      );
    }
  }

  const menu = new Map<string, NonemptyTasks>();
  const staffDurations = new Set<number>();
  for (const { id, tasks } of shop.menu) {
    const [firstTask, ...remainingTasks] = tasks;
    if (!id || menu.has(id) || !firstTask) {
      throw new RangeError(
        "Menu items must have unique IDs and at least one task.",
      );
    }
    const taskIds = new Set<string>();
    for (const task of tasks) {
      const { staffSeconds, machine, unattendedSeconds } = task;
      if (
        !task.id ||
        taskIds.has(task.id) ||
        !Number.isFinite(staffSeconds) ||
        staffSeconds <= 0 ||
        staffSeconds > SECONDS_PER_DAY ||
        (machine !== undefined && !machines.includes(machine)) ||
        (unattendedSeconds !== undefined &&
          (!machine ||
            !Number.isFinite(unattendedSeconds) ||
            unattendedSeconds < 0 ||
            unattendedSeconds > SECONDS_PER_DAY))
      ) {
        throw new RangeError(
          "Each menu task requires a unique ID, valid duration, and equipment for unattended time.",
        );
      }
      taskIds.add(task.id);
      staffDurations.add(staffSeconds);
    }
    menu.set(id, [firstTask, ...remainingTasks]);
  }

  const workerIds = new Set<string>();
  const shiftBoundaries = new Set<number>();
  const workers = shop.workers.map(({ id, shifts }) => {
    if (!id || workerIds.has(id))
      throw new RangeError("Workers must have unique IDs.");
    workerIds.add(id);
    const orderedShifts = [...shifts].sort((a, b) => a.startsAt - b.startsAt);
    const continuousShifts: Shift[] = [];
    for (const shift of orderedShifts) {
      const { startsAt, endsAt } = shift;
      const previous = continuousShifts[continuousShifts.length - 1];
      if (
        !Number.isFinite(startsAt) ||
        !Number.isFinite(endsAt) ||
        startsAt < 0 ||
        endsAt > SECONDS_PER_DAY ||
        startsAt >= endsAt ||
        (previous && startsAt < previous.endsAt)
      ) {
        throw new RangeError(
          "Worker shifts must be valid nonoverlapping time windows within Saturday.",
        );
      }
      if (previous?.endsAt === startsAt) {
        continuousShifts[continuousShifts.length - 1] = {
          startsAt: previous.startsAt,
          endsAt,
        };
      } else {
        continuousShifts.push(shift);
      }
    }
    for (const { startsAt, endsAt } of continuousShifts) {
      shiftBoundaries.add(startsAt);
      for (const duration of staffDurations) {
        const latestStart = endsAt - duration;
        if (latestStart > startsAt) shiftBoundaries.add(latestStart);
      }
    }
    return { id, shifts: continuousShifts };
  });
  return {
    workers,
    equipment,
    menu,
    patienceSeconds,
    shiftBoundaries: [...shiftBoundaries].sort((a, b) => a - b),
  };
}

function resourceWaits(): MutableResourceWait[] {
  return resources.map((resource) => ({
    resource,
    label: resourceLabels[resource],
    blockedTasks: 0,
    totalWaitSeconds: 0,
    longestTaskWaitSeconds: 0,
  }));
}

function makeUnit(id: string): ResourceUnit {
  return { id, busyUntil: 0, busySeconds: 0 };
}

function day(
  shop: PreparedShop,
  { hours, arrivals: inputArrivals }: Saturday,
  recordTimeline: boolean,
) {
  const arrivalIds = new Set<string>();
  const arrivals = inputArrivals
    .map(({ id, at, itemId }) => {
      const tasks = shop.menu.get(itemId);
      if (
        !id ||
        arrivalIds.has(id) ||
        !Number.isFinite(at) ||
        at < hours.opensAt ||
        at >= hours.closesAt ||
        !tasks
      ) {
        throw new RangeError(
          "Arrivals require unique IDs, times during service hours, and configured menu items.",
        );
      }
      arrivalIds.add(id);
      return { arrival: Object.freeze({ id, at, itemId }), tasks };
    })
    .sort((a, b) => a.arrival.at - b.arrival.at);

  const workers = shop.workers.map(({ id, shifts }) => ({
    ...makeUnit(id),
    shifts,
  }));
  const equipment = new Map(
    machines.map((kind) => [
      kind,
      Array.from({ length: shop.equipment[kind] }, (_, index) =>
        makeUnit(`${kind}-${index + 1}`),
      ),
    ]),
  );
  const timeline: SimulationEvent[] | undefined = recordTimeline
    ? []
    : undefined;
  const waits = resourceWaits();
  const servedWaits: number[] = [];
  let customersLost = 0;
  let at = hours.opensAt;
  let serviceEndsAt = hours.closesAt;
  let arrivalIndex = 0;
  let boundaryIndex = 0;
  let waiting: Waiting[] = [];
  let running: Running[] = [];

  function availableWorker(staffSeconds: number, time: number) {
    let available: (typeof workers)[number] | undefined;
    let earliestEnd = Infinity;
    for (const worker of workers) {
      if (worker.busyUntil > time) continue;
      const shift = worker.shifts.find(
        ({ startsAt, endsAt }) =>
          startsAt <= time && time <= endsAt - staffSeconds,
      );
      if (
        shift &&
        (!available || shift.endsAt < earliestEnd ||
          (shift.endsAt === earliestEnd && worker.id < available.id))
      ) {
        available = worker;
        earliestEnd = shift.endsAt;
      }
    }
    return available;
  }

  function availableMachine(machine: Machine, time: number) {
    return equipment.get(machine)?.find((unit) => unit.busyUntil <= time);
  }

  function enqueue(order: Order, task: Task) {
    const expiresAt =
      at + Math.max(0, shop.patienceSeconds - order.waitSeconds);
    waiting.push({
      order,
      task,
      queuedAt: at,
      expiresAt,
      blocked: { staff: 0, grinder: 0, groupHead: 0, steamWand: 0 },
    });
    timeline?.push(
      Object.freeze({
        kind: "task_queued",
        at,
        arrivalId: order.arrivalId,
        taskId: task.id,
      }),
    );
  }

  function finishWaiting(entry: Waiting) {
    entry.order.waitSeconds += at - entry.queuedAt;
    for (const resourceWait of waits) {
      const seconds = entry.blocked[resourceWait.resource];
      if (seconds === 0) continue;
      resourceWait.blockedTasks += 1;
      resourceWait.totalWaitSeconds += seconds;
      resourceWait.longestTaskWaitSeconds = Math.max(
        resourceWait.longestTaskWaitSeconds,
        seconds,
      );
    }
  }

  while (arrivalIndex < arrivals.length || waiting.length || running.length) {
    running = running.filter(({ order, task, endsAt }) => {
      if (endsAt > at) return true;
      timeline?.push(
        Object.freeze({
          kind: "task_completed",
          at,
          arrivalId: order.arrivalId,
          taskId: task.id,
        }),
      );
      order.nextTask += 1;
      const nextTask = order.tasks[order.nextTask];
      if (nextTask) {
        enqueue(order, nextTask);
      } else {
        servedWaits.push(order.waitSeconds);
        timeline?.push(
          Object.freeze({
            kind: "order_served",
            at,
            arrivalId: order.arrivalId,
            waitSeconds: order.waitSeconds,
          }),
        );
      }
      return false;
    });

    while (true) {
      const next = arrivals[arrivalIndex];
      if (next?.arrival.at !== at) break;
      arrivalIndex += 1;
      const {
        arrival: { id, itemId },
        tasks,
      } = next;
      timeline?.push(
        Object.freeze({ kind: "arrived", at, arrivalId: id, itemId }),
      );
      enqueue({ arrivalId: id, tasks, nextTask: 0, waitSeconds: 0 }, tasks[0]);
    }

    // Dispatch in ready order and let other orders use any resources a blocked task cannot claim.
    waiting = waiting.filter((entry) => {
      const { order, task, expiresAt } = entry;
      const worker = availableWorker(task.staffSeconds, at);
      const machine = task.machine && availableMachine(task.machine, at);
      if (worker && (!task.machine || machine)) {
        finishWaiting(entry);
        const workerReleasedAt = at + task.staffSeconds;
        const endsAt = workerReleasedAt + (task.unattendedSeconds ?? 0);
        if (workerReleasedAt <= at)
          throw new RangeError(
            "Task duration is below the clock's resolution.",
          );
        worker.busyUntil = workerReleasedAt;
        worker.busySeconds += task.staffSeconds;
        if (machine) {
          machine.busyUntil = endsAt;
          machine.busySeconds +=
            task.staffSeconds + (task.unattendedSeconds ?? 0);
        }
        serviceEndsAt = Math.max(serviceEndsAt, endsAt);
        running.push({ order, task, endsAt });
        timeline?.push(
          Object.freeze({
            kind: "task_started",
            at,
            arrivalId: order.arrivalId,
            taskId: task.id,
            workerId: worker.id,
            workerReleasedAt,
            endsAt,
            ...(machine ? { machineId: machine.id } : {}),
          }),
        );
        return false;
      }
      if (expiresAt > at) return true;
      finishWaiting(entry);
      customersLost += 1;
      timeline?.push(
        Object.freeze({
          kind: "customer_lost",
          at,
          arrivalId: order.arrivalId,
          waitSeconds: order.waitSeconds,
        }),
      );
      return false;
    });

    if (arrivalIndex === arrivals.length && !waiting.length && !running.length)
      break;
    while ((shop.shiftBoundaries[boundaryIndex] ?? Infinity) <= at)
      boundaryIndex += 1;
    let nextAt = Math.min(
      arrivals[arrivalIndex]?.arrival.at ?? Infinity,
      shop.shiftBoundaries[boundaryIndex] ?? Infinity,
    );
    for (const worker of workers) {
      if (worker.busyUntil > at) nextAt = Math.min(nextAt, worker.busyUntil);
    }
    for (const active of running) nextAt = Math.min(nextAt, active.endsAt);
    for (const entry of waiting) nextAt = Math.min(nextAt, entry.expiresAt);

    // The dispatch conditions are constant inside this interval. Split time when both resources are missing.
    const seconds = nextAt - at;
    const midpoint = at + seconds / 2;
    for (const { task, blocked } of waiting) {
      const noStaff = !availableWorker(task.staffSeconds, midpoint);
      const machine = task.machine;
      const noMachine =
        machine !== undefined && !availableMachine(machine, midpoint);
      if (noStaff) blocked.staff += noMachine ? seconds / 2 : seconds;
      if (noMachine) blocked[machine] += noStaff ? seconds / 2 : seconds;
    }
    at = nextAt;
  }

  const utilization: Utilization[] = workers.map((worker) =>
    use(
      worker,
      "worker",
      worker.shifts.reduce(
        (seconds, { startsAt, endsAt }) =>
          seconds +
          Math.max(
            0,
            Math.min(endsAt, serviceEndsAt) - Math.max(startsAt, hours.opensAt),
          ),
        0,
      ),
    ),
  );
  for (const [kind, units] of equipment) {
    for (const unit of units)
      utilization.push(use(unit, kind, serviceEndsAt - hours.opensAt));
  }
  return {
    arrivals: arrivals.map(({ arrival }) => arrival),
    timeline: timeline ?? [],
    servedWaits,
    customersLost,
    utilization,
    waits,
  };
}

function use(
  unit: Pick<ResourceUnit, "id" | "busySeconds">,
  kind: Utilization["kind"],
  availableSeconds: number,
): Utilization {
  return {
    id: unit.id,
    kind,
    busySeconds: unit.busySeconds,
    availableSeconds,
    fraction: availableSeconds > 0 ? unit.busySeconds / availableSeconds : 0,
  };
}

function percentile(waits: readonly number[], quantile: number): number | null {
  const rank = (waits.length - 1) * quantile;
  const lower = Math.floor(rank);
  const lowerValue = waits[lower];
  const upperValue = waits[Math.ceil(rank)];
  return lowerValue === undefined || upperValue === undefined
    ? null
    : lowerValue + (upperValue - lowerValue) * (rank - lower);
}

function waitStats(
  servedWaits: number[],
  utilization: Utilization[],
  waits: MutableResourceWait[],
): WaitStats {
  servedWaits.sort((a, b) => a - b);
  const resourceWaits = Object.freeze(waits.map((wait) => Object.freeze(wait)));
  const bottleneck = [...resourceWaits].sort(
    (a, b) =>
      b.longestTaskWaitSeconds - a.longestTaskWaitSeconds ||
      b.totalWaitSeconds - a.totalWaitSeconds,
  )[0];
  return {
    waitP50Seconds: percentile(servedWaits, 0.5),
    waitP90Seconds: percentile(servedWaits, 0.9),
    utilization: Object.freeze(utilization.map((unit) => Object.freeze(unit))),
    resourceWaits,
    bottleneck:
      bottleneck && bottleneck.longestTaskWaitSeconds > 0 ? bottleneck : null,
  };
}

function saturdayResult(result: ReturnType<typeof day>): SaturdayResult {
  return Object.freeze({
    arrivals: Object.freeze(result.arrivals),
    timeline: Object.freeze(result.timeline),
    stats: Object.freeze({
      ordersServed: result.servedWaits.length,
      customersLost: result.customersLost,
      ...waitStats(result.servedWaits, result.utilization, result.waits),
    }),
  });
}

export function simulateSaturday(
  shop: Shop,
  saturday: Saturday,
): SaturdayResult {
  assertServiceHours(saturday.hours);
  return saturdayResult(day(prepareShop(shop), saturday, true));
}

export function simulateSeries(shop: Shop, plan: ArrivalPlan): SeriesResult {
  assertServiceHours(plan.hours);
  const runCount = plan.runs.length;
  const [firstArrivals, ...remainingRuns] = plan.runs;
  if (!firstArrivals)
    throw new RangeError("At least one arrival run is required.");
  const prepared = prepareShop(shop);
  const first = day(
    prepared,
    { hours: plan.hours, arrivals: firstArrivals },
    true,
  );
  const servedWaits = [...first.servedWaits];
  let customersLost = first.customersLost;
  const totals = first.utilization.map((unit) => ({ ...unit }));
  const waits = first.waits.map((wait) => ({ ...wait }));

  for (const arrivals of remainingRuns) {
    const result = day(prepared, { hours: plan.hours, arrivals }, false);
    for (const seconds of result.servedWaits) servedWaits.push(seconds);
    customersLost += result.customersLost;
    // Runs use the same prepared shop, so resource identity and ordering are fixed.
    for (const [index, unit] of result.utilization.entries()) {
      const total = totals[index]!;
      total.busySeconds += unit.busySeconds;
      total.availableSeconds += unit.availableSeconds;
    }
    for (const [index, wait] of result.waits.entries()) {
      const total = waits[index]!;
      total.blockedTasks += wait.blockedTasks;
      total.totalWaitSeconds += wait.totalWaitSeconds;
      total.longestTaskWaitSeconds = Math.max(
        total.longestTaskWaitSeconds,
        wait.longestTaskWaitSeconds,
      );
    }
  }

  const utilization = totals.map(
    ({ id, kind, busySeconds, availableSeconds }) =>
      use(
        { id, busySeconds: busySeconds / runCount },
        kind,
        availableSeconds / runCount,
      ),
  );
  return Object.freeze({
    seed: plan.seed,
    demandLevel: plan.demandLevel,
    runCount,
    playback: saturdayResult(first),
    stats: Object.freeze({
      meanOrdersServed: servedWaits.length / runCount,
      meanCustomersLost: customersLost / runCount,
      ...waitStats(servedWaits, utilization, waits),
    }),
  });
}
