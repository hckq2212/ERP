import { Router } from "express";
import { DashboardController } from "../controllers/Dashboard.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";

const router = Router();
const dashboardController = new DashboardController();

// GET /api/dashboard
router.get("/", authMiddleware, dashboardController.getDashboardData);

export default router;
