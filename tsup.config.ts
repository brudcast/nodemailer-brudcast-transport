import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "node18",
  external: ["@ladjs/consolidate", "nodemailer"],
  footer: ({ format }) =>
    format === "cjs"
      ? { js: "module.exports = Object.assign(module.exports.default, module.exports);" }
      : undefined
});
