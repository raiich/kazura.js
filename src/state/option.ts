/**
 * Tracer observes state transitions for logging or debugging purposes.
 * S is the state type used by the Machine.
 *
 * trace() is called after an exit-action (if any) succeeds and before the
 * entry method of the destination state is invoked.
 *
 * Special cases:
 * - On the initial transition triggered by launch(), fromState is null and event is null.
 * - On stop(), fromState is the state the machine was in, toState is null, and event is null.
 *
 * trace() is not called when a transition is blocked by a Guarded error
 * returned from an exit-action, or when stop() is invoked from within an
 * exit-action (the destination-side trace for the blocked transition is
 * suppressed; the stop-side trace is still recorded).
 *
 * Recorded even if the destination state's entry() throws — useful for post-mortem debugging.
 *
 * trace() is invoked synchronously. Implementations must not throw and must
 * not block. A throwing trace() leaves the machine in an inconsistent state
 * (transition committed but entry not yet executed).
 *
 * Implementations must not mutate the state or event objects they receive.
 */
export interface Tracer<S> {
  trace(fromState: S | null, toState: S | null, event: object | null): void;
}

/** MachineOptions configures a Machine at construction time. */
export interface MachineOptions<S> {
  tracer?: Tracer<S>;
}
