import type { Timer } from "./timer.js";

/**
 * Dispatcher defines the interface for scheduling delayed function execution.
 * This abstraction allows the state manager to work with different timer implementations,
 * including test-friendly dispatchers that can control time simulation.
 *
 * Synchronization Guarantee:
 * Functions registered with afterFunc are executed with proper synchronization.
 * Even if multiple functions are scheduled to execute at the same time,
 * they will be executed serially without race conditions.
 */
export interface Dispatcher {
  /**
   * afterFunc schedules a function to be executed after the specified duration in milliseconds.
   * Returns a Timer that can be used to cancel the scheduled execution.
   */
  afterFunc(delayMs: number, f: () => void): Timer;
}
