import { app } from './app';
import { config } from './config/env';

app.listen(config.port, () => {
  console.log(`MyMOPH Backoffice API running on port ${config.port} (${config.timezone})`);
});
