import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { RuntimeDispatcher } from "./dispatcher.js";
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
  it("subsequent tasks still execute after error in earlier task", () => {
    const dispatcher = new RuntimeDispatcher();
    let secondExecuted = false;

    dispatcher.afterFunc(10, () => {
      throw new Error("first error");
    });
    dispatcher.afterFunc(20, () => {
      secondExecuted = true;
    });

    expect(() => vi.advanceTimersByTime(10)).toThrow("first error");
    vi.advanceTimersByTime(10);
    expect(secondExecuted).toBe(true);
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
