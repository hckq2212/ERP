import { Router } from "express";
import { JobCriteriaController } from "../controllers/JobCriteria.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const router = Router();
const controller = new JobCriteriaController();

router.get("/job/:jobId", controller.getByJob);
router.put("/job/:jobId", roleMiddleware(["ADMIN", "BOD"]), controller.sync);
router.post("/", roleMiddleware(["ADMIN", "BOD"]), controller.create);
router.delete("/:id", roleMiddleware(["ADMIN", "BOD"]), controller.delete);

export default router;
