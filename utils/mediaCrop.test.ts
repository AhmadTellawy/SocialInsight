import assert from 'node:assert/strict';
import test from 'node:test';
import { cropFromOriginal, moveSourceCrop } from './mediaCrop.ts';
import { acquireBodyScrollLock } from './bodyScrollLock.ts';

test('nested photo and creator dialogs release page scrolling in either cleanup order', () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const document = { body: { style: { overflow: 'auto' } } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  try {
    for (const parentFirst of [true, false]) {
      const parent = acquireBodyScrollLock(); const child = acquireBodyScrollLock();
      (parentFirst ? parent : child)();
      assert.equal(document.body.style.overflow, 'hidden');
      (parentFirst ? child : parent)();
      assert.equal(document.body.style.overflow, 'auto');
      parent(); child();
      assert.equal(document.body.style.overflow, 'auto');
    }
  } finally {
    if (before) Object.defineProperty(globalThis, 'document', before);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});

test('square to portrait reveals source pixels instead of narrowing the square', () => {
  const square = cropFromOriginal(2 / 3, 1);
  const portrait = cropFromOriginal(2 / 3, .8, square);
  assert.equal(square.crop.width, 1);
  assert.equal(portrait.crop.width, 1);
  assert.ok(Math.abs(portrait.crop.height - 5 / 6) < 1e-10);
  assert.ok(portrait.crop.y < square.crop.y);
  assert.deepEqual(cropFromOriginal(2 / 3, 2 / 3, portrait).crop, { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(cropFromOriginal(2 / 3, 1, portrait), square);
});

test('repeated changes keep focal position and stay inside each original', () => {
  for (const source of [.1, 2 / 3, 1, 1.5, 8]) {
    let crop = cropFromOriginal(source, 1);
    crop = moveSourceCrop(crop, .2, -.1);
    const focal = [crop.focalX, crop.focalY];
    for (const ratio of [.8, 1, source, .8, 1]) {
      crop = cropFromOriginal(source, ratio, crop);
      assert.deepEqual([crop.focalX, crop.focalY], focal);
      assert.ok(crop.crop.x >= 0 && crop.crop.y >= 0);
      assert.ok(crop.crop.x + crop.crop.width <= 1 + 1e-10);
      assert.ok(crop.crop.y + crop.crop.height <= 1 + 1e-10);
      assert.ok(Math.abs(crop.crop.width * source / crop.crop.height - ratio) < 1e-9);
    }
  }
});

test('movement clamps at source edges and preserves accessibility text', () => {
  const crop = { ...cropFromOriginal(2, 1), altText: 'A landscape' };
  const moved = moveSourceCrop(crop, 100, -100);
  assert.equal(moved.crop.x, .5);
  assert.equal(moved.crop.y, 0);
  assert.equal(cropFromOriginal(2, .8, moved).altText, 'A landscape');
  assert.throws(() => cropFromOriginal(0, 1));
  assert.throws(() => cropFromOriginal(1, NaN));
});
