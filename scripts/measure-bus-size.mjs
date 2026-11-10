import { Buffer } from "node:buffer";
import { log } from "node:console";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

for (const entry of ["src/bus/index.ts", "src/client/busHooks.ts"]) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    write: false,
    format: "esm",
    external: ["react", "react-dom", "react-dom/client"],
    target: "es2020",
  });
  const bundle = Buffer.concat(result.outputFiles.map((file) => file.contents));
  log(
    `${entry}: ${bundle.length} B minified, ${gzipSync(bundle).length} B gzip`,
  );
}
