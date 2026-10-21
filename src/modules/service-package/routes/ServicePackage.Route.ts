import { Router } from "express";
import { ServicePackageController } from "../controllers/ServicePackage.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const router = Router();
const controller = new ServicePackageController();

router.get("/", controller.getAll);
router.get("/:id", controller.getOne);
router.post("/", roleMiddleware(["ADMIN", "BOD"]), controller.create);
router.put("/:id", roleMiddleware(["ADMIN", "BOD"]), controller.update);
router.delete("/:id", roleMiddleware(["ADMIN", "BOD"]), controller.delete);

export default router;
