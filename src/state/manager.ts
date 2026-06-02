import type {Dispatcher, Timer} from "../task";

/**
 * Manager manages a single state value with support for timer-based operations.
 * It supports multiple timers and automatically cancels all timers when the state changes.
 */
export class Manager<S> {
  private current: S | null = null;
  private timers = new TimerGroup();

  /** Get returns the current state value. */
  get(): S | null {
    return this.current;
  }

  /** @internal Returns the number of currently active timers (for testing). */
  activeTimerCount(): number {
    return this.timers.activeCount();
  }

  /**
   * Set updates the current state and cancels all active timers.
   * This ensures that timers from the previous state don't execute
   * after a state transition.
   */
  set(next: S | null): void {
    this.timers.clear();
    this.current = next;
  }

  /**
   * afterFunc schedules a function to execute after the specified duration.
   * The function will not execute if the state changes before the timer fires.
   */
  afterFunc(dispatcher: Dispatcher, delayMs: number, f: () => void): void {
    this.timers.afterFunc(dispatcher, delayMs, f);
  }
}

/**
 * TimerGroup manages multiple timers with safe cancellation.
 *
 * In JS's single-threaded model, timer.stop() alone is sufficient to prevent
 * a pending callback from firing — no additional guard flag is needed.
 */
class TimerGroup {
  private timers: Timer[] = [];

  /**
   * afterFunc schedules a function to execute after the specified duration.
   * The function will not execute if clear() is called before the timer fires.
   */
  afterFunc(dispatcher: Dispatcher, delayMs: number, f: () => void): void {
    const timer = dispatcher.afterFunc(delayMs, () => {
      this.removeTimer(timer);
      f();
    });
    this.timers.push(timer);
  }

  private removeTimer(fired: Timer): void {
    const idx = this.timers.indexOf(fired);
    if (idx !== -1) {
      // Swap with last and pop for O(1) removal
      this.timers[idx] = this.timers[this.timers.length - 1];
      this.timers.pop();
    }
  }

  activeCount(): number {
    return this.timers.length;
  }

  /**
   * clear cancels all active timers.
   */
  clear(): void {
    for (const timer of this.timers) {
      timer.stop();
    }
    this.timers = [];
  }
}
