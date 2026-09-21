/**
 * Reads the words printed inside every logo, once, and writes them to data/letters.json.
 * MobileCLIP cannot read: it scores "a logo with letters in it" at chance. Apple's Vision can, locally and free.
 * Safe to re-run: only images with no entry yet are read. Runs in its own helper process, so searches stay quick.
 *
 *   node scripts/read-letters.mjs
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const root = process.cwd();
const OUT = path.join(root, "data", "letters.json");
const items = JSON.parse(fs.readFileSync(path.join(root, "data", "library.json"), "utf8"));
const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const todo = items.filter((it) => done[it.id] === undefined);
console.log(`${items.length} images, ${items.length - todo.length} already read, ${todo.length} to go`);
if (!todo.length) process.exit(0);

const proc = spawn(path.join(root, "native", "coreml_embed"), [path.join(root, "models")]);
const waiting = new Map();
readline.createInterface({ input: proc.stdout }).on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.ready) return start();
  waiting.get(msg.id)?.(msg);
  waiting.delete(msg.id);
});
const ask = (id, file) => new Promise((res) => (waiting.set(id, res), proc.stdin.write(JSON.stringify({ id, op: "ocr", path: path.join(root, "public", "icons", file) }) + "\n")));

let read = 0;
let withText = 0;
const save = () => fs.writeFileSync(OUT, JSON.stringify(done));
async function start() {
  const began = Date.now();
  for (const [n, it] of todo.entries()) {
    const r = await ask(n + 1, it.file);
    done[it.id] = r.ok ? r.letters : "";
    if (done[it.id]) withText++;
    if (++read % 200 === 0) {
      save();
      const left = ((Date.now() - began) / read) * (todo.length - read);
      console.log(`${read}/${todo.length}  ${withText} have writing  about ${Math.round(left / 60000)} min left`);
    }
  }
  save();
  console.log(`done: ${read} read, ${withText} have writing in them`);
  proc.kill();
  process.exit(0);
}
