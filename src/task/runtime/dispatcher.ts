import type { Dispatcher, Timer } from "..";

/**
 * RuntimeDispatcher executes tasks via setTimeout.
 * In JS's single-threaded model, setTimeout callbacks are naturally serialized
 * by the event loop, providing sequential execution guarantees.
 *
 * Negative delays are clamped to 0 by the browser/runtime (per HTML spec).
 */
export class RuntimeDispatcher implements Dispatcher {
  afterFunc(delayMs: number, f: () => void): Timer {
    let fired = false;
    const id = setTimeout(() => {
      fired = true;
      f();
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
}
