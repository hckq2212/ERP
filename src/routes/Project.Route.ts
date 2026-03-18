import { Router } from "express";
import { ProjectController } from "../controllers/Project.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";
import { validationMiddleware } from "../middlewares/Validation.Middleware";
import { AssignTeamDTO } from "../dto/Project.dto";


const router = Router();
const projectController = new ProjectController();

router.get("/", authMiddleware, projectController.getAll);
router.get("/:id", authMiddleware, projectController.getOne);
router.get("/contract/:contractId", authMiddleware, projectController.getByContract);


router.post("/assign", authMiddleware, validationMiddleware(AssignTeamDTO), projectController.assign);
router.post("/:id/confirm", authMiddleware, projectController.confirm);
router.post("/:id/start", authMiddleware, projectController.start);


export default router;
