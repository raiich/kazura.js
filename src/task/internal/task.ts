import { type Task, ErrCanceled } from "../task.js";

type Settlement =
  | { status: "success" }
  | { status: "canceled" }
  | { status: "panicked"; value: unknown };

/**
 * RunFailure boxes the value a task's function threw so a dispatcher can surface
 * it. The box distinguishes a thrown `null`/`undefined` from a successful run.
 */
export type RunFailure = { value: unknown };

/**
 * PendingTask is a {@link Task} whose function is queued for later serialized
 * execution. Exactly one of run or cancel settles it; wait observes the result.
 *
 * The Promise is created lazily by wait, so a settled-but-unobserved task (e.g.
 * an afterFunc callback or a fire-and-forget invokeFunc that never calls wait)
 * never produces an unhandled rejection.
 */
export class PendingTask implements Task {
  private settlement: Settlement | null = null;
  private promise: Promise<void> | null = null;
  private deliver: ((settlement: Settlement) => void) | null = null;

  constructor(private readonly fn: () => void) {}

  /**
   * run executes the function and settles the task. On failure it returns the
   * thrown value boxed and does not re-throw, leaving the dispatcher to decide
   * how to surface it; this mirrors Go's PendingTask.Run returning an error
   * rather than re-panicking, kept separate from wait's rejection. A successful
   * run returns null.
   */
  run(): RunFailure | null {
    try {
      this.fn();
    } catch (e) {
      this.settle({ status: "panicked", value: e });
      return { value: e };
    }
    this.settle({ status: "success" });
    return null;
  }

  /** cancel settles the task as canceled without running the function. */
  cancel(): void {
    this.settle({ status: "canceled" });
  }

  private settle(settlement: Settlement): void {
    if (this.settlement != null) {
      return;
    }
    this.settlement = settlement;
    this.deliver?.(settlement);
  }

  /** wait returns the result Promise: resolves on success, rejects with the
   * thrown value on failure, or with {@link ErrCanceled} if canceled. */
  wait(): Promise<void> {
    if (this.promise == null) {
      this.promise = new Promise<void>((resolve, reject) => {
        const deliver = (settlement: Settlement) => {
          if (settlement.status === "success") {
            resolve();
          } else if (settlement.status === "canceled") {
            reject(ErrCanceled);
          } else {
            reject(settlement.value);
          }
        };
        if (this.settlement != null) {
          deliver(this.settlement);
        } else {
          this.deliver = deliver;
        }
      });
    }
    return this.promise;
  }
}

/**
 * CompletedTask is a {@link Task} with a fixed result, used when the outcome is
 * already known at submission (e.g. the dispatcher has stopped). The result
 * promise is created lazily and reused, so an unawaited wait() never leaks a
 * fresh rejection on every call.
 */
class CompletedTask implements Task {
  private promise: Promise<void> | null = null;

  constructor(private readonly error: unknown) {}

  wait(): Promise<void> {
    if (this.promise == null) {
      this.promise =
        this.error == null ? Promise.resolve() : Promise.reject(this.error);
    }
    return this.promise;
  }
}

/** CanceledTask is a Task for a function that a stopped dispatcher will never run. */
export const CanceledTask: Task = new CompletedTask(ErrCanceled);
