// node src/collab.test.mjs  (uses node:sqlite as a stand-in for D1)
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { grantActive, sameSet, mergeSharedEdit } from "./collab.js";
import * as collab from "./collab.js";
import * as auth from "./auth.js";

// ── pure parts
assert.ok(grantActive({ expires_at: null }));
assert.ok(grantActive({ expires_at: Date.now() + 1000 }));
assert.ok(!grantActive({ expires_at: Date.now() - 1 }));
assert.ok(!grantActive(null));
assert.ok(sameSet(["a", "b", "c"], ["c", "a", "b"]) && !sameSet(["a", "b"], ["a", "c"]) && !sameSet(["a"], ["a", "b"]));
{
  const album = { id: "alb1", title: "Old", albumArtist: "X", year: "2020", genre: "", compilation: false, trackIds: ["t1", "t2"], cover: "c".repeat(64), updatedAt: 5 };
  const tracks = [{ id: "t1", albumId: "alb1", fileName: "a.mp3", tags: { title: "One" } }, { id: "t2", albumId: "alb1", fileName: "b.mp3", tags: { title: "Two" } }, { id: "z9", albumId: "other", tags: { title: "Keep" } }];
  const edit = { album: { ...album, title: "New", trackIds: ["t2", "t1"], cover: "d".repeat(64) }, tracks: [{ id: "t1", tags: { title: "Uno" } }, { id: "z9", tags: { title: "Hacked" } }, { id: "t3", tags: { title: "Injected" } }] };
  const r = mergeSharedEdit(album, tracks, edit, { now: 99, coverOk: false });
  assert.equal(r.album.title, "New");
  assert.deepEqual(r.album.trackIds, ["t2", "t1"], "reorder allowed");
  assert.equal(r.album.cover, "c".repeat(64), "a cover that wasn't uploaded is ignored");
  assert.equal(r.album.updatedAt, 99); assert.equal(r.album.collabEditAt, 99);
  assert.equal(r.tracks.find((t) => t.id === "t1").tags.title, "Uno");
  assert.equal(r.tracks.find((t) => t.id === "t1").fileName, "a.mp3", "audio fields untouched");
  assert.equal(r.tracks.find((t) => t.id === "z9").tags.title, "Keep", "songs outside the album can't be edited");
  assert.equal(r.tracks.length, 3, "no songs added");
  assert.deepEqual(mergeSharedEdit(album, tracks, { album: { ...edit.album, trackIds: ["t1", "t3"] }, tracks: [] }).album.trackIds, ["t1", "t2"], "adding or dropping songs is ignored");
  assert.equal(mergeSharedEdit(album, tracks, edit, { coverOk: true }).album.cover, "d".repeat(64));
  assert.equal(mergeSharedEdit(album, tracks, { album: { ...edit.album, cover: null }, tracks: [] }).album.cover, null, "removing the cover is allowed");
}

// ── against a SQL database (D1 stand-in)
const sqlite = new DatabaseSync(":memory:");
const wrap = (sql) => {
  let args = [];
  const st = { bind: (...a) => { args = a; return st; }, first: async () => sqlite.prepare(sql).get(...args) ?? null, all: async () => ({ results: sqlite.prepare(sql).all(...args) }), run: async () => { sqlite.prepare(sql).run(...args); return {}; }, exec: () => sqlite.prepare(sql).run(...args) };
  return st;
};
const env = { DB: { prepare: wrap, batch: async (list) => { for (const s of list) s.exec(); return []; } }, AUDIO: { delete: async () => {}, get: async () => null } };
await auth.authDb(env);
const now = Date.now();
for (const [id, email] of [["own1own1own1own1own1own1", "owner@x.com"], ["ed1ed1ed1ed1ed1ed1ed1ed", "editor@x.com"], ["vw1vw1vw1vw1vw1vw1vw1vw", "viewer@x.com"]]) sqlite.prepare("INSERT INTO users (id, email, name, created_at, seen_at) VALUES (?, ?, '', ?, ?)").run(id, email, now, now);
const owner = { id: "own1own1own1own1own1own1" }, editor = { id: "ed1ed1ed1ed1ed1ed1ed1ed" }, viewer = { id: "vw1vw1vw1vw1vw1vw1vw1vw" }; // real ids are 24 characters
const tags = (title) => ({ title, artists: ["A"], track: 0, disc: 0 });
await auth.writeLibrary(env, owner, {
  albums: [{ id: "alb1alb1", title: "Mine", albumArtist: "A", year: "2026", genre: "", compilation: false, trackIds: ["trk1trk1", "trk2trk2"], cover: null, updatedAt: 100 },
    { id: "alb2alb2", title: "Private", albumArtist: "A", trackIds: ["trk3trk3"], updatedAt: 100 }],
  tracks: [{ id: "trk1trk1", albumId: "alb1alb1", tags: tags("One") }, { id: "trk2trk2", albumId: "alb1alb1", tags: tags("Two") }, { id: "trk3trk3", albumId: "alb2alb2", tags: tags("Secret") }],
});

