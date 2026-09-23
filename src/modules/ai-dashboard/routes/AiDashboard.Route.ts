import { Router } from "express";
import { AiDashboardController } from "../controllers/AiDashboard.Controller";

const router = Router();
const controller = new AiDashboardController();

router.get("/", controller.getDashboard);

export default router;
