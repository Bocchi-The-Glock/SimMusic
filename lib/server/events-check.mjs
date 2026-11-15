import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase } from '../../server/storage.mjs';

const directory = await mkdtemp(join(tmpdir(), 'simmusic-events-'));
const base = 'http://127.0.0.1:3199';
const token = randomBytes(32).toString('hex');
const adminCookie = `simlive_session=${token}`;
const database = openDatabase(directory);
// Local test-only session: no production account password or credential is needed.
await database.prepare('INSERT INTO sessions (token_hash,user_id,expires_at) VALUES (?,?,?)')
  .bind(createHash('sha256').update(token).digest('hex'), 'system-admin', Date.now() + 60_000).run();
database.close();
let output = '', checks = 0;
const child = spawn(process.execPath, ['server.js'], {
  cwd: resolve('dist/standalone'),
  env: { ...process.env, HOST: '127.0.0.1', PORT: '3199', SIMMUSIC_DATA_DIR: directory },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', value => output += value);
child.stderr.on('data', value => output += value);

async function call(path, method = 'GET', body, cookie = '', expected = 200) {
  const response = await fetch(base + path, {
    method,
    headers: { Origin: base, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
  checks++;
  return { data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const register = name => call('/api/auth', 'POST', { mode: 'register', gameId: name, password: 'event-test-only', confirmPassword: 'event-test-only' }, '', 201);
const createShow = async (playerId, cookie = '', livehouseId = 'starry') => (await call('/api/events', 'POST', {
  livehouseId, date: '2026-11-15', hour: 20, playerId, title: 'Permission test',
}, cookie, 201)).data;
async function assertDeleteControl(eventId, cookie, expected) {
  const { data } = await call('/api/state', 'GET', undefined, cookie);
  assert.equal(data.events.find(event => event.id === eventId)?.canDelete, expected);
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(base + '/api/state')).ok) { ready = true; break; } } catch {}
    if (child.exitCode !== null) throw Error(output);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, 'Server must start');
  const owner = await register('Mixed_Player');
  const stranger = await register('Another_Player');
  const guestBooking = await createShow('mIXED_pLAYER');
  assert.equal(guestBooking.canDelete, false);
  await assertDeleteControl(guestBooking.id, '', false);
  await assertDeleteControl(guestBooking.id, owner.cookie, true);
  await assertDeleteControl(guestBooking.id, stranger.cookie, false);
  await call(`/api/events/${guestBooking.id}`, 'DELETE', undefined, '', 401);
  await call(`/api/events/${guestBooking.id}`, 'DELETE', undefined, stranger.cookie, 403);
  await call(`/api/events/${guestBooking.id}`, 'DELETE', undefined, owner.cookie);
  await call(`/api/events/${guestBooking.id}`, 'DELETE', undefined, owner.cookie, 404);

  const punctuationBooking = await createShow('Mixed__Player');
  await assertDeleteControl(punctuationBooking.id, owner.cookie, false);
  await call(`/api/events/${punctuationBooking.id}`, 'DELETE', undefined, owner.cookie, 403);
  await assertDeleteControl(punctuationBooking.id, adminCookie, true);
  await call(`/api/events/${punctuationBooking.id}`, 'DELETE', undefined, adminCookie);

  const authenticatedBooking = await createShow('Spoofed_Name', owner.cookie);
  assert.equal(authenticatedBooking.playerId, 'Mixed_Player');
  assert.equal(authenticatedBooking.canDelete, true);
  await assertDeleteControl(authenticatedBooking.id, owner.cookie, true);
  await call(`/api/events/${authenticatedBooking.id}`, 'DELETE', undefined, owner.cookie);

  const venueBody = { name: 'Permission venue', x: 1, y: 64, z: 2, port: '' };
  const venue = (await call('/api/livehouses', 'POST', venueBody, owner.cookie, 201)).data;
  assert.equal(typeof venue.createdAt, 'number');
  assert.ok(venue.createdAt > 0);
  const anotherGuest = await createShow('SomeoneElse', '', venue.id);
  await assertDeleteControl(anotherGuest.id, owner.cookie, true);
  await call(`/api/events/${anotherGuest.id}`, 'DELETE', undefined, owner.cookie);
  const adminBooking = await createShow('Another_Player', stranger.cookie, venue.id);
  await assertDeleteControl(adminBooking.id, adminCookie, true);
  await call(`/api/events/${adminBooking.id}`, 'DELETE', undefined, adminCookie);
  const editedVenue = (await call(`/api/livehouses/${venue.id}`, 'PATCH', { ...venueBody, name: 'Edited venue' }, owner.cookie)).data;
  assert.equal(editedVenue.createdAt, venue.createdAt);

  const songBody = { title: 'Timestamp test', artist: 'Artist', price: 10, customPrice: false, bars: null, genre: '摇滚', description: '', shopIds: [] };
  const song = (await call('/api/songs', 'POST', songBody, owner.cookie, 201)).data;
  assert.equal(typeof song.createdAt, 'number');
  assert.ok(song.createdAt > 0);
  const editedSong = (await call(`/api/songs/${song.id}`, 'PATCH', { ...songBody, title: 'Edited song' }, owner.cookie)).data;
  assert.equal(editedSong.createdAt, song.createdAt);
  const { data: finalState } = await call('/api/state', 'GET', undefined, owner.cookie);
  assert.equal(finalState.songs.find(item => item.id === song.id).createdAt, song.createdAt);
  assert.equal(finalState.livehouses.find(item => item.id === venue.id).createdAt, venue.createdAt);
  assert.equal(finalState.livehouses.find(item => item.id === 'starry').createdAt, 0);
  assert.equal(finalState.events.length, 0);
  console.log(`PASS ${checks} event/ordering API checks; guest ID ownership, case handling, admin rights, denial and stable timestamps`);
} catch (error) { console.error(output); throw error; }
finally {
  if (child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  await rm(directory, { recursive: true });
}
