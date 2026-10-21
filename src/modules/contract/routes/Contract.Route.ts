import { Router } from "express";
import { ContractController } from "../controllers/Contract.Controller";
import { validationMiddleware } from "../../../shared/middlewares/Validation.Middleware";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";
import { CreateContractDTO, UpdateContractServiceNicknameDTO } from "../dto/Contract.dto";

const router = Router();
const contractController = new ContractController();

router.get("/", contractController.getAll);
router.patch("/services/:id/nickname", validationMiddleware(UpdateContractServiceNicknameDTO), contractController.updateServiceNickname);
router.get("/:id", contractController.getOne);
router.post("/", validationMiddleware(CreateContractDTO), contractController.create);
router.delete("/:id", contractController.delete);

// Proposal Workflow
router.post("/:id/proposal", contractController.uploadProposal);
router.post("/:id/approve-proposal", roleMiddleware(["ADMIN", "BOD"]), contractController.approveProposal);
router.post("/:id/reject-proposal", roleMiddleware(["ADMIN", "BOD"]), contractController.rejectProposal);
router.post("/:id/signed", contractController.uploadSigned);

// Milestones
router.post("/:id/milestones", contractController.addMilestone);
router.put("/milestones/:id",roleMiddleware(["ADMIN", "BOD", "ADMIN_SALE"]), contractController.updateMilestone);
router.delete("/milestones/:id",roleMiddleware(["ADMIN", "BOD", "ADMIN_SALE"]), contractController.deleteMilestone);

export default router;
