import { describe, it, expect } from "vitest";
import { Machine, EntryMachine, AfterFuncMachine, AfterEntryMachine } from "./machine.js";
import { type State, Guarded } from "./state.js";
import type { Tracer } from "./option.js";
import { newGraph, type Edge } from "./graph";
import { EventLoopDispatcher } from "../task/eventloop";

// -- Test helpers --

interface TestValue {
  map: Record<string, unknown>;
}

type VMState = State<TestValue>;

class LaunchEvent {}

class TestState implements VMState {
  constructor(
    private n: string,
    private entryFn?: (m: EntryMachine<TestValue>, event: object) => void,
  ) {}
  name(): string {
    return this.n;
  }
  entry(machine: EntryMachine<TestValue>, event: object): void {
    this.entryFn?.(machine, event);
  }
}

function on(
  event: new (...args: any[]) => object,
  from: VMState | null,
  to: VMState,
): Edge<VMState> {
  return { from, event, to };
}

// -- Tests --

describe("Machine constructor", () => {
  it("throws with null graph", () => {
    expect(() => new Machine(null as any, { map: {} })).toThrow(
      "graph cannot be null",
    );
  });

  it("succeeds with valid parameters", () => {
    const graph = newGraph<VMState>(new TestState("initial"));
    const machine = new Machine(graph, { map: {} });
    expect(machine).toBeDefined();
  });
});

describe("Machine launch and stop", () => {
  it("complete lifecycle flow", () => {
    const initialState = new TestState("initial");
    const graph = newGraph<VMState>(initialState);
    const machine = new Machine(graph, { map: {} });

    // Before launch
    expect(() => machine.currentState()).toThrow("not launched");

    // Launch
    machine.launch(new LaunchEvent());
    expect(machine.currentState()).toBe(initialState);

    // Duplicate launch
    expect(() => machine.launch(new LaunchEvent())).toThrow("already launched");

    // Stop
    machine.stop();

    // After stop
    expect(() => machine.currentState()).toThrow("not launched");

    // Duplicate stop
    expect(() => machine.stop()).toThrow("already stopped");
  });
});

describe("Machine.trigger", () => {
  class StartEvent {}
  class NextEvent {}

  it("trigger behavior and validation", () => {
    const initialState = new TestState("initial");
    const nextState = new TestState("next");
    const graph = newGraph<VMState>(initialState, on(NextEvent, initialState, nextState));
    const machine = new Machine(graph, { map: {} });

    // Before launch
    expect(() => machine.trigger(new StartEvent())).toThrow("not launched");

    machine.launch(new LaunchEvent());

    // Nil event
    expect(() => machine.trigger(null as any)).toThrow("event cannot be null");

    // Invalid event
    expect(() => machine.trigger(new StartEvent())).toThrow("no transition found");

    // Valid transition
    expect(machine.trigger(new NextEvent())).toBeNull();
    expect(machine.currentState()).toBe(nextState);

    // No transition from next state
    expect(() => machine.trigger(new NextEvent())).toThrow("no transition found");
  });

  it("rejects plain objects as events", () => {
    const state = new TestState("initial");
    const graph = newGraph<VMState>(state);
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    expect(() => machine.trigger({})).toThrow("event must be an instance of a named class");
  });
});

describe("EntryMachine.value", () => {
  it("returns machine data", () => {
    const value: TestValue = { map: { key: "value", number: 123 } };
    let retrievedValue: TestValue | null = null;

    const testState = new TestState("test", (machine) => {
      retrievedValue = machine.value();
    });

    const graph = newGraph<VMState>(testState);
    const machine = new Machine(graph, value);
    machine.launch(new LaunchEvent());

    expect(retrievedValue).toBe(value);
  });
});

