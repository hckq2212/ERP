import { Router } from "express";
import { JobController } from "../controllers/Job.Controller";

const router = Router();
const jobController = new JobController();

router.get("/", jobController.getAll);
router.get("/:id", jobController.getOne);
router.post("/", jobController.create);
router.put("/:id", jobController.update);
router.delete("/:id", jobController.delete);

export default router;
