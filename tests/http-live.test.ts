import { createServer } from "node:http";
import { afterEach, expect, it } from "vitest";
import { httpFetch } from "../src/utils/http.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

it("sends aisa-cli as the actual HTTP User-Agent", async () => {
  const received: string[] = [];
  const server = createServer((request, response) => {
    received.push(request.headers["user-agent"] ?? "");
    response.end("ok");
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const address = server.address();
  if (!address || typeof address === "string") throw new Error("missing test port");
  const response = await httpFetch(`http://127.0.0.1:${address.port}/`, {
    headers: { "user-agent": "other-client" },
  });

  expect(await response.text()).toBe("ok");
  expect(received).toEqual(["aisa-cli"]);
});
