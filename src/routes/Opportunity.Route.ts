import { Router } from "express";
import { OpportunityController } from "../controllers/Opportunity.Controller";
import multer from "multer";

const router = Router();
const opportunityController = new OpportunityController();

// Multer config
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 25 * 1024 * 1024, // 25MB (individual file limit check, but we check total manually)
        files: 5 // Max 5 files
    }
});

router.get("/", opportunityController.getAll);
router.get("/:id", opportunityController.getOne);
router.post("/", upload.array('files', 5), opportunityController.create);
router.patch("/:id", upload.array('files', 5), opportunityController.update);
router.delete("/:id", opportunityController.delete);

export default router;
