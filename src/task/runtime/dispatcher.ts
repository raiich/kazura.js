import type { Dispatcher, Task, Timer } from "..";
import { PendingTask, CanceledTask } from "../internal/task.js";

/** Options for {@link RuntimeDispatcher}. */
export interface RuntimeDispatcherOptions {
  /**
   * onError is called once, with the value a task threw, when the dispatcher
   * stops. It is the operator-level counterpart of Go queue.Serve returning the
   * error, and the only dispatcher-scoped outlet for a throwing afterFunc
   * callback (without it that callback surfaces as an uncaught exception).
   *
   * It does not silence a throwing invokeFunc task's returned Promise: the
   * operator and submitter channels are independent, so onError is not a
   * "no crash" switch — an unobserved invokeFunc rejection still surfaces.
   */
  onError?: (error: unknown) => void;
}

/**
 * RuntimeDispatcher executes tasks via setTimeout.
 * In JS's single-threaded model, setTimeout callbacks are naturally serialized
 * by the event loop, providing sequential execution guarantees.
 *
 * Ported from Go kazura: equivalent to Go's queue.Dispatcher, with the JS event
 * loop serving the role of its Serve run loop. Go's mutex.Dispatcher has no
 * counterpart and is omitted from the JS port.
 *
 * Panic handling: once a task throws, the dispatcher stops and runs no further
 * task. invokeFunc returns a Task; call wait() to observe — it rejects with the
 * thrown value if the task threw, or with ErrCanceled for a later submission. A
 * fire-and-forget submission that never calls wait() creates no Promise, so a
 * throw or cancellation cannot crash the process; the stop is instead reported
 * to onError (the operator channel) if one was given. A throwing afterFunc
 * callback also has no Task to observe, so it likewise goes to onError, or to an
 * uncaught exception (window.onerror / process 'uncaughtException') when none.
 *
 * @example
 * const d = new RuntimeDispatcher({ onError: (cause) => log("stopped", cause) });
 * await d.invokeFunc(() => step()).wait();          // await completion
 * d.invokeFunc(() => step()).wait().catch((e) => {  // or observe cancellation
 *   if (e === ErrCanceled) cleanup();
 * });
 * d.invokeFunc(() => step());                        // fire-and-forget never crashes
 *
 * Negative delays are clamped to 0 by the browser/runtime (per HTML spec).
 */
export class RuntimeDispatcher implements Dispatcher {
  private ended = false;
  private readonly onError?: (error: unknown) => void;

  constructor(options?: RuntimeDispatcherOptions) {
    this.onError = options?.onError;
  }

  afterFunc(delayMs: number, f: () => void): Timer {
    let fired = false;
    const id = setTimeout(() => {
      if (this.ended) {
        // A prior task threw; skip f. Leave the timer stoppable so a later
        // stop() still reports it prevented execution.
        return;
      }
      fired = true;
      try {
        f();
      } catch (e) {
        this.shutdown(e);
        if (this.onError === undefined) {
          // No sink to capture it, so surface as an uncaught exception.
          throw e;
        }
      }
    }, delayMs);
    return {
      stop(): boolean {
        if (fired) {
          return false;
        }
        clearTimeout(id);
        fired = true;
        return true;
      },
    };
  }

  invokeFunc(f: () => void): Task {
    if (this.ended) {
      return CanceledTask;
    }
    const pending = new PendingTask(f);
    setTimeout(() => {
      if (this.ended) {
        pending.cancel();
        return;
      }
      const failure = pending.run();
      if (failure) {
        // wait() rejects with the value; report the stop to onError too.
        this.shutdown(failure.value);
      }
    }, 0);
    return pending;
  }

  /** shutdown stops the dispatcher and reports the cause to onError once. */
  private shutdown(error: unknown): void {
    if (this.ended) {
      return;
    }
    this.ended = true;
    this.onError?.(error);
  }
}
