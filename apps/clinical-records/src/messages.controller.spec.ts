import { ForbiddenException } from "@nestjs/common";
import { database } from "../../../libs/common/src/database";
import { MessagesController } from "./messages.controller";

jest.mock("../../../libs/common/src/database");

const mockedDatabase = database as jest.MockedFunction<typeof database>;

function mockClient() {
  const query = jest.fn()
    .mockResolvedValueOnce(undefined) // BEGIN
    .mockResolvedValueOnce({ rowCount: 1 }) // beginIdempotent insert
    .mockResolvedValueOnce({}) // insert messages
    .mockResolvedValueOnce({}) // completeIdempotent
    .mockResolvedValueOnce(undefined); // COMMIT
  return { query, release: jest.fn() };
}

describe("MessagesController.send", () => {
  let controller: MessagesController;

  beforeEach(() => {
    controller = new MessagesController();
    mockedDatabase.mockReset();
  });

  it("derives fromRole=clinician and authorId from the caller's own token for a staff sender", async () => {
    const client = mockClient();
    mockedDatabase.mockReturnValue({ connect: () => Promise.resolve(client) } as any);

    const result = await controller.send(
      "patient-1",
      { tenantId: "tenant-1", text: "How are you feeling?" },
      "idem-key-1234567890",
      { user: { sub: "staff-1", tenantId: "tenant-1" } },
    );

    expect(result).toMatchObject({ fromRole: "clinician", authorId: "staff-1" });
    const insertParams = client.query.mock.calls[2][1] as unknown[];
    expect(insertParams.slice(1)).toEqual(["patient-1", "tenant-1", "clinician", "staff-1", "How are you feeling?"]);
  });

  it("derives fromRole=patient and authorId from the caller's own token for a patient sender", async () => {
    const client = mockClient();
    mockedDatabase.mockReturnValue({ connect: () => Promise.resolve(client) } as any);

    const result = await controller.send(
      "patient-1",
      { tenantId: "tenant-1", text: "Feeling better today" },
      "idem-key-1234567890",
      { user: { sub: "patient-1" } },
    );

    expect(result).toMatchObject({ fromRole: "patient", authorId: "patient-1" });
  });

  it("rejects a patient sending on behalf of a different patient id", async () => {
    await expect(
      controller.send(
        "patient-1",
        { tenantId: "tenant-1", text: "..." },
        "idem-key-1234567890",
        { user: { sub: "patient-2" } },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects staff from a different tenant", async () => {
    await expect(
      controller.send(
        "patient-1",
        { tenantId: "tenant-1", text: "..." },
        "idem-key-1234567890",
        { user: { sub: "staff-1", tenantId: "tenant-2" } },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
