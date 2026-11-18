import { Router } from "express";
import { ReferralPartnerController } from "../controllers/ReferralPartner.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const router = Router();
const referralPartnerController = new ReferralPartnerController();

const PARTNER_VIEW_ROLES = ["ADMIN", "BOD", "BD", "ADMIN_SALE", "PM"];
const PARTNER_MANAGE_ROLES = ["ADMIN", "BOD"];

router.get("/", roleMiddleware(PARTNER_VIEW_ROLES), referralPartnerController.getAll);
router.get("/:id", roleMiddleware(PARTNER_VIEW_ROLES), referralPartnerController.getOne);
router.get("/:id/statistics", roleMiddleware(PARTNER_VIEW_ROLES), referralPartnerController.getStatistics);
router.post("/", roleMiddleware(PARTNER_MANAGE_ROLES), referralPartnerController.create);
router.put("/:id", roleMiddleware(PARTNER_MANAGE_ROLES), referralPartnerController.update);
router.delete("/:id", roleMiddleware(PARTNER_MANAGE_ROLES), referralPartnerController.delete);

export default router;
