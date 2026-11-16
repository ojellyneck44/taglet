// Collaborators: invite someone to one album, as an editor or a listener, for a number of days or indefinitely.
//
// The album stays in its owner's library (one JSON document per user, see auth.js). A grant is a row saying
// "this user may use that album": listeners can read it and stream its songs, editors can also change its tags,
// song order and cover (never the audio, never delete it). Every request checks the grant when it arrives, so removing
// someone or an expired grant cuts access at once; the collaborator's copy disappears on their next sync.
//
// An invite is a single-use link (valid for 7 days). Opening it while signed in turns it into a grant, and for a timed
// grant the clock starts at that moment.

import { authDb, sha256, readLibrary, cleanLibrary } from "./auth.js";

const DAY = 86400000;
export const INVITE_DAYS = 7;
const ID = /^[a-z0-9]{6,16}$/; // album and song ids
const USER_ID = /^[a-z0-9]{6,40}$/; // account ids are longer
const HASH = /^[0-9a-f]{64}$/;
const ROLES = new Set(["view", "edit"]);
const MAX_PENDING = 20;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const rand = (bytes) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
const fail = (status, error) => { throw { status, error }; };

/** Whether a grant row still gives access. `expires_at` null means no end date. */
export const grantActive = (g, now = Date.now()) => !!g && (g.expires_at == null || g.expires_at > now);

/** True when two lists hold the same ids, in any order. */
export const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * What an editor's changes do to the owner's album. Pure, so it can be tested.
 * Allowed: title, artist, year, genre, compilation, each song's tags, the order of songs, the cover.
 * Never: adding or removing songs, audio, or anything outside this album.
 */
export function mergeSharedEdit(album, tracks, edit, { now = Date.now(), coverOk = false } = {}) {
  const inAlbum = new Set(album.trackIds);
  const reorder = sameSet(edit.album.trackIds, album.trackIds);
  const merged = {
    ...album,
    title: edit.album.title, albumArtist: edit.album.albumArtist, year: edit.album.year, genre: edit.album.genre, compilation: edit.album.compilation,
    trackIds: reorder ? edit.album.trackIds : album.trackIds,
    cover: edit.album.cover && coverOk ? edit.album.cover : edit.album.cover === null ? null : album.cover,
    updatedAt: now, collabEditAt: now,
  };
  const byId = new Map(edit.tracks.map((t) => [t.id, t]));
  const mergedTracks = tracks.map((t) => (inAlbum.has(t.id) && byId.has(t.id) ? { ...t, tags: byId.get(t.id).tags } : t));
  return { album: merged, tracks: mergedTracks };
}

/* ── Owner: invites and people ── */

