import { expect, it } from "vitest";

import { frameAt } from "./service-playback";
import { servicePlaybackSchema } from "./service-run";
import { simulateSaturday, type Shop } from "./simulation";

const hours = { opensAt: 0, closesAt: 120 };
const worker = { id: "first", shifts: [{ startsAt: 0, endsAt: 120 }] };
const shop: Shop = {
  workers: [worker],
  equipment: { grinder: 1, groupHead: 1, steamWand: 1 },
  menu: [
    {
      id: "espresso",
      tasks: [
        {
          id: "Brew",
          machine: "groupHead",
          staffSeconds: 10,
          unattendedSeconds: 20,
        },
      ],
    },
    { id: "tea", tasks: [{ id: "Order", staffSeconds: 5 }] },
  ],
  patienceSeconds: 100,
};

function playback(bItem = "espresso", fixture = shop, bAt = 2) {
  const arrivals = [
    { id: "a", at: 0, itemId: "espresso" },
    { id: "b", at: bAt, itemId: bItem },
  ];
  const result = simulateSaturday(fixture, { hours, arrivals });
  return servicePlaybackSchema.parse(JSON.parse(JSON.stringify(result)));
}

it("explains the longest current wait using the resources available at that second", () => {
  const staffAndMachine = playback();
  expect(frameAt(staffAndMachine, 9).currentWait).toEqual({
    station: "Brew",
    seconds: 7,
    blockedBy: ["staff", "groupHead"],
  });
  expect(frameAt(staffAndMachine, 10).currentWait).toEqual({
    station: "Brew",
    seconds: 8,
    blockedBy: ["groupHead"],
  });
  expect(frameAt(staffAndMachine, 30).currentWait).toBeUndefined();

  const staffOnly = playback("tea");
  expect(frameAt(staffOnly, 9).currentWait).toEqual({
    station: "Order",
    seconds: 7,
    blockedBy: ["staff"],
  });
  expect(frameAt(staffOnly, 10).currentWait).toBeUndefined();

  const machineOnly = playback("espresso", {
    ...shop,
    workers: [worker, { ...worker, id: "second" }],
  });
  expect(frameAt(machineOnly, 2).currentWait).toEqual({
    station: "Brew",
    seconds: 0,
    blockedBy: ["groupHead"],
  });
});

it("preserves eligibility at the exact last instant a task fits in a shift", () => {
  const saved = playback(
    "espresso",
    {
      ...shop,
      workers: [{ ...worker, shifts: [{ startsAt: 0, endsAt: 20 }] }],
    },
    10,
  );
  expect(frameAt(saved, 10).currentWait?.blockedBy).toEqual(["groupHead"]);
  expect(frameAt(saved, 11).currentWait?.blockedBy).toEqual([
    "staff",
    "groupHead",
  ]);
  expect(frameAt(saved, 30).currentWait?.blockedBy).toEqual(["staff"]);
});

it("shows stage and duration without claiming a cause for a legacy run", () => {
  const saved = playback();
  const legacy = servicePlaybackSchema.parse({
    arrivals: saved.arrivals,
    timeline: saved.timeline,
    stats: saved.stats,
  });
  expect(frameAt(legacy, 9).currentWait).toEqual({
    station: "Brew",
    seconds: 7,
    blockedBy: [],
  });
});
