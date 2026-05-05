import { Router } from "express";
import { ServiceController } from "../controllers/Service.Controller";
import { roleMiddleware } from "../middlewares/Role.Middleware";

const router = Router();
const serviceController = new ServiceController();

router.get("/", serviceController.getAll);
router.get("/:id", serviceController.getOne);
router.post("/", serviceController.create);
router.patch("/:id", serviceController.update);
router.delete("/bulk", roleMiddleware(["ADMIN", "BOD"]), serviceController.bulkDelete);
router.delete("/:id", serviceController.delete);

router.post("/:id/jobs/:jobId", serviceController.addJob);
router.delete("/:id/jobs/:jobId", serviceController.removeJob);

export default router;
