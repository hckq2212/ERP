import { Router } from "express";
import { PaymentMilestoneController } from "../controllers/PaymentMilestone.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const router = Router();
const controller = new PaymentMilestoneController();

const milestoneMutateRoles = roleMiddleware(["ADMIN", "BOD", "ADMIN_SALE"]);

router.get("/", controller.getAll);
router.get("/contract/:contractId", controller.getByContract);
router.post("/", milestoneMutateRoles, controller.create);
router.put("/:id", milestoneMutateRoles, controller.update);
router.delete("/:id", milestoneMutateRoles, controller.delete);
router.put("/contract/:contractId/bulk", milestoneMutateRoles, controller.bulkSave);

export default router;
