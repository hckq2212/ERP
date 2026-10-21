import { Router } from "express";
import { ReferralPartnerController } from "../controllers/ReferralPartner.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const router = Router();
const referralPartnerController = new ReferralPartnerController();

router.get("/", referralPartnerController.getAll);
router.get("/:id", referralPartnerController.getOne);
router.get("/:id/statistics", roleMiddleware(["ADMIN", "BOD", "BD", "ADMIN_SALE", "PM"]), referralPartnerController.getStatistics);
router.post("/", roleMiddleware(["ADMIN", "BOD"]), referralPartnerController.create);
router.put("/:id", roleMiddleware(["ADMIN", "BOD"]), referralPartnerController.update);
router.delete("/:id", roleMiddleware(["ADMIN", "BOD"]), referralPartnerController.delete);

export default router;
