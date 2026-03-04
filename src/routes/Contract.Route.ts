import { Router } from "express";
import { ContractController } from "../controllers/Contract.Controller";
import multer from "multer";

const router = Router();
const contractController = new ContractController();

router.get("/", contractController.getAll);
router.get("/:id", contractController.getOne);
router.post("/", contractController.create);
router.delete("/:id", contractController.delete);

// Proposal Workflow
router.post("/:id/proposal", contractController.uploadProposal);
router.post("/:id/approve-proposal", contractController.approveProposal);
router.post("/:id/reject-proposal", contractController.rejectProposal);
router.post("/:id/signed", contractController.uploadSigned);

// Milestones
router.post("/:id/milestones", contractController.addMilestone);
router.put("/milestones/:id", contractController.updateMilestone);
router.delete("/milestones/:id", contractController.deleteMilestone);

export default router;
