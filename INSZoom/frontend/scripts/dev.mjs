import { createServer } from "vite";
import { viteOptions } from "./vite-options.mjs";

const server = await createServer(viteOptions(process.cwd()));
await server.listen();
server.printUrls();

const close = async () => {
  await server.close();
  process.exit(0);
};

process.once("SIGINT", close);
process.once("SIGTERM", close);
