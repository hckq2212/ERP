import { Router } from "express";
import { AcceptanceController } from "../controllers/Acceptance.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

import { validationMiddleware } from "../../../shared/middlewares/Validation.Middleware";
import { ApproveAcceptanceDTO, CreateAcceptanceDTO, RejectAcceptanceDTO } from "../dto/Acceptance.dto";

const router = Router();
const controller = new AcceptanceController();
const acceptanceRoles = ["BOD", "ADMIN", "ADMIN_SALE", "PM"];

router.get("/", controller.getAllRequests);
router.get("/:id", controller.getRequest);
router.post("/request", validationMiddleware(CreateAcceptanceDTO), controller.createRequest);
router.post("/:id/approve", roleMiddleware(acceptanceRoles), validationMiddleware(ApproveAcceptanceDTO), controller.approveRequest);
router.post("/:id/reject", roleMiddleware(acceptanceRoles), validationMiddleware(RejectAcceptanceDTO), controller.rejectRequest);
router.post("/:id/process", roleMiddleware(acceptanceRoles), controller.processRequest);

export default router;
