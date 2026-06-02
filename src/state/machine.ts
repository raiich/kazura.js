import type { Graph } from "./graph";
import { type EventConstructor, type Node, findNext, stateName, eventName } from "./graph/node.js";
import type { Dispatcher } from "../task";
import type { State } from "./state.js";
import { Guarded } from "./state.js";
import { Manager } from "./manager.js";
import type { MachineOptions } from "./option.js";

function errMethodNotCallable(): Error {
  return new Error("method is not callable here");
}

/**
 * Calls state.entry() and verifies it did not return a Promise.
 * entry() is typed as void, but an async function would return a Promise at runtime.
 * The cast to unknown captures the actual runtime return value for detection.
 */
function callEntry<T>(
  state: State<T>,
  machine: EntryMachine<T>,
  event: object,
): void {
  const result = (state.entry as (m: EntryMachine<T>, e: object) => unknown)(machine, event);
  if (result != null) {
    if (typeof (result as { then?: unknown }).then === "function") {
      throw new Error(
        "State.entry() must be synchronous (returned a Promise). Use afterFunc() for async operations.",
      );
    }
    if (typeof (result as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === "function") {
      throw new Error(
        "State.entry() must be synchronous (returned an AsyncGenerator). Use afterFunc() for async operations.",
      );
    }
  }
}

const enum MachineState {
  Stopped = 0,
  Launched = 1,
}

const enum ExecutionContext {
  None = 0,
  Entry = 1,
  AfterEntry = 2,
  AfterFunc = 3,
  Exit = 4,
}

/**
 * Machine represents a finite state machine that manages states of type S.
 */
export class Machine<S extends State<T>, T> {
  private graph: Graph<S>;
  private readonly val: T;
  private manager = new Manager<Node<S>>();
  private state: MachineState = MachineState.Stopped;
  private context: ExecutionContext = ExecutionContext.None;
  private onExitCallback:
    | ((machine: ExitMachine<T>, event: object) => Guarded | null)
    | null = null;
  private afterEntryCallback:
    | ((machine: AfterEntryMachine<T>) => void)
    | null = null;
  private opts: MachineOptions<S>;

  constructor(graph: Graph<S>, value: T, opts?: MachineOptions<S>) {
    if (graph == null) {
      throw new Error("graph cannot be null");
    }
    this.graph = graph;
    this.val = value;
    this.opts = opts ?? {};
  }

  /** Returns the current value stored in the machine. */
  value(): T {
    return this.val;
  }

  /**
   * Launch starts the state machine and transitions to the initial state.
   * The event parameter is passed to the initial state's entry method.
   * Throws if the machine is already launched.
   */
  launch(event: object): void {
    if (this.state === MachineState.Launched) {
      throw new Error("machine is already launched");
    }
    if (this.context !== ExecutionContext.None) {
      throw errMethodNotCallable();
    }

    try {
      this.state = MachineState.Launched;
      const nextNode = this.graph.initialNode;

      // Enter the initial state
      this.manager.set(nextNode);
      if (this.opts.tracer != null) {
        this.opts.tracer.trace(null, nextNode.state, null);
      }
      this.context = ExecutionContext.Entry;
      callEntry(nextNode.state, new EntryMachine(this), event);

      // Execute pending after-entry callbacks
      this.drainAfterEntry();
    } finally {
      this.context = ExecutionContext.None;
    }
  }

  /**
   * Trigger processes an event and potentially transitions to a new state.
   * Returns Guarded if the transition was blocked by a guard, or null on success.
   * Throws if the event is invalid for the current state.
   */
  trigger(event: object): Guarded | null {
    if (this.context !== ExecutionContext.None) {
      throw errMethodNotCallable();
    }

    try {
      return this.triggerInternal(event);
    } finally {
      this.context = ExecutionContext.None;
    }
  }

  /** @internal */
  triggerFromAfterFunc(event: object): Guarded | null {
    if (this.context !== ExecutionContext.AfterFunc) {
      throw errMethodNotCallable();
    }
    return this.triggerInternal(event);
  }

  /** @internal */
  triggerFromAfterEntry(event: object): Guarded | null {
    if (this.context !== ExecutionContext.AfterEntry) {
      throw errMethodNotCallable();
    }
    return this.triggerOnce(event);
  }

  private triggerInternal(event: object): Guarded | null {
    const err = this.triggerOnce(event);
    if (err != null) {
      return err;
    }

    // Execute pending after-entry callbacks
    this.drainAfterEntry();
    return null;
  }

  /** triggerOnce performs a single state transition without executing after-entry callbacks. */
  private triggerOnce(event: object): Guarded | null {
    if (event == null) {
      throw new Error("event cannot be null");
    }
    if (this.state !== MachineState.Launched) {
      throw new Error("machine is not launched");
    }

    // Validate event is a class instance
    if (
      event.constructor === Object ||
      event.constructor == null
    ) {
      throw new Error("event must be an instance of a named class");
    }

    const currentNode = this.manager.get();
    if (currentNode == null) {
      throw new Error("no current state");
    }
    const eventType: EventConstructor =
      event.constructor as EventConstructor;

    // Find transition for the event
    let nextNode = findNext(
      currentNode.events,
      currentNode.nextNodes,
      eventType,
    );
    if (nextNode == null) {
      nextNode = findNext(
        this.graph.wildcards.events,
        this.graph.wildcards.nextNodes,
        eventType,
      );
      if (nextNode == null) {
        throw new Error(
          `no transition found for event ${eventName(eventType)} from state ${stateName(currentNode.state)}`,
        );
      }
    }

    // Execute exit callback if present
    const exitCallback = this.popExitAction();
    if (exitCallback != null) {
      this.context = ExecutionContext.Exit;
      const guarded = exitCallback(new ExitMachine(this), event);
      if (guarded != null) {
        return guarded;
      }
      // Check if machine was stopped during exit callback
      if ((this.state as MachineState) === MachineState.Stopped) {
        return null;
      }
    }

    // Transition to the new state
    this.manager.set(nextNode!);
    if (this.opts.tracer != null) {
      this.opts.tracer.trace(currentNode.state, nextNode!.state, event);
    }
    this.context = ExecutionContext.Entry;
    callEntry(nextNode!.state, new EntryMachine(this), event);

    return null;
  }

  /**
   * Stop shuts down the state machine and cancels all pending timers.
   * Throws if the machine is already stopped.
   */
  stop(): void {
    if (this.state === MachineState.Stopped) {
      throw new Error("machine is already stopped");
    }

    const lastNode = this.manager.get();
    this.state = MachineState.Stopped;
    // Clear state and cancel all timers
    this.manager.set(null);
    this.onExitCallback = null;
    this.afterEntryCallback = null;

    if (this.opts.tracer != null) {
      this.opts.tracer.trace(lastNode!.state, null, null);
    }
  }

  /**
   * currentState returns the current state of the machine.
   * Throws if the machine has not been launched or has been stopped.
   */
  currentState(): S {
    if (this.state !== MachineState.Launched) {
      throw new Error("machine is not launched");
    }
    const currentNode = this.manager.get();
    if (currentNode == null) {
      throw new Error("no current state");
    }
    return currentNode.state;
  }

  /** @internal */
  doAfterFunc(
    dispatcher: Dispatcher,
    delayMs: number,
    callback: (machine: AfterFuncMachine<T>) => void,
  ): void {
    this.manager.afterFunc(dispatcher, delayMs, () => {
      this.context = ExecutionContext.AfterFunc;
      try {
        callback(new AfterFuncMachine(this));
      } finally {
        this.context = ExecutionContext.None;
      }
    });
  }

  /** @internal */
  doAfterEntry(
    callback: (machine: AfterEntryMachine<T>) => void,
  ): void {
    if (this.context !== ExecutionContext.Entry) {
      throw new Error("AfterEntry is not callable here");
    }
    if (this.afterEntryCallback != null) {
      throw new Error("callback for AfterEntry already registered");
    }
    this.afterEntryCallback = callback;
  }

  private popAfterEntry():
    | ((machine: AfterEntryMachine<T>) => void)
    | null {
    const callback = this.afterEntryCallback;
    this.afterEntryCallback = null;
    return callback;
  }

  /** @internal */
  doOnExit(
    callback: (machine: ExitMachine<T>, event: object) => Guarded | null,
  ): void {
    if (this.context === ExecutionContext.Exit) {
      throw errMethodNotCallable();
    }
    if (this.onExitCallback != null) {
      throw new Error("exit callback already registered");
    }
    this.onExitCallback = callback;
  }

  private popExitAction():
    | ((machine: ExitMachine<T>, event: object) => Guarded | null)
    | null {
    const callback = this.onExitCallback;
    this.onExitCallback = null;
    return callback;
  }

  private drainAfterEntry(): void {
    for (;;) {
      const callback = this.popAfterEntry();
      if (callback == null) {
        break;
      }
      this.context = ExecutionContext.AfterEntry;
      callback(new AfterEntryMachine(this));
    }
  }
}

/**
 * EntryMachine provides operations available when entering a state.
 */
export class EntryMachine<T> {
  /** @internal */
  constructor(private m: Machine<State<T>, T>) {}

  /** Returns the current value stored in the machine. */
  value(): T {
    return this.m.value();
  }

  /**
   * afterFunc schedules a callback to be executed after the specified duration.
   * The callback will be canceled if the state changes before the timer fires.
   */
  afterFunc(
    dispatcher: Dispatcher,
    delayMs: number,
    callback: (m: AfterFuncMachine<T>) => void,
  ): void {
    this.m.doAfterFunc(dispatcher, delayMs, callback);
  }

  /**
   * afterEntry schedules a callback to be executed immediately after the entry method completes.
   * Throws if the callback registration fails.
   */
  afterEntry(callback: (m: AfterEntryMachine<T>) => void): void {
    this.m.doAfterEntry(callback);
  }

  /**
   * onExit registers a callback to be executed when leaving this state (exit-action).
   * The callback can return a Guarded to prevent the state transition.
   * Only one exit-action can be registered per state.
   */
  onExit(
    callback: (m: ExitMachine<T>, event: object) => Guarded | null,
  ): void {
    this.m.doOnExit(callback);
  }
}

/**
 * AfterFuncMachine provides operations available within AfterFunc callbacks.
 */
export class AfterFuncMachine<T> {
  /** @internal */
  constructor(private m: Machine<State<T>, T>) {}

  /** Returns the current value stored in the machine. */
  value(): T {
    return this.m.value();
  }

  /**
   * afterFunc schedules another callback to be executed after the specified duration.
   */
  afterFunc(
    dispatcher: Dispatcher,
    delayMs: number,
    callback: (m: AfterFuncMachine<T>) => void,
  ): void {
    this.m.doAfterFunc(dispatcher, delayMs, callback);
  }

  /**
   * trigger processes an event and transitions to a new state.
   * Returns Guarded if blocked, null on success.
   */
  trigger(event: object): Guarded | null {
    return this.m.triggerFromAfterFunc(event);
  }
}

/**
 * AfterEntryMachine provides operations available within AfterEntry callbacks.
 */
export class AfterEntryMachine<T> {
  /** @internal */
  constructor(private m: Machine<State<T>, T>) {}

  /** Returns the current value stored in the machine. */
  value(): T {
    return this.m.value();
  }

  /**
   * trigger processes an event and transitions to a new state.
   * Returns Guarded if blocked, null on success.
   */
  trigger(event: object): Guarded | null {
    return this.m.triggerFromAfterEntry(event);
  }
}

/**
 * ExitMachine provides operations available within exit callbacks.
 */
export class ExitMachine<T> {
  /** @internal */
  constructor(private m: Machine<State<T>, T>) {}

  /** Returns the current value stored in the machine. */
  value(): T {
    return this.m.value();
  }
}
