import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

// Compile the pure client module without starting React, a browser, or a server.
const source = await readFile(new URL('./client-state.ts', import.meta.url), 'utf8');
const options = { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } };
const communitySource = await readFile(new URL('./community-state.ts', import.meta.url), 'utf8');
const communityUrl = `data:text/javascript;base64,${Buffer.from(ts.transpileModule(communitySource, options).outputText).toString('base64')}`;
const compiled = ts.transpileModule(source, options).outputText.replace('from "./community-state"', `from "${communityUrl}"`);
const { applyConfirmedMutation, SnapshotLoader } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

const player = { id: 'user-a', gameId: 'PlayerA', role: 'user', bio: 'A 的简介', avatarUrl: null };
const admin = { id: 'admin', gameId: 'Admin', role: 'admin', bio: '管理员简介', avatarUrl: null };
const venue = (id, owner = 'PlayerA') => ({ id, name: id, owner, x: 1, y: 64, z: 2, port: '港口', protected: false, imageUrl: null });
const song = (id, owner = 'PlayerA', shopIds = []) => ({ id, title: id, owner, artist: '作曲者', price: 100, customPrice: false, bars: 32, genre: '摇滚', description: '', shopIds, imageUrl: null });
const shop = (id) => ({ id, name: id, x: 1, y: 64, z: 2, port: '港口', owner: 'PlayerA', ownerId: player.id, canManage: true, imageUrl: null });
const show = (id, livehouseId, canDelete = true) => ({ id, livehouseId, date: '2026-11-14', hour: 20, playerId: 'PlayerA', title: id, createdAt: '1', canDelete });
const artist = (id, gameId, songCount, bio = '', avatarUrl = null) => ({ id, gameId, songCount, bio, avatarUrl, contact: undefined, registered: true });
const state = (overrides = {}) => ({ user: { ...player }, livehouses: [], events: [], songs: [], shops: [], genres: ['摇滚'], artists: [], ...overrides });
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test('a confirmed first song creates the registered artist and replaying a response never duplicates it', () => {
  const before = freeze(state());
  const created = song('new-song');
  const first = applyConfirmedMutation(before, '/api/songs', 'POST', created);
  assert.deepEqual(first.songs, [created]);
  assert.deepEqual(first.artists.find(a => a.id === player.id), artist(player.id, player.gameId, 1, player.bio));
  const second = applyConfirmedMutation(first, '/api/songs', 'POST', created);
  assert.equal(second.songs.length, 1);
  assert.equal(second.artists[0].songCount, 1);
  assert.deepEqual(before.songs, []);
});

test('admin deleting another player’s last song removes that artist and preserves everyone else', () => {
  const before = freeze(state({ user: admin, songs: [song('a'), song('admin-song', 'Admin')], artists: [artist(player.id, 'PlayerA', 1, player.bio), artist(admin.id, 'Admin', 1, admin.bio)] }));
  const after = applyConfirmedMutation(before, '/api/songs/a', 'DELETE', { ok: true });
  assert.deepEqual(after.songs.map(s => s.id), ['admin-song']);
  assert.deepEqual(after.artists, [artist(admin.id, 'Admin', 1, admin.bio)]);
  assert.equal(before.songs.length, 2);
});

test('song deletion updates the remaining count without losing artist identity or biography', () => {
  const before = freeze(state({ songs: [song('a'), song('b')], artists: [artist(player.id, 'PlayerA', 2, player.bio)] }));
  const after = applyConfirmedMutation(before, '/api/songs/a', 'DELETE', { ok: true });
  assert.deepEqual(after.artists, [artist(player.id, 'PlayerA', 1, player.bio)]);
});

test('deleting a shop removes its links across songs without deleting music or changing counts', () => {
  const before = freeze(state({ shops: [shop('shop-a'), shop('shop-b')], songs: [song('a', 'PlayerA', ['shop-a', 'shop-b']), song('b', 'PlayerA', ['shop-a'])], artists: [artist(player.id, 'PlayerA', 2, player.bio)] }));
  const after = applyConfirmedMutation(before, '/api/shops/shop-a', 'DELETE', { ok: true });
  assert.deepEqual(after.shops.map(s => s.id), ['shop-b']);
  assert.deepEqual(after.songs.map(s => s.shopIds), [['shop-b'], []]);
  assert.equal(after.songs.length, 2);
  assert.equal(after.artists[0].songCount, 2);
  assert.deepEqual(before.songs[0].shopIds, ['shop-a', 'shop-b']);
});

test('deleting a venue also removes its schedule while preserving unrelated venues and songs', () => {
  const before = freeze(state({ livehouses: [venue('venue-a'), venue('venue-b')], events: [show('1', 'venue-a'), show('2', 'venue-b'), show('3', 'venue-a')], songs: [song('music')] }));
  const after = applyConfirmedMutation(before, '/api/livehouses/venue-a', 'DELETE', { ok: true });
  assert.deepEqual(after.livehouses.map(v => v.id), ['venue-b']);
  assert.deepEqual(after.events.map(e => e.id), ['2']);
  assert.deepEqual(after.songs, before.songs);
});

