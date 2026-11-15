import { createAppServerContext } from '@pioneer/app-sdk/server';

export async function run(consume: (bytes: Uint8Array) => Promise<void>) {
  const app = await createAppServerContext();
  try {
    const terminal = await app.host.pty.create({ cols: 120, rows: 30 });
    let consumption = Promise.resolve();
    let streamError: unknown;
    const subscription = await terminal.subscribe({
      after: 0,
      onOutput(frame) {
        consumption = consumption.then(async () => {
          await consume(frame.bytes);
          await frame.ack();
          // Check failed / exitStatus and end here if consuming until exit.
        });
        void consumption.catch(error => { streamError = error; });
      },
      onError(error) { streamError = error; },
    });
    try {
      await terminal.write('pwd\n');
      await terminal.resize({ cols: 100, rows: 28 });
      // Application chooses how long to consume; this example only flushes
      // callbacks already received. An input ACK is not command completion.
      await consumption;
      if (streamError) throw streamError;
    } finally { subscription.dispose(); await terminal.close(); }
  } finally { await app.close(); }
}
