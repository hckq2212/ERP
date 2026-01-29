import { Router } from "express";
import { ContractController } from "../controllers/Contract.Controller";
import multer from "multer";

const router = Router();
const contractController = new ContractController();

// Multer config
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 25 * 1024 * 1024, // 25MB
    }
});

router.get("/", contractController.getAll);
router.get("/:id", contractController.getOne);
router.post("/", contractController.create);
router.delete("/:id", contractController.delete);

// Proposal Workflow
router.post("/:id/proposal", upload.single('file'), contractController.uploadProposal);
router.post("/:id/approve-proposal", contractController.approveProposal);
router.post("/:id/signed", upload.single('file'), contractController.uploadSigned);

// Milestones
router.post("/:id/milestones", contractController.addMilestone);
router.put("/milestones/:id", contractController.updateMilestone);
router.delete("/milestones/:id", contractController.deleteMilestone);

export default router;
