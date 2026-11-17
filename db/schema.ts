import { sqliteTable, text, integer, real, primaryKey, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(), gameId: text('game_id').notNull(),
  gameKey: text('game_key').notNull().unique(), salt: text('salt').notNull(),
  passwordHash: text('password_hash').notNull(), createdAt: integer('created_at').notNull(),
});
export const players = sqliteTable('players', {
  id:text('id').primaryKey(), gameId:text('game_id').notNull(), gameKey:text('game_key').notNull().unique(), contact:text('contact').notNull().default(''),
});
export const importRecords = sqliteTable('import_records', {
  source:text('source').notNull(), sourceId:text('source_id').notNull(), entityId:text('entity_id').notNull(),
},t=>[primaryKey({columns:[t.source,t.sourceId]})]);
export const profiles = sqliteTable('profiles', {
  userId: text('user_id').primaryKey(), bio: text('bio').notNull().default(''),
});
export const sessions = sqliteTable('sessions', {
  tokenHash: text('token_hash').primaryKey(), userId: text('user_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (t) => [index('sessions_expiry_idx').on(t.expiresAt)]);
export const livehouses = sqliteTable('livehouses', {
  id: text('id').primaryKey(), name: text('name').notNull(),
  x: integer('x').notNull(), y: integer('y').notNull(), z: integer('z').notNull(),
  port: text('port').notNull(), owner: text('owner').notNull(),
  ownerId: text('owner_id').notNull(), createdAt: integer('created_at').notNull(),
});
export const events = sqliteTable('events', {
  id: integer('id').primaryKey({autoIncrement: true}),
  livehouseId: text('livehouse_id').notNull(), date: text('date').notNull(),
  hour: integer('hour').notNull(), playerId: text('player_id').notNull(),
  creatorId: text('creator_id'), title: text('title').notNull(),
  createdAt: integer('created_at').notNull(),
}, (t) => [index('events_schedule_idx').on(t.livehouseId, t.date, t.hour, t.id)]);
export const shops = sqliteTable('shops', {
  id: text('id').primaryKey(), name: text('name').notNull(), nameKey: text('name_key').notNull().unique(),
  x: integer('x').notNull(), y: integer('y').notNull(), z: integer('z').notNull(),
  port: text('port').notNull(), createdAt: integer('created_at').notNull(),
  ownerId: text('owner_id'), creatorId:text('creator_id'), coordinatesKnown:integer('coordinates_known',{mode:'boolean'}).notNull().default(true),
});
export const genres = sqliteTable('genres', {
  name: text('name').primaryKey(), nameKey: text('name_key').notNull().unique(),
});
export const songs = sqliteTable('songs', {
  id: text('id').primaryKey(), title: text('title').notNull(), artist: text('artist').notNull(),
  price: real('price'), customPrice: integer('custom_price', {mode: 'boolean'}).notNull(),
  instruments:text('instruments').notNull().default('["钢琴"]'), saleX:integer('sale_x'),saleY:integer('sale_y'),saleZ:integer('sale_z'),
  bars: integer('bars').notNull(), genre: text('genre').notNull(), description: text('description').notNull(),
  owner: text('owner').notNull(), ownerId: text('owner_id').notNull(), createdAt: integer('created_at').notNull(),
});
export const songShops = sqliteTable('song_shops', {
  songId: text('song_id').notNull().references(() => songs.id, {onDelete: 'cascade'}),
  shopId: text('shop_id').notNull().references(() => shops.id),
}, (t) => [primaryKey({columns:[t.songId,t.shopId]})]);
export const rateWindows = sqliteTable('rate_windows', {
  key: text('key').primaryKey(), count: integer('count').notNull(), resetAt: integer('reset_at').notNull(),
});
export const entityImages = sqliteTable('entity_images', {
  entityType: text('entity_type').notNull(), entityId: text('entity_id').notNull(),
  objectKey: text('object_key').notNull().unique(), mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
}, (t) => [primaryKey({columns: [t.entityType, t.entityId]})]);

// The fixed administrator is not stored in users, so userId is session-validated.
export const favorites = sqliteTable('favorites', {
  songId: text('song_id').notNull().references(() => songs.id, {onDelete: 'cascade'}),
  userId: text('user_id').notNull(), createdAt: integer('created_at').notNull(),
}, (t) => [primaryKey({columns: [t.songId, t.userId]}), index('favorites_user_idx').on(t.userId)]);

export const bands = sqliteTable('bands', {
 id:text('id').primaryKey(), name:text('name').notNull(), captainId:text('captain_id').notNull().references(()=>players.id), createdAt:integer('created_at').notNull(),
},t=>[uniqueIndex('bands_captain_unique').on(t.captainId)]);
export const bandMembers = sqliteTable('band_members', {
 bandId:text('band_id').notNull().references(()=>bands.id,{onDelete:'cascade'}), playerId:text('player_id').notNull().references(()=>players.id),
},t=>[primaryKey({columns:[t.bandId,t.playerId]}),index('band_members_player_idx').on(t.playerId)]);
export const activities = sqliteTable('activities', {
 id:text('id').primaryKey(), name:text('name').notNull(), date:text('date').notNull(), description:text('description').notNull(), location:text('location').notNull(),
 ownerId:text('owner_id').notNull().references(()=>players.id), livehouseId:text('livehouse_id'), createdAt:integer('created_at').notNull(),
},t=>[uniqueIndex('activities_venue_date_unique').on(t.livehouseId,t.date)]);
export const activitySignups = sqliteTable('activity_signups', {
 id:integer('id').primaryKey({autoIncrement:true}), activityId:text('activity_id').notNull().references(()=>activities.id,{onDelete:'cascade'}),
 kind:text('kind').notNull(), playerId:text('player_id').notNull(), bandId:text('band_id').references(()=>bands.id), creatorId:text('creator_id'), participantKey:text('participant_key').notNull(), createdAt:integer('created_at').notNull(),
},t=>[uniqueIndex('activity_signup_participant_unique').on(t.activityId,t.participantKey)]);
