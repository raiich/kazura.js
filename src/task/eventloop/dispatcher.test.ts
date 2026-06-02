import { describe, it, expect } from "vitest";
import { EventLoopDispatcher } from "./dispatcher.js";
import { dispatcherContractTests } from "../dispatcher.tests.js";

dispatcherContractTests("EventLoopDispatcher", () => {
  const d = new EventLoopDispatcher(0);
  return { dispatcher: d, advanceTo: (t) => d.fastForward(t) };
});

describe("EventLoopDispatcher.fastForward", () => {
  it("throws on backward time", () => {
    const dispatcher = new EventLoopDispatcher(0);
    expect(() => dispatcher.fastForward(-1)).toThrow("unprocessable time");
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

describe("EventLoopDispatcher error handling", () => {
  it("subsequent tasks do not execute after error", () => {
    const dispatcher = new EventLoopDispatcher(0);
    let subsequent = false;

    dispatcher.afterFunc(100, () => {
      throw new Error("boom");
    });
    dispatcher.afterFunc(200, () => {
      subsequent = true;
    });

    expect(() => dispatcher.fastForward(200)).toThrow("boom");
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

    expect(() => dispatcher.fastForward(10)).toThrow("first error");
  });
});
