import { describe, it, expect } from "vitest";
import { newGraph, dump, type Edge } from "./graph.js";

class CoinEvent {}
class ButtonEvent {}
class DoneEvent {}

class InitialState {
  name() {
    return "InitialState";
  }
}
class WaitingState {
  name() {
    return "WaitingState";
  }
}
class PouringState {
  name() {
    return "PouringState";
  }
}

function on<S>(
  event: new (...args: any[]) => object,
  from: S | null,
  to: S,
): Edge<S> {
  return { from, event, to };
}

describe("dump", () => {
  it("generates Mermaid state diagram", () => {
    const initial = new InitialState();
    const waiting = new WaitingState();
    const pouring = new PouringState();

    const g = newGraph<object>(
      initial,
      on(CoinEvent, initial, waiting),
      on(CoinEvent, waiting, waiting),
      on(DoneEvent, waiting, initial),
      on(ButtonEvent, waiting, pouring),
      on(DoneEvent, pouring, initial),
    );

    const result = dump(g);
    expect(result).toBe(
      [
        "stateDiagram-v2",
        "  [*] --> InitialState",
        "  InitialState --> WaitingState: CoinEvent",
        "  PouringState --> InitialState: DoneEvent",
        "  WaitingState --> InitialState: DoneEvent",
        "  WaitingState --> PouringState: ButtonEvent",
        "  WaitingState --> WaitingState: CoinEvent",
      ].join("\n"),
    );
  });

  it("handles wildcard transitions", () => {
    const s0 = new InitialState();
    const s1 = new WaitingState();

    const g = newGraph<object>(
      s0,
      on(CoinEvent, null, s1),
      on(DoneEvent, s1, s0),
    );

    const result = dump(g);
    expect(result).toBe(
      [
        "stateDiagram-v2",
        "  [*] --> InitialState",
        "  * --> WaitingState: CoinEvent",
        "  WaitingState --> InitialState: DoneEvent",
      ].join("\n"),
    );
  });

  it("uses static eventName when available", () => {
    class CustomEvent {
      static readonly eventName = "MyCustomEvent";
    }
    const s0 = new InitialState();
    const s1 = new WaitingState();

    const g = newGraph<object>(
      s0,
      on(CustomEvent, s0, s1),
      on(DoneEvent, s1, s0),
    );

    const result = dump(g);
    expect(result).toBe(
      [
        "stateDiagram-v2",
        "  [*] --> InitialState",
        "  InitialState --> WaitingState: MyCustomEvent",
        "  WaitingState --> InitialState: DoneEvent",
      ].join("\n"),
    );
  });
});
