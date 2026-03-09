import { Router } from "express";
import { ProjectController } from "../controllers/Project.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";


const router = Router();
const projectController = new ProjectController();

router.get("/", authMiddleware, projectController.getAll);
router.get("/:id", authMiddleware, projectController.getOne);
router.get("/contract/:contractId", authMiddleware, projectController.getByContract);


router.post("/assign", authMiddleware, projectController.assign);
router.post("/:id/confirm", authMiddleware, projectController.confirm);
router.post("/:id/start", authMiddleware, projectController.start);


export default router;
