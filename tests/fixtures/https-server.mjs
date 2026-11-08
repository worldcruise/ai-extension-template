import { generateKeyPairSync, sign } from 'node:crypto';
import { createServer } from 'node:https';

// Ephemeral, self-signed fixture certificate. The test browser ignores its trust
// error; no private key is stored and no real ChatGPT connection is made.
function certificate() {
  const der = (tag, ...parts) => {
    const body = Buffer.concat(parts.map(part => Buffer.isBuffer(part) ? part : Buffer.from(part)));
    const bytes = [];
    let size = body.length;
    while (size) { bytes.unshift(size & 255); size >>>= 8; }
    const length = body.length < 128 ? [body.length] : [128 | bytes.length, ...bytes];
    return Buffer.concat([Buffer.from([tag, ...length]), body]);
  };
  const sequence = (...parts) => der(0x30, ...parts);
  const algorithm = sequence(der(0x06, Buffer.from('2a864886f70d01010b', 'hex')), der(0x05));
  const name = sequence(der(0x31, sequence(der(0x06, [0x55, 0x04, 0x03]), der(0x0c, 'chatgpt.com'))));
  const validity = sequence(der(0x17, '240101000000Z'), der(0x17, '490101000000Z'));
  const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const tbs = sequence(der(0xa0, der(0x02, [2])), der(0x02, [1]), algorithm, name, validity, name,
    pair.publicKey.export({ type: 'spki', format: 'der' }));
  const cert = sequence(tbs, algorithm, der(0x03, Buffer.from([0]), sign('sha256', tbs, pair.privateKey)));
  return {
    key: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }),
    cert: `-----BEGIN CERTIFICATE-----\n${cert.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`
  };
}

export async function serveFixture(handler) {
  const server = createServer(certificate(), handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    port: server.address().port,
    async close() {
      const closed = new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
      await closed;
    }
  };
}
