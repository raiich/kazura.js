// Vending machine implementation using kazura state machine.
// This example showcases state transitions, guard conditions, timeouts, and event handling.

import {
  newGraph,
  on,
  Machine,
  Guarded,
  type State,
  type Tracer,
  type EntryMachine,
  type ExitMachine,
  type AfterEntryMachine,
  type AfterFuncMachine,
} from "../../src/state";
import { dump } from "../../src/state/graph";
import type { Dispatcher } from "../../src/task";
import { EventLoopDispatcher } from "../../src/task/eventloop";

// -- Logger (replaceable for testing) --

export let log = (...args: unknown[]) => {
  console.log(...args);
};

export function setLogger(fn: (...args: unknown[]) => void) {
  log = fn;
}

function logKV(msg: string, ...kvs: [string, unknown][]) {
  const parts = [msg];
  for (const [k, v] of kvs) {
    parts.push(`${k}=${v}`);
  }
  log(parts.join(" "));
}

// -- Events --

class CoinEvent {
  constructor(public readonly value: number) {}
  toString() {
    return String(this.value);
  }
}

class ButtonEvent {
  constructor(public readonly item: string) {}
  toString() {
    return this.item;
  }
}

class DoneEvent {
  constructor(public readonly reason: string) {}
  toString() {
    return this.reason;
  }
}

// -- State data --

class VendingMachine {
  coins = 0;
  constructor(public readonly dispatcher: Dispatcher) {}
}

type VMState = State<VendingMachine>;

// -- States --

class StartEvent {}

class InitialState implements VMState {
  name() {
    return "InitialState";
  }
  entry(machine: EntryMachine<VendingMachine>, _: object): void {
    machine.value().coins = 0;
  }
}

// transitionLogger implements Tracer and logs every state transition.
// Using Tracer keeps each entry method free of transition-logging boilerplate.
class TransitionLogger implements Tracer<VMState> {
  trace(from: VMState | null, to: VMState | null, event: object | null): void {
    logKV("transition",
      ["from", from?.constructor.name ?? null],
      ["to", to?.constructor.name ?? null],
      ["event", event]);
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
      logKV("coin", ["count", vm.coins]);
    }

    // Guard conditions: conditionally control state transitions
    machine.onExit((_: ExitMachine<VendingMachine>, event: object) => {
      if (event instanceof CoinEvent) {
        return null;
      }
      if (event instanceof ButtonEvent) {
        if (event.item === "coffee" && vm.coins < 2) {
          return new Guarded(
            `2 coin(s) for ${event.item}, but ${vm.coins}`,
          );
        }
      }
      return null;
    });

    // Timeout: automatically return to initial state after 10 seconds
    machine.afterFunc(vm.dispatcher, 10_000, (m: AfterFuncMachine<VendingMachine>) => {
      m.trigger(new DoneEvent("timeout"));
    });
  }
}

class PouringState implements VMState {
  name() {
    return "PouringState";
  }
  entry(machine: EntryMachine<VendingMachine>, event: object): void {
    logKV("pouring", ["item", (event as ButtonEvent).item]);

    machine.afterEntry((m: AfterEntryMachine<VendingMachine>) => {
      m.trigger(new DoneEvent("done"));
    });
  }
}

// -- State graph --

const initial = new InitialState();
const waiting = new WaitingState();
const pouring = new PouringState();

const stateGraph = newGraph<VMState>(
  initial,
  on(CoinEvent, initial, waiting),
  on(CoinEvent, waiting, waiting),
  on(DoneEvent, waiting, initial),
  on(ButtonEvent, waiting, pouring),
  on(DoneEvent, pouring, initial),
);

// -- Main --

export function main() {
  logKV(
    "state diagram:\n```mermaid\n" + dump(stateGraph) + "\n```",
  );
  const dispatcher = new EventLoopDispatcher(0);
  const vm = new VendingMachine(dispatcher);
  const machine = new Machine(stateGraph, vm, { tracer: new TransitionLogger() });
  machine.launch(new StartEvent());

  // Scenario 1: Buy water (1 coin required)
  logKV("scenario: basic (pouring water)");
  {
    machine.trigger(new CoinEvent(1));
    machine.trigger(new ButtonEvent("water"));
  }
  logKV("---");

  // Scenario 2: Buy coffee (2 coins required)
  logKV("scenario: basic (pouring coffee)");
  {
    machine.trigger(new CoinEvent(1));
    machine.trigger(new CoinEvent(2));
    machine.trigger(new ButtonEvent("coffee"));
  }
  logKV("---");

  // Scenario 3: Insufficient coins - guard condition prevents transition
  logKV("scenario: insufficient coins and cancel");
  {
    machine.trigger(new CoinEvent(1));
    const err = machine.trigger(new ButtonEvent("coffee"));
    logKV("insufficient coins", ["error", `"${err!.reason}"`]);
    machine.trigger(new DoneEvent("cancel"));
  }
  logKV("---");

  // Scenario 4: Timeout after coin insertion
  logKV("scenario: timeout");
  {
    machine.trigger(new CoinEvent(1));
    dispatcher.fastForward(10_000);
  }
}

// Run if executed directly
if (import.meta.url.endsWith(process.argv[1]?.replace(/^file:\/\//, "") ?? "")) {
  main();
}
