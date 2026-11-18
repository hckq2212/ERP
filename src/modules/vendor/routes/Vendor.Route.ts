import { Router } from "express";
import { VendorController } from "../controllers/Vendor.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";
import multer from "multer";

const router = Router();
const vendorController = new VendorController();

const VENDOR_VIEW_ROLES = ["ADMIN", "BOD", "PM", "ADMIN_SALE", "ACCOUNTANT", "BD"];
const VENDOR_MANAGE_ROLES = ["ADMIN", "BOD"];

router.get("/", roleMiddleware(VENDOR_VIEW_ROLES), vendorController.getAll);
router.get("/by-job/:jobId", roleMiddleware(VENDOR_VIEW_ROLES), vendorController.getByJob);
router.get("/:id", roleMiddleware(VENDOR_VIEW_ROLES), vendorController.getOne);
router.post("/", roleMiddleware(VENDOR_MANAGE_ROLES), vendorController.create);
router.patch("/:id", roleMiddleware(VENDOR_MANAGE_ROLES), vendorController.update);
router.delete("/:id", roleMiddleware(VENDOR_MANAGE_ROLES), vendorController.delete);

// Vendor Jobs
router.get("/:id/jobs", roleMiddleware(VENDOR_VIEW_ROLES), vendorController.getJobs);
router.post("/:id/jobs/:jobId", roleMiddleware(VENDOR_MANAGE_ROLES), vendorController.addJob);
router.patch("/:id/jobs/:jobId", roleMiddleware(VENDOR_MANAGE_ROLES), vendorController.addJob);
router.delete("/:id/jobs/:jobId", roleMiddleware(VENDOR_MANAGE_ROLES), vendorController.removeJob);

export default router;
