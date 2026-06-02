/**
 * Timer represents a timer that can be stopped.
 * This interface provides an abstraction for schedulable tasks that can be cancelled before execution.
 */
export interface Timer {
  /**
   * Stop prevents the Timer from firing. It returns true if the call stops the timer,
   * false if the timer has already expired or been stopped.
   */
  stop(): boolean;
}
