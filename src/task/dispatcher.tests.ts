import { describe, it, expect } from "vitest";
import type { Dispatcher } from "./dispatcher.js";

type DispatcherTestHarness = {
  dispatcher: Dispatcher;
  advanceTo: (timeMs: number) => void;
};

export function dispatcherContractTests(
  name: string,
  factory: () => DispatcherTestHarness,
): void {
  describe(`${name}: Dispatcher contract`, () => {
    describe("afterFunc", () => {
      it("executes once after delay", () => {
        const { dispatcher, advanceTo } = factory();
        let count = 0;

        dispatcher.afterFunc(10, () => {
          count++;
        });

        advanceTo(10);
        expect(count).toBe(1);
        advanceTo(100);
        expect(count).toBe(1);
      });
    });

    describe("invokeFunc", () => {
      it("runs submitted functions serialized", () => {
        const { dispatcher, advanceTo } = factory();
        let counter = 0;
        let actual = 0;

        dispatcher.invokeFunc(() => {
          counter += 2;
          actual = counter;
        });
        dispatcher.invokeFunc(() => {
          counter += 3;
          actual = counter;
        });

        advanceTo(0);
        expect(actual).toBe(5);
        advanceTo(50);
        expect(actual).toBe(5);
      });

      it("the returned promise resolves after the function completes", async () => {
        const { dispatcher, advanceTo } = factory();
        let ran = false;

        const task = dispatcher.invokeFunc(() => {
          ran = true;
        });
        advanceTo(0);

        await expect(task.wait()).resolves.toBeUndefined();
        expect(ran).toBe(true);
      });

      // How a thrown value reaches the driver differs per dispatcher (a wrapped
      // throw vs an uncaught rejection), so those assertions live in each
      // dispatcher's own test file. The shared contract for wait() is that it
      // re-throws the original thrown value, covered there too.
    });

    describe("Timer.stop", () => {
      it("before execution", () => {
        const { dispatcher, advanceTo } = factory();
        let executed = false;

        const timer = dispatcher.afterFunc(10, () => {
          executed = true;
        });

        const stopped = timer.stop();
        expect(stopped).toBe(true);

        advanceTo(100);
        expect(executed).toBe(false);
      });

      it("after execution", () => {
        const { dispatcher, advanceTo } = factory();
        let executed = false;

        const timer = dispatcher.afterFunc(10, () => {
          executed = true;
        });

        advanceTo(10);
        expect(executed).toBe(true);

        const stopped = timer.stop();
        expect(stopped).toBe(false);
      });

      it("multiple calls", () => {
        const { dispatcher, advanceTo } = factory();
        let executed = false;

        const timer = dispatcher.afterFunc(20, () => {
          executed = true;
        });

        expect(timer.stop()).toBe(true);
        expect(timer.stop()).toBe(false);
        expect(timer.stop()).toBe(false);

        advanceTo(100);
        expect(executed).toBe(false);
      });
    });

    describe("multiple timers", () => {
      it("different delays execute in order", () => {
        const { dispatcher, advanceTo } = factory();
        const results: number[] = [];

        dispatcher.afterFunc(30, () => results.push(3));
        dispatcher.afterFunc(10, () => results.push(1));
        dispatcher.afterFunc(20, () => results.push(2));

        advanceTo(10);
        expect(results).toEqual([1]);
        advanceTo(20);
        expect(results).toEqual([1, 2]);
        advanceTo(30);
        expect(results).toEqual([1, 2, 3]);
      });

      it("same delay executes in FIFO order", () => {
        const { dispatcher, advanceTo } = factory();
        const results: string[] = [];

        dispatcher.afterFunc(10, () => results.push("A"));
        dispatcher.afterFunc(10, () => results.push("B"));
        dispatcher.afterFunc(10, () => results.push("C"));

        advanceTo(9);
        expect(results).toEqual([]);
        advanceTo(10);
        expect(results).toEqual(["A", "B", "C"]);
      });
    });

    describe("Timer.stop from callback", () => {
      it("stop another timer from within callback", () => {
        const { dispatcher, advanceTo } = factory();
        let targetExecuted = false;
        let stopResult = false;

        const target = dispatcher.afterFunc(500, () => {
          targetExecuted = true;
        });
        dispatcher.afterFunc(100, () => {
          stopResult = target.stop();
        });

        advanceTo(500);
        expect(stopResult).toBe(true);
        expect(targetExecuted).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("zero duration", () => {
        const { dispatcher, advanceTo } = factory();
        let executed = false;

        const timer = dispatcher.afterFunc(0, () => {
          executed = true;
        });
        expect(timer).toBeDefined();

        advanceTo(0);
        expect(executed).toBe(true);
      });

      it("negative duration", () => {
        const { dispatcher, advanceTo } = factory();
        let executed = false;

        const timer = dispatcher.afterFunc(-10, () => {
          executed = true;
        });
        expect(timer).toBeDefined();

        advanceTo(0);
        expect(executed).toBe(true);
      });

      it("max duration is cancellable", () => {
        const { dispatcher } = factory();
        const timer = dispatcher.afterFunc(Number.MAX_SAFE_INTEGER, () => {});
        expect(timer).toBeDefined();
        expect(timer.stop()).toBe(true);
      });
    });

    describe("selective stop", () => {
      it("stopping one timer does not affect others", () => {
        const { dispatcher, advanceTo } = factory();
        const results: string[] = [];

        dispatcher.afterFunc(10, () => results.push("A"));
        const timerB = dispatcher.afterFunc(20, () => results.push("B"));
        dispatcher.afterFunc(30, () => results.push("C"));

        timerB.stop();
        advanceTo(30);
        expect(results).toEqual(["A", "C"]);
      });
    });

    describe("timing boundary", () => {
      it("does not fire before delay elapses but fires at exact delay", () => {
        const { dispatcher, advanceTo } = factory();
        let executed = false;

        dispatcher.afterFunc(100, () => {
          executed = true;
        });

        advanceTo(99);
        expect(executed).toBe(false);

        advanceTo(100);
        expect(executed).toBe(true);
      });
    });

    describe("delayed registration", () => {
      it("afterFunc after time has advanced uses relative delay", () => {
        const { dispatcher, advanceTo } = factory();
        let executed = false;

        advanceTo(50);
        dispatcher.afterFunc(10, () => {
          executed = true;
        });

        advanceTo(59);
        expect(executed).toBe(false);
        advanceTo(60);
        expect(executed).toBe(true);
      });
    });

    describe("nested scheduling", () => {
      it("afterFunc from within callback", () => {
        const { dispatcher, advanceTo } = factory();
        const results: number[] = [];

        dispatcher.afterFunc(10, () => {
          results.push(1);
          dispatcher.afterFunc(20, () => {
            results.push(2);
          });
        });

        advanceTo(30);
        expect(results).toEqual([1, 2]);
      });
    });

    describe("error handling", () => {
      // afterFunc returns no Task to observe, so a throwing callback surfaces
      // during time advancement in both dispatchers. The exact value differs
      // (a wrapped throw vs the original), asserted in each dispatcher's tests.
      it("callback error propagates", () => {
        const { dispatcher, advanceTo } = factory();

        dispatcher.afterFunc(10, () => {
          throw new Error("test error");
        });

        expect(() => advanceTo(10)).toThrow();
      });

      it("null function", () => {
        const { dispatcher, advanceTo } = factory();

        dispatcher.afterFunc(5, null as unknown as () => void);
        expect(() => advanceTo(5)).toThrow();
      });
    });
  });
}
