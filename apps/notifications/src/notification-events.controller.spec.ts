import { database } from "../../../libs/common/src/database";
import { NotificationEventsController } from "./notification-events.controller";

jest.mock("../../../libs/common/src/database");

const mockedDatabase = database as jest.MockedFunction<typeof database>;

function mockClient(queryImpl: jest.Mock) {
  return { query: queryImpl, release: jest.fn() };
}

describe("NotificationEventsController.notificationsRequested", () => {
  let controller: NotificationEventsController;

  beforeEach(() => {
    controller = new NotificationEventsController();
    mockedDatabase.mockReset();
  });

  it("inserts a feed row for a new event", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rowCount: 1 }) // inbox insert (new)
      .mockResolvedValueOnce({}) // insert notifications_feed
      .mockResolvedValueOnce(undefined); // COMMIT
    mockedDatabase.mockReturnValue({ connect: () => Promise.resolve(mockClient(query)) } as any);

    await controller.notificationsRequested({
      key: "evt-1",
      value: { recipient: "user-1", message: "Your dose is due", category: "reminder" },
    });

    const insertCall = query.mock.calls[2];
    expect(insertCall[0]).toContain("INSERT INTO notifications_feed");
    expect(insertCall[1]).toEqual(expect.arrayContaining(["user-1", "reminder", null, "Your dose is due"]));
  });

  it("does nothing beyond the dedupe insert when the event was already processed", async () => {
    const query = jest.fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce(undefined);
    mockedDatabase.mockReturnValue({ connect: () => Promise.resolve(mockClient(query)) } as any);

    await controller.notificationsRequested({ key: "evt-1", value: { recipient: "user-1", message: "..." } });

    expect(query).toHaveBeenCalledTimes(3);
  });

  it("ignores a message with no key", async () => {
    const connect = jest.fn();
    mockedDatabase.mockReturnValue({ connect } as any);

    await controller.notificationsRequested({ value: { recipient: "user-1", message: "..." } });

    expect(connect).not.toHaveBeenCalled();
  });
});
