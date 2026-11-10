import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { BUS_CONTRACT_VERSION, createBus, type EventMeta } from "../../src/bus";

type Events = {
  message: { text: string };
  count: number;
};

const globalBus = globalThis as typeof globalThis & {
  __MFE_BUS__?: unknown;
};

afterEach(() => {
  vi.useRealTimers();
  delete globalBus.__MFE_BUS__;
  vi.restoreAllMocks();
});

describe("createBus", () => {
  it("fans out synchronously in subscription order", () => {
    const bus = createBus<Events>();
    const received: string[] = [];
    bus.subscribe("message", () => received.push("first"));
    bus.subscribe("message", () => received.push("second"));

    bus.publish("message", { text: "hello" });

    expect(received).toEqual(["first", "second"]);
  });

  it("isolates handler errors and reports them through onError", () => {
    const bus = createBus<Events>();
    const received: string[] = [];
    const errors: Array<{ error: unknown; meta: EventMeta }> = [];
    bus.onError((error, meta) => errors.push({ error, meta }));
    bus.subscribe("message", () => {
      throw new Error("handler failed");
    });
    bus.subscribe("message", (_payload, meta) =>
      received.push(`${meta.seq}:${meta.replayed}`),
    );

    expect(() => bus.publish("message", { text: "hello" })).not.toThrow();
    expect(received).toEqual(["1:false"]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error).toEqual(new Error("handler failed"));
    expect(errors[0]!.meta.channel).toBe("message");
  });

  it("uses console.error when no error listener is registered", () => {
    const bus = createBus<Events>();
    const error = new Error("handler failed");
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    bus.subscribe("message", () => {
      throw error;
    });

    bus.publish("message", { text: "hello" });

    expect(report).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ channel: "message", seq: 1 }),
    );
  });

  it("reports errors thrown by error listeners without interrupting delivery", () => {
    const bus = createBus<Events>();
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const received = vi.fn();
    bus.onError(() => {
      throw new Error("reporter failed");
    });
    bus.subscribe("message", () => {
      throw new Error("handler failed");
    });
    bus.subscribe("message", received);

    expect(() => bus.publish("message", { text: "hello" })).not.toThrow();
    expect(received).toHaveBeenCalledOnce();
    expect(report).toHaveBeenCalledWith(
      new Error("reporter failed"),
      expect.objectContaining({ channel: "message", seq: 1 }),
    );
  });

  it("retains events for their TTL and replays them in sequence order", () => {
    vi.useFakeTimers();
    const bus = createBus<Events>();
    const received: Array<{ count: number; meta: EventMeta }> = [];
    bus.publish("count", 1, { ttl: 500, source: "host" });
    bus.publish("count", 2, { ttl: 1_000 });
    vi.advanceTimersByTime(600);

    bus.subscribe("count", (count, meta) => received.push({ count, meta }), {
      replay: true,
    });

    expect(received.map(({ count }) => count)).toEqual([2]);
    expect(received[0]!.meta).toMatchObject({
      channel: "count",
      seq: 2,
      replayed: true,
    });
    expect(received[0]!.meta.source).toBeUndefined();
    expect(bus.inspect().channels.count).toEqual({
      listeners: 1,
      retained: 1,
      lastSeq: 2,
    });
    vi.useRealTimers();
  });

  it("filters replay with afterSeq and retains at most 100 events per channel", () => {
    const bus = createBus<Events>();
    for (let count = 1; count <= 105; count += 1) {
      bus.publish("count", count, { ttl: 10_000 });
    }
    const received: number[] = [];
    bus.subscribe("count", (count) => received.push(count), {
      replay: true,
      afterSeq: 103,
    });

    expect(received).toEqual([104, 105]);
    const oldestRetained: number[] = [];
    bus.subscribe("count", (count) => oldestRetained.push(count), {
      replay: true,
    });
    expect(oldestRetained).toHaveLength(100);
    expect(oldestRetained[0]).toBe(6);
    expect(oldestRetained[oldestRetained.length - 1]).toBe(105);
    expect(bus.inspect().channels.count?.retained).toBe(100);
    expect(bus.inspect().channels.count?.lastSeq).toBe(105);
  });

  it("keeps inspect side-effect free", () => {
    const bus = createBus<Events>();
    bus.publish("count", 1, { ttl: 1_000 });

    const first = bus.inspect();
    const second = bus.inspect();
    const received: number[] = [];
    bus.subscribe("count", (count) => received.push(count), { replay: true });

    expect(second).toEqual(first);
    expect(received).toEqual([1]);
  });

  it("assigns increasing sequence numbers and keeps channels independent", () => {
    const bus = createBus<Events>();
    const sequences: number[] = [];
    bus.subscribe("count", (_count, meta) => sequences.push(meta.seq));

    bus.publish("count", 1);
    bus.publish("message", { text: "other channel" });
    bus.publish("count", 2);

    expect(sequences).toEqual([1, 2]);
    expect(bus.inspect().channels.message?.lastSeq).toBe(1);
  });

  it("uses the handle source unless a publish overrides it", () => {
    const bus = createBus<Events>({ source: "module-default" });
    const sources: Array<string | undefined> = [];
    bus.subscribe("message", (_payload, meta) => sources.push(meta.source));

    bus.publish("message", { text: "default" });
    bus.publish("message", { text: "override" }, { source: "explicit" });

    expect(sources).toEqual(["module-default", "explicit"]);
  });

  it("applies subscription changes only to the next published event", () => {
    const bus = createBus<Events>();
    const received: string[] = [];
    let unsubscribeSecond = () => {};
    bus.subscribe("message", () => {
      received.push("first");
      unsubscribeSecond();
      bus.subscribe("message", () => received.push("late"));
    });
    unsubscribeSecond = bus.subscribe("message", () => received.push("second"));

    bus.publish("message", { text: "one" });
    bus.publish("message", { text: "two" });

    expect(received).toEqual(["first", "second", "first", "late"]);
  });

  it("delivers nested publishes immediately and in sequence order", () => {
    const bus = createBus<Events>();
    const received: number[] = [];
    bus.subscribe("count", (count) => {
      received.push(count);
      if (count === 1) bus.publish("count", 2);
    });

    bus.publish("count", 1);

    expect(received).toEqual([1, 2]);
  });

  it("supports once, replay, and AbortSignal cancellation", () => {
    const bus = createBus<Events>();
    const received: number[] = [];
    bus.publish("count", 1, { ttl: 1_000 });
    bus.publish("count", 2, { ttl: 1_000 });
    bus.once("count", (count) => received.push(count), { replay: true });

    const controller = new AbortController();
    bus.subscribe("count", (count) => received.push(count), {
      signal: controller.signal,
    });
    controller.abort();
    bus.publish("count", 3);

    expect(received).toEqual([1]);
  });

  it("queues new events until all retained replay events are delivered", () => {
    const bus = createBus<Events>();
    const received: number[] = [];
    bus.publish("count", 1, { ttl: 1_000 });
    bus.publish("count", 2, { ttl: 1_000 });

    bus.subscribe(
      "count",
      (count) => {
        received.push(count);
        if (count === 1) bus.publish("count", 3);
      },
      { replay: true },
    );

    expect(received).toEqual([1, 2, 3]);
  });

  it("uses a versioned global core and rejects incompatible contracts", async () => {
    globalBus.__MFE_BUS__ = { contractVersion: BUS_CONTRACT_VERSION + 1 };
    expect(() => createBus<Events>()).toThrow(
      /Incompatible event bus contract: found 2, expected 1/,
    );
    delete globalBus.__MFE_BUS__;

    const firstCopy = await import("../../src/bus");
    const firstBus = firstCopy.createBus<Events>();
    firstBus.publish("message", { text: "retained" }, { ttl: 1_000 });

    vi.resetModules();
    const secondCopy = await import("../../src/bus");
    const received: string[] = [];
    secondCopy
      .createBus<Events>()
      .subscribe("message", (payload) => received.push(payload.text), {
        replay: true,
      });

    expect(received).toEqual(["retained"]);
  });

  it("does not create global state until createBus is called", async () => {
    delete globalBus.__MFE_BUS__;
    vi.resetModules();

    await import("../../src/bus");

    expect(globalBus.__MFE_BUS__).toBeUndefined();
  });

  it("rejects invalid TTL values", () => {
    const bus = createBus<Events>();
    expect(() => bus.publish("count", 1, { ttl: -1 })).toThrow(RangeError);
  });

  it("rejects invalid afterSeq values", () => {
    const bus = createBus<Events>();
    expect(() =>
      bus.subscribe("message", () => {}, { afterSeq: Number.NaN }),
    ).toThrow(RangeError);
    expect(() =>
      bus.publish("count", 1, { ttl: Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
    expect(() => bus.publish("count", 1, { ttl: Number.NaN })).toThrow(
      RangeError,
    );
  });

  it("preserves event typing for channels and payloads", () => {
    const bus = createBus<Events>();
    expectTypeOf(bus.publish).parameter(0).toEqualTypeOf<"message" | "count">();
    bus.publish("message", { text: "typed" });
    // @ts-expect-error unknown event channel
    bus.publish("missing", { text: "typed" });
    // @ts-expect-error invalid payload for the event channel
    bus.publish("count", { text: "not a number" });
  });
});
