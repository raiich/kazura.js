import { describe, it, expect } from "vitest";
import { Manager } from "./manager.js";
import { EventLoopDispatcher } from "../task/eventloop";

describe("Manager", () => {
  it("get/set", () => {
    const manager = new Manager<string>();
    expect(manager.get()).toBe(null);

    manager.set("state1");
    expect(manager.get()).toBe("state1");

    manager.set("state2");
    expect(manager.get()).toBe("state2");

    manager.set(null);
    expect(manager.get()).toBe(null);
  });

  it("afterFunc fires when state unchanged", () => {
    const manager = new Manager<string>();
    const dispatcher = new EventLoopDispatcher(0);
    let fired = false;

    manager.set("state1");
    manager.afterFunc(dispatcher, 100, () => {
      fired = true;
    });

    expect(manager.activeTimerCount()).toBe(1);
    dispatcher.fastForward(100);
    expect(fired).toBe(true);
    expect(manager.activeTimerCount()).toBe(0);
  });

  it("afterFunc cancelled on state change", () => {
    const manager = new Manager<string>();
    const dispatcher = new EventLoopDispatcher(0);
    let fired = false;

    manager.set("state1");
    manager.afterFunc(dispatcher, 100, () => {
      fired = true;
    });

    expect(manager.activeTimerCount()).toBe(1);

    // Change state before timer fires
    manager.set("state2");

    expect(manager.activeTimerCount()).toBe(0);
    dispatcher.fastForward(200);
    expect(fired).toBe(false);
  });

  it("multiple timers cancelled on state change", () => {
    const manager = new Manager<string>();
    const dispatcher = new EventLoopDispatcher(0);
    let count = 0;

    manager.set("state1");
    manager.afterFunc(dispatcher, 100, () => count++);
    manager.afterFunc(dispatcher, 200, () => count++);
    manager.afterFunc(dispatcher, 300, () => count++);

    expect(manager.activeTimerCount()).toBe(3);
    manager.set("state2");
    expect(manager.activeTimerCount()).toBe(0);

    dispatcher.fastForward(400);
    expect(count).toBe(0);
  });

  it("multiple timers execute in order", () => {
    const manager = new Manager<string>();
    const dispatcher = new EventLoopDispatcher(0);
    const execOrder: number[] = [];

    manager.set("state1");
    manager.afterFunc(dispatcher, 30, () => execOrder.push(0));
    manager.afterFunc(dispatcher, 10, () => execOrder.push(1));
    manager.afterFunc(dispatcher, 20, () => execOrder.push(2));

    expect(manager.activeTimerCount()).toBe(3);

    dispatcher.fastForward(10);
    expect(execOrder).toEqual([1]);
    expect(manager.activeTimerCount()).toBe(2);

    dispatcher.fastForward(20);
    expect(execOrder).toEqual([1, 2]);
    expect(manager.activeTimerCount()).toBe(1);

    dispatcher.fastForward(30);
    expect(execOrder).toEqual([1, 2, 0]);
    expect(manager.activeTimerCount()).toBe(0);
  });

  it("timers execute during stable state periods", () => {
    const manager = new Manager<string>();
    const dispatcher = new EventLoopDispatcher(0);
    const executionLog: string[] = [];

    manager.set("initial");
    manager.afterFunc(dispatcher, 30, () => executionLog.push("timer1_in_initial"));
    manager.afterFunc(dispatcher, 40, () => executionLog.push("timer2_in_initial"));

    // Execute first timer
    dispatcher.fastForward(30);

    // Change state after first timer but before second
    manager.set("changed");
    manager.afterFunc(dispatcher, 50, () => executionLog.push("timer3_in_changed"));

    // Execute remaining timers
    dispatcher.fastForward(80);

    // Only timer1 and timer3 should execute
    expect(executionLog).toEqual(["timer1_in_initial", "timer3_in_changed"]);
    expect(manager.activeTimerCount()).toBe(0);
  });

  it("zero duration timer", () => {
    const manager = new Manager<string>();
    const dispatcher = new EventLoopDispatcher(0);
    let executed = false;

    manager.afterFunc(dispatcher, 0, () => { executed = true; });
    expect(manager.activeTimerCount()).toBe(1);

    dispatcher.fastForward(0);
    expect(executed).toBe(true);
    expect(manager.activeTimerCount()).toBe(0);
  });

  it("large number of timers", () => {
    const manager = new Manager<string>();
    const dispatcher = new EventLoopDispatcher(0);
    let executedCount = 0;

    manager.set("state1");
    for (let i = 0; i < 1000; i++) {
      manager.afterFunc(dispatcher, 100, () => { executedCount++; });
    }

    expect(manager.activeTimerCount()).toBe(1000);
    dispatcher.fastForward(100);
    expect(executedCount).toBe(1000);
    expect(manager.activeTimerCount()).toBe(0);
  });

  it("rapid state transitions", () => {
    const manager = new Manager<string>();
    const dispatcher = new EventLoopDispatcher(0);
    const executedStates: string[] = [];

    manager.afterFunc(dispatcher, 50, () => {
      executedStates.push(manager.get()!);
    });

    manager.set("1");
    manager.set("2");
    manager.set("3");

    manager.afterFunc(dispatcher, 25, () => {
      executedStates.push(manager.get()!);
    });

    dispatcher.fastForward(100);
    expect(executedStates).toEqual(["3"]);
    expect(manager.activeTimerCount()).toBe(0);
  });

  it("nested afterFunc in callback", () => {
    const manager = new Manager<string>();
    const dispatcher = new EventLoopDispatcher(0);
    const executionOrder: string[] = [];

    manager.set("initial");
    manager.afterFunc(dispatcher, 50, () => {
      executionOrder.push("first_callback");
      manager.afterFunc(dispatcher, 30, () => {
        executionOrder.push("nested_callback");
      });
    });

    dispatcher.fastForward(50);
    expect(executionOrder).toEqual(["first_callback"]);
    expect(manager.activeTimerCount()).toBe(1);

    dispatcher.fastForward(80);
    expect(executionOrder).toEqual(["first_callback", "nested_callback"]);
    expect(manager.activeTimerCount()).toBe(0);
  });

  it("state change in callback cancels other pending timers", () => {
    const manager = new Manager<string>();
    const dispatcher = new EventLoopDispatcher(0);
    const executed: string[] = [];

    manager.set("initial");
    manager.afterFunc(dispatcher, 50, () => {
      executed.push("timer1");
      manager.set("changed");
    });
    manager.afterFunc(dispatcher, 60, () => {
      executed.push("timer2");
    });

    dispatcher.fastForward(50);
    dispatcher.fastForward(100);

    expect(executed).toEqual(["timer1"]);
    expect(manager.get()).toBe("changed");
    expect(manager.activeTimerCount()).toBe(0);
  });
});
