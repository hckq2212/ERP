import { Router } from "express";
import { AcceptanceController } from "../controllers/Acceptance.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

import { validationMiddleware } from "../../../shared/middlewares/Validation.Middleware";
import { ApproveAcceptanceDTO, CreateAcceptanceDTO, RejectAcceptanceDTO } from "../dto/Acceptance.dto";
import { ACCEPTANCE_APPROVER_ROLES } from "../helpers/AcceptancePermission.helper";
import { UserRole, STAFF_ROLES } from "../../account/entities/Account.entity";

const router = Router();
const controller = new AcceptanceController();

const ACCEPTANCE_REQUESTER_ROLES: UserRole[] = [
  UserRole.ADMIN,
  UserRole.BOD,
  UserRole.ADMIN_SALE,
  UserRole.BD,
  UserRole.PM,
  ...STAFF_ROLES,
];

router.get("/", controller.getAllRequests);
router.get("/:id", controller.getRequest);
router.post("/request", roleMiddleware(ACCEPTANCE_REQUESTER_ROLES), validationMiddleware(CreateAcceptanceDTO), controller.createRequest);
router.post("/:id/approve", roleMiddleware(ACCEPTANCE_APPROVER_ROLES), validationMiddleware(ApproveAcceptanceDTO), controller.approveRequest);
router.post("/:id/reject", roleMiddleware(ACCEPTANCE_APPROVER_ROLES), validationMiddleware(RejectAcceptanceDTO), controller.rejectRequest);
router.post("/:id/process", roleMiddleware(ACCEPTANCE_APPROVER_ROLES), controller.processRequest);

export default router;
