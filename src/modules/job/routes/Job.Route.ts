import { Router } from "express";
import { JobController } from "../controllers/Job.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const router = Router();
const jobController = new JobController();

router.get("/", jobController.getAll);
router.get("/:id", jobController.getOne);
router.post("/", roleMiddleware(["ADMIN", "BOD"]), jobController.create);
router.patch("/:id", roleMiddleware(["ADMIN", "BOD"]), jobController.update);
router.delete("/:id", roleMiddleware(["ADMIN", "BOD"]), jobController.delete);

export default router;
