import { Router } from "express";
import { JobCriteriaController } from "../controllers/JobCriteria.Controller";

const router = Router();
const controller = new JobCriteriaController();

router.get("/job/:jobId", controller.getByJob);
router.put("/job/:jobId", controller.sync);
router.post("/", controller.create);
router.delete("/:id", controller.delete);

export default router;