// inviting needs the album to be in the account
await assert.rejects(collab.createInvite(env, owner, { albumId: "nope1234", role: "view", days: null }), { error: "not_synced" });
await assert.rejects(collab.createInvite(env, owner, { albumId: "alb1alb1", role: "admin", days: null }), { error: "bad_request" });
const inv = await collab.createInvite(env, owner, { albumId: "alb1alb1", role: "edit", days: 30 });
assert.ok(inv.token.length === 48 && inv.expiresAt > now + 6 * 864e5);
assert.equal((await collab.listPeople(env, owner, "alb1alb1")).invites.length, 1);

// accept: not your own, single use, grant clock starts now
await assert.rejects(collab.accept(env, owner, inv.token), { error: "own_album" });
await assert.rejects(collab.accept(env, editor, "0".repeat(48)), { error: "invite_invalid" });
const got = await collab.accept(env, editor, inv.token);
assert.deepEqual(got, { albumId: "alb1alb1", role: "edit" });
await assert.rejects(collab.accept(env, viewer, inv.token), { error: "invite_invalid" }, "an invite works once");
const people = (await collab.listPeople(env, owner, "alb1alb1")).people;
assert.equal(people.length, 1); assert.equal(people[0].who, "editor@x.com");
const days = (people[0].expiresAt - Date.now()) / 864e5;
assert.ok(days > 29.9 && days <= 30, "30 days from acceptance");

// an editor sees only the shared album, and can reach its songs but not the owner's other songs
const shared = (await collab.readShared(env, editor)).shared;
assert.equal(shared.length, 1); assert.equal(shared[0].album.id, "alb1alb1"); assert.equal(shared[0].tracks.length, 2); assert.equal(shared[0].role, "edit");
assert.ok(await collab.canReadTrack(env, editor.id, owner.id, "trk1trk1"));
assert.ok(!(await collab.canReadTrack(env, editor.id, owner.id, "trk3trk3")), "songs in other albums stay private");
assert.ok(!(await collab.canReadTrack(env, viewer.id, owner.id, "trk1trk1")), "strangers get nothing");
assert.ok(await collab.isEditorOf(env, editor.id, owner.id));

// editing: tags and order change in the owner's album; the owner's newer-device push can't erase them
const r = await collab.writeShared(env, editor, { ownerId: owner.id, album: { ...shared[0].album, title: "Edited", trackIds: ["trk2trk2", "trk1trk1"] }, tracks: [{ id: "trk1trk1", albumId: "alb1alb1", tags: tags("Uno") }] });
assert.ok(r.updatedAt >= now);
let lib = await auth.readLibrary(env, owner);
assert.equal(lib.albums[0].title, "Edited"); assert.deepEqual(lib.albums[0].trackIds, ["trk2trk2", "trk1trk1"]);
assert.equal(lib.tracks.find((t) => t.id === "trk1trk1").tags.title, "Uno");
assert.equal(lib.albums.find((a) => a.id === "alb2alb2").title, "Private", "other albums untouched");
await auth.writeLibrary(env, owner, { albums: [{ id: "alb1alb1", title: "Stale", trackIds: ["trk1trk1", "trk2trk2"], updatedAt: 50 }, { id: "alb2alb2", title: "Private", trackIds: ["trk3trk3"], updatedAt: 100 }], tracks: [{ id: "trk1trk1", albumId: "alb1alb1", tags: tags("Old") }, { id: "trk2trk2", albumId: "alb1alb1", tags: tags("Two") }, { id: "trk3trk3", albumId: "alb2alb2", tags: tags("Secret") }] });
lib = await auth.readLibrary(env, owner);
assert.equal(lib.albums.find((a) => a.id === "alb1alb1").title, "Edited", "a stale device can't overwrite a collaborator's newer edit");
await auth.writeLibrary(env, owner, { albums: [{ id: "alb1alb1", title: "Owner again", trackIds: ["trk2trk2", "trk1trk1"], updatedAt: Date.now() + 5000 }], tracks: [{ id: "trk1trk1", albumId: "alb1alb1", tags: tags("Uno") }, { id: "trk2trk2", albumId: "alb1alb1", tags: tags("Two") }] });
lib = await auth.readLibrary(env, owner);
assert.equal(lib.albums[0].title, "Owner again", "after the owner syncs and edits, their newer version wins");

