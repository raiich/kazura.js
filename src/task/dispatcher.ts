import type { Timer } from "./timer.js";
import type { Task } from "./task.js";

/**
 * Dispatcher defines the interface for scheduling delayed function execution.
 * This abstraction allows the state manager to work with different timer implementations,
 * including test-friendly dispatchers that can control time simulation.
 *
 * Synchronization Guarantee:
 * Functions registered with afterFunc are executed with proper synchronization.
 * Even if multiple functions are scheduled to execute at the same time,
 * they will be executed serially without race conditions.
 *
 * Panic handling:
 * If a scheduled function throws, the dispatcher stops: remaining functions do
 * not run and later invokeFunc tasks settle as canceled. How the thrown value
 * is reported is implementation-dependent; see each implementation.
 */
export interface Dispatcher {
  /**
   * afterFunc schedules a function to be executed after the specified duration in milliseconds.
   * Returns a Timer that can be used to cancel the scheduled execution.
   */
  afterFunc(delayMs: number, f: () => void): Timer;

  /**
   * invokeFunc submits a function for serialized execution and returns a {@link
   * Task} handle. Call its wait() to observe the outcome: the Promise resolves
   * when f completes, rejects with the thrown value if f threw, or rejects with
   * {@link ErrCanceled} if the dispatcher stopped first. A fire-and-forget
   * submission that never calls wait() creates no Promise, so neither a throw nor
   * a cancellation can surface as an unhandled rejection. An implementation may
   * run f on the next time advance or event-loop turn; calling invokeFunc or
   * afterFunc from within a dispatched function is supported, but awaiting wait()
   * from inside one is not.
   */
  invokeFunc(f: () => void): Task;
}
