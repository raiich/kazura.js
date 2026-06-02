export type { State } from "./state.js";
export { Guarded } from "./state.js";
export type { Tracer, MachineOptions } from "./option.js";
export {
  Machine,
  EntryMachine,
  AfterFuncMachine,
  AfterEntryMachine,
  ExitMachine,
} from "./machine.js";
import { type Edge, type EventConstructor, type Graph, newGraph as graphNew } from "./graph/index.js";

/**
 * on creates a state transition edge from one state to another, triggered by an event class.
 * Use null as the 'from' parameter to create wildcard transitions that work from any state.
 *
 * @example
 * on(CoinEvent, new InitialState(), new WaitingState())
 * on(QuitEvent, null, new MenuState())  // wildcard
 */
export function on<S>(
  event: EventConstructor,
  from: S | null,
  to: S,
): Edge<S> {
  return { from, event, to };
}

/**
 * newGraph creates a new state Graph for the Machine.
 * The init parameter specifies the initial state, and edges define the valid transitions.
 * Throws if the graph structure is invalid (e.g., unreachable states, duplicate transitions).
 */
export function newGraph<S>(init: S, ...edges: Edge<S>[]): Graph<S> {
  return graphNew(init, ...edges);
}
