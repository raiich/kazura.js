import { describe, it, expect } from "vitest";
import {
  newGraph,
  on,
  Machine,
  Guarded,
  type State,
  type EntryMachine,
} from ".";
import type { Dispatcher } from "../task";
import { EventLoopDispatcher } from "../task/eventloop";

// -- Vending machine example (from design spec) --

class CoinEvent {
  constructor(public readonly value: number) {}
}
class ButtonEvent {
  constructor(public readonly item: string) {}
}
class DoneEvent {
  constructor(public readonly reason: string) {}
}
class StartEvent {}

class VendingMachine {
  coins = 0;
  constructor(public readonly dispatcher: Dispatcher) {}
}

type VMState = State<VendingMachine>;

class InitialState implements VMState {
  name() {
    return "InitialState";
  }
  entry(machine: EntryMachine<VendingMachine>): void {
    machine.value().coins = 0;
  }
}

class WaitingState implements VMState {
  name() {
    return "WaitingState";
  }
  entry(machine: EntryMachine<VendingMachine>, event: object): void {
    const vm = machine.value();
    if (event instanceof CoinEvent) {
      vm.coins++;
    }

    machine.onExit((_m, evt) => {
      if (evt instanceof ButtonEvent) {
        if (evt.item === "coffee" && vm.coins < 2) {
          return new Guarded(
            `2 coin(s) for ${evt.item}, but ${vm.coins}`,
          );
        }
      }
      return null;
    });

    machine.afterFunc(vm.dispatcher, 10_000, (m) => {
      m.trigger(new DoneEvent("timeout"));
    });
  }
}

class PouringState implements VMState {
  name() {
    return "PouringState";
  }
  entry(machine: EntryMachine<VendingMachine>): void {
    machine.afterEntry((m) => {
      m.trigger(new DoneEvent("done"));
    });
  }
}

describe("Vending machine integration test", () => {
  it("coin → button → pour → done cycle", () => {
    const dispatcher = new EventLoopDispatcher(0);
    const vm = new VendingMachine(dispatcher);
    const initial = new InitialState();
    const waiting = new WaitingState();
    const pouring = new PouringState();

    const graph = newGraph<VMState>(
      initial,
      on(CoinEvent, initial, waiting),
      on(CoinEvent, waiting, waiting),
      on(DoneEvent, waiting, initial),
      on(ButtonEvent, waiting, pouring),
      on(DoneEvent, pouring, initial),
    );

    const machine = new Machine(graph, vm);
    machine.launch(new StartEvent());

    expect(machine.currentState()).toBe(initial);
    expect(vm.coins).toBe(0);

    // Insert first coin
    expect(machine.trigger(new CoinEvent(1))).toBeNull();
    expect(machine.currentState()).toBe(waiting);
    expect(vm.coins).toBe(1);

    // Try to buy coffee with 1 coin (guarded)
    const err = machine.trigger(new ButtonEvent("coffee"));
    expect(err).toBeInstanceOf(Guarded);
    expect(err!.reason).toContain("2 coin(s) for coffee, but 1");
    expect(machine.currentState()).toBe(waiting);

    // Insert second coin
    expect(machine.trigger(new CoinEvent(1))).toBeNull();
    expect(vm.coins).toBe(2);

    // Buy coffee (should succeed)
    expect(machine.trigger(new ButtonEvent("coffee"))).toBeNull();
    // PouringState.entry calls afterEntry which triggers DoneEvent
    // → transitions back to InitialState
    expect(machine.currentState()).toBe(initial);
    expect(vm.coins).toBe(0);
  });

  it("timeout returns to initial", () => {
    const dispatcher = new EventLoopDispatcher(0);
    const vm = new VendingMachine(dispatcher);
    const initial = new InitialState();
    const waiting = new WaitingState();
    const pouring = new PouringState();

    const graph = newGraph<VMState>(
      initial,
      on(CoinEvent, initial, waiting),
      on(CoinEvent, waiting, waiting),
      on(DoneEvent, waiting, initial),
      on(ButtonEvent, waiting, pouring),
      on(DoneEvent, pouring, initial),
    );

    const machine = new Machine(graph, vm);
    machine.launch(new StartEvent());

    // Insert coin
    machine.trigger(new CoinEvent(1));
    expect(machine.currentState()).toBe(waiting);

    // Fast forward past timeout
    dispatcher.fastForward(10_000);
    expect(machine.currentState()).toBe(initial);
    expect(vm.coins).toBe(0);
  });

  it("timeout cancelled on state transition", () => {
    const dispatcher = new EventLoopDispatcher(0);
    const vm = new VendingMachine(dispatcher);
    const initial = new InitialState();
    const waiting = new WaitingState();
    const pouring = new PouringState();

    const graph = newGraph<VMState>(
      initial,
      on(CoinEvent, initial, waiting),
      on(CoinEvent, waiting, waiting),
      on(DoneEvent, waiting, initial),
      on(ButtonEvent, waiting, pouring),
      on(DoneEvent, pouring, initial),
    );

    const machine = new Machine(graph, vm);
    machine.launch(new StartEvent());

    // Insert coins and buy
    machine.trigger(new CoinEvent(1));
    machine.trigger(new CoinEvent(1));
    machine.trigger(new ButtonEvent("coffee"));
    expect(machine.currentState()).toBe(initial);

    // Fast-forward — timeout should not fire
    dispatcher.fastForward(20_000);
    expect(machine.currentState()).toBe(initial);
  });
});

describe("on function", () => {
  it("creates edge with correct fields", () => {
    class MyState {
      name() {
        return "MyState";
      }
    }
    class MyEvent {}

    const from = new MyState();
    const to = new MyState();
    // This would fail because same constructor, but shows the API
    const edge = on(MyEvent, from, to);
    expect(edge.from).toBe(from);
    expect(edge.event).toBe(MyEvent);
    expect(edge.to).toBe(to);
  });

  it("creates wildcard edge with null from", () => {
    class MyState {}
    class MyEvent {}

    const to = new MyState();
    const edge = on(MyEvent, null, to);
    expect(edge.from).toBeNull();
    expect(edge.event).toBe(MyEvent);
    expect(edge.to).toBe(to);
  });
});

describe("event safety checks", () => {
  it("rejects plain object as event", () => {
    class S implements State<null> {
      entry(): void {}
    }
    const graph = newGraph<VMState>(new S() as any);
    const machine = new Machine(graph, null as any);
    machine.launch(new StartEvent());

    expect(() => machine.trigger({})).toThrow(
      "event must be an instance of a named class",
    );
  });

  it("rejects Object.create(null) as event", () => {
    class S implements State<null> {
      entry(): void {}
    }
    const graph = newGraph<VMState>(new S() as any);
    const machine = new Machine(graph, null as any);
    machine.launch(new StartEvent());

    expect(() => machine.trigger(Object.create(null))).toThrow(
      "event must be an instance of a named class",
    );
  });
});
