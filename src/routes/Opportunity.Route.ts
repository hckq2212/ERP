import { Router } from "express";
import { OpportunityController } from "../controllers/Opportunity.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";
import { validationMiddleware } from "../middlewares/Validation.Middleware";
import { CreateOpportunityDTO, UpdateOpportunityDTO } from "../dto/Opportunity.dto";

const router = Router();
const opportunityController = new OpportunityController();

router.get("/", authMiddleware, opportunityController.getAll);
router.get("/:id", authMiddleware, opportunityController.getOne);
router.post("/", authMiddleware, validationMiddleware(CreateOpportunityDTO), opportunityController.create);
router.patch("/:id", authMiddleware, validationMiddleware(UpdateOpportunityDTO), opportunityController.update);
router.patch("/:id/approve", authMiddleware, opportunityController.approve);
router.delete("/:id", authMiddleware, opportunityController.delete);

export default router;
