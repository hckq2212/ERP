import { Router } from "express";
import { ProjectController } from "../controllers/Project.Controller";

const router = Router();
const projectController = new ProjectController();

router.get("/", projectController.getAll);
router.get("/:id", projectController.getOne);

router.post("/assign", projectController.assign); // Create project
router.post("/:id/confirm", projectController.confirm);
router.post("/:id/start", projectController.start);

export default router;
