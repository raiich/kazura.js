import { describe, it, expect } from "vitest";
import { EventLoopDispatcher } from "../eventloop";
import { PausableDispatcher } from "./dispatcher.js";
import { Manager } from "../../state/manager.js";
import { dispatcherContractTests } from "../dispatcher.tests.js";

function setup() {
  let currentTime = 0;
  const base = new EventLoopDispatcher(0);
  const dispatcher = new PausableDispatcher(base, () => currentTime);

  function advance(to: number) {
    currentTime = to;
    base.fastForward(to);
  }

  return { base, dispatcher, advance, get currentTime() { return currentTime; }, set currentTime(v: number) { currentTime = v; } };
}

dispatcherContractTests("PausableDispatcher", () => {
  let currentTime = 0;
  const base = new EventLoopDispatcher(0);
  const d = new PausableDispatcher(base, () => currentTime);
  return {
    dispatcher: d,
    advanceTo: (t) => {
      currentTime = t;
      base.fastForward(t);
    },
  };
});

describe("pause()", () => {
  it("active timers do not fire while paused", () => {
    const { dispatcher, advance } = setup();
    let executed = false;

    dispatcher.afterFunc(100, () => { executed = true; });
    advance(30);
    dispatcher.pause();

    advance(200);
    expect(executed).toBe(false);
  });

  it("invokeFunc is not buffered during pause", async () => {
    const { dispatcher, advance } = setup();
    dispatcher.pause();

    let executed = false;
    const task = dispatcher.invokeFunc(() => { executed = true; });
    advance(0);

    expect(executed).toBe(true);
    await expect(task.wait()).resolves.toBeUndefined();
  });

  it("afterFunc during pause is buffered", () => {
    const { dispatcher, advance } = setup();
    let executed = false;

    dispatcher.pause();
    dispatcher.afterFunc(50, () => { executed = true; });
    dispatcher.resume();

    advance(50);
    expect(executed).toBe(true);
  });

  it("buffered afterFunc does not fire before resume", () => {
    const { dispatcher, advance } = setup();
    let executed = false;

    dispatcher.pause();
    dispatcher.afterFunc(50, () => { executed = true; });

    advance(100);
    expect(executed).toBe(false);
  });

  it("already fired timers are unaffected by pause", () => {
    const { dispatcher, advance } = setup();
    let f1Executed = false;
    let f2Executed = false;

    dispatcher.afterFunc(30, () => { f1Executed = true; });
    dispatcher.afterFunc(100, () => { f2Executed = true; });

    advance(30);
    expect(f1Executed).toBe(true);

    dispatcher.pause();
    advance(200);
    expect(f2Executed).toBe(false);
  });

  it("double pause throws", () => {
    const { dispatcher } = setup();

    dispatcher.pause();
    expect(() => dispatcher.pause()).toThrow();
  });

  it("resume without pause throws", () => {
    const { dispatcher } = setup();

    expect(() => dispatcher.resume()).toThrow();
  });
});

