// Bundle the solve server for AWS Lambda into server/out (see the README's "Solve server"): the handler (index.js) with the search helper, the scoring
// worker and its helper it starts in threads (helper.js, scoring.js, scoring-helper.js), the full pair answer files gzipped (answers/), all of it zipped
// into server/out/puzzly-server.zip for server/deploy.mjs; plus check.js (not zipped), the whole-solve check through the server.
// ANSWERS=name1,name2 picks other answer files from bench/out/pairs (default CFOP levels 2 and 3's pair files)
import { build } from "esbuild";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, statSync, writeFileSync, writeSync } from "node:fs";
import { crc32, gzipSync } from "node:zlib";

const OUT = "server/out";
const ZIP = `${OUT}/puzzly-server.zip`;
const ANSWERS = (process.env.ANSWERS ?? "cfop-level-2-pair-1,cfop-level-3-pair-1").split(",");

await build({
  entryPoints: { index: "server/handler.ts", helper: "bench/helper.ts", scoring: "bench/scoring.ts", "scoring-helper": "bench/scoring-helper.ts", check: "server/check.ts" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  // Everything bundled in (Lambda has no node_modules), but the AWS SDK, which comes with Lambda's Node runtime
  external: ["@aws-sdk/*"],
  // A require left in a bundled package works in an ES module
  banner: { js: 'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);' },
  loader: { ".wasm": "binary" },
  outdir: OUT,
  logLevel: "warning",
});
// Lambda reads .js as an ES module only with this
writeFileSync(`${OUT}/package.json`, '{ "type": "module" }\n');

// The full answer files, gzipped once (again when the file is newer)
mkdirSync(`${OUT}/answers`, { recursive: true });
for (const name of ANSWERS) {
  const from = `bench/out/pairs/${name}.answers`;
  const to = `${OUT}/answers/${name}.answers.gz`;
  if (!existsSync(from)) throw new Error(`${from} is missing: make it with bench/answer-file.ts`);
  if (existsSync(to) && statSync(to).mtimeMs >= statSync(from).mtimeMs) continue;
  console.log(`Gzipping ${from}…`);
  writeFileSync(to, gzipSync(readFileSync(from)));
}
// Answer files no longer asked for go out of the zip
const answers = readdirSync(`${OUT}/answers`).filter((name) => ANSWERS.some((wanted) => name === `${wanted}.answers.gz`));

// The zip, each file stored as it is (the answer files are gzipped already; the code is a few MB), readable by everyone (Lambda runs as another user)
const files = ["index.js", "helper.js", "scoring.js", "scoring-helper.js", "package.json", ...answers.map((name) => `answers/${name}`)];
const zip = openSync(ZIP, "w");
const central = [];
let offset = 0;
const write = (buffer) => {
  writeSync(zip, buffer);
  offset += buffer.length;
};
for (const name of files) {
  const data = readFileSync(`${OUT}/${name}`);
  const path = Buffer.from(name);
  const crc = crc32(data);
  // Local header: version 2.0, no flags, stored, 1980-01-01, crc, sizes, name
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x21, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(path.length, 26);
  // Central entry: made on Unix (so the mode counts), the same fields, mode 0644, where the local header is
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(0x0314, 4);
  entry.writeUInt16LE(20, 6);
  entry.writeUInt16LE(0x21, 14);
  entry.writeUInt32LE(crc, 16);
  entry.writeUInt32LE(data.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(path.length, 28);
  entry.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  entry.writeUInt32LE(offset, 42);
  central.push(entry, path);
  write(local);
  write(path);
  write(data);
}
const centralAt = offset;
for (const part of central) write(part);
// End of the central directory: its entries, size and place
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(offset - centralAt, 12);
end.writeUInt32LE(centralAt, 16);
write(end);
closeSync(zip);
console.log(`Built ${ZIP} (${(offset / 1e6).toFixed(1)} MB: ${files.join(", ")}) and ${OUT}/check.js`);
