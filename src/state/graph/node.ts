/** Constructor type used as event key */
export type EventConstructor = new (...args: any[]) => object;

/**
 * Namer interface allows custom naming of graph elements.
 * Elements implementing this interface will be identified by their name() rather than their constructor.
 */
export interface Namer {
  name(): string;
}

/**
 * Node represents a single state node in the Graph.
 */
export class Node<S> {
  readonly state: S;
  /** @internal */
  readonly events: EventConstructor[] = [];
  /** @internal */
  readonly nextNodes: Node<S>[] = [];

  constructor(state: S) {
    this.state = state;
  }
}

/**
 * Wildcards represents global transitions that can be triggered from any node in the graph.
 */
export class Wildcards<S> {
  /** @internal */
  readonly events: EventConstructor[] = [];
  /** @internal */
  readonly nextNodes: Node<S>[] = [];
}

/**
 * findNext returns the destination Node if a transition for the given event exists.
 * Uses constructor identity (===) for matching, not instanceof.
 */
export function findNext<S>(
  events: EventConstructor[],
  nextNodes: Node<S>[],
  event: EventConstructor,
): Node<S> | undefined {
  for (let i = 0; i < events.length; i++) {
    if (events[i] === event) {
      return nextNodes[i];
    }
  }
  return undefined;
}

/** Check if a value implements the Namer interface (duck typing) */
export function isNamer(s: unknown): s is Namer {
  return (
    s != null &&
    typeof s === "object" &&
    "name" in s &&
    typeof (s as { name: unknown }).name === "function"
  );
}

/**
 * Get a display name for a state value.
 * Uses Namer.name() if available, otherwise uses constructor.name.
 */
export function stateName(s: unknown): string {
  if (isNamer(s)) {
    return s.name();
  }
  if (s != null && typeof s === "object") {
    return s.constructor.name;
  }
  return String(s);
}

/**
 * Get a display name for an event constructor.
 * Uses static eventName if available, otherwise uses constructor.name.
 */
export function eventName(event: EventConstructor): string {
  if ("eventName" in event && typeof event.eventName === "string") {
    return event.eventName;
  }
  return event.name;
}

