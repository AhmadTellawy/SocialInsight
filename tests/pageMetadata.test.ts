import assert from 'node:assert/strict';
import test from 'node:test';
import { metadataPageHandle, parsePublicPageMetadata, writePageMetadata } from '../utils/pageMetadata.ts';

const publicMetadata = { title: 'A Page | Opiniup', description: 'Public bio', canonicalUrl: 'https://opiniup.com/pages/a_page', imageUrl: 'https://socialinsight-api.onrender.com/api/media/public-image' };

test('private, malformed, and nested routes never request public metadata', () => {
  for (const path of ['/pages', '/pages/manage', '/pages/manage/123', '/pages/create', '/pages/mine', '/pages/staff', '/pages/cases', '/pages/invitations', '/pages/blocks', '/pages/%61_page', '/pages/a_page/extra']) {
    assert.equal(metadataPageHandle(path), null, path);
  }
  assert.equal(metadataPageHandle('/pages/a_page'), 'a_page');
});

test('canonical metadata rejects hostile origins, credentials, private paths, and image protocols', () => {
  assert.deepEqual(parsePublicPageMetadata(publicMetadata), publicMetadata);
  for (const canonicalUrl of ['https://evil.example/pages/a_page', 'https://opiniup.com.evil.example/pages/a_page', 'https://x@opiniup.com/pages/a_page', 'https://opiniup.com/pages/manage', 'https://opiniup.com/pages/a_page?token=secret']) {
    assert.equal(parsePublicPageMetadata({ ...publicMetadata, canonicalUrl }), null);
  }
  for (const imageUrl of ['javascript:alert(1)', 'data:text/html,<script>', 'https://secret@opiniup.com/image']) {
    assert.equal(parsePublicPageMetadata({ ...publicMetadata, imageUrl }), null);
  }
  assert.equal(parsePublicPageMetadata({ id: 'private-page', name: 'Private draft' }), null);
});

function mockDocument() {
  const nodes: Array<{ attributes: Record<string, string>; remove(): void; setAttribute(key: string, value: string): void }> = [];
  const document = {
    title: 'Opiniup',
    querySelectorAll: () => [...nodes],
    createElement: () => {
      const element = { attributes: {} as Record<string, string>, setAttribute(key: string, value: string) { this.attributes[key] = value; }, remove() { nodes.splice(nodes.indexOf(element), 1); } };
      return element;
    },
    head: { appendChild: (node: typeof nodes[number]) => nodes.push(node) },
  };
  return { document: document as unknown as Document, nodes };
}

test('metadata writes literal attacker text and removes prior Page identity on error/private route/unmount', () => {
  const { document, nodes } = mockDocument();
  const malicious = { ...publicMetadata, title: '"><script>alert(1)</script>', description: '<img src=x onerror=alert(1)>' };
  writePageMetadata(document, malicious);
  assert.equal(document.title, malicious.title);
  assert.equal(nodes.find(node => node.attributes.name === 'description')?.attributes.content, malicious.description);
  assert.equal(nodes.find(node => node.attributes.rel === 'canonical')?.attributes.href, publicMetadata.canonicalUrl);
  writePageMetadata(document, null);
  assert.equal(document.title, 'Opiniup');
  assert.deepEqual(nodes.map(node => node.attributes.content), ['noindex, nofollow']);
  writePageMetadata(document, publicMetadata);
  writePageMetadata(document, null, false);
  assert.equal(document.title, 'Opiniup');
  assert.equal(nodes.length, 0);
});
