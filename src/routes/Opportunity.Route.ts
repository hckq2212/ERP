import { Router } from "express";
import { OpportunityController } from "../controllers/Opportunity.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";

const router = Router();
const opportunityController = new OpportunityController();

router.get("/", authMiddleware, opportunityController.getAll);
router.get("/:id", opportunityController.getOne);
router.post("/", authMiddleware, opportunityController.create);
router.patch("/:id", authMiddleware, opportunityController.update);
router.patch("/:id/approve", authMiddleware, opportunityController.approve);
router.delete("/:id", authMiddleware, opportunityController.delete);

export default router;
