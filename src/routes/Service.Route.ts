import { Router } from "express";
import { ServiceController } from "../controllers/Service.Controller";

const router = Router();
const serviceController = new ServiceController();

router.get("/", serviceController.getAll);
router.get("/:id", serviceController.getOne);
router.post("/", serviceController.create);
router.put("/:id", serviceController.update);
router.delete("/:id", serviceController.delete);

export default router;
