import { Router } from "express";
import { OpportunityServiceController } from "../controllers/OpportunityService.Controller";

const router = Router();
const controller = new OpportunityServiceController();

router.get("/opportunity/:opportunityId", controller.getAllByOpportunity);
router.get("/:id", controller.getOne);
router.post("/", controller.create);
router.patch("/:id", controller.update);
router.delete("/:id", controller.delete);

export default router;
