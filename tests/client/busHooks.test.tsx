import { StrictMode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBus, type EventMeta } from "../../src/bus";
import { createBusHooks } from "../../src/client/busHooks";
import { ModuleContext } from "../../src/client/ModuleContext";

type Events = {
  message: { text: string };
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete (globalThis as typeof globalThis & { __MFE_BUS__?: unknown })
    .__MFE_BUS__;
});

describe("createBusHooks", () => {
  it("cancels subscriptions when the hook unmounts", () => {
    const bus = createBus<Events>();
    const { useSubscribe } = createBusHooks(bus);
    const { unmount } = renderHook(() => useSubscribe("message", () => {}));

    expect(bus.inspect().channels.message?.listeners).toBe(1);
    unmount();
    expect(bus.inspect().channels.message?.listeners).toBe(0);
  });

  it("returns a stable publisher across renders", () => {
    const { usePublish } = createBusHooks(createBus<Events>());
    const { result, rerender } = renderHook(() => usePublish());
    const publish = result.current;

    rerender();

    expect(result.current).toBe(publish);
  });

  it("uses the latest handler without resubscribing", () => {
    const bus = createBus<Events>();
    const subscribe = vi.spyOn(bus, "subscribe");
    const { useSubscribe } = createBusHooks(bus);
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ handler }: { handler: (payload: Events["message"]) => void }) =>
        useSubscribe("message", handler),
      { initialProps: { handler: first } },
    );

    rerender({ handler: second });
    act(() => bus.publish("message", { text: "latest" }));

    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(
      { text: "latest" },
      expect.objectContaining({ channel: "message" }),
    );
  });

  it("does not replay the same retained event twice in StrictMode", () => {
    const bus = createBus<Events>();
    bus.publish("message", { text: "retained" }, { ttl: 1_000 });
    const { useSubscribe } = createBusHooks(bus);
    const received: string[] = [];

    renderHook(
      () =>
        useSubscribe("message", (payload) => received.push(payload.text), {
          replay: true,
        }),
      { wrapper: StrictMode },
    );

    expect(received).toEqual(["retained"]);
  });

  it("uses ModuleContext to attribute published events to the module", () => {
    const bus = createBus<Events>();
    const { usePublish } = createBusHooks(bus);
    const metas: EventMeta[] = [];
    bus.subscribe("message", (_payload, meta) => metas.push(meta));
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <ModuleContext.Provider
        value={{
          appName: "shop",
          name: "cart",
          isolateStyles: false,
        }}
      >
        {children}
      </ModuleContext.Provider>
    );
    const { result } = renderHook(() => usePublish(), { wrapper });

    act(() => result.current("message", { text: "hello" }));

    expect(metas[0]?.source).toBe("shop-cart");
  });
});
