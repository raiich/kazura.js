import { describe, it, expect } from "vitest";
import { newGraph, dump, type Edge } from "./graph.js";

class Event0 {}
class Event1 {}
class Event2 {}
class Event3 {}
class Event4 {}

class State0 {}
class State1 {}
class State2 {}
class State3 {}

class NamerState {
  constructor(private n: string) {}
  name(): string {
    return this.n;
  }
}

function on<S>(
  event: new (...args: any[]) => object,
  from: S | null,
  to: S,
): Edge<S> {
  return { from, event, to };
}

describe("newGraph", () => {
  it("basic graph", () => {
    const s1 = new State1();
    const s2 = new State2();
    const s0 = new State0();
    const s3 = new State3();

    const g = newGraph(
      s1,
      on(Event1, s1, s2),
      on(Event2, s2, s1),
      on(Event0, null, s0),
      on(Event4, null, s0),
      on(Event3, null, s3),
      on(Event2, s3, s1),
    );
    const d = dump(g);
    expect(d).toContain("stateDiagram-v2");
    expect(d).toContain("[*] --> State1");
    expect(d).toContain("State1 --> State2: Event1");
    expect(d).toContain("State2 --> State1: Event2");
  });

  it("unreachable states from initial state", () => {
    const s0 = new State0();
    const s1 = new State1();
    const s3 = new State3();

    expect(() =>
      newGraph(
        s0,
        on(Event1, s1, s0),
        on(Event1, s3, s1),
      ),
    ).toThrow("unreachable nodes: [State1 State3]");
  });

  it("unreachable states (dangling)", () => {
    const s0 = new State0();
    const s1 = new State1();
    const s4a = new NamerState("s4");
    const s4b = new NamerState("s4'");

    expect(() =>
      newGraph<object>(
        s0,
        on(Event1, s0, s1),
        on(Event1, s4a, s1),
        on(Event1, s4b, s1),
      ),
    ).toThrow("unreachable nodes: [s4 s4']");
  });

  it("duplicate transition with same event to different state", () => {
    const s0 = new State0();
    const s1 = new State1();
    const s2 = new State2();

    expect(() =>
      newGraph(
        s1,
        on(Event1, s1, s0),
        on(Event1, s1, s2),
      ),
    ).toThrow("already exists for node");
  });

  it("duplicate transition with same event to same state", () => {
    const s1 = new State1();
    const s2 = new State2();

    expect(() =>
      newGraph(
        s1,
        on(Event1, s1, s2),
        on(Event1, s1, s2),
      ),
    ).toThrow("already exists for node");
  });

  it("duplicate wildcard transition with same event", () => {
    const s0 = new State0();
    const s1 = new State1();
    const s2 = new State2();

    expect(() =>
      newGraph(
        s1,
        on(Event1, s1, s2),
        on(Event1, null, s0),
      ),
    ).toThrow("wildcard transition already exists");
  });

  it("same Namer name with different instance", () => {
    const s0 = new NamerState("s0");
    const s1 = new NamerState("s1");

    expect(() =>
      newGraph<object>(
        s0,
        on(Event1, s0, s1),
        on(Event2, new NamerState("s1"), s0),
      ),
    ).toThrow("already exists");
  });

  it("same state type but not equal", () => {
    class MyState1 {
      constructor(public x?: number) {}
    }
    class MyState2 {
      constructor(public y?: number) {}
    }

    // Two different instances of same constructor
    expect(() =>
      newGraph(
        new MyState1(),
        on<object>(Event1, new MyState1(), new MyState2()),
        on<object>(Event2, new MyState1(), new MyState2()),
      ),
    ).toThrow("already exists as");
  });
});
