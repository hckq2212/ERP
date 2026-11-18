import { Router } from "express";
import { OpportunityController } from "../controllers/Opportunity.Controller";
import { validationMiddleware } from "../../../shared/middlewares/Validation.Middleware";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";
import { CreateOpportunityDTO, UpdateOpportunityDTO } from "../dto/Opportunity.dto";

const router = Router();
const opportunityController = new OpportunityController();

const OPPORTUNITY_MANAGE_ROLES = ["ADMIN", "BOD", "BD", "ADMIN_SALE"];

router.get("/", opportunityController.getAll);
router.get("/:id", opportunityController.getOne);
router.post("/", roleMiddleware(OPPORTUNITY_MANAGE_ROLES), validationMiddleware(CreateOpportunityDTO), opportunityController.create);
router.patch("/:id", roleMiddleware(OPPORTUNITY_MANAGE_ROLES), validationMiddleware(UpdateOpportunityDTO), opportunityController.update);
router.patch("/:id/draft", roleMiddleware(OPPORTUNITY_MANAGE_ROLES), validationMiddleware(UpdateOpportunityDTO), opportunityController.saveDraft);
router.patch("/:id/resubmit", roleMiddleware(OPPORTUNITY_MANAGE_ROLES), opportunityController.resubmit);
router.patch("/:id/addcustomer", roleMiddleware(["BOD", "ADMIN", "BD"]), opportunityController.addCustomer);
router.patch("/:id/approve", roleMiddleware(["BOD", "ADMIN"]), opportunityController.approve);
router.patch("/:id/reject", roleMiddleware(["BOD", "ADMIN"]), opportunityController.reject);
router.delete("/:id", roleMiddleware(["BOD", "ADMIN", "BD"]), opportunityController.delete);

export default router;
