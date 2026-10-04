'use strict';

// Public walker APIs also accept caller-supplied ASTs, bypassing parse().
// Follow children only: parser parent/prev links are intentionally cyclic.
const MAX_NESTING_DEPTH = 100;

module.exports = ast => {
  const active = new Set();
  const stack = [{ node: ast, depth: 0, leave: false }];
  while (stack.length) {
    const frame = stack.pop();
    const node = frame.node;
    if (!node || typeof node !== 'object') {
      throw new TypeError('Expected an AST node');
    }
    if (frame.leave) {
      active.delete(node);
      continue;
    }
    if (active.has(node)) {
      throw new SyntaxError('Cyclic AST children are not supported');
    }
    if (!node.nodes) continue;
    if (!Array.isArray(node.nodes)) {
      throw new TypeError('Expected AST children to be an array');
    }
    const depth = frame.depth + (node === ast && node.type === 'root' ? 0 : 1);
    if (depth > MAX_NESTING_DEPTH) {
      throw new SyntaxError(`Input nesting depth exceeds maximum (${MAX_NESTING_DEPTH})`);
    }
    active.add(node);
    stack.push({ node, depth, leave: true });
    for (let i = node.nodes.length - 1; i >= 0; i--) {
      stack.push({ node: node.nodes[i], depth, leave: false });
    }
  }
};