test('create and edit shop responses update the existing item without creating duplicate entries', () => {
  const created = shop('new-shop');
  const first = applyConfirmedMutation(state(), '/api/shops', 'POST', created);
  const edited = { ...created, name: '新名称', port: '新港口' };
  const after = applyConfirmedMutation(freeze(first), '/api/shops/new-shop', 'PATCH', edited);
  assert.deepEqual(after.shops, [edited]);
});

test('new events use server-confirmed permissions; deleting an event updates only that event', () => {
  const before = state({ events: [show('1', 'venue-a')] });
  const created = show('2', 'venue-a', false);
  const first = applyConfirmedMutation(before, '/api/events', 'POST', created);
  assert.equal(first.events.find(e => e.id === '2').canDelete, false);
  const after = applyConfirmedMutation(first, '/api/events/1', 'DELETE', { ok: true });
  assert.deepEqual(after.events.map(e => e.id), ['2']);
});

test('cover edits use the new server URL and removals clear only the selected cover', () => {
  const before = freeze(state({ livehouses: [venue('venue-a')], songs: [song('a'), song('b')] }));
  const updated = applyConfirmedMutation(before, '/api/songs/a/image', 'PATCH', { imageUrl: '/api/images/new.webp' });
  assert.equal(updated.songs[0].imageUrl, '/api/images/new.webp');
  assert.equal(updated.songs[1].imageUrl, null);
  const removed = applyConfirmedMutation(updated, '/api/songs/a/image', 'PATCH', { imageUrl: null });
  assert.equal(removed.songs[0].imageUrl, null);
  const venueUpdated = applyConfirmedMutation(removed, '/api/livehouses/venue-a/image', 'PATCH', { imageUrl: '/api/images/venue.webp' });
  assert.equal(venueUpdated.livehouses[0].imageUrl, '/api/images/venue.webp');
  assert.equal(before.songs[0].imageUrl, null);
});

test('profile confirmation updates account and artist biography and avatar without a full refresh', () => {
  const before = freeze(state({ songs: [song('a')], artists: [artist(player.id, 'PlayerA', 1, player.bio)] }));
  const changedUser = { ...player, bio: '已保存的新简介', avatarUrl: '/api/images/profile.webp' };
  const after = applyConfirmedMutation(before, '/api/profile', 'PATCH', { user: changedUser });
  assert.equal(after.user.bio, changedUser.bio);
  assert.equal(after.artists[0].bio, changedUser.bio);
  assert.equal(after.artists[0].avatarUrl, changedUser.avatarUrl);
  const removed=applyConfirmedMutation(after,'/api/profile','PATCH',{user:{...changedUser,avatarUrl:null}});
  assert.equal(removed.user.avatarUrl,null);
  assert.equal(removed.artists[0].avatarUrl,null);
});

test('logging out immediately clears previous account’s editable permissions', () => {
  const before = freeze(state({ user: admin, shops: [shop('a')], events: [show('1', 'venue-a')] }));
  const after = applyConfirmedMutation(before, '/api/auth', 'POST', { user: null });
  assert.equal(after.user, null);
  assert.equal(after.shops[0].canManage, false);
  assert.equal(after.events[0].canDelete, false);
});

test('refreshes requested together share one network request', async () => {
  const pending = deferred(); let calls = 0; const snapshots = [];
  const loader = new SnapshotLoader(() => { calls++; return pending.promise; }, value => snapshots.push(value));
  const one = loader.load(), two = loader.load();
  await Promise.resolve();
  assert.equal(calls, 1);
  pending.resolve('snapshot');
  assert.equal(await one, true);
  assert.equal(await two, true);
  assert.deepEqual(snapshots, ['snapshot']);
  loader.dispose();
});

test('a stale read cannot resurrect a song deleted by a later confirmed mutation, even if abort is ignored', async () => {
  const old = deferred(), fresh = deferred(); const signals = []; let calls = 0;
  let current = state({ songs: [song('deleted')] });
  const loader = new SnapshotLoader(signal => { signals.push(signal); return ++calls === 1 ? old.promise : fresh.promise; }, value => { current = value; });
  const oldRead = loader.load();
  await Promise.resolve();
  loader.beginMutation();
  assert.equal(signals[0].aborted, true);
  assert.equal(await loader.load(), false);
  current = applyConfirmedMutation(current, '/api/songs/deleted', 'DELETE', { ok: true });
  loader.endMutation();
  const newRead = loader.load();
  fresh.resolve(current);
  assert.equal(await newRead, true);
  old.resolve(state({ songs: [song('deleted')] }));
  assert.equal(await oldRead, false);
  assert.deepEqual(current.songs, []);
  assert.equal(calls, 2);
  loader.dispose();
});

