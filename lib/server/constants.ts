// Server-only invariants. No API can edit this account or the protected venue.
// Never import this module from client components.
export const ADMIN = Object.freeze({
  id: 'system-admin', gameId: 'Bocchi_TheGlock', role: 'admin' as const,
  salt: '153be41f040e99ecee3b27eed269c353',
  passwordHash: 'a0fa8ad9b68bcdfba8a45e87cd04a62a5b016fe16fa0d80f06096b82e7dbc415',
});
export const STARRY = Object.freeze({
  id: 'starry', name: 'Starry Livehouse', x: -6374, y: 67, z: 8820,
  port: '凯撒岛中心港', owner: ADMIN.gameId, protected: true,
});
export const DEFAULT_GENRES = Object.freeze([
  '摇滚','流行','古典','爵士','民谣','电子','金属','朋克','后摇',
  '独立摇滚','另类摇滚','硬摇滚','前卫摇滚','布鲁斯','R&B','灵魂乐',
  '放克','嘻哈','说唱','雷鬼','乡村','蓝草','拉丁','波萨诺瓦',
  '迪斯科','舞曲','浩室','Techno','Trance','Dubstep','Drum & Bass',
  '氛围音乐','实验音乐','新世纪','管弦乐','室内乐','交响乐','歌剧',
  '钢琴','指弹','合唱','福音','中国风','世界音乐','City Pop',
  'J-Pop','K-Pop','动漫音乐','游戏音乐','影视配乐','Vocaloid','Lo-fi','其他',
]);