describe("EntryMachine.afterFunc", () => {
  class TimerEvent {}

  it("schedules timer correctly", () => {
    const dispatcher = new EventLoopDispatcher(0);
    let timerExecuted = false;

    const timerState = new TestState("timer", (machine) => {
      machine.afterFunc(dispatcher, 5000, () => {
        timerExecuted = true;
      });
    });

    const graph = newGraph<VMState>(timerState);
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    expect(timerExecuted).toBe(false);
    dispatcher.fastForward(5000);
    expect(timerExecuted).toBe(true);
  });

  it("timer cancellation on state transition", () => {
    const dispatcher = new EventLoopDispatcher(0);
    let timerExecuted = false;

    const timerState = new TestState("timer", (machine) => {
      machine.afterFunc(dispatcher, 10000, () => {
        timerExecuted = true;
      });
    });
    const nextState = new TestState("next");

    const graph = newGraph<VMState>(
      timerState,
      on(TimerEvent, timerState, nextState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    machine.trigger(new TimerEvent());
    dispatcher.fastForward(15000);
    expect(timerExecuted).toBe(false);
  });

  it("afterFunc from afterEntry callback fires", () => {
    const dispatcher = new EventLoopDispatcher(0);
    let timerExecuted = false;
    let afterEntryExecuted = false;

    const testState = new TestState("test", (machine) => {
      machine.afterEntry(() => {
        afterEntryExecuted = true;
        machine.afterFunc(dispatcher, 3000, () => {
          timerExecuted = true;
        });
      });
    });

    const graph = newGraph<VMState>(testState);
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    expect(afterEntryExecuted).toBe(true);
    expect(timerExecuted).toBe(false);
    dispatcher.fastForward(3000);
    expect(timerExecuted).toBe(true);
  });

  it("afterFunc from afterEntry callback cancelled on transition", () => {
    class NextEvent {}
    const dispatcher = new EventLoopDispatcher(0);
    let timerExecuted = false;

    const fromState = new TestState("from", (machine) => {
      machine.afterEntry(() => {
        machine.afterFunc(dispatcher, 5000, () => {
          timerExecuted = true;
        });
      });
    });
    const toState = new TestState("to");

    const graph = newGraph<VMState>(
      fromState,
      on(NextEvent, fromState, toState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    machine.trigger(new NextEvent());
    dispatcher.fastForward(10000);
    expect(timerExecuted).toBe(false);
  });

  it("afterFunc from onExit callback cancelled on transition (exit allows)", () => {
    class NextEvent {}
    const dispatcher = new EventLoopDispatcher(0);
    let timerExecuted = false;
    let exitExecuted = false;

    const fromState = new TestState("from", (machine) => {
      machine.onExit(() => {
        exitExecuted = true;
        machine.afterFunc(dispatcher, 3000, () => {
          timerExecuted = true;
        });
        return null;
      });
    });
    const toState = new TestState("to");

    const graph = newGraph<VMState>(
      fromState,
      on(NextEvent, fromState, toState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    machine.trigger(new NextEvent());
    expect(exitExecuted).toBe(true);
    expect(timerExecuted).toBe(false);

    dispatcher.fastForward(5000);
    // Timer should NOT fire because state changed
    expect(timerExecuted).toBe(false);
  });

  it("afterFunc from onExit callback fires when transition blocked", () => {
    class NextEvent {}
    const dispatcher = new EventLoopDispatcher(0);
    let timerExecuted = false;

    const fromState = new TestState("from", (machine) => {
      machine.onExit(() => {
        machine.afterFunc(dispatcher, 2000, () => {
          timerExecuted = true;
        });
        return new Guarded("transition blocked");
      });
    });
    const toState = new TestState("to");

    const graph = newGraph<VMState>(
      fromState,
      on(NextEvent, fromState, toState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    const err = machine.trigger(new NextEvent());
    expect(err).toBeInstanceOf(Guarded);
    expect(err!.reason).toBe("transition blocked");
    expect(machine.currentState()).toBe(fromState);

    dispatcher.fastForward(2000);
    expect(timerExecuted).toBe(true);
  });
});

describe("EntryMachine.afterEntry", () => {
  class TriggerEvent {}

  it("callback executes after entry", () => {
    const executionOrder: string[] = [];
    const initialState = new TestState("initial");
    const callbackState = new TestState("callback", (machine) => {
      executionOrder.push("entry");
      machine.afterEntry(() => {
        executionOrder.push("after-entry");
      });
    });

    const graph = newGraph<VMState>(
      initialState,
      on(TriggerEvent, initialState, callbackState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    machine.trigger(new TriggerEvent());
    expect(executionOrder).toEqual(["entry", "after-entry"]);
  });

  it("multiple afterEntry callbacks not allowed", () => {
    let entryExecuted = false;
    const initialState = new TestState("initial");
    const callbackState = new TestState("callback", (machine) => {
      machine.afterEntry(() => {});
      expect(() => machine.afterEntry(() => {})).toThrow(
        "callback for AfterEntry already registered",
      );
      entryExecuted = true;
    });

    const graph = newGraph<VMState>(
      initialState,
      on(TriggerEvent, initialState, callbackState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());
    machine.trigger(new TriggerEvent());
    expect(entryExecuted).toBe(true);
  });

  it("afterEntry from afterFunc callback throws", () => {
    const dispatcher = new EventLoopDispatcher(0);
    let afterFuncExecuted = false;

    const testState = new TestState("test", (machine) => {
      machine.afterFunc(dispatcher, 1000, () => {
        expect(() => machine.afterEntry(() => {})).toThrow(
          "AfterEntry is not callable here",
        );
        afterFuncExecuted = true;
      });
    });

    const graph = newGraph<VMState>(testState);
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    dispatcher.fastForward(1000);
    expect(afterFuncExecuted).toBe(true);
  });

  it("afterEntry chaining across states", () => {
    class ChainEvent {}
    class LoopEvent {}
    const executionOrder: string[] = [];
    const initialState = new TestState("initial");
    const stateA = new TestState("A", (machine) => {
      executionOrder.push("A-entry");
      machine.afterEntry((m) => {
        executionOrder.push("A-after");
        m.trigger(new ChainEvent());
      });
    });
    const stateB = new TestState("B", (machine) => {
      executionOrder.push("B-entry");
      machine.afterEntry(() => {
        executionOrder.push("B-after");
      });
    });

    const graph = newGraph<VMState>(
      initialState,
      on(LoopEvent, initialState, stateA),
      on(ChainEvent, stateA, stateB),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    machine.trigger(new LoopEvent());
    expect(executionOrder).toEqual(["A-entry", "A-after", "B-entry", "B-after"]);
  });
});

describe("EntryMachine.onExit", () => {
  class TransitionEvent {}

  it("callback executes before transition", () => {
    const executionOrder: string[] = [];
    const fromState = new TestState("from", (machine) => {
      executionOrder.push("from-entry");
      machine.onExit(() => {
        executionOrder.push("exit");
        return null;
      });
    });
    const toState = new TestState("to", () => {
      executionOrder.push("to-entry");
    });

    const graph = newGraph<VMState>(
      fromState,
      on(TransitionEvent, fromState, toState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    machine.trigger(new TransitionEvent());
    expect(executionOrder).toEqual(["from-entry", "exit", "to-entry"]);
  });

  it("guard condition prevents transition", () => {
    const fromState = new TestState("from", (machine) => {
      machine.onExit(() => new Guarded("transition blocked"));
    });
    const toState = new TestState("to");

    const graph = newGraph<VMState>(
      fromState,
      on(TransitionEvent, fromState, toState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    const err = machine.trigger(new TransitionEvent());
    expect(err).toBeInstanceOf(Guarded);
    expect(err!.reason).toBe("transition blocked");
    expect(machine.currentState()).toBe(fromState);
  });

  it("multiple onExit callbacks not allowed", () => {
    let entryExecuted = false;
    const exitState = new TestState("exit", (machine) => {
      machine.onExit(() => null);
      expect(() => machine.onExit(() => null)).toThrow(
        "exit callback already registered",
      );
      entryExecuted = true;
    });

    const graph = newGraph<VMState>(exitState);
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());
    expect(entryExecuted).toBe(true);
  });

  it("guard callback receives correct event", () => {
    class SpecialEvent {
      constructor(public readonly data: string) {}
    }
    let receivedEvent: object | null = null;

    const fromState = new TestState("from", (machine) => {
      machine.onExit((_, event) => {
        receivedEvent = event;
        return new Guarded("blocked");
      });
    });
    const toState = new TestState("to");

    const graph = newGraph<VMState>(
      fromState,
      on(SpecialEvent, fromState, toState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    const triggerEvent = new SpecialEvent("test");
    machine.trigger(triggerEvent);
    expect(receivedEvent).toBe(triggerEvent);
  });

  it("onExit from onExit callback throws", () => {
    class NextEvent {}
    let exitExecuted = false;

    const fromState = new TestState("from", (machine) => {
      machine.onExit(() => {
        expect(() => machine.onExit(() => null)).toThrow(
          "method is not callable here",
        );
        exitExecuted = true;
        return new Guarded("transition blocked");
      });
    });
    const toState = new TestState("to");

    const graph = newGraph<VMState>(
      fromState,
      on(NextEvent, fromState, toState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    machine.trigger(new NextEvent());
    expect(exitExecuted).toBe(true);
  });
});

describe("AfterFuncMachine", () => {
  class NextEvent {}

  it("value returns machine data", () => {
    const dispatcher = new EventLoopDispatcher(0);
    const value: TestValue = { map: { timer: "test" } };
    let afterFuncExecuted = false;

    const testState = new TestState("test", (machine) => {
      machine.afterFunc(dispatcher, 1000, (m) => {
        expect(m.value()).toBe(value);
        afterFuncExecuted = true;
      });
    });

    const graph = newGraph<VMState>(testState);
    const machine = new Machine(graph, value);
    machine.launch(new LaunchEvent());

    dispatcher.fastForward(1000);
    expect(afterFuncExecuted).toBe(true);
  });

  it("schedule timer from afterFunc callback", () => {
    const dispatcher = new EventLoopDispatcher(0);
    let firstExecuted = false;
    let secondExecuted = false;

    const testState = new TestState("test", (machine) => {
      machine.afterFunc(dispatcher, 2000, (m) => {
        firstExecuted = true;
        m.afterFunc(dispatcher, 1000, () => {
          secondExecuted = true;
        });
      });
    });

    const graph = newGraph<VMState>(testState);
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    dispatcher.fastForward(2000);
    expect(firstExecuted).toBe(true);
    expect(secondExecuted).toBe(false);

    dispatcher.fastForward(3000);
    expect(secondExecuted).toBe(true);
  });

  it("trigger from afterFunc callback", () => {
    const dispatcher = new EventLoopDispatcher(0);
    let triggerExecuted = false;

    const fromState = new TestState("from", (machine) => {
      machine.afterFunc(dispatcher, 1000, (m) => {
        expect(m.trigger(new NextEvent())).toBeNull();
        triggerExecuted = true;
      });
    });
    const toState = new TestState("to");

    const graph = newGraph<VMState>(
      fromState,
      on(NextEvent, fromState, toState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    expect(machine.currentState()).toBe(fromState);
    dispatcher.fastForward(1000);
    expect(triggerExecuted).toBe(true);
    expect(machine.currentState()).toBe(toState);
  });
});

describe("AfterEntryMachine", () => {
  class FirstEvent {}
  class SecondEvent {}

  it("value returns machine data", () => {
    class TriggerEvent {}
    const value: TestValue = { map: { after: "entry" } };
    let afterEntryExecuted = false;

    const initialState = new TestState("initial");
    const testState = new TestState("test", (machine) => {
      machine.afterEntry((m) => {
        expect(m.value()).toBe(value);
        afterEntryExecuted = true;
      });
    });

    const graph = newGraph<VMState>(
      initialState,
      on(TriggerEvent, initialState, testState),
    );
    const machine = new Machine(graph, value);
    machine.launch(new LaunchEvent());

    machine.trigger(new TriggerEvent());
    expect(afterEntryExecuted).toBe(true);
  });

  it("trigger from afterEntry callback", () => {
    let triggerExecuted = false;

    const initialState = new TestState("initial");
    const firstState = new TestState("first", (machine) => {
      machine.afterEntry((m) => {
        expect(m.trigger(new SecondEvent())).toBeNull();
        triggerExecuted = true;
      });
    });
    const secondState = new TestState("second");

    const graph = newGraph<VMState>(
      initialState,
      on(FirstEvent, initialState, firstState),
      on(SecondEvent, firstState, secondState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    machine.trigger(new FirstEvent());
    expect(triggerExecuted).toBe(true);
    expect(machine.currentState()).toBe(secondState);
  });
});

describe("ExitMachine.value", () => {
  class TransitionEvent {}

  it("returns machine data", () => {
    const value: TestValue = { map: { exit: "test" } };
    let exitExecuted = false;

    const fromState = new TestState("from", (machine) => {
      machine.onExit((m) => {
        expect(m.value()).toBe(value);
        exitExecuted = true;
        return null;
      });
    });
    const toState = new TestState("to");

    const graph = newGraph<VMState>(
      fromState,
      on(TransitionEvent, fromState, toState),
    );
    const machine = new Machine(graph, value);
    machine.launch(new LaunchEvent());

    machine.trigger(new TransitionEvent());
    expect(exitExecuted).toBe(true);
  });
});

describe("Machine.stop during exit", () => {
  class NextEvent {}

  it("stop in exit callback skips afterEntry", () => {
    let afterEntryExecuted = false;
    let toEntryExecuted = false;

    const fromState = new TestState("from", (entryMachine) => {
      entryMachine.onExit(() => {
        // Stop during exit
        machine.stop();
        return null;
      });
    });
    const toState = new TestState("to", (entryMachine) => {
      toEntryExecuted = true;
      entryMachine.afterEntry(() => {
        afterEntryExecuted = true;
      });
    });

    const graph = newGraph<VMState>(
      fromState,
      on(NextEvent, fromState, toState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    // trigger returns null (stop during exit is not an error)
    const err = machine.trigger(new NextEvent());
    expect(err).toBeNull();
    // toState.entry should NOT be called because machine was stopped in exit
    expect(toEntryExecuted).toBe(false);
    expect(afterEntryExecuted).toBe(false);
  });
});

describe("EntryMachine.afterEntry context violations", () => {
  it("afterEntry from afterEntry callback throws", () => {
    class TriggerEvent {}
    let afterEntryExecuted = false;
    const initialState = new TestState("initial");
    const testState = new TestState("test", (machine) => {
      machine.afterEntry(() => {
        expect(() => machine.afterEntry(() => {})).toThrow(
          "AfterEntry is not callable here",
        );
        afterEntryExecuted = true;
      });
    });

    const graph = newGraph<VMState>(
      initialState,
      on(TriggerEvent, initialState, testState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    machine.trigger(new TriggerEvent());
    expect(afterEntryExecuted).toBe(true);
  });

  it("afterEntry from onExit callback throws", () => {
    class TriggerEvent {}
    let exitExecuted = false;
    const fromState = new TestState("from", (machine) => {
      machine.onExit(() => {
        expect(() => machine.afterEntry(() => {})).toThrow(
          "AfterEntry is not callable here",
        );
        exitExecuted = true;
        return new Guarded("transition blocked");
      });
    });
    const toState = new TestState("to");

    const graph = newGraph<VMState>(
      fromState,
      on(TriggerEvent, fromState, toState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    machine.trigger(new TriggerEvent());
    expect(exitExecuted).toBe(true);
  });
});

describe("EntryMachine.onExit from other contexts", () => {
  it("onExit from afterFunc callback succeeds", () => {
    class NextEvent {}
    const dispatcher = new EventLoopDispatcher(0);
    let afterFuncExecuted = false;
    let exitExecuted = false;

    const testState = new TestState("test", (machine) => {
      machine.afterFunc(dispatcher, 1000, () => {
        machine.onExit(() => {
          exitExecuted = true;
          return null;
        });
        afterFuncExecuted = true;
      });
    });
    const nextState = new TestState("next");

    const graph = newGraph<VMState>(
      testState,
      on(NextEvent, testState, nextState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    dispatcher.fastForward(1000);
    expect(afterFuncExecuted).toBe(true);

    machine.trigger(new NextEvent());
    expect(exitExecuted).toBe(true);
    expect(machine.currentState()).toBe(nextState);
  });

  it("onExit from afterEntry callback succeeds", () => {
    class TriggerEvent {}
    class NextEvent {}
    let afterEntryExecuted = false;
    let exitExecuted = false;

    const initialState = new TestState("initial");
    const testState = new TestState("test", (machine) => {
      machine.afterEntry(() => {
        machine.onExit(() => {
          exitExecuted = true;
          return null;
        });
        afterEntryExecuted = true;
      });
    });
    const nextState = new TestState("next");

    const graph = newGraph<VMState>(
      initialState,
      on(TriggerEvent, initialState, testState),
      on(NextEvent, testState, nextState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    machine.trigger(new TriggerEvent());
    expect(afterEntryExecuted).toBe(true);

    machine.trigger(new NextEvent());
    expect(exitExecuted).toBe(true);
    expect(machine.currentState()).toBe(nextState);
  });
});

describe("AfterEntry infinite loop prevention", () => {
  it("self-loop via afterEntry executes many times without stack overflow", () => {
    class LoopEvent {}
    let callCount = 0;
    const maxIterations = 10000;

    const initialState = new TestState("initial");
    const loopState = new TestState("loop", (machine) => {
      callCount++;
      if (callCount < maxIterations) {
        machine.afterEntry((m) => {
          m.trigger(new LoopEvent());
        });
      }
    });

    const graph = newGraph<VMState>(
      initialState,
      on(LoopEvent, initialState, loopState),
      on(LoopEvent, loopState, loopState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    machine.trigger(new LoopEvent());
    expect(callCount).toBe(maxIterations);
  });
});

// Context violation tests.
// View classes all hold the same Machine instance, so creating a different view class
// from it and calling its methods tests context enforcement.
describe("Context violation tests", () => {
  function getMachine(view: unknown): Machine<VMState, TestValue> {
    return (view as { m: Machine<VMState, TestValue> }).m;
  }

  it("AfterFuncMachine.trigger from Entry context throws", () => {
    class NextEvent {}
    let entryExecuted = false;

    const testState = new TestState("test", (entryMachine) => {
      const access = getMachine(entryMachine);
      const afterFuncMachine = new AfterFuncMachine(access);
      expect(() => afterFuncMachine.trigger(new NextEvent())).toThrow(
        "method is not callable here",
      );
      entryExecuted = true;
    });
    const nextState = new TestState("next");

    const graph = newGraph<VMState>(
      testState,
      on(NextEvent, testState, nextState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());
    expect(entryExecuted).toBe(true);
  });

  it("AfterFuncMachine.trigger from AfterEntry context throws", () => {
    class TriggerEvent {}
    class SecondEvent {}
    let afterEntryExecuted = false;

    const initialState = new TestState("initial");
    const firstState = new TestState("first", (entryMachine) => {
      entryMachine.afterEntry((afterEntryMachine) => {
        const access = getMachine(afterEntryMachine);
        const afterFuncMachine = new AfterFuncMachine(access);
        expect(() => afterFuncMachine.trigger(new SecondEvent())).toThrow(
          "method is not callable here",
        );
        afterEntryExecuted = true;
      });
    });
    const secondState = new TestState("second");

    const graph = newGraph<VMState>(
      initialState,
      on(TriggerEvent, initialState, firstState),
      on(SecondEvent, firstState, secondState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    machine.trigger(new TriggerEvent());
    expect(afterEntryExecuted).toBe(true);
  });

  it("AfterFuncMachine.trigger from OnExit context throws", () => {
    class NextEvent {}
    class SecondEvent {}
    let exitExecuted = false;

    const fromState = new TestState("from", (entryMachine) => {
      entryMachine.onExit((exitMachine) => {
        const access = getMachine(exitMachine);
        const afterFuncMachine = new AfterFuncMachine(access);
        expect(() => afterFuncMachine.trigger(new SecondEvent())).toThrow(
          "method is not callable here",
        );
        exitExecuted = true;
        return null;
      });
    });
    const toState = new TestState("to");
    const secondState = new TestState("second");

    const graph = newGraph<VMState>(
      fromState,
      on(NextEvent, fromState, toState),
      on(SecondEvent, toState, secondState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    machine.trigger(new NextEvent());
    expect(exitExecuted).toBe(true);
  });

  it("AfterEntryMachine.trigger from Entry context throws", () => {
    class SecondEvent {}
    let entryExecuted = false;

    const firstState = new TestState("first", (entryMachine) => {
      const access = getMachine(entryMachine);
      const afterEntryMachine = new AfterEntryMachine(access);
      expect(() => afterEntryMachine.trigger(new SecondEvent())).toThrow(
        "method is not callable here",
      );
      entryExecuted = true;
    });
    const secondState = new TestState("second");

    const graph = newGraph<VMState>(
      firstState,
      on(SecondEvent, firstState, secondState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());
    expect(entryExecuted).toBe(true);
  });

  it("AfterEntryMachine.trigger from AfterFunc context throws", () => {
    class SecondEvent {}
    const dispatcher = new EventLoopDispatcher(0);
    let afterFuncExecuted = false;

    const firstState = new TestState("first", (entryMachine) => {
      entryMachine.afterFunc(dispatcher, 1000, (afterFuncMachine) => {
        const access = getMachine(afterFuncMachine);
        const afterEntryMachine = new AfterEntryMachine(access);
        expect(() => afterEntryMachine.trigger(new SecondEvent())).toThrow(
          "method is not callable here",
        );
        afterFuncExecuted = true;
      });
    });
    const secondState = new TestState("second");

    const graph = newGraph<VMState>(
      firstState,
      on(SecondEvent, firstState, secondState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    dispatcher.fastForward(1000);
    expect(afterFuncExecuted).toBe(true);
  });

  it("AfterEntryMachine.trigger from OnExit context throws", () => {
    class NextEvent {}
    class SecondEvent {}
    let exitExecuted = false;

    const fromState = new TestState("from", (entryMachine) => {
      entryMachine.onExit((exitMachine) => {
        const access = getMachine(exitMachine);
        const afterEntryMachine = new AfterEntryMachine(access);
        expect(() => afterEntryMachine.trigger(new SecondEvent())).toThrow(
          "method is not callable here",
        );
        exitExecuted = true;
        return null;
      });
    });
    const toState = new TestState("to");
    const secondState = new TestState("second");

    const graph = newGraph<VMState>(
      fromState,
      on(NextEvent, fromState, toState),
      on(SecondEvent, toState, secondState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    machine.trigger(new NextEvent());
    expect(exitExecuted).toBe(true);
  });
});

describe("EntryMachine.onExit from onExit callback", () => {
  it("onExit from onExit callback throws", () => {
    class NextEvent {}
    let exitExecuted = false;

    const fromState = new TestState("from", (machine) => {
      machine.onExit(() => {
        expect(() =>
          machine.onExit(() => null),
        ).toThrow("method is not callable here");
        exitExecuted = true;
        return new Guarded("transition blocked");
      });
    });
    const toState = new TestState("to");

    const graph = newGraph<VMState>(
      fromState,
      on(NextEvent, fromState, toState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    const err = machine.trigger(new NextEvent());
    expect(err?.reason).toBe("transition blocked");
    expect(exitExecuted).toBe(true);
  });
});

describe("async entry detection", () => {
  it("detects async entry function on launch", () => {
    const asyncState = {
      name() { return "async"; },
      entry() { return Promise.resolve(); },
    } as unknown as VMState;

    const graph = newGraph<VMState>(asyncState);
    const machine = new Machine(graph, { map: {} });

    expect(() => machine.launch(new LaunchEvent())).toThrow(
      "State.entry() must be synchronous (returned a Promise)",
    );
  });

  it("detects async entry function on trigger", () => {
    class GoEvent {}
    const initialState = new TestState("initial");
    const asyncState = {
      name() { return "async"; },
      entry() { return Promise.resolve(); },
    } as unknown as VMState;

    const graph = newGraph<VMState>(
      initialState,
      on(GoEvent, initialState, asyncState),
    );
    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());

    expect(() => machine.trigger(new GoEvent())).toThrow(
      "State.entry() must be synchronous (returned a Promise)",
    );
  });

  it("detects async generator entry function", () => {
    const asyncGenState = {
      name() { return "asyncgen"; },
      async *entry() { yield; },
    } as unknown as VMState;

    const graph = newGraph<VMState>(asyncGenState);
    const machine = new Machine(graph, { map: {} });

    expect(() => machine.launch(new LaunchEvent())).toThrow(
      "State.entry() must be synchronous (returned an AsyncGenerator)",
    );
  });
});

// -- Tracer tests --

interface TracerCall {
  from: VMState | null;
  to: VMState | null;
  event: object | null;
}

class RecordingTracer implements Tracer<VMState> {
  calls: TracerCall[] = [];
  trace(from: VMState | null, to: VMState | null, event: object | null): void {
    this.calls.push({ from, to, event });
  }
}

describe("Machine Tracer", () => {
  class NextEvent {}
  class BlockedEvent {}

  it("trace is called with (null, initial, null) on launch", () => {
    const initialState = new TestState("initial");
    const graph = newGraph<VMState>(initialState);

    const tracer = new RecordingTracer();
    const machine = new Machine(graph, { map: {} }, { tracer });
    machine.launch(new LaunchEvent());

    expect(tracer.calls).toHaveLength(1);
    expect(tracer.calls[0].from).toBeNull();
    expect(tracer.calls[0].to).toBe(initialState);
    expect(tracer.calls[0].event).toBeNull();
  });

  it("trace is called with (from, to, event) on transition", () => {
    const initialState = new TestState("initial");
    const nextState = new TestState("next");
    const graph = newGraph<VMState>(
      initialState,
      on(NextEvent, initialState, nextState),
    );

    const tracer = new RecordingTracer();
    const machine = new Machine(graph, { map: {} }, { tracer });
    machine.launch(new LaunchEvent());

    const event = new NextEvent();
    expect(machine.trigger(event)).toBeNull();

    expect(tracer.calls).toHaveLength(2);
    expect(tracer.calls[1].from).toBe(initialState);
    expect(tracer.calls[1].to).toBe(nextState);
    expect(tracer.calls[1].event).toBe(event);
  });

  it("trace is recorded before entry on launch, even if entry throws", () => {
    const panicState = new TestState("panic", () => {
      throw new Error("entry panic");
    });
    const graph = newGraph<VMState>(panicState);

    const tracer = new RecordingTracer();
    const machine = new Machine(graph, { map: {} }, { tracer });

    expect(() => machine.launch(new LaunchEvent())).toThrow("entry panic");

    expect(tracer.calls).toHaveLength(1);
    expect(tracer.calls[0].from).toBeNull();
    expect(tracer.calls[0].to).toBe(panicState);
  });

  it("trace is recorded before entry on trigger, even if entry throws", () => {
    const initialState = new TestState("initial");
    const panicState = new TestState("panic", () => {
      throw new Error("entry panic");
    });
    const graph = newGraph<VMState>(
      initialState,
      on(NextEvent, initialState, panicState),
    );

    const tracer = new RecordingTracer();
    const machine = new Machine(graph, { map: {} }, { tracer });
    machine.launch(new LaunchEvent());
    expect(tracer.calls).toHaveLength(1);

    const event = new NextEvent();
    expect(() => machine.trigger(event)).toThrow("entry panic");

    expect(tracer.calls).toHaveLength(2);
    expect(tracer.calls[1].from).toBe(initialState);
    expect(tracer.calls[1].to).toBe(panicState);
    expect(tracer.calls[1].event).toBe(event);
  });

  it("trace is not called when exit-action blocks with Guarded", () => {
    const nextState = new TestState("next");
    const initialState = new TestState("initial", (machine) => {
      machine.onExit(() => new Guarded("blocked"));
    });
    const graph = newGraph<VMState>(
      initialState,
      on(BlockedEvent, initialState, nextState),
    );

    const tracer = new RecordingTracer();
    const machine = new Machine(graph, { map: {} }, { tracer });
    machine.launch(new LaunchEvent());

    // Launch recorded one call; blocked transition must not add another.
    expect(tracer.calls).toHaveLength(1);

    const err = machine.trigger(new BlockedEvent());
    expect(err).toBeInstanceOf(Guarded);
    expect(tracer.calls).toHaveLength(1);
  });

  it("trace is called with (last, null, null) on stop", () => {
    const initialState = new TestState("initial");
    const nextState = new TestState("next");
    const graph = newGraph<VMState>(
      initialState,
      on(NextEvent, initialState, nextState),
    );

    const tracer = new RecordingTracer();
    const machine = new Machine(graph, { map: {} }, { tracer });
    machine.launch(new LaunchEvent());
    machine.trigger(new NextEvent());
    expect(tracer.calls).toHaveLength(2);

    machine.stop();

    expect(tracer.calls).toHaveLength(3);
    expect(tracer.calls[2].from).toBe(nextState);
    expect(tracer.calls[2].to).toBeNull();
    expect(tracer.calls[2].event).toBeNull();
  });

  it("trace records (from, from, event) on self-transition", () => {
    class SelfEvent {}

    const state = new TestState("loop");
    const graph = newGraph<VMState>(
      state,
      on(SelfEvent, state, state),
    );

    const tracer = new RecordingTracer();
    const machine = new Machine(graph, { map: {} }, { tracer });
    machine.launch(new LaunchEvent());

    const event = new SelfEvent();
    expect(machine.trigger(event)).toBeNull();

    expect(tracer.calls).toHaveLength(2);
    expect(tracer.calls[1].from).toBe(state);
    expect(tracer.calls[1].to).toBe(state);
    expect(tracer.calls[1].event).toBe(event);
  });

  it("stop from exit-action records stop-side trace but not destination-side", () => {
    const fromState = new TestState("from", (entryMachine) => {
      entryMachine.onExit(() => {
        machine.stop();
        return null;
      });
    });
    const toState = new TestState("to");
    const graph = newGraph<VMState>(
      fromState,
      on(NextEvent, fromState, toState),
    );

    const tracer = new RecordingTracer();
    const machine = new Machine(graph, { map: {} }, { tracer });
    machine.launch(new LaunchEvent());
    expect(tracer.calls).toHaveLength(1);

    // trigger during which exit-action calls stop()
    machine.trigger(new NextEvent());

    // stop-side trace (from, null, null) is recorded by stop()
    // destination-side trace (from, to, event) is NOT recorded
    expect(tracer.calls).toHaveLength(2);
    expect(tracer.calls[1].from).toBe(fromState);
    expect(tracer.calls[1].to).toBeNull();
    expect(tracer.calls[1].event).toBeNull();
  });

  it("machine without tracer does not throw", () => {
    const initialState = new TestState("initial");
    const nextState = new TestState("next");
    const graph = newGraph<VMState>(
      initialState,
      on(NextEvent, initialState, nextState),
    );

    const machine = new Machine(graph, { map: {} });
    machine.launch(new LaunchEvent());
    machine.trigger(new NextEvent());
    machine.stop();
  });
});
