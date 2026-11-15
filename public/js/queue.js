// The play queue: which song is next, with shuffle and repeat. Pure logic, no DOM, so it can be tested.
// `ids` is the context in album order (an album's playable songs). `order` is the order they play in:
// the same as `ids`, or a shuffle of them. `pos` points at the current song inside `order`.

/** Fisher-Yates on a copy. */
const shuffled = (list, rnd) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/** Seconds into a song after which "previous" restarts it instead of going back, like every music player. */
export const RESTART_AFTER = 3;

export function createQueue({ rnd = Math.random } = {}) {
  let ids = [], order = [], pos = -1;
  let shuffle = false, repeat = "off"; // repeat: "off" | "all" | "one"

  /** A fresh play order. With shuffle on, `first` plays first and the rest follow in random order. */
  const build = (first) => {
    if (!shuffle) return [...ids];
    const rest = shuffled(ids.filter((id) => id !== first), rnd);
    return first != null && ids.includes(first) ? [first, ...rest] : rest;
  };

  const q = {
    get shuffle() { return shuffle; },
    get repeat() { return repeat; },
    get ids() { return [...ids]; },
    get order() { return [...order]; },
    get current() { return order[pos] ?? null; },
    get size() { return ids.length; },

    /** Start a context. `startId` plays first; unplayed songs before it in album order are not skipped when linear. */
    load(list, startId = null) {
      ids = [...list];
      const start = ids.includes(startId) ? startId : ids[0] ?? null;
      order = build(start);
      pos = start == null ? -1 : order.indexOf(start);
      return q.current;
    },

    setShuffle(on) {
      on = !!on;
      if (on === shuffle) return;
      shuffle = on;
      const cur = q.current;
      order = build(cur);
      pos = cur == null ? -1 : order.indexOf(cur);
    },
    toggleShuffle() { q.setShuffle(!shuffle); return shuffle; },

    setRepeat(mode) { repeat = ["off", "all", "one"].includes(mode) ? mode : "off"; },
    cycleRepeat() { repeat = repeat === "off" ? "all" : repeat === "all" ? "one" : "off"; return repeat; },

    /** The context changed under us (songs added, removed or reordered). The current song keeps playing. */
    sync(list) {
      const cur = q.current;
      ids = [...list];
      if (!shuffle) {
        order = [...ids];
        pos = cur == null ? -1 : order.indexOf(cur);
        return;
      }
      // Keep the shuffle the listener already has: drop what's gone, drop the new songs in at random after the current one.
      const kept = order.filter((id) => ids.includes(id));
      const added = shuffled(ids.filter((id) => !kept.includes(id)), rnd);
      const at = cur == null ? -1 : kept.indexOf(cur);
      order = [...kept.slice(0, at + 1), ...shuffled([...kept.slice(at + 1), ...added], rnd)];
      pos = cur == null ? -1 : order.indexOf(cur);
    },

    /** What `next()` would play, so its audio can be made ready ahead of time. */
    peekNext(auto = true) {
      if (!order.length) return null;
      if (auto && repeat === "one") return q.current;
      if (pos + 1 < order.length) return order[pos + 1];
      // A new shuffled lap isn't decided until it starts, so there's nothing to get ready early.
      if (repeat !== "off" && !(shuffle && order.length > 1)) return order[0];
      return null;
    },

    /**
     * Advance. `auto` is true when a song ended by itself (repeat-one replays it) and false when the listener
     * pressed Next (repeat-one still moves on). Returns the song to play, or null at the end of the queue.
     */
    next(auto = true) {
      if (!order.length) return null;
      if (auto && repeat === "one") return q.current;
      if (pos + 1 < order.length) return order[++pos];
      if (repeat === "off") return null; // "one" only gets here when Next was pressed: it wraps like "all"
      if (shuffle && order.length > 1) {
        // A new lap gets a new shuffle, and never opens with the song that just finished.
        const last = order[pos];
        let again = build(null);
        if (again[0] === last) [again[0], again[1]] = [again[1], again[0]];
        order = again;
      }
      pos = 0;
      return order[0];
    },

    /**
     * Go back. Past RESTART_AFTER seconds in, or at the very start with nowhere to go, it restarts the current
     * song (returns it again); otherwise it steps to the one before, wrapping to the last song when repeating all.
     */
    prev(currentTime = 0) {
      if (!order.length) return null;
      if (currentTime > RESTART_AFTER) return q.current;
      if (pos > 0) return order[--pos];
      if (repeat !== "off") { pos = order.length - 1; return order[pos]; }
      return q.current;
    },

    /** Jump to a song already in the context (a tap on a row) without rebuilding the order. */
    jump(id) {
      const i = order.indexOf(id);
      if (i < 0) return null;
      pos = i;
      return id;
    },

    clear() { ids = []; order = []; pos = -1; },
  };
  return q;
}
