import { build } from "vite";
import { viteOptions } from "./vite-options.mjs";

await build(viteOptions(process.cwd()));
