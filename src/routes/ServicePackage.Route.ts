import { Router } from "express";
import { ServicePackageController } from "../controllers/ServicePackage.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";

const router = Router();
const controller = new ServicePackageController();

router.get("/", authMiddleware, controller.getAll);
router.get("/:id", authMiddleware, controller.getOne);
router.post("/", authMiddleware, controller.create);
router.put("/:id", authMiddleware, controller.update);
router.delete("/:id", authMiddleware, controller.delete);

export default router;
