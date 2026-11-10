import type { ServiceRun } from "./service-run";
import { shiftFitsTask, type Machine, type Resource } from "./simulation";

type ServiceStation = Extract<
  ServiceRun["playback"]["timeline"][number],
  { kind: "task_queued" }
>["taskId"];

type Ticket = {
  itemId: string;
  station?: ServiceStation;
  queuedAt?: number;
  active: boolean;
};

export function frameAt(playback: ServiceRun["playback"], time: number) {
  const { capacity } = playback;
  const tickets = new Map<string, Ticket>();
  const busyWorkers = new Set<string>();
  const busyMachines: Partial<Record<Machine, number>> = {};
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
        if (event.workerReleasedAt > time) {
          busyWorkers.add(event.workerId);
        }
        if (capacity && event.machineId && event.endsAt > time) {
          const machine =
            capacity.tasks[ticket.itemId]?.[event.taskId]?.machine;
          if (machine) busyMachines[machine] = (busyMachines[machine] ?? 0) + 1;
        }
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
  let waiting = 0;
  let oldest:
    { itemId: string; station: ServiceStation; queuedAt: number } | undefined;
  for (const { itemId, station, queuedAt, active } of tickets.values()) {
    if (active) continue;
    waiting++;
    if (
      station &&
      queuedAt !== undefined &&
      (!oldest || queuedAt < oldest.queuedAt)
    ) {
      oldest = { itemId, station, queuedAt };
    }
  }

  const blockedBy: Resource[] = [];
  if (oldest && capacity) {
    const task = capacity.tasks[oldest.itemId]?.[oldest.station];
    if (task) {
      const availableStaff = capacity.workers.some(
        ({ id, shifts }) =>
          !busyWorkers.has(id) &&
          shifts.some((shift) => shiftFitsTask(shift, time, task.staffSeconds)),
      );
      if (!availableStaff) blockedBy.push("staff");
      const { machine } = task;
      if (
        machine &&
        (busyMachines[machine] ?? 0) >= capacity.equipment[machine]
      ) {
        blockedBy.push(machine);
      }
    }
  } else if (oldest && busyWorkers.size > 0) {
    const workers = playback.stats.utilization.filter(
      ({ kind }) => kind === "worker",
    );
    if (
      workers.length === busyWorkers.size &&
      workers.every(({ id }) => busyWorkers.has(id))
    ) {
      blockedBy.push("staff");
    }
  }

  const currentWait = oldest && {
    station: oldest.station,
    seconds: time - oldest.queuedAt,
    blockedBy,
  };
  return {
    currentWait,
    tickets: [...tickets.entries()],
    arrived,
    waiting,
    served,
    lost,
    active: tickets.size - waiting,
    latest,
  };
}
