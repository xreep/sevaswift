import 'dotenv/config';
import { createApp } from './app';
import { config } from './config/index';
import { recoverDispatchState } from './modules/dispatch/dispatch.service';

const app = createApp();

app.listen(config.port, () => {
  console.warn(`Server running on port ${config.port} in ${config.nodeEnv} mode`);
  recoverDispatchState().catch(err => console.error('[dispatch] Recovery failed:', err));
});
