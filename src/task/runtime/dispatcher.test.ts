import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { RuntimeDispatcher } from "./dispatcher.js";
import { ErrCanceled } from "../task.js";
import { dispatcherContractTests } from "../dispatcher.tests.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
});

dispatcherContractTests("RuntimeDispatcher", () => {
  let current = 0;
  const d = new RuntimeDispatcher();
  return {
    dispatcher: d,
    advanceTo: (t) => {
      vi.advanceTimersByTime(t - current);
      current = t;
    },
  };
});

describe("RuntimeDispatcher error handling", () => {
  it("subsequent tasks do not run after an afterFunc callback throws", () => {
    const dispatcher = new RuntimeDispatcher();
    let secondExecuted = false;

    dispatcher.afterFunc(10, () => {
      throw new Error("first error");
    });
    dispatcher.afterFunc(20, () => {
      secondExecuted = true;
    });

    // afterFunc returns no promise, so the throw surfaces as an uncaught
    // exception (fake timers re-throw it here).
    expect(() => vi.advanceTimersByTime(10)).toThrow("first error");
    vi.advanceTimersByTime(10);
    expect(secondExecuted).toBe(false);
  });

  it("an invokeFunc task that throws rejects its promise and cancels later tasks", async () => {
    const dispatcher = new RuntimeDispatcher();
    const boom = new Error("boom");

    const failed = dispatcher.invokeFunc(() => {
      throw boom;
    });
    let laterRan = false;
    const later = dispatcher.invokeFunc(() => {
      laterRan = true;
    });
    // Observe each task's wait() before advancing.
    const failedErr = failed.wait().catch((e) => e);
    const laterErr = later.wait().catch((e) => e);

    // A throwing invokeFunc task is captured by run(), so advancing does not throw.
    expect(() => vi.advanceTimersByTime(0)).not.toThrow();

    expect(await failedErr).toBe(boom); // the original value itself
    expect(await laterErr).toBe(ErrCanceled);
    expect(laterRan).toBe(false);
  });

  it("invokeFunc on a stopped dispatcher is canceled and never runs", async () => {
    const dispatcher = new RuntimeDispatcher();
    // Observe the failing task's wait() so its rejection is not left unhandled.
    dispatcher
      .invokeFunc(() => {
        throw new Error("boom");
      })
      .wait()
      .catch(() => {});
    vi.advanceTimersByTime(0); // run the throwing task -> stopped

    let ran = false;
    const task = dispatcher.invokeFunc(() => {
      ran = true;
    });
    await expect(task.wait()).rejects.toBe(ErrCanceled);
    vi.advanceTimersByTime(0);
    expect(ran).toBe(false);
  });

  it("a timer scheduled after shutdown can still be stopped", () => {
    const dispatcher = new RuntimeDispatcher();
    dispatcher
      .invokeFunc(() => {
        throw new Error("boom");
      })
      .wait()
      .catch(() => {});
    vi.advanceTimersByTime(0); // stopped

    let ran = false;
    const timer = dispatcher.afterFunc(1, () => {
      ran = true;
    });
    expect(timer.stop()).toBe(true);
    expect(timer.stop()).toBe(false);

    vi.advanceTimersByTime(1);
    expect(ran).toBe(false);
  });
});

describe("RuntimeDispatcher onError", () => {
  it("reports a throwing afterFunc callback instead of throwing uncaught", () => {
    const errors: unknown[] = [];
    const dispatcher = new RuntimeDispatcher({ onError: (e) => errors.push(e) });
    const boom = new Error("boom");

    dispatcher.afterFunc(10, () => {
      throw boom;
    });

    // With onError set, the throw is captured, not re-thrown to the timer driver.
    expect(() => vi.advanceTimersByTime(10)).not.toThrow();
    expect(errors).toEqual([boom]);
  });

  it("reports a throwing invokeFunc task in addition to its promise", async () => {
    const errors: unknown[] = [];
    const dispatcher = new RuntimeDispatcher({ onError: (e) => errors.push(e) });
    const boom = new Error("boom");

    const failed = dispatcher
      .invokeFunc(() => {
        throw boom;
      })
      .wait()
      .catch((e) => e);
    vi.advanceTimersByTime(0);

    expect(await failed).toBe(boom); // submitter channel
    expect(errors).toEqual([boom]); // operator channel
  });

  it("is called once, with the first thrown value", () => {
    const errors: unknown[] = [];
    const dispatcher = new RuntimeDispatcher({ onError: (e) => errors.push(e) });

    dispatcher.afterFunc(5, () => {
      throw new Error("first");
    });
    dispatcher.afterFunc(10, () => {
      throw new Error("second");
    });

    expect(() => vi.advanceTimersByTime(5)).not.toThrow();
    vi.advanceTimersByTime(10); // the dispatcher is stopped; the second never runs
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("first");
  });
});

describe("RuntimeDispatcher fire-and-forget safety", () => {
  it("a fire-and-forget invokeFunc that throws does not crash the process", async () => {
    vi.useRealTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const errors: unknown[] = [];
      const dispatcher = new RuntimeDispatcher({ onError: (e) => errors.push(e) });
      const boom = new Error("boom");

      // No wait(): the throwing task creates no Promise, so nothing rejects.
      dispatcher.invokeFunc(() => {
        throw boom;
      });
      await tick();
      await tick();

      expect(unhandled).toEqual([]); // no crash
      expect(errors).toEqual([boom]); // the operator channel still saw the stop
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });

  it("a fire-and-forget invokeFunc canceled at shutdown does not reject unhandled", async () => {
    vi.useRealTimers();
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", onUnhandled);
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    try {
      const dispatcher = new RuntimeDispatcher();
      // Observe the panic so only the cancel path is under test, then stop.
      dispatcher
        .invokeFunc(() => {
          throw new Error("boom");
        })
        .wait()
        .catch(() => {});
      dispatcher.invokeFunc(() => {}); // queued before the stop -> canceled, never waited
      await tick();

      dispatcher.invokeFunc(() => {}); // submitted after the stop -> canceled, never waited
      await tick();
      await tick();

      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("RuntimeDispatcher nested scheduling", () => {
  it("afterFunc from within callback", () => {
    const dispatcher = new RuntimeDispatcher();
    const results: number[] = [];

    dispatcher.afterFunc(10, () => {
      results.push(1);
      dispatcher.afterFunc(5, () => {
        results.push(2);
      });
    });

    vi.advanceTimersByTime(10);
    expect(results).toEqual([1]);
    vi.advanceTimersByTime(5);
    expect(results).toEqual([1, 2]);
  });
});
