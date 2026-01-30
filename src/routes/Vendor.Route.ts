import { Router } from "express";
import { VendorController } from "../controllers/Vendor.Controller";

const router = Router();
const vendorController = new VendorController();

router.get("/", vendorController.getAll);
router.get("/:id", vendorController.getOne);
router.post("/", vendorController.create);
router.patch("/:id", vendorController.update);
router.delete("/:id", vendorController.delete);

// Vendor Jobs
router.get("/:id/jobs", vendorController.getJobs);
router.post("/:id/jobs/:jobId", vendorController.addJob);
router.patch("/:id/jobs/:jobId", vendorController.addJob);
router.delete("/:id/jobs/:jobId", vendorController.removeJob);

export default router;
