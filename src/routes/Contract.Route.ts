import { Router } from "express";
import { ContractController } from "../controllers/Contract.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";

const router = Router();
const contractController = new ContractController();

router.get("/", authMiddleware, contractController.getAll);
router.get("/:id", authMiddleware, contractController.getOne);
router.post("/", authMiddleware, contractController.create);
router.delete("/:id", authMiddleware, contractController.delete);

// Proposal Workflow
router.post("/:id/proposal", authMiddleware, contractController.uploadProposal);
router.post("/:id/approve-proposal", authMiddleware, contractController.approveProposal);
router.post("/:id/reject-proposal", authMiddleware, contractController.rejectProposal);
router.post("/:id/signed", authMiddleware, contractController.uploadSigned);

// Milestones
router.post("/:id/milestones", authMiddleware, contractController.addMilestone);
router.put("/milestones/:id", authMiddleware, contractController.updateMilestone);
router.delete("/milestones/:id", authMiddleware, contractController.deleteMilestone);

export default router;
