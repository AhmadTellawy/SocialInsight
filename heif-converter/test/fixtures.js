function box(type, payload) {
  const output = Buffer.alloc(8 + payload.length);
  output.writeUInt32BE(output.length, 0);
  output.write(type, 4, 4, 'ascii');
  payload.copy(output, 8);
  return output;
}

export function heifFixture({ brand = 'heic', compatible = ['mif1', 'heic'], dimensions = [[1200, 800]] } = {}) {
  const ftypPayload = Buffer.alloc(8 + compatible.length * 4);
  ftypPayload.write(brand, 0, 4, 'ascii');
  ftypPayload.writeUInt32BE(0, 4);
  compatible.forEach((value, index) => ftypPayload.write(value, 8 + index * 4, 4, 'ascii'));
  const properties = dimensions.map(([width, height]) => {
    const payload = Buffer.alloc(12);
    payload.writeUInt32BE(0, 0);
    payload.writeUInt32BE(width, 4);
    payload.writeUInt32BE(height, 8);
    return box('ispe', payload);
  });
  properties.push(box('hvcC', Buffer.from([1, 1, 96, 0])));
  const ipco = box('ipco', Buffer.concat(properties));
  const iprp = box('iprp', ipco);
  const meta = box('meta', Buffer.concat([Buffer.alloc(4), iprp]));
  const mdat = box('mdat', Buffer.from([1, 2, 3, 4]));
  return Buffer.concat([box('ftyp', ftypPayload), meta, mdat]);
}
