import { describe, it, expect } from "vitest";
import { EventLoopDispatcher } from "./dispatcher.js";
import { ErrCanceled } from "../task.js";
import { dispatcherContractTests } from "../dispatcher.tests.js";

dispatcherContractTests("EventLoopDispatcher", () => {
  const d = new EventLoopDispatcher(0);
  return { dispatcher: d, advanceTo: (t) => d.fastForward(t) };
});

describe("EventLoopDispatcher.fastForward", () => {
  it("backward time is a no-op", () => {
    const dispatcher = new EventLoopDispatcher(0);
    let executed = false;
    dispatcher.afterFunc(0, () => { executed = true; });

    // Fast-forwarding before the current time runs nothing and is not an error.
    expect(() => dispatcher.fastForward(-1)).not.toThrow();
    expect(executed).toBe(false);

    // Time is not rewound, so a forward fast-forward still runs the task.
    dispatcher.fastForward(0);
    expect(executed).toBe(true);
  });

  it("partial advance executes only due tasks", () => {
    const dispatcher = new EventLoopDispatcher(0);
    let f1 = false;
    let f2 = false;
    let f3 = false;

    dispatcher.afterFunc(100, () => { f1 = true; });
    dispatcher.afterFunc(200, () => { f2 = true; });
    dispatcher.afterFunc(300, () => { f3 = true; });

    dispatcher.fastForward(150);

    expect(f1).toBe(true);
    expect(f2).toBe(false);
    expect(f3).toBe(false);
  });

  it("tasks added during execution run in same fastForward", () => {
    const dispatcher = new EventLoopDispatcher(0);
    const results: number[] = [];

    dispatcher.afterFunc(10, () => {
      results.push(1);
      dispatcher.afterFunc(0, () => {
        results.push(2);
      });
    });

    dispatcher.fastForward(10);
    expect(results).toEqual([1, 2]);
  });
});

describe("EventLoopDispatcher resource management", () => {
  it("all tasks cleaned up after execution", () => {
    const dispatcher = new EventLoopDispatcher(0);
    const numTimers = 1000;

    for (let i = 0; i < numTimers; i++) {
      dispatcher.afterFunc(10, () => {});
    }

    expect(dispatcher.taskCount()).toBe(numTimers);
    dispatcher.fastForward(20);
    expect(dispatcher.taskCount()).toBe(0);
  });

  it("cancelled timers immediately removed", () => {
    const dispatcher = new EventLoopDispatcher(0);
    const numTimers = 1000;

    for (let i = 0; i < numTimers; i++) {
      const timer = dispatcher.afterFunc(3600_000, () => {});
      expect(timer.stop()).toBe(true);
    }

    expect(dispatcher.taskCount()).toBe(0);
  });
});

/** Runs fn and returns the value it throws; fails if fn does not throw. */
function thrownBy(fn: () => void): unknown {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected the call to throw");
}

