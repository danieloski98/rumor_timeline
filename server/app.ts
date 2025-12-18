import express, { type Express, type NextFunction, type Request, type Response } from "express";
import bodyParser from "body-parser";
import helmet from 'helmet';
import cors from "cors";
import morgan from "morgan";
import router from '../routes/index';
import { NotFoundError } from '../exceptions/not-found-error';
import { errorHandler } from '../exceptions/error-handler';
import { config } from "../config";

const app: Express = express();

app.use(bodyParser.json());
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" } // Allow cross-origin resource loading
}));

app.use(
  cors({
    origin: config.corsOrigin, // Allows any domain by default, override via CORS_ORIGIN
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'requester'],
  }),
);

app.use(morgan(config.logFormat));

app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'UP', timestamp: new Date() }).status(200);
});

app.use('/events/v1', router);

// Catch-all 404 for any HTTP method that wasn't matched above.
app.use((req: Request, _res: Response, next: NextFunction) => next(new NotFoundError(req.path)));
app.use(errorHandler);

export default app;
