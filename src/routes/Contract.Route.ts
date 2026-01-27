import { Router } from "express";
import { ContractController } from "../controllers/Contract.Controller";

const router = Router();
const contractController = new ContractController();

router.get("/", contractController.getAll);
router.get("/:id", contractController.getOne);
router.post("/", contractController.create);
router.delete("/:id", contractController.delete);

export default router;
