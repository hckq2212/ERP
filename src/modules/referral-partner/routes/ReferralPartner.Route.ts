import { Router } from "express";
import { ReferralPartnerController } from "../controllers/ReferralPartner.Controller";

const router = Router();
const referralPartnerController = new ReferralPartnerController();

router.get("/", referralPartnerController.getAll);
router.get("/:id", referralPartnerController.getOne);
router.get("/:id/statistics", referralPartnerController.getStatistics);
router.post("/", referralPartnerController.create);
router.put("/:id", referralPartnerController.update);
router.delete("/:id", referralPartnerController.delete);

export default router;
