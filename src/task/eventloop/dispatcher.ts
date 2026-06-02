import type { Timer } from "../timer.js";
import type { Dispatcher } from "../dispatcher.js";

/**
 * EventLoopDispatcher manages scheduled tasks with controllable time progression.
 * It maintains an ordered queue of tasks and allows manual time advancement
 * for applications requiring precise timing control, such as testing.
 */
export class EventLoopDispatcher implements Dispatcher {
  private now: number;
  private tasks: ScheduledTask[] = [];

  constructor(now: number) {
    this.now = now;
  }

  /**
   * fastForward advances the time to the specified time and executes all tasks
   * that are scheduled to run during this time period.
   */
  fastForward(to: number): void {
    for (;;) {
      const head = this.proceedAndDequeue(to);
      if (head == null) {
        return;
      }
      head.exec();
    }
  }

  private proceedAndDequeue(end: number): ScheduledTask | null {
    if (end < this.now) {
      throw new Error(
        `unprocessable time: now=${this.now}, to=${end}`,
      );
    }

    const head = this.dequeue(end);
    if (head == null) {
      this.now = end;
      return null;
    }
    this.now = head.at;
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
    return head;
  }

  afterFunc(delayMs: number, f: () => void): Timer {
    const at = this.now + delayMs;
    const entry = new ScheduledTask(at, f);

    // Find insertion point to maintain chronological order
    let i = 0;
    while (i < this.tasks.length) {
      if (at < this.tasks[i].at) {
        break;
      }
      i++;
    }
    this.tasks.splice(i, 0, entry);

    return new TaskTimer(this, entry);
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
    private task: () => void,
  ) {}

  exec(): void {
    this.task();
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
