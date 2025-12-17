import { config } from "./config";
import app from "./server/app";

app.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server listening on http://localhost:${config.port} (${config.env})`);
});

