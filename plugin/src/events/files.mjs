// files.mjs (src/events) - the two things every command that changes the project's files shares.
//
//   writeAtomic(file, text)      the whole file or nothing: written beside the target, then renamed over it
//   withWriteLock(fn, options)   ONE lock for every command that writes the record, the settings or the memory
//                                files. It is held for the whole read-change-write. A second command waits
//                                briefly, then stops with "another command is writing: run it again" and has
//                                changed nothing.
//
// The lock is a file in the local folder holding the holder's process id. A lock whose process is gone is taken
// over at once; one that cannot be read is taken over after a minute.
import fs from "node:fs";
import path from "node:path";
import { ROOT, LOCAL } from "../build/config.mjs";

const DIR = path.resolve(ROOT, LOCAL);
export const WRITE_LOCK = path.join(DIR, "write.lock");
export const LOCKED_MESSAGE = "another command is writing: run it again. Nothing was changed.";
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const BUSY = ["EEXIST", "EPERM", "EBUSY", "EACCES"]; // on Windows a file another process is touching answers any of these

export function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  // A file marked read-only is not replaced behind its owner's back (a rename would do exactly that on POSIX).
  if (fs.existsSync(file)) fs.accessSync(file, fs.constants.W_OK);
  const tmp = file + "." + process.pid + ".tmp";
  try {
    fs.writeFileSync(tmp, text);
    for (let tries = 0; ; tries++) {
      try { fs.renameSync(tmp, file); break; }
      catch (err) { if (!BUSY.includes(err.code) || tries >= 20) throw err; sleep(15); } // a reader had it open for an instant
    }
  } catch (err) { try { fs.rmSync(tmp, { force: true }); } catch { /* nothing was left */ } throw err; }
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (err) { return err.code === "EPERM"; } };
// Is the lock left by a run that is gone? Returns what was read, so only that very lock is taken away.
function stale(lock) {
  let text = "", mtime = 0;
  try { text = fs.readFileSync(lock, "utf8"); mtime = fs.statSync(lock).mtimeMs; } catch { return null; }
  let pid = null; try { pid = JSON.parse(text).pid; } catch { /* not readable: its age decides */ }
  if (Number.isInteger(pid) && pid > 0) return alive(pid) ? null : text;
  return Date.now() - mtime > 60000 ? text : null;
}

export function withWriteLock(fn, { lock = WRITE_LOCK, waitMs = null } = {}) {
  const env = Number(process.env.COCKPIT_LOCK_WAIT_MS);
  const wait = waitMs != null ? waitMs : Number.isFinite(env) && env >= 0 && env <= 60000 ? env : 4000;
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  const until = Date.now() + wait;
  for (;;) {
    try { const fd = fs.openSync(lock, "wx"); try { fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() })); } finally { fs.closeSync(fd); } break; }
    catch (err) {
      if (!BUSY.includes(err.code)) throw err;
      const old = stale(lock);
      if (old != null) {
        // Take away that lock and no other: if a new holder wrote its own in the meantime, leave it be.
        try { if (fs.readFileSync(lock, "utf8") === old) fs.rmSync(lock, { force: true }); } catch { /* it is gone already */ }
        continue;
      }
      if (Date.now() >= until) throw Object.assign(new Error(LOCKED_MESSAGE), { code: "LOCKED" });
      sleep(20);
    }
  }
  try { return fn(); }
  finally { for (let i = 0; i < 50; i++) { try { fs.rmSync(lock, { force: true }); break; } catch { sleep(5); } } }
}
