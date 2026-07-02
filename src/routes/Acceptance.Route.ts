import { Router } from "express";
import { AcceptanceController } from "../controllers/Acceptance.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";
import { roleMiddleware } from "../middlewares/Role.Middleware";

import { validationMiddleware } from "../middlewares/Validation.Middleware";
import { ApproveAcceptanceDTO, CreateAcceptanceDTO, RejectAcceptanceDTO } from "../dto/Acceptance.dto";

const router = Router();
const controller = new AcceptanceController();
const acceptanceRoles = ["BOD", "ADMIN", "ADMIN_SALE", "ACCOUNTANT"];

router.get("/", authMiddleware, controller.getAllRequests);
router.get("/:id", authMiddleware, controller.getRequest);
router.post("/request", authMiddleware, validationMiddleware(CreateAcceptanceDTO), controller.createRequest);
router.post("/:id/approve", authMiddleware, roleMiddleware(acceptanceRoles), validationMiddleware(ApproveAcceptanceDTO), controller.approveRequest);
router.post("/:id/reject", authMiddleware, roleMiddleware(acceptanceRoles), validationMiddleware(RejectAcceptanceDTO), controller.rejectRequest);
router.post("/:id/process", authMiddleware, roleMiddleware(acceptanceRoles), controller.processRequest);

export default router;
