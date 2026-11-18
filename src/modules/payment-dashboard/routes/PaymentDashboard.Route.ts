import { Router } from "express";
import { PaymentDashboardController } from "../controllers/PaymentDashboard.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const router = Router();
const controller = new PaymentDashboardController();

router.get(
    "/",
    roleMiddleware(["BOD", "ADMIN", "ADMIN_SALE", "PM", "BD"]),
    controller.getDashboard
);

export default router;
