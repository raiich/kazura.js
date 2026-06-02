import { describe, it, expect } from "vitest";
import { Node, findNext, isNamer, stateName, eventName } from "./node.js";

class Event0 {}
class Event1 {}

class State0 {}
class State1 {}

class NamedState {
  constructor(private n: string) {}
  name(): string {
    return this.n;
  }
}

describe("findNext", () => {
  it("finds matching event", () => {
    const node1 = new Node(new State0());
    const node2 = new Node(new State1());
    const events = [Event0, Event1];
    const nextNodes = [node1, node2];

    const found = findNext(events, nextNodes, Event1);
    expect(found).toBe(node2);
  });

  it("returns undefined for no match", () => {
    const node1 = new Node(new State0());
    const events = [Event0];
    const nextNodes = [node1];

    const found = findNext(events, nextNodes, Event1);
    expect(found).toBeUndefined();
  });

  it("uses strict equality (===), not instanceof", () => {
    class Parent {}
    class Child extends Parent {}
    const node = new Node(new State0());

    const found = findNext([Parent], [node], Child);
    expect(found).toBeUndefined();
  });
});

describe("isNamer", () => {
  it("detects Namer interface", () => {
    expect(isNamer(new NamedState("test"))).toBe(true);
    expect(isNamer(new State0())).toBe(false);
    expect(isNamer(null)).toBe(false);
    expect(isNamer(undefined)).toBe(false);
  });
});

describe("stateName", () => {
  it("uses Namer.name() when available", () => {
    expect(stateName(new NamedState("my-state"))).toBe("my-state");
  });

  it("uses constructor.name for non-Namer", () => {
    expect(stateName(new State0())).toBe("State0");
  });
});

describe("eventName", () => {
  it("uses constructor name", () => {
    expect(eventName(Event0)).toBe("Event0");
  });

  it("uses static eventName when available", () => {
    class MyEvent {
      static readonly eventName = "CustomEventName";
    }
    expect(eventName(MyEvent)).toBe("CustomEventName");
  });
});
