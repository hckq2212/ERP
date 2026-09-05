import { Router } from "express";
import { DashboardController } from "../controllers/Dashboard.Controller";

const router = Router();
const dashboardController = new DashboardController();

// GET /api/dashboard
router.get("/", dashboardController.getDashboardData);

export default router;