// a listener can read but not write
const inv2 = await collab.createInvite(env, owner, { albumId: "alb1alb1", role: "view", days: null });
await collab.accept(env, viewer, inv2.token);
assert.equal(sqlite.prepare("SELECT expires_at FROM collaborators WHERE user_id = ?").get(viewer.id).expires_at, null, "indefinite means no end date");
await assert.rejects(collab.writeShared(env, viewer, { ownerId: owner.id, album: shared[0].album, tracks: [] }), { error: "forbidden" });
assert.ok(await collab.canReadTrack(env, viewer.id, owner.id, "trk2trk2"));

// revoking cuts access at once
const person = (await collab.listPeople(env, owner, "alb1alb1")).people.find((p) => p.who === "viewer@x.com");
await collab.revoke(env, owner, { personId: person.id });
assert.ok(!(await collab.canReadTrack(env, viewer.id, owner.id, "trk2trk2")));
assert.equal((await collab.readShared(env, viewer)).shared.length, 0);
await assert.rejects(collab.writeShared(env, viewer, { ownerId: owner.id, album: shared[0].album, tracks: [] }), { error: "forbidden" });

// expiry cuts access without anyone doing anything
sqlite.prepare("UPDATE collaborators SET expires_at = ? WHERE user_id = ?").run(Date.now() - 1000, editor.id);
assert.ok(!(await collab.canReadTrack(env, editor.id, owner.id, "trk1trk1")), "an expired grant gives no access");
assert.ok(!(await collab.isEditorOf(env, editor.id, owner.id)));
assert.equal((await collab.readShared(env, editor)).shared.length, 0);

// invites can be withdrawn, expire, and the owner deleting the album ends the grants
const inv3 = await collab.createInvite(env, owner, { albumId: "alb1alb1", role: "view", days: 7 });
await collab.revoke(env, owner, { inviteId: inv3.id });
await assert.rejects(collab.accept(env, viewer, inv3.token), { error: "invite_invalid" });
const inv4 = await collab.createInvite(env, owner, { albumId: "alb1alb1", role: "view", days: 7 });
sqlite.prepare("UPDATE collab_invites SET expires_at = ?").run(Date.now() - 1);
await assert.rejects(collab.accept(env, viewer, inv4.token), { error: "invite_invalid" }, "an old invite link stops working");
const inv5 = await collab.createInvite(env, owner, { albumId: "alb1alb1", role: "view", days: null });
await collab.accept(env, viewer, inv5.token);
await auth.writeLibrary(env, owner, { albums: [], tracks: [] });
assert.equal((await collab.readShared(env, viewer)).shared.length, 0, "deleting the album ends the sharing");

// leaving
const inv6 = await auth.writeLibrary(env, owner, { albums: [{ id: "alb1alb1", title: "Back", trackIds: ["trk1trk1"], updatedAt: 1 }], tracks: [{ id: "trk1trk1", albumId: "alb1alb1", tags: tags("One") }] }).then(() => collab.createInvite(env, owner, { albumId: "alb1alb1", role: "view", days: null }));
await collab.accept(env, viewer, inv6.token);
const mine = (await collab.readShared(env, viewer)).shared[0];
await collab.leave(env, viewer, { personId: mine.id });
assert.equal((await collab.readShared(env, viewer)).shared.length, 0);
console.log("collab ok");
