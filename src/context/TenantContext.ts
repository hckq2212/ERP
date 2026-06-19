import { AsyncLocalStorage } from "async_hooks";
import { Companies } from "../entity/Company.entity";
import { CompanyMembers } from "../entity/CompanyMember.entity";

type TenantStore = {
    company?: Companies;
    companyMember?: CompanyMembers;
};

const tenantStorage = new AsyncLocalStorage<TenantStore>();

export const TenantContext = {
    run<T>(store: TenantStore, callback: () => T) {
        return tenantStorage.run(store, callback);
    },

    getCompany() {
        return tenantStorage.getStore()?.company;
    },

    getCompanyMember() {
        return tenantStorage.getStore()?.companyMember;
    },

    setCompanyMember(companyMember: CompanyMembers) {
        const store = tenantStorage.getStore();
        if (store) {
            store.companyMember = companyMember;
        }
    }
};
