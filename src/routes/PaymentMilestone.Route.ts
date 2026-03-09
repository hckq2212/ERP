import { Router } from "express";
import { PaymentMilestoneController } from "../controllers/PaymentMilestone.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";

const router = Router();
const controller = new PaymentMilestoneController();

router.get("/", authMiddleware, controller.getAll);
router.get("/contract/:contractId", authMiddleware, controller.getByContract);
router.post("/", authMiddleware, controller.create);
router.put("/:id", authMiddleware, controller.update);
router.delete("/:id", authMiddleware, controller.delete);
router.put("/contract/:contractId/bulk", authMiddleware, controller.bulkSave);

export default router;
