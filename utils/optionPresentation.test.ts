import assert from 'node:assert/strict';
import test from 'node:test';
import type { MediaDraft } from '../types.ts';
import {
  reconcileOptionMediaDrafts,
  resolveOptionPresentation,
  shouldShowOptionNames
} from './optionPresentation.ts';

const draft = (clientId: string, replacesClientId?: string): MediaDraft => ({
  clientId,
  replacesClientId,
  file: null,
  previewUrl: '',
  purpose: 'OPTION_IMAGE',
  status: 'editing',
  progress: 0,
  aspectRatio: 1
});

const option = (id: string) => ({ id, text: '', image: undefined, mediaDrafts: [] as MediaDraft[] });

test('derives legacy image presentation without changing explicit text presentation', () => {
  assert.equal(resolveOptionPresentation(undefined, [{ image: 'legacy.webp' }]), 'image');
  assert.equal(resolveOptionPresentation('text', [{ image: 'legacy.webp' }]), 'text');
  assert.equal(resolveOptionPresentation(undefined, [{ image: undefined }]), 'text');
});

test('bulk drafts preserve labels, fill empty image slots, and append in picker order', () => {
  let nextId = 3;
  const first = { ...option('one'), text: 'Messi' };
  const second = { ...option('two'), text: 'Ronaldo' };
  const result = reconcileOptionMediaDrafts(
    [first, second],
    [draft('a'), draft('b'), draft('c'), draft('d')],
    () => option(String(nextId++))
  );

  assert.deepEqual(result.map((item) => item.id), ['one', 'two', '3', '4']);
  assert.deepEqual(result.map((item) => item.mediaDrafts[0]?.clientId), ['a', 'b', 'c', 'd']);
  assert.deepEqual(result.slice(0, 2).map((item) => item.text), ['Messi', 'Ronaldo']);
});

test('replacement drafts remain attached to the original option slot', () => {
  const first = { ...option('one'), mediaDrafts: [draft('old')] };
  const second = option('two');
  const result = reconcileOptionMediaDrafts(
    [first, second],
    [draft('new', 'old')],
    () => option('unused')
  );

  assert.equal(result[0].mediaDrafts[0].clientId, 'new');
  assert.equal(result[1].mediaDrafts.length, 0);
});

test('canceling an unfinished legacy-image replacement restores the legacy image', () => {
  const replacing = { ...option('one'), image: 'legacy.webp', mediaDrafts: [draft('replacement')] };
  const result = reconcileOptionMediaDrafts([replacing], [], () => option('unused'));

  assert.equal(result[0].image, 'legacy.webp');
  assert.equal(result[0].mediaDrafts.length, 0);
});

test('hidden names apply only to image presentation', () => {
  assert.equal(shouldShowOptionNames('image', false), false);
  assert.equal(shouldShowOptionNames('image', true), true);
  assert.equal(shouldShowOptionNames('text', false), true);
});
