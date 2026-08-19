import { createServer, type Server } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { sendSmtpMail } from '../../apps/server/src/email.js';

interface SmtpSink {
  server: Server;
  port: number;
  message: Promise<string>;
}

async function startSmtpSink(): Promise<SmtpSink> {
  let resolveMessage: (message: string) => void = () => undefined;
  const message = new Promise<string>((resolve) => {
    resolveMessage = resolve;
  });
  const server = createServer((socket) => {
    let buffer = '';
    let readingData = false;
    socket.setEncoding('utf8');
    socket.write('220 smtp.example.test ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk;
      while (true) {
        if (readingData) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          resolveMessage(buffer.slice(0, end));
          buffer = buffer.slice(end + 5);
          readingData = false;
          socket.write('250 2.0.0 queued\r\n');
          continue;
        }
        const end = buffer.indexOf('\r\n');
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const command = line.split(' ', 1)[0]?.toUpperCase();
        if (command === 'EHLO') {
          socket.write('250-smtp.example.test\r\n250 8BITMIME\r\n');
        } else if (command === 'DATA') {
          readingData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (command === 'QUIT') {
          socket.end('221 2.0.0 bye\r\n');
        } else {
          socket.write('250 2.0.0 ok\r\n');
        }
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('SMTP test server did not bind a TCP port');
  }
  return { server, port: address.port, message };
}

describe('generic SMTP client', () => {
  let sink: SmtpSink | undefined;

  afterEach(async () => {
    if (sink !== undefined) {
      await new Promise<void>((resolve, reject) =>
        sink?.server.close((error) =>
          error === undefined ? resolve() : reject(error),
        ),
      );
      sink = undefined;
    }
  });

  it('sends a plain-text message through a custom SMTP server', async () => {
    sink = await startSmtpSink();
    await sendSmtpMail(
      {
        preset: 'CUSTOM',
        hostname: '127.0.0.1',
        port: sink.port,
        security: 'NONE',
        sender: 'marketscope@example.test',
        recipients: ['buyer@example.test'],
      },
      {
        subject: 'MarketScope SMTP test',
        text: 'The SMTP body arrived.',
      },
    );
    const message = await sink.message;
    expect(message).toContain('Subject: MarketScope SMTP test');
    expect(message).toContain('The SMTP body arrived.');
    expect(message).toContain('To: buyer@example.test');
  });
});
