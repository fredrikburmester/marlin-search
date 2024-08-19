import { Request, Response, NextFunction } from "express";
import { EXPRESS_AUTH_TOKEN } from "./config";

export const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const token = req.headers["authorization"];

  if (token === EXPRESS_AUTH_TOKEN) {
    next();
  } else {
    res
      .status(403)
      .json({ status: "error", message: "Forbidden: Invalid token" });
  }
};
