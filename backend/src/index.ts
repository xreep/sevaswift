import 'dotenv/config';
import http from 'http';
import { createApp } from './app';
import { config } from './config/index';
import { recoverDispatchState } from './modules/dispatch/dispatch.service';
import { attachRealtime } from './modules/realtime/realtime.gateway';

const server = http.createServer(createApp());
attachRealtime(server);

server.listen(config.port, () => {
  console.warn(`Server running on port ${config.port} in ${config.nodeEnv} mode`);
  recoverDispatchState().catch(err => console.error('[dispatch] Recovery failed:', err));
});