export async function createInvite(env, user, { albumId, role, days }) {
  if (!ID.test(albumId || "") || !ROLES.has(role)) fail(400, "bad_request");
  const d = days == null ? null : Math.floor(Number(days));
  if (d !== null && !(d >= 1 && d <= 365)) fail(400, "bad_request");
  const lib = await readLibrary(env, user);
  if (!lib.albums.some((a) => a.id === albumId)) fail(409, "not_synced"); // the album has to be in the account first
  const db = await authDb(env), now = Date.now();
  await db.prepare("DELETE FROM collab_invites WHERE expires_at <= ?").bind(now).run();
  const pending = (await db.prepare("SELECT COUNT(*) AS n FROM collab_invites WHERE owner_id = ?").bind(user.id).first()).n;
  if (pending >= MAX_PENDING) fail(429, "too_many_invites");
  const token = rand(24), id = rand(8);
  const expiresAt = now + INVITE_DAYS * DAY;
  await db.prepare("INSERT INTO collab_invites (id, token_hash, owner_id, album_id, role, grant_days, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, await sha256(token), user.id, albumId, role, d, expiresAt, now).run();
  return { id, token, expiresAt };
}

export async function listPeople(env, user, albumId) {
  if (!ID.test(albumId || "")) fail(400, "bad_request");
  const db = await authDb(env), now = Date.now();
  await db.prepare("DELETE FROM collaborators WHERE expires_at IS NOT NULL AND expires_at <= ?").bind(now).run();
  const people = (await db.prepare(
    "SELECT c.id, c.role, c.expires_at, c.created_at, u.email, u.name FROM collaborators c JOIN users u ON u.id = c.user_id WHERE c.owner_id = ? AND c.album_id = ? ORDER BY c.created_at",
  ).bind(user.id, albumId).all()).results.map((r) => ({ id: r.id, role: r.role, expiresAt: r.expires_at, since: r.created_at, who: r.name || r.email }));
  const invites = (await db.prepare(
    "SELECT id, role, grant_days, expires_at FROM collab_invites WHERE owner_id = ? AND album_id = ? AND expires_at > ? ORDER BY created_at",
  ).bind(user.id, albumId, now).all()).results.map((r) => ({ id: r.id, role: r.role, days: r.grant_days, expiresAt: r.expires_at }));
  return { people, invites };
}

/** Owner removes a collaborator's access, or withdraws an invite nobody has used yet. */
export async function revoke(env, user, { personId, inviteId }) {
  const db = await authDb(env);
  if (personId) await db.prepare("DELETE FROM collaborators WHERE id = ? AND owner_id = ?").bind(String(personId), user.id).run();
  else if (inviteId) await db.prepare("DELETE FROM collab_invites WHERE id = ? AND owner_id = ?").bind(String(inviteId), user.id).run();
  else fail(400, "bad_request");
  return { ok: true };
}

/** A collaborator gives up their own access. */
export async function leave(env, user, { personId }) {
  await (await authDb(env)).prepare("DELETE FROM collaborators WHERE id = ? AND user_id = ?").bind(String(personId || ""), user.id).run();
  return { ok: true };
}

/* ── Collaborator: accepting and reading ── */

export async function accept(env, user, token) {
  if (typeof token !== "string" || !/^[0-9a-f]{48}$/.test(token)) fail(404, "invite_invalid");
  const db = await authDb(env), now = Date.now();
  const inv = await db.prepare("SELECT * FROM collab_invites WHERE token_hash = ?").bind(await sha256(token)).first();
  if (!inv || inv.expires_at <= now) fail(404, "invite_invalid");
  if (inv.owner_id === user.id) fail(400, "own_album");
  const owner = await readLibrary(env, { id: inv.owner_id });
  if (!owner.albums.some((a) => a.id === inv.album_id)) fail(404, "invite_invalid");
  const expires = inv.grant_days ? now + inv.grant_days * DAY : null;
  await db.batch([
    db.prepare(
      "INSERT INTO collaborators (id, owner_id, album_id, user_id, role, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT (owner_id, album_id, user_id) DO UPDATE SET role = excluded.role, expires_at = excluded.expires_at",
    ).bind(rand(8), inv.owner_id, inv.album_id, user.id, inv.role, expires, now),
    db.prepare("DELETE FROM collab_invites WHERE id = ?").bind(inv.id), // single use
  ]);
  return { albumId: inv.album_id, role: inv.role };
}

/** Every album shared with this user right now: the album, its songs, who owns it, and what they can do. */
export async function readShared(env, user) {
  const db = await authDb(env), now = Date.now();
  await db.prepare("DELETE FROM collaborators WHERE expires_at IS NOT NULL AND expires_at <= ?").bind(now).run();
  const grants = (await db.prepare(
    "SELECT c.id, c.owner_id, c.album_id, c.role, c.expires_at, u.email, u.name FROM collaborators c JOIN users u ON u.id = c.owner_id WHERE c.user_id = ?",
  ).bind(user.id).all()).results;
  const libs = new Map(), shared = [];
  for (const g of grants) {
    if (!libs.has(g.owner_id)) libs.set(g.owner_id, await readLibrary(env, { id: g.owner_id }));
    const lib = libs.get(g.owner_id);
    const album = lib.albums.find((a) => a.id === g.album_id);
    if (!album) { await db.prepare("DELETE FROM collaborators WHERE id = ?").bind(g.id).run(); continue; } // the owner deleted it
    shared.push({ id: g.id, ownerId: g.owner_id, owner: g.name || g.email, role: g.role, expiresAt: g.expires_at, album, tracks: lib.tracks.filter((t) => t.albumId === album.id) });
  }
  return { shared };
}

/* ── Access checks for the audio and cover routes ── */

/** May this user stream this song of this owner's? One query: an active grant on an album that lists the song. */
export async function canReadTrack(env, userId, ownerId, trackId) {
  if (!ID.test(trackId || "") || !USER_ID.test(ownerId || "")) return false;
  const row = await (await authDb(env)).prepare(
    `SELECT 1 AS ok FROM collaborators c JOIN user_data u ON u.user_id = c.owner_id, json_each(u.data, '$.albums') a
     WHERE c.user_id = ? AND c.owner_id = ? AND (c.expires_at IS NULL OR c.expires_at > ?) AND c.album_id = json_extract(a.value, '$.id')
       AND EXISTS (SELECT 1 FROM json_each(a.value, '$.trackIds') t WHERE t.value = ?) LIMIT 1`,
  ).bind(userId, ownerId, Date.now(), trackId).first();
  return !!row;
}

export async function canReadCover(env, userId, ownerId, hash) {
  if (!HASH.test(hash || "") || !USER_ID.test(ownerId || "")) return false;
  const row = await (await authDb(env)).prepare(
    `SELECT 1 AS ok FROM collaborators c JOIN user_data u ON u.user_id = c.owner_id, json_each(u.data, '$.albums') a
     WHERE c.user_id = ? AND c.owner_id = ? AND (c.expires_at IS NULL OR c.expires_at > ?) AND c.album_id = json_extract(a.value, '$.id')
       AND json_extract(a.value, '$.cover') = ? LIMIT 1`,
  ).bind(userId, ownerId, Date.now(), hash).first();
  return !!row;
}

/** Editors may upload a new cover into the owner's storage. */
export async function isEditorOf(env, userId, ownerId) {
  if (!USER_ID.test(ownerId || "")) return false;
  const row = await (await authDb(env)).prepare("SELECT expires_at FROM collaborators WHERE user_id = ? AND owner_id = ? AND role = 'edit' AND (expires_at IS NULL OR expires_at > ?) LIMIT 1")
    .bind(userId, ownerId, Date.now()).first();
  return !!row;
}

/* ── Editor: saving changes into the owner's album ── */

export async function writeShared(env, user, { ownerId, album, tracks }) {
  if (!USER_ID.test(ownerId || "") || !ID.test(album?.id || "")) fail(400, "bad_request");
  const db = await authDb(env);
  const g = await db.prepare("SELECT role, expires_at FROM collaborators WHERE user_id = ? AND owner_id = ? AND album_id = ?").bind(user.id, ownerId, album.id).first();
  if (!grantActive(g) || g.role !== "edit") fail(403, "forbidden");
  const edit = cleanLibrary({ albums: [album], tracks });
  if (!edit.albums.length) fail(400, "bad_request");
  const lib = await readLibrary(env, { id: ownerId });
  const mine = lib.albums.find((a) => a.id === album.id);
  if (!mine) fail(404, "gone");
  const cover = edit.albums[0].cover;
  const coverOk = cover ? !!(await db.prepare("SELECT 1 AS ok FROM covers WHERE user_id = ? AND hash = ?").bind(ownerId, cover).first()) : false;
  const merged = mergeSharedEdit(mine, lib.tracks, { album: edit.albums[0], tracks: edit.tracks }, { coverOk });
  const doc = {
    albums: lib.albums.map((a) => (a.id === merged.album.id ? merged.album : a)),
    tracks: merged.tracks.map(({ audio, ...t }) => t), // `audio` is computed on read, not stored
    deleted: lib.deleted || {},
  };
  const text = JSON.stringify(doc);
  if (text.length > 1_500_000) fail(413, "library_too_big");
  const updatedAt = Date.now();
  await db.prepare("INSERT OR REPLACE INTO user_data (user_id, data, updated_at) VALUES (?, ?, ?)").bind(ownerId, text, updatedAt).run();
  return { updatedAt: merged.album.updatedAt };
}
