import { Router } from "express";
import { ServicePackageController } from "../controllers/ServicePackage.Controller";

const router = Router();
const controller = new ServicePackageController();

router.get("/", controller.getAll);
router.get("/:id", controller.getOne);
router.post("/", controller.create);
router.put("/:id", controller.update);
router.delete("/:id", controller.delete);

export default router;
