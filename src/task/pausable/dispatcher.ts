import type { Timer } from "../timer.js";
import type { Task } from "../task.js";
import type { Dispatcher } from "../dispatcher.js";

export class PausableDispatcher implements Dispatcher {
  private paused = false;
  private tracked = new Set<TrackedEntry>();

  constructor(
    private base: Dispatcher,
    private now: () => number,
  ) {}

  afterFunc(delayMs: number, f: () => void): Timer {
    const entry: TrackedEntry = {
      callback: f,
      delayMs,
      dispatchedAt: this.now(),
      baseTimer: null,
    };
    if (!this.paused) {
      entry.baseTimer = this.dispatchEntry(entry);
    }
    this.tracked.add(entry);
    return {
      stop: () => this.stop(entry),
    };
  }

  /**
   * invokeFunc submits f to the base dispatcher for serialized execution. Unlike
   * afterFunc it is not buffered while paused, since it carries no delay to suspend.
   */
  invokeFunc(f: () => void): Task {
    return this.base.invokeFunc(f);
  }

  private stop(entry: TrackedEntry): boolean {
    if (!this.tracked.delete(entry)) {
      return false;
    }
    if (entry.baseTimer != null) {
      // Delegate to the base timer's stop. Returns false if the base
      // dispatcher has already executed the callback.
      return entry.baseTimer.stop();
    }
    // Paused: callback has not been dispatched yet, so stop succeeds.
    return true;
  }

  /** @internal Returns the number of tracked entries (for testing). */
  trackedCount(): number {
    return this.tracked.size;
  }

  pause(): void {
    if (this.paused) {
      throw new Error("already paused");
    }
    this.paused = true;
    const pausedAt = this.now();

    // Entries whose stop() returns false have already fired (completed before pause), so exclude them
    const fired: TrackedEntry[] = [];
    for (const entry of this.tracked) {
      if (!entry.baseTimer!.stop()) {
        fired.push(entry);
      } else {
        entry.delayMs = Math.max(0, entry.delayMs - (pausedAt - entry.dispatchedAt));
        entry.baseTimer = null;
      }
    }
    for (const entry of fired) {
      this.tracked.delete(entry);
    }
  }

  resume(): void {
    if (!this.paused) {
      throw new Error("not paused");
    }
    this.paused = false;
    const resumedAt = this.now();

    for (const entry of this.tracked) {
      entry.dispatchedAt = resumedAt;
      entry.baseTimer = this.dispatchEntry(entry);
    }
  }

  private dispatchEntry(entry: TrackedEntry): Timer {
    return this.base.afterFunc(entry.delayMs, () => {
      this.tracked.delete(entry);
      entry.callback();
    });
  }
}

interface TrackedEntry {
  callback: () => void;
  delayMs: number;
  dispatchedAt: number;
  baseTimer: Timer | null;
}
