import { Router } from "express";
import { QuotationController } from "../controllers/Quotation.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const router = Router();
const quotationController = new QuotationController();

router.get("/", quotationController.getAll);
router.get("/:id", quotationController.getOne);
router.get("/opportunity/:opportunityId", quotationController.getByOpportunity); // Get all quotes for an opp
router.post("/", quotationController.create);
router.post("/addendum", quotationController.createAddendum);
router.put("/:id", quotationController.update);
router.post("/:id/approve", roleMiddleware(["BOD", "ADMIN"]), quotationController.approve); // Approve endpoint
router.post("/:id/reject", quotationController.reject); // Reject endpoint
router.delete("/:id", quotationController.delete);

export default router;
