import { Router } from "express";
import { TaskController } from "../controllers/Task.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";
import multer from "multer";


const router = Router();
const taskController = new TaskController();

const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 25 * 1024 * 1024,
        files: 5
    }
});

import { validationMiddleware } from "../middlewares/Validation.Middleware";
import { CreateTaskDTO, TaskAssignmentDTO } from "../dto/Task.dto";

router.get("/", authMiddleware, taskController.getAll);
router.get("/:id", authMiddleware, taskController.getOne);
router.post("/", authMiddleware, validationMiddleware(CreateTaskDTO), taskController.create);
router.post("/internal", authMiddleware, taskController.createInternal);
router.put("/bulk-assign", authMiddleware, taskController.bulkAssign);
router.put("/:id", authMiddleware, taskController.update);
router.put("/:id/assign", authMiddleware, validationMiddleware(TaskAssignmentDTO), taskController.assign);
router.patch("/:id/submit-result", authMiddleware, taskController.submitResult);
router.delete("/:id", authMiddleware, taskController.delete);
router.patch("/:id/reassign", authMiddleware, taskController.reassign);
router.post("/:id/pricing", authMiddleware, taskController.assessExtraTask);
router.post('/:id/request-support', authMiddleware, taskController.requestSupport);
router.post('/:id/respond-support', authMiddleware, taskController.respondToSupport);
router.post('/:id/return-support', authMiddleware, taskController.returnSupport);
router.post('/:id/request-return-support', authMiddleware, taskController.requestReturnSupport);
router.post('/:id/assign-support-team', authMiddleware, taskController.assignSupportTeam);
router.patch("/:id/rework", authMiddleware, taskController.rework);
router.patch("/:id/customer-approve", authMiddleware, taskController.approveByCustomer);
router.post("/:id/remind", authMiddleware, taskController.sendReminder);

export default router;
