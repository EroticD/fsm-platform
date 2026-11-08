import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { S3StorageDriver, type S3ClientLike } from "./s3-driver";

type CommandLike = {
  constructor: { name: string };
  input: Record<string, unknown>;
};

type Reply = unknown | ((command: CommandLike) => unknown);

function fakeClient(replies: Record<string, Reply>): {
  client: S3ClientLike;
  send: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn(async (command: unknown) => {
    const typed = command as CommandLike;
    const name = typed.constructor.name;
    const reply = replies[name];
    if (reply === undefined) throw new Error(`Uventet kommando ${name}`);
    return typeof reply === "function"
      ? (reply as (command: CommandLike) => unknown)(typed)
      : reply;
  });
  return { client: { send }, send };
}

describe("S3StorageDriver", () => {
  it("mapper nøkler under prefiks uten å endre appens relative nøkkel", async () => {
    const { client, send } = fakeClient({
      PutObjectCommand: {},
    });
    const driver = new S3StorageDriver(
      { bucket: "fsm", region: "eu-north-1", prefix: "prod/uploads" },
      client,
    );

    await driver.write("abc.pdf", Buffer.from("pdf"), {
      contentType: "application/pdf",
    });

    const input = (send.mock.calls[0][0] as CommandLike).input;
    expect(input).toMatchObject({
      Bucket: "fsm",
      Key: "prod/uploads/abc.pdf",
      ContentType: "application/pdf",
    });
  });

  it("leser og strømmer innhold", async () => {
    const { client } = fakeClient({
      GetObjectCommand: (command: CommandLike) => {
        if (command.input.Range) {
          return {
            Body: {
              transformToWebStream: () =>
                Readable.toWeb(Readable.from([Buffer.from("234")])),
            },
          };
        }
        return {
          Body: {
            transformToByteArray: async () => Uint8Array.from(Buffer.from("innhold")),
          },
        };
      },
    });
    const driver = new S3StorageDriver(
      { bucket: "fsm", region: "eu-north-1" },
      client,
    );

    await expect(driver.read("a.txt")).resolves.toEqual(Buffer.from("innhold"));
    const text = await new Response(
      await driver.stream("a.txt", { start: 2, end: 4 }),
    ).text();
    expect(text).toBe("234");
  });

  it("returnerer null når HeadObject sier 404", async () => {
    const { client } = fakeClient({
      HeadObjectCommand: () => {
        throw Object.assign(new Error("ikke funnet"), {
          $metadata: { httpStatusCode: 404 },
        });
      },
    });
    const driver = new S3StorageDriver(
      { bucket: "fsm", region: "eu-north-1" },
      client,
    );
    await expect(driver.stat("borte.pdf")).resolves.toBeNull();
  });

  it("lister paginert og fjerner prefikset fra nøklene", async () => {
    const { client } = fakeClient({
      ListObjectsV2Command: (command: CommandLike) =>
        command.input.ContinuationToken
          ? {
              Contents: [
                {
                  Key: "prod/uploads/.transfer/job-b/package.zip",
                  Size: 2,
                },
              ],
              IsTruncated: false,
            }
          : {
              Contents: [
                {
                  Key: "prod/uploads/.transfer/job-a/package.zip",
                  Size: 1,
                },
              ],
              IsTruncated: true,
              NextContinuationToken: "neste",
            },
    });
    const driver = new S3StorageDriver(
      { bucket: "fsm", region: "eu-north-1", prefix: "prod/uploads" },
      client,
    );

    const objects = await driver.list(".transfer");
    expect(objects.map((object) => object.key)).toEqual([
      ".transfer/job-a/package.zip",
      ".transfer/job-b/package.zip",
    ]);
  });

  it("sletter idempotent med riktig objektnøkkel", async () => {
    const { client, send } = fakeClient({ DeleteObjectCommand: {} });
    const driver = new S3StorageDriver(
      { bucket: "fsm", region: "eu-north-1", prefix: "p" },
      client,
    );
    await driver.delete("a.pdf");
    expect((send.mock.calls[0][0] as CommandLike).input).toMatchObject({
      Bucket: "fsm",
      Key: "p/a.pdf",
    });
  });

  it("healthCheck bruker HeadBucket og feiler videre til kalleren", async () => {
    const { client, send } = fakeClient({
      HeadBucketCommand: () => {
        throw new Error("credentials mangler");
      },
    });
    const driver = new S3StorageDriver(
      { bucket: "fsm", region: "eu-north-1" },
      client,
    );
    await expect(driver.healthCheck()).rejects.toThrow("credentials");
    expect((send.mock.calls[0][0] as CommandLike).input).toMatchObject({
      Bucket: "fsm",
    });
  });
});
