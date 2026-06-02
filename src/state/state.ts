import type { EntryMachine } from "./machine.js";

/**
 * State represents a state in the finite state machine.
 * T is the type of data that the state machine manages.
 */
export interface State<T> {
  /**
   * entry is called when the state machine transitions into this state (entry-action).
   * The event parameter contains the event that triggered this state transition.
   *
   * This method must be synchronous. Use afterFunc() for async operations.
   */
  entry(machine: EntryMachine<T>, event: object): void;
}

/**
 * Guarded represents an error value that can prevent state transitions.
 * When returned by an exit-action, it blocks the transition and keeps the machine in the current state.
 */
export class Guarded {
  constructor(public readonly reason: string) {}
}
