// node public/js/queue.test.mjs
import assert from "node:assert/strict";
import { createQueue, RESTART_AFTER } from "./queue.js";

// A seeded generator so the shuffle tests are repeatable.
const seeded = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const ids = ["a", "b", "c", "d", "e"];

// Linear: play the first song and listen through to the last, then stop.
{
  const q = createQueue();
  assert.equal(q.load(ids, "a"), "a");
  const heard = ["a"];
  for (let n; (n = q.next()); ) heard.push(n);
  assert.deepEqual(heard, ids);
  assert.equal(q.next(), null, "the end of the album stops");
  assert.equal(q.current, "e", "and stays on the last song");
}

// Starting mid-album plays on to the end; going back reaches the earlier songs.
{
  const q = createQueue();
  q.load(ids, "c");
  assert.equal(q.next(), "d");
  assert.equal(q.prev(0), "c");
  assert.equal(q.prev(0), "b");
}

// Repeat all wraps both ways; repeat one replays on its own but Next still moves on.
{
  const q = createQueue();
  q.load(ids, "e"); q.setRepeat("all");
  assert.equal(q.next(), "a");
  assert.equal(q.prev(0), "e");
  q.setRepeat("one");
  assert.equal(q.next(true), "e", "ended by itself: again");
  assert.equal(q.next(false), "a", "Next pressed: on to the next song");
  assert.equal(q.cycleRepeat(), "off");
  assert.equal(q.cycleRepeat(), "all");
  assert.equal(q.cycleRepeat(), "one");
}

// Previous restarts the song when it is more than a few seconds in, and at the very start with nothing before it.
{
  const q = createQueue();
  q.load(ids, "c");
  assert.equal(q.prev(RESTART_AFTER + 1), "c");
  assert.equal(q.prev(RESTART_AFTER), "b");
  q.load(ids, "a");
  assert.equal(q.prev(0), "a", "first song, repeat off: restart it");
}

// Shuffle: every song once, the current one first, and turning it off keeps your place.
{
  const q = createQueue({ rnd: seeded(7) });
  q.load(ids, "c");
  q.setShuffle(true);
  assert.equal(q.current, "c");
  assert.equal(q.order[0], "c");
  assert.deepEqual([...q.order].sort(), ids);
  const heard = ["c"];
  for (let n; (n = q.next()); ) heard.push(n);
  assert.deepEqual([...heard].sort(), ids, "every song plays exactly once");
  q.load(ids, "b"); q.setShuffle(true); q.next();
  const here = q.current;
  q.setShuffle(false);
  assert.equal(q.current, here);
  assert.equal(q.next(), ids[ids.indexOf(here) + 1] ?? null, "back to album order from where you are");
}

// Shuffle + repeat all: a new lap is a new shuffle and never opens with the song that just ended.
{
  const q = createQueue({ rnd: seeded(3) });
  q.load(ids, "a"); q.setShuffle(true); q.setRepeat("all");
  for (let lap = 0; lap < 20; lap++) {
    const seen = new Set([q.current]);
    let last = q.current;
    for (let i = 1; i < ids.length; i++) { last = q.next(); seen.add(last); }
    assert.equal(seen.size, ids.length, "a lap covers the whole album");
    const first = q.next();
    assert.notEqual(first, last, "no immediate repeat across laps");
  }
}

// One song, repeat all, shuffle on: still plays (no infinite shuffle loop, no crash).
{
  const q = createQueue();
  q.load(["a"], "a"); q.setShuffle(true); q.setRepeat("all");
  assert.equal(q.next(), "a");
}

// The album changes under a playing queue: the current song keeps its place.
{
  const q = createQueue();
  q.load(ids, "c");
  q.sync(["c", "a", "b", "z"]);            // reordered, one added, two removed
  assert.equal(q.current, "c");
  assert.equal(q.next(), "a");
  q.sync(["b", "z"]);                      // the playing song ("a") was removed
  assert.equal(q.current, null);
  const s = createQueue({ rnd: seeded(11) });
  s.load(ids, "b"); s.setShuffle(true); s.next();
  const cur = s.current;
  s.sync([...ids, "new"]);
  assert.equal(s.current, cur, "shuffle keeps the current song through a sync");
  assert.deepEqual([...s.order].sort(), [...ids, "new"].sort());
}

// peekNext agrees with next, and an empty queue is safe.
{
  const q = createQueue();
  q.load(ids, "a");
  assert.equal(q.peekNext(), "b");
  q.load(ids, "e");
  assert.equal(q.peekNext(), null);
  q.setRepeat("all");
  assert.equal(q.peekNext(), "a");
  const e = createQueue();
  assert.equal(e.next(), null); assert.equal(e.prev(0), null); assert.equal(e.peekNext(), null); assert.equal(e.current, null);
}

console.log("queue ok");
