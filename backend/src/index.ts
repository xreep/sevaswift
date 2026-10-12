import 'dotenv/config';
import { createApp } from './app';
import { config } from './config/index';

const app = createApp();

app.listen(config.port, () => {
  console.warn(`Server running on port ${config.port} in ${config.nodeEnv} mode`);
});
