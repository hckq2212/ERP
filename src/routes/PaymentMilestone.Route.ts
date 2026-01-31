import { Router } from "express";
import { PaymentMilestoneController } from "../controllers/PaymentMilestone.Controller";

const router = Router();
const controller = new PaymentMilestoneController();

router.get("/contract/:contractId", controller.getByContract);
router.post("/", controller.create);
router.put("/:id", controller.update);
router.delete("/:id", controller.delete);
router.put("/contract/:contractId/bulk", controller.bulkSave);

export default router;
