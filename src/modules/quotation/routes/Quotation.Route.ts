import { Router } from "express";
import { QuotationController } from "../controllers/Quotation.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const router = Router();
const quotationController = new QuotationController();

const quotationManageRoles = roleMiddleware(["ADMIN", "BOD", "BD", "ADMIN_SALE"]);

router.get("/", quotationController.getAll);
router.get("/:id", quotationController.getOne);
router.get("/opportunity/:opportunityId", quotationController.getByOpportunity); // Get all quotes for an opp
router.post("/", quotationManageRoles, quotationController.create);
router.post("/addendum", quotationManageRoles, quotationController.createAddendum);
router.put("/:id", quotationManageRoles, quotationController.update);
router.post("/:id/approve", roleMiddleware(["BOD", "ADMIN"]), quotationController.approve); // Approve endpoint
router.post("/:id/reject", roleMiddleware(["BOD", "ADMIN"]), quotationController.reject); // Reject endpoint
router.delete("/:id", roleMiddleware(["BOD", "ADMIN", "BD", "ADMIN_SALE"]), quotationController.delete);

export default router;
