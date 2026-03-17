import { Request, Response, NextFunction } from "express";
import { formatDate } from "./format";

export const loggingMiddleware = (req: Request, res: Response, next: NextFunction) => {
    console.log(`[${req.method}] ${req.originalUrl || req.url} ${formatDate(Date.now())}`);
    next();
};
