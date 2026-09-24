import { Router } from "express";
import { PaymentDashboardController } from "../controllers/PaymentDashboard.Controller";

const router = Router();
const controller = new PaymentDashboardController();

router.get("/", controller.getDashboard);

export default router;
