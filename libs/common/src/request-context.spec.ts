import { getRequestContext, runWithRequestContext } from "./request-context";

describe("request context", () => {
  it("keeps the request id available inside async work", async () => {
    const requestId = "req-123";

    const result = await new Promise<string>((resolve) => {
      runWithRequestContext({ requestId }, async () => {
        resolve(getRequestContext().requestId ?? "missing");
      });
    });

    expect(result).toBe(requestId);
  });
});