describe("resume() and remaining time", () => {
  it("reschedules with remaining time", () => {
    const { dispatcher, advance } = setup();
    let executed = false;

    dispatcher.afterFunc(100, () => { executed = true; });
    advance(30);
    dispatcher.pause();
    dispatcher.resume(); // resume at 30

    advance(30 + 70); // remaining 70ms
    expect(executed).toBe(true);
  });

  it("does not fire before remaining time elapses", () => {
    const { dispatcher, advance } = setup();
    let executed = false;

    dispatcher.afterFunc(100, () => { executed = true; });
    advance(30);
    dispatcher.pause();
    dispatcher.resume(); // resume at 30

    advance(30 + 69);
    expect(executed).toBe(false);
  });

  it("buffered task reschedules with original delayMs", () => {
    const { dispatcher, advance } = setup();
    let executed = false;

    dispatcher.pause();
    dispatcher.afterFunc(50, () => { executed = true; });
    dispatcher.resume(); // resume at 0

    advance(50);
    expect(executed).toBe(true);
  });

  it("remaining clamped to 0", () => {
    const s = setup();
    let executed = false;

    s.dispatcher.afterFunc(100, () => { executed = true; });
    // Advance only currentTime, leave base unchanged
    s.currentTime = 200;
    s.dispatcher.pause();
    s.dispatcher.resume(); // resume at 200, remaining = 0

    s.advance(200); // remaining=0, fires immediately
    expect(executed).toBe(true);
  });

  it("pause duration does not affect remaining time", () => {
    for (const pauseDuration of [70, 9970]) {
      const { dispatcher, advance } = setup();
      let executed = false;

      dispatcher.afterFunc(100, () => { executed = true; });
      advance(30);
      dispatcher.pause();

      advance(30 + pauseDuration);
      dispatcher.resume();

      advance(30 + pauseDuration + 70); // remaining = 100 - 30 = 70
      expect(executed).toBe(true);
    }
  });

  it("multiple timers have correct individual remaining times", () => {
    const { dispatcher, advance } = setup();
    const results: string[] = [];

    dispatcher.afterFunc(100, () => results.push("A"));
    dispatcher.afterFunc(200, () => results.push("B"));
    advance(50);
    dispatcher.pause();
    dispatcher.resume(); // resume at 50

    advance(50 + 150); // A: remaining 50, B: remaining 150
    expect(results).toEqual(["A", "B"]);
  });
});

describe("Timer.stop() interaction with pause", () => {
  it("stop() during pause removes from buffer", () => {
    const { dispatcher, advance } = setup();
    let executed = false;

    const timer = dispatcher.afterFunc(100, () => { executed = true; });
    dispatcher.pause();

    expect(timer.stop()).toBe(true);
    dispatcher.resume();
    advance(200);
    expect(executed).toBe(false);
  });

  it("stop() on timer created during pause", () => {
    const { dispatcher, advance } = setup();
    let executed = false;

    dispatcher.pause();
    const timer = dispatcher.afterFunc(50, () => { executed = true; });

    expect(timer.stop()).toBe(true);
    dispatcher.resume();
    advance(100);
    expect(executed).toBe(false);
  });

  it("double stop() returns false", () => {
    const { dispatcher } = setup();

    const timer = dispatcher.afterFunc(100, () => {});
    dispatcher.pause();

    expect(timer.stop()).toBe(true);
    expect(timer.stop()).toBe(false);
  });
});

describe("multiple pause/resume cycles", () => {
  it("pause → resume → pause → resume fires correctly", () => {
    const { dispatcher, advance } = setup();
    let executed = false;

    dispatcher.afterFunc(200, () => { executed = true; });
    advance(50);             // 50ms elapsed
    dispatcher.pause();      // remaining 150ms
    dispatcher.resume();     // resume1 at 50
    advance(50 + 50);        // 50ms elapsed (remaining 100ms)
    dispatcher.pause();      // remaining 100ms
    dispatcher.resume();     // resume2 at 100
    advance(100 + 100);      // remaining 100ms elapsed

    expect(executed).toBe(true);
  });

  it("does not fire at intermediate point", () => {
    const { dispatcher, advance } = setup();
    let executed = false;

    dispatcher.afterFunc(200, () => { executed = true; });
    advance(50);
    dispatcher.pause();
    dispatcher.resume();     // resume1 at 50
    advance(50 + 50);        // 50ms elapsed
    dispatcher.pause();      // remaining 100ms
    dispatcher.resume();     // resume2 at 100

    advance(100 + 99);       // 1ms before remaining
    expect(executed).toBe(false);
  });
});

