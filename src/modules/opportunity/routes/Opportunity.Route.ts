import { Router } from "express";
import { OpportunityController } from "../controllers/Opportunity.Controller";
import { validationMiddleware } from "../../../shared/middlewares/Validation.Middleware";
import { CreateOpportunityDTO, UpdateOpportunityDTO } from "../dto/Opportunity.dto";

const router = Router();
const opportunityController = new OpportunityController();

router.get("/", opportunityController.getAll);
router.get("/:id", opportunityController.getOne);
router.post("/", validationMiddleware(CreateOpportunityDTO), opportunityController.create);
router.patch("/:id", validationMiddleware(UpdateOpportunityDTO), opportunityController.update);
router.patch("/:id/approve", opportunityController.approve);
router.delete("/:id", opportunityController.delete);

export default router;
