import { configFromEnv } from './config';
import { seededRng } from './rng';
import { createAdaServer } from './server';

const config = configFromEnv();
const server = createAdaServer({ config, rng: config.testSeed !== null ? seededRng(config.testSeed) : undefined });
server.listen(config.port).then((port) => console.log(`ada server listening on :${port}`));

for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => server.close().then(() => process.exit(0)));
