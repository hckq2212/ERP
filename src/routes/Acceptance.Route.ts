import { Router } from "express";
import { AcceptanceController } from "../controllers/Acceptance.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";

const router = Router();
const controller = new AcceptanceController();

router.get("/", authMiddleware, controller.getAllRequests);
router.get("/:id", authMiddleware, controller.getRequest);
router.post("/request", authMiddleware, controller.createRequest);
router.post("/:id/approve", authMiddleware, controller.approveRequest);
router.post("/:id/reject", authMiddleware, controller.rejectRequest);
router.post("/:id/process", authMiddleware, controller.processRequest);

export default router;
