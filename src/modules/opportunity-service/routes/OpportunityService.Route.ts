import { Router } from "express";
import { OpportunityServiceController } from "../controllers/OpportunityService.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const router = Router();
const controller = new OpportunityServiceController();

const opportunityManageRoles = roleMiddleware(["ADMIN", "BOD", "BD", "ADMIN_SALE"]);

router.get("/opportunity/:opportunityId", controller.getAllByOpportunity);
router.get("/:id", controller.getOne);
router.post("/", opportunityManageRoles, controller.create);
router.patch("/:id", opportunityManageRoles, controller.update);
router.delete("/:id", opportunityManageRoles, controller.delete);

export default router;
