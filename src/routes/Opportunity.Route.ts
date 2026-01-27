import { Router } from "express";
import { OpportunityController } from "../controllers/Opportunity.Controller";

const router = Router();
const opportunityController = new OpportunityController();

router.get("/", opportunityController.getAll);
router.get("/:id", opportunityController.getOne);
router.post("/", opportunityController.create);
router.put("/:id", opportunityController.update);
router.delete("/:id", opportunityController.delete);

export default router;
