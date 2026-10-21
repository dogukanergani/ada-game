import { createAppServer } from './server';

const port = Number(process.env.PORT ?? 3001);
const app = createAppServer();
app.httpServer.listen(port, '0.0.0.0', () => {
  console.log(`[ada] server listening on :${port}`);
});
