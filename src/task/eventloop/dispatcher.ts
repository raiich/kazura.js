import type { Timer } from "../timer.js";
import type { Dispatcher } from "../dispatcher.js";
import type { Task } from "../task.js";
import { PendingTask, CanceledTask, type RunFailure } from "../internal/task.js";

/**
 * EventLoopDispatcher manages scheduled tasks with controllable time progression.
 * It maintains an ordered queue of tasks and allows manual time advancement
 * for applications requiring precise timing control, such as testing.
 */
export class EventLoopDispatcher implements Dispatcher {
  private now: number;
  private tasks: ScheduledTask[] = [];
  private ended = false;

  constructor(now: number) {
    this.now = now;
  }

  /**
   * fastForward advances the time to the specified time and executes all tasks
   * that are scheduled to run during this time period. If a task throws, the
   * dispatcher stops (subsequent tasks are canceled) and fastForward throws an
   * Error whose `cause` is the thrown value.
   */
  fastForward(to: number): void {
    for (;;) {
      const head = this.proceedAndDequeue(to);
      if (head == null) {
        return;
      }
      const failure = head.exec();
      if (failure) {
        this.shutdown();
        // The operator drives time, so report the failure to it as a distinct
        // wrapped error; the task's own wait() still re-throws the original
        // value. Separating the two channels keeps a single panic from
        // surfacing as the same value twice.
        throw new Error("eventloop dispatcher stopped: a dispatched function threw", {
          cause: failure.value,
        });
      }
    }
  }

  /**
   * shutdown stops the dispatcher after a task throws. Queued tasks are canceled
   * so invokeFunc waiters settle, but stay in the queue so a Timer.stop can still
   * cancel them; the ended gate keeps them from running.
   */
  private shutdown(): void {
    this.ended = true;
    for (const entry of this.tasks) {
      entry.cancel();
    }
  }

  private proceedAndDequeue(end: number): ScheduledTask | null {
    // A shut-down dispatcher runs nothing further, and does not advance time.
    if (this.ended) {
      return null;
    }
    const head = this.dequeue(end);
    if (head == null) {
      // Fast-forwarding backward runs nothing and does not rewind time.
      if (end > this.now) {
        this.now = end;
      }
      return null;
    }
    return head;
  }

  private dequeue(end: number): ScheduledTask | null {
    if (this.tasks.length === 0) {
      return null;
    }
    const head = this.tasks[0];
    if (end < head.at) {
      return null;
    }
    this.tasks.splice(0, 1);
    this.now = head.at;
    return head;
  }

  afterFunc(delayMs: number, f: () => void): Timer {
    const entry = this.enqueue(this.now + delayMs, new PendingTask(f));
    return new TaskTimer(this, entry);
  }

  /**
   * invokeFunc schedules f to run at the current simulated time, executed by the
   * next fastForward, and returns a Task; its wait() observes completion. On a
   * stopped dispatcher f never runs and wait() rejects with ErrCanceled.
   */
  invokeFunc(f: () => void): Task {
    if (this.ended) {
      return CanceledTask;
    }
    const pending = new PendingTask(f);
    this.enqueue(this.now, pending);
    return pending;
  }

  private enqueue(at: number, pending: PendingTask): ScheduledTask {
    const entry = new ScheduledTask(at, pending);

    // Find insertion point to maintain chronological order
    let i = 0;
    while (i < this.tasks.length) {
      if (at < this.tasks[i].at) {
        break;
      }
      i++;
    }
    this.tasks.splice(i, 0, entry);

    return entry;
  }

  /** @internal Returns the number of scheduled tasks (for testing). */
  taskCount(): number {
    return this.tasks.length;
  }

  /** @internal */
  dropTask(task: ScheduledTask): boolean {
    const idx = this.tasks.indexOf(task);
    if (idx === -1) {
      return false;
    }
    this.tasks.splice(idx, 1);
    return true;
  }
}

class ScheduledTask {
  constructor(
    readonly at: number,
    private pending: PendingTask,
  ) {}

  exec(): RunFailure | null {
    return this.pending.run();
  }

  cancel(): void {
    this.pending.cancel();
  }
}

class TaskTimer implements Timer {
  constructor(
    private dispatcher: EventLoopDispatcher,
    private entry: ScheduledTask,
  ) {}

  stop(): boolean {
    return this.dispatcher.dropTask(this.entry);
  }
}