test('mutation failure still invalidates earlier reads and permits a fresh reconciliation', async () => {
  const old = deferred(), fresh = deferred(); let calls = 0; const snapshots = [];
  const loader = new SnapshotLoader(() => ++calls === 1 ? old.promise : fresh.promise, value => snapshots.push(value));
  const initial = loader.load();
  await Promise.resolve();
  loader.beginMutation();
  // The rejected write leaves local state untouched; its finally block unblocks the loader.
  loader.endMutation();
  const afterFailure = loader.load();
  old.resolve('stale-before-failed-write');
  assert.equal(await initial, false);
  fresh.resolve('current-server-state');
  assert.equal(await afterFailure, true);
  assert.deepEqual(snapshots, ['current-server-state']);
  loader.dispose();
});

test('a failed background refresh preserves confirmed local state and a later retry succeeds', async () => {
  const first = deferred(), retry = deferred(); let calls = 0;
  let current = applyConfirmedMutation(state(), '/api/songs', 'POST', song('saved'));
  const loader = new SnapshotLoader(() => ++calls === 1 ? first.promise : retry.promise, value => { current = value; });
  const refresh = loader.load();
  first.reject(new Error('network offline'));
  await assert.rejects(refresh, /network offline/);
  assert.deepEqual(current.songs.map(s => s.id), ['saved']);
  const again = loader.load();
  retry.resolve({ ...current, genres: ['摇滚', '爵士'] });
  assert.equal(await again, true);
  assert.deepEqual(current.genres, ['摇滚', '爵士']);
  loader.dispose();
});

test('stale errors are ignored and do not clear the newer request’s loading state', async () => {
  const old = deferred(), fresh = deferred(); let calls = 0; const loading = [];
  const loader = new SnapshotLoader(() => ++calls === 1 ? old.promise : fresh.promise, () => {}, value => loading.push(value));
  const oldRead = loader.load();
  await Promise.resolve();
  loader.beginMutation(); loader.endMutation();
  const newRead = loader.load();
  old.reject(new Error('stale failure'));
  assert.equal(await oldRead, false);
  assert.equal(loading.at(-1), true);
  fresh.resolve('new');
  assert.equal(await newRead, true);
  assert.equal(loading.at(-1), false);
  loader.dispose();
});

test('disposed loaders cannot publish a late response or start another fetch', async () => {
  const pending = deferred(); const snapshots = []; let calls = 0;
  const loader = new SnapshotLoader(() => { calls++; return pending.promise; }, value => snapshots.push(value));
  const reading = loader.load();
  await Promise.resolve();
  loader.dispose();
  pending.resolve('late');
  assert.equal(await reading, false);
  assert.equal(await loader.load(), false);
  assert.equal(calls, 1);
  assert.deepEqual(snapshots, []);
});


test('favorite cancellation only clears the heart and never removes the song', () => {
 const before=freeze(state({songs:[{...song('a'),favoriteCount:2,isFavorited:true,canEdit:true},song('b')]}));
 const after=applyConfirmedMutation(before,'/api/songs/a/favorite','DELETE',{id:'a',favoriteCount:1,isFavorited:false});
 assert.equal(after.songs.length,2);assert.equal(after.songs[0].favoriteCount,1);assert.equal(after.songs[0].isFavorited,false);
 assert.equal(after.songs[0].canEdit,true);assert.equal(before.songs[0].favoriteCount,2);
});
test('account changes immediately clear previous hearts and adjust editing permissions', () => {
 const before=freeze(state({songs:[{...song('a'),favoriteCount:2,isFavorited:true,canEdit:true}]}));
 for(const user of [null,{...player,id:'b',gameId:'PlayerB'}]){
  const after=applyConfirmedMutation(before,'/api/auth','POST',{user});
  assert.equal(after.songs[0].isFavorited,false);assert.equal(after.songs[0].canEdit,false);assert.equal(after.songs[0].favoriteCount,2);
 }
});
test('song and venue edits replace details without changing list order or counts', () => {
 const before=freeze(state({songs:[song('a'),song('b')],livehouses:[venue('v')]}));
 const edited={...before.songs[1],title:'Edited',favoriteCount:1,isFavorited:true,canEdit:true};
 const after=applyConfirmedMutation(before,'/api/songs/b','PATCH',edited);
 assert.deepEqual(after.songs.map(s=>s.id),['a','b']);assert.equal(after.songs[1].title,'Edited');
 const nextVenue={...before.livehouses[0],port:'',name:'New venue'};
 assert.deepEqual(applyConfirmedMutation(after,'/api/livehouses/v','PATCH',nextVenue).livehouses,[nextVenue]);
});
