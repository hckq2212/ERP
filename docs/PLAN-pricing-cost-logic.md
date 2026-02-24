# PLAN: Pricing and Cost Logic Review

This plan addresses the questions regarding the logic for `NON_BILLABLE` tasks and Vendor price integration into Contract costs.

## Analysis of Current Logic

### 1. `NON_BILLABLE` Tasks vs. Selling Price
- **Findings**: 
    - In `Quotation.Service.ts`, only `BILLABLE` tasks are included in addendum quotations.
    - In `Task.Service.ts`, the `assessExtraTask` method sets `sellingPrice` to 0 for `NON_BILLABLE` tasks.
- **Answer**: **NO**, any task with status `NON_BILLABLE` (specifically `PricingStatus.NON_BILLABLE`) will NOT be added to the selling price.

### 2. Vendor Job Assignment vs. Contract Cost
- **Findings**:
    - When assigning a job to a vendor in `Task.Service.ts`, the code only links the vendor to the task.
    - It does **NOT** retrieve the vendor's price from `VendorJobs` or update the `Contract.cost` field.
    - Contract costs are updated during `Contract` creation (initial snapshot) or when an addendum is signed.
- **Answer**: **NO**, assigning a job to a vendor does NOT currently update or add to the `Contract.cost`. The cost remains fixed based on the initial quotation or subsequent addendums.

---

## User Review Required

> [!IMPORTANT]
> - There is an inconsistency where `NON_BILLABLE` **extra** tasks update the `Contract.cost` immediately, but vendor assignments (which also represent a cost) do not.
> - Would you like me to implement a mechanism to automatically update the `Contract.cost` when a vendor is assigned with a specific price?

---

## Proposed Changes

### [Component] Backend Service

#### [MODIFY] [Task.Service.ts](file:///c:/HCKQ_Self_learning/GETVINI/ERP/src/services/Task.Service.ts)
- Update `assign` method:
    - If `performerType` is `VENDOR`, fetch `VendorJobs` for the specific vendor and job.
    - Retrieve the `price`.
    - Update `task.cost` with this price.
    - Atomically update the associated `Contract.cost` by:
        1. Subtracting the previous `task.cost` (if any).
        2. Adding the new vendor price.
    - Save both Task and Contract.

## Verification Plan

### Automated Tests
- Create a test script to assign a task to a vendor and verify the `Contract.cost` increases by the vendor's price.
- Verify reassignment correctly adjusts the cost.

### Manual Verification
- Assign a task to a vendor in the UI and check the Contract detail page for the updated cost.
