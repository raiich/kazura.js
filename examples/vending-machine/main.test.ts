import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { main, setLogger, log as originalLog } from "./main.js";

// Go test correspondence: kazura/examples/vending-machine/main_test.go

describe("Vending machine", () => {
  it("produces expected log output", () => {
    const messages: string[] = [];
    const prevLog = originalLog;
    setLogger((...args: unknown[]) => {
      messages.push(args.join(" "));
    });

    try {
      main();
    } finally {
      setLogger(prevLog);
    }

    const expectedPath = join(
      import.meta.dirname,
      "testdata",
      "expected.log.txt",
    );
    const expected = readFileSync(expectedPath, "utf-8");
    expect(messages.join("\n")).toBe(expected);
  });
});
