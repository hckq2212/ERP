import { Router } from "express";
import { ServiceController } from "../controllers/Service.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const router = Router();
const serviceController = new ServiceController();

router.get("/", serviceController.getAll);
router.get("/:id", serviceController.getOne);
router.post("/", roleMiddleware(["ADMIN", "BOD"]), serviceController.create);
router.patch("/:id", roleMiddleware(["ADMIN", "BOD"]), serviceController.update);
router.delete("/bulk", roleMiddleware(["ADMIN", "BOD"]), serviceController.bulkDelete);
router.delete("/:id", roleMiddleware(["ADMIN", "BOD"]), serviceController.delete);

router.post("/:id/jobs/:jobId", roleMiddleware(["ADMIN", "BOD"]), serviceController.addJob);
router.delete("/:id/jobs/:jobId", roleMiddleware(["ADMIN", "BOD"]), serviceController.removeJob);

export default router;
