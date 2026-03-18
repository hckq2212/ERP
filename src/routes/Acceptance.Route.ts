import { Router } from "express";
import { AcceptanceController } from "../controllers/Acceptance.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";

import { validationMiddleware } from "../middlewares/Validation.Middleware";
import { CreateAcceptanceDTO, UpdateAcceptanceStatusDTO } from "../dto/Acceptance.dto";

const router = Router();
const controller = new AcceptanceController();

router.get("/", authMiddleware, controller.getAllRequests);
router.get("/:id", authMiddleware, controller.getRequest);
router.post("/request", authMiddleware, validationMiddleware(CreateAcceptanceDTO), controller.createRequest);
router.post("/:id/approve", authMiddleware, validationMiddleware(UpdateAcceptanceStatusDTO), controller.approveRequest);
router.post("/:id/reject", authMiddleware, validationMiddleware(UpdateAcceptanceStatusDTO), controller.rejectRequest);
router.post("/:id/process", authMiddleware, controller.processRequest);

export default router;