describe("EventLoopDispatcher error handling", () => {
  it("reports the thrown value to the driver as a wrapped error and to wait unchanged", async () => {
    const dispatcher = new EventLoopDispatcher(0);
    const boom = new Error("boom");
    const task = dispatcher.invokeFunc(() => {
      throw boom;
    });

    // The operator (fastForward) gets a distinct wrapper; the original is its cause.
    const err = thrownBy(() => dispatcher.fastForward(0)) as Error;
    expect(err).not.toBe(boom);
    expect(err.cause).toBe(boom);

    // wait() rejects with the original value itself on every call.
    await expect(task.wait()).rejects.toBe(boom);
    await expect(task.wait()).rejects.toBe(boom);
  });

  it("carries a non-Error thrown value through cause and wait unchanged", async () => {
    const dispatcher = new EventLoopDispatcher(0);
    const task = dispatcher.invokeFunc(() => {
      throw 42;
    });

    const err = thrownBy(() => dispatcher.fastForward(0)) as Error;
    expect(err.cause).toBe(42);
    await expect(task.wait()).rejects.toBe(42);
  });

  it("subsequent tasks do not execute after error", () => {
    const dispatcher = new EventLoopDispatcher(0);
    let subsequent = false;

    dispatcher.afterFunc(100, () => {
      throw new Error("boom");
    });
    dispatcher.afterFunc(200, () => {
      subsequent = true;
    });

    expect(() => dispatcher.fastForward(200)).toThrow();
    expect(subsequent).toBe(false);
  });

  it("only first error reported", () => {
    const dispatcher = new EventLoopDispatcher(0);

    dispatcher.afterFunc(5, () => {
      throw new Error("first error");
    });
    dispatcher.afterFunc(10, () => {
      throw new Error("second error");
    });

    const err = thrownBy(() => dispatcher.fastForward(10)) as Error;
    expect((err.cause as Error).message).toBe("first error");
  });

  it("shutdown after error: no work runs on a later fastForward", () => {
    const dispatcher = new EventLoopDispatcher(0);
    dispatcher.afterFunc(1, () => {
      throw new Error("boom");
    });
    let laterRan = false;
    dispatcher.afterFunc(2, () => {
      laterRan = true;
    });

    expect(() => dispatcher.fastForward(2)).toThrow();
    expect(laterRan).toBe(false);

    // Stopped: work submitted afterward never runs, but a timer can still cancel
    // its still-queued task (Stop reports it prevented execution).
    let ran = false;
    const timer = dispatcher.afterFunc(1, () => {
      ran = true;
    });
    expect(timer.stop()).toBe(true);
    expect(timer.stop()).toBe(false);

    // A timer left un-stopped after shutdown never fires, even on a later advance.
    dispatcher.afterFunc(1, () => {
      ran = true;
    });
    dispatcher.fastForward(3600_000);
    expect(ran).toBe(false);
  });

  it("invokeFunc on a stopped dispatcher is canceled and never runs", async () => {
    const dispatcher = new EventLoopDispatcher(0);
    dispatcher.afterFunc(1, () => {
      throw new Error("boom");
    });
    expect(() => dispatcher.fastForward(1)).toThrow();

    let ran = false;
    const task = dispatcher.invokeFunc(() => {
      ran = true;
    });
    await expect(task.wait()).rejects.toBe(ErrCanceled);

    dispatcher.fastForward(3600_000);
    expect(ran).toBe(false);
  });

  it("a pending invokeFunc is canceled when a panic stops the dispatcher", async () => {
    const dispatcher = new EventLoopDispatcher(0);
    // Observe the failing task's wait() so its rejection is not left unhandled.
    dispatcher.invokeFunc(() => {
      throw new Error("boom");
    }).wait().catch(() => {});
    let pendingRan = false;
    const pending = dispatcher.invokeFunc(() => {
      pendingRan = true;
    });

    expect(() => dispatcher.fastForward(0)).toThrow();
    await expect(pending.wait()).rejects.toBe(ErrCanceled);
    expect(pendingRan).toBe(false);
  });

  it("a fire-and-forget invokeFunc that throws surfaces via fastForward, not as a rejection", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const dispatcher = new EventLoopDispatcher(0);
      // No wait(): the throw creates no Promise; the operator sees it via fastForward.
      dispatcher.invokeFunc(() => {
        throw new Error("boom");
      });
      expect(() => dispatcher.fastForward(0)).toThrow();
      await tick();
      await tick();

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("a fire-and-forget invokeFunc canceled at shutdown does not reject unhandled", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const dispatcher = new EventLoopDispatcher(0);
      // Observe the panic so only the cancel path is under test.
      dispatcher
        .invokeFunc(() => {
          throw new Error("boom");
        })
        .wait()
        .catch(() => {});
      dispatcher.invokeFunc(() => {}); // fire-and-forget; canceled by the stop, never waited
      expect(() => dispatcher.fastForward(0)).toThrow();

      dispatcher.invokeFunc(() => {}); // submitted after the stop -> canceled, never waited
      await tick();
      await tick();

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});
