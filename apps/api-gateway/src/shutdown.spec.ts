import { registerGracefulShutdown } from "./shutdown";

describe("graceful shutdown", () => {
  it("closes the Nest app on termination signals", async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const app = { close } as any;
    const listeners: Record<string, Function> = {};
    const on = jest.fn((signal: string, handler: Function) => {
      listeners[signal] = handler;
    });

    const processMock = { on } as any;
    registerGracefulShutdown(app, processMock);

    expect(on).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
    expect(on).toHaveBeenCalledWith("SIGINT", expect.any(Function));

    await listeners.SIGTERM();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
