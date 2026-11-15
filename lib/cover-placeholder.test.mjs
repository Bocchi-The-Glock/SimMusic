import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import ts from 'typescript';

const source = await readFile(new URL('./cover-placeholder.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { coverText, coverLines, wrapCoverName, coverTypography, coverPalette } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('song covers include complete words up to ten characters including spaces', () => {
  assert.equal(coverText('Hello World', 'song'), 'Hello');
  assert.equal(coverText('A New Song', 'song'), 'A New Song');
  assert.equal(coverText('Hello Moon tonight', 'song'), 'Hello Moon');
  assert.equal(coverText('The Long Road Home', 'song'), 'The Long');
  assert.equal(coverText('A very long title', 'song'), 'A very');
  assert.equal(coverText('One extraordinarily long word', 'song'), 'One');
  assert.equal(coverText('Hi there', 'song'), 'Hi there');
});

test('only an overlong first word may be truncated', () => {
  assert.equal(coverText('Extraordinary Days', 'song'), 'Extraordinary');
  assert.equal(coverText('abcdefghij more words', 'song'), 'abcdefghij');
  assert.equal(coverText('九月的风吹过凯撒岛港口', 'song'), '九月的风吹过凯撒岛港');
});

test('whitespace is normalized before applying the character budget', () => {
  assert.equal(coverText('  Hello\t\nMoon   tonight  ', 'song'), 'Hello Moon');
  assert.equal(coverText('one\u3000two\u00a0three', 'song'), 'one two');
  assert.equal(coverText('  \n\t ', 'song'), '?');
});

test('venue and shop covers use at most eight characters per line and three lines', () => {
  assert.equal(coverText('Starry Livehouse', 'venue'), 'Starry\nLivehouse');
  assert.equal(coverText('凯撒岛中央音乐商店', 'shop'), '凯撒岛中央音乐商\n店');
  assert.equal(coverText('ABC', 'venue'), 'ABC');
  assert.equal(coverText('Hello World', 'shop'), 'Hello\nWorld');
  assert.deepEqual(wrapCoverName('一二三四五六七八九十一二三四五六七八九十一二三四五六'), ['一二三四五六七八','九十一二三四五六','七八九十一二三四']);
  assert.deepEqual(wrapCoverName('Alpha Beta Gamma Delta'), ['Alpha Beta','Gamma','Delta']);
  assert.deepEqual(wrapCoverName(''), ['?']);
});

test('spaces count toward eight characters and whole words move to the next line', () => {
  assert.deepEqual(wrapCoverName('Blue Sky Port'), ['Blue Sky', 'Port']);
  assert.deepEqual(wrapCoverName('Blue Skys Port'), ['Blue Skys', 'Port']);
  assert.deepEqual(wrapCoverName('A New Day'), ['A New Day']);
  assert.deepEqual(wrapCoverName('凯撒 Blue 港口'), ['凯撒 Blue', '港口']);
  assert.deepEqual(wrapCoverName('  Blue\tSky\n Port  '), ['Blue Sky', 'Port']);
});

test('overlong words split safely without overflowing or exceeding three lines', () => {
  assert.deepEqual(wrapCoverName('abcdefghijklmnopqrstuvwx more'), ['abcdefghijklmnopqrstuvwx','more']);
  assert.deepEqual(wrapCoverName('AB Extraordinary XYZ'), ['AB','Extraordinary','XYZ']);
  assert.deepEqual(wrapCoverName('👨‍👩‍👧‍👦12345678'), ['👨‍👩‍👧‍👦12345678']);
});

test('song layout balances CJK without changing its ten-character selection', () => {
  assert.deepEqual(coverLines('一二三四五六七八九十十一', 'song'), ['一二三四五','六七八九十']);
  assert.deepEqual(coverLines('Hello Moon tonight', 'song'), ['Hello Moon']);
  assert.deepEqual(coverLines('A New Song', 'song'), ['A New Song']);
  assert.deepEqual(coverLines('Extraordinary', 'song'), ['Extraordinary']);
  assert.equal(coverLines('音乐会今天开场 ABC', 'song').join(''), coverText('音乐会今天开场 ABC', 'song').replaceAll(' ',''));
});

test('avatars use one visible initial and do not split accents or emoji', () => {
  assert.equal(coverText('  bocchi', 'avatar'), 'B');
  assert.equal(coverText('凯撒', 'avatar'), '凯');
  assert.equal(coverText('e\u0301toile', 'avatar'), 'É');
  assert.equal(coverText('ßinger', 'avatar'), 'S');
  assert.equal(coverText('👩🏽‍🎤Music', 'avatar'), '👩🏽‍🎤');
  assert.equal(coverText('🇨🇳 Music', 'avatar'), '🇨🇳');
});

test('song and multiline covers preserve whole Unicode graphemes', () => {
  assert.equal(coverText('👨‍👩‍👧‍👦123456789XY', 'song'), '👨‍👩‍👧‍👦123456789XY');
  assert.equal(coverText('e\u0301123456789', 'venue'), 'é123456789');
  assert.equal(coverText('🎸 Rock Band', 'song'), '🎸 Rock');
});

test('font choice is stable and offers four local font styles', () => {
  const original = coverTypography('persistent-id', 'song');
  assert.deepEqual(coverTypography('persistent-id', 'song'), original);
  const choices = new Set(Array.from({length:100},(_,index)=>coverTypography(`song-${index}`, 'song').key));
  assert.equal(choices.size, 4);
  assert.ok(original.family.includes('serif'));
  assert.ok(!original.family.includes('http'));
});

test('stable identities retain their palette and different identities vary', () => {
  const original = coverPalette('persistent-id', 'song');
  assert.deepEqual(coverPalette('persistent-id', 'song'), original);
  const backgrounds = new Set(Array.from({ length: 100 }, (_, index) => coverPalette(`song-${index}`, 'song').background));
  assert.ok(backgrounds.size >= 8);
  assert.match(original.background, /^#[0-9a-f]{6}$/);
  assert.match(original.foreground, /^#[0-9a-f]{6}$/);
});

test('browsers without Intl.Segmenter retain common emoji sequences', () => {
  const commonJs = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const legacy = runInNewContext(`${commonJs}\nexports;`, { exports: {}, Intl: {} });
  assert.equal(legacy.coverText('👩🏽‍🎤Music', 'avatar'), '👩🏽‍🎤');
  assert.equal(legacy.coverText('🇨🇳 Music', 'avatar'), '🇨🇳');
  assert.equal(legacy.coverText('👨‍👩‍👧‍👦123456789XY', 'song'), '👨‍👩‍👧‍👦123456789XY');
});