describe("edge cases", () => {
  it("pause and resume with no timers", () => {
    const { dispatcher } = setup();
    dispatcher.pause();
    dispatcher.resume();
  });

  it("zero duration pause resume", () => {
    const { dispatcher, advance } = setup();
    let executed = false;

    dispatcher.afterFunc(0, () => { executed = true; });
    dispatcher.pause();

    advance(50);
    dispatcher.resume();
    advance(50); // remaining=0, fires immediately
    expect(executed).toBe(true);
  });

  it("negative duration pause resume", () => {
    const { dispatcher, advance } = setup();
    let executed = false;

    dispatcher.afterFunc(-10, () => { executed = true; });
    dispatcher.pause();

    advance(50);
    dispatcher.resume();
    advance(50); // remaining=0 (clamped), fires immediately
    expect(executed).toBe(true);
  });
});

describe("rapid toggle", () => {
  it("resume → pause → resume preserves correct remaining", () => {
    const { dispatcher, advance } = setup();
    let executed = false;

    dispatcher.afterFunc(1000, () => { executed = true; });

    // 300ms elapsed, remaining = 700ms
    advance(300);
    dispatcher.pause();

    // Resume immediately and pause again (0ms between)
    dispatcher.resume();
    dispatcher.pause();

    // Resume, remaining should still be 700ms
    dispatcher.resume();

    advance(300 + 699);
    expect(executed).toBe(false);

    advance(300 + 700);
    expect(executed).toBe(true);
  });
});

describe("pause callback race", () => {
  it("pause after timer fires at exact time", () => {
    const { dispatcher, advance } = setup();
    let executed = false;

    dispatcher.afterFunc(100, () => { executed = true; });
    advance(100); // timer fires
    expect(executed).toBe(true);

    dispatcher.pause();
    expect(dispatcher.trackedCount()).toBe(0);
  });

  it("pause just before timer fires", () => {
    const { dispatcher, advance } = setup();
    let executed = false;

    dispatcher.afterFunc(100, () => { executed = true; });
    advance(99);
    expect(executed).toBe(false);

    dispatcher.pause();
    expect(dispatcher.trackedCount()).toBe(1);

    // Verify timer resumes correctly with remaining 1ms
    dispatcher.resume(); // resume at 99
    advance(99 + 1);
    expect(executed).toBe(true);
  });
});

describe("tracked cleanup", () => {
  it("tracked is empty after all timers fire", () => {
    const { dispatcher, advance } = setup();
    const numTimers = 1000;

    for (let i = 0; i < numTimers; i++) {
      dispatcher.afterFunc(10, () => {});
    }

    advance(10);
    expect(dispatcher.trackedCount()).toBe(0);

    // Pause on empty tracked should succeed
    dispatcher.pause();
    expect(dispatcher.trackedCount()).toBe(0);
  });
});

describe("callback behavior", () => {
  it("afterFunc in callback delegates to base when running", () => {
    const { dispatcher, advance } = setup();
    let nested = false;

    dispatcher.afterFunc(10, () => {
      dispatcher.afterFunc(20, () => { nested = true; });
    });

    advance(10);
    expect(nested).toBe(false);

    advance(30);
    expect(nested).toBe(true);
  });

  it("pause in callback buffers subsequent afterFunc", () => {
    const { dispatcher, advance } = setup();
    let buffered = false;

    dispatcher.afterFunc(10, () => {
      dispatcher.pause();
      dispatcher.afterFunc(20, () => { buffered = true; });
    });

    advance(10);
    expect(buffered).toBe(false);

    dispatcher.resume(); // resume at 10
    advance(10 + 20);
    expect(buffered).toBe(true);
  });
});

describe("Manager integration", () => {
  it("state change during pause cancels timer", () => {
    const { dispatcher, advance } = setup();
    const manager = new Manager<string>();
    let executed = false;

    manager.set("state1");
    manager.afterFunc(dispatcher, 100, () => { executed = true; });
    dispatcher.pause();

    manager.set("state2"); // Timer.stop() removes from tracked
    dispatcher.resume();
    advance(200);
    expect(executed).toBe(false);
  });
});
