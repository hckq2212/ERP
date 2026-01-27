import { Router } from "express";
import { TaskController } from "../controllers/Task.Controller";
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

router.get("/", taskController.getAll);
router.get("/:id", taskController.getOne);
router.post("/", taskController.create);
router.put("/:id", taskController.update);
router.put("/:id/assign", upload.array('files', 5), taskController.assign);
router.delete("/:id", taskController.delete);

export default router;
