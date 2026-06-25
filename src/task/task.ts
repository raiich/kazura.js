/**
 * ErrCanceled is the rejection reason when the dispatcher stops without running a
 * function submitted via {@link Dispatcher.invokeFunc}. Match it by identity.
 */
export const ErrCanceled = new Error("task canceled");

/**
 * Task is a handle for awaiting completion of a function submitted via
 * {@link Dispatcher.invokeFunc}.
 */
export interface Task {
  /**
   * wait resolves once the submitted function finishes. If the dispatcher stopped
   * without running it, the promise rejects with {@link ErrCanceled}. If the
   * function threw, wait rejects with the thrown value on every call.
   *
   * The promise is created only when wait is called, so a fire-and-forget
   * submission that never calls wait cannot surface a throw or cancellation as an
   * unhandled rejection.
   */
  wait(): Promise<void>;
}
