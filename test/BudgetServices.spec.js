// Budgets (mantle.other.BudgetServices and BudgetReportServices) over the fiscal year of a new organization, and the GL
// account application lookups. New spec, no Groovy original.
let organizationPartyId, facilityId, assetId
const effectiveTime = Date.now()
let budgetId, yearPeriodId, expenseAccountIds = [], itemSeqId

spec({
    stepwise: true,
    tempSequences: { start: 56700, banks: { "mantle.other.budget.Budget": 10, "mantle.party.Party": 10, "mantle.facility.Facility": 10, "mantle.product.asset.Asset": 10, "mantle.party.time.TimePeriod": 30 } },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

const n = (value) => dec(value).toNumber()

feature("create a Budget on the fiscal year", {
    when() {
        organizationPartyId = call("mantle.party.PartyServices.create#Organization", { organizationName: "Budget Org", roleTypeId: "Supplier" }).partyId
        call("create#mantle.party.PartyRole", { partyId: organizationPartyId, roleTypeId: "OrgInternal" })
        call("mantle.ledger.LedgerServices.init#PartyAccountingConfiguration",
                { sourcePartyId: "DefaultSettings", organizationPartyId, startYear: String(new Date(effectiveTime).getUTCFullYear()) })
        const years = call("mantle.ledger.LedgerServices.get#OrganizationFiscalTimePeriods",
                { organizationPartyId, filterDate: ec.user.nowTimestamp, timePeriodTypeId: "FiscalYear" })
        yearPeriodId = years.timePeriodList[0].timePeriodId
        const classes = call("org.moqui.impl.BasicServices.find#EnumerationByParent", { parentEnumId: "EXPENSE", includeNested: true })
        expenseAccountIds = Array.from(ec.entity.find("mantle.ledger.account.GlAccountAndOrganization").condition("organizationPartyId", organizationPartyId)
                .condition("glAccountClassEnumId", "in", Array.from(classes.enumIdSet)).orderBy("accountCode").list()).map(a => a.glAccountId).slice(0, 2)
        budgetId = call("mantle.other.BudgetServices.create#Budget", { timePeriodId: yearPeriodId, subTimePeriodTypeId: "FiscalMonth",
                budgetTypeEnumId: "BudgetOperating", description: "Test Budget" }).budgetId
        return { budget: ec.entity.find("mantle.other.budget.Budget").condition("budgetId", budgetId).one() }
    },
    then({ budget }) {
        expenseAccountIds.length == 2
        budget.currencyUomId == "USD"
        budget.timePeriodId == yearPeriodId
    },
})

feature("store a BudgetItem, update it, and remove it by storing no amount", {
    when() {
        itemSeqId = call("mantle.other.BudgetServices.store#BudgetItem", { budgetId, glAccountId: expenseAccountIds[0], amount: 1200 }).budgetItemSeqId
        const created = ec.entity.find("mantle.other.budget.BudgetItem").condition("budgetId", budgetId).condition("budgetItemSeqId", itemSeqId).one()
        call("mantle.other.BudgetServices.store#BudgetItem", { budgetId, budgetItemSeqId: itemSeqId, glAccountId: expenseAccountIds[0], amount: 1500 })
        const updated = ec.entity.find("mantle.other.budget.BudgetItem").condition("budgetId", budgetId).condition("budgetItemSeqId", itemSeqId).one()
        call("mantle.other.BudgetServices.store#BudgetItem", { budgetId, budgetItemSeqId: itemSeqId, glAccountId: expenseAccountIds[0] })
        const removed = ec.entity.find("mantle.other.budget.BudgetItem").condition("budgetId", budgetId).condition("budgetItemSeqId", itemSeqId).one()
        return { created, updated, removed }
    },
    then({ created, updated, removed }) {
        n(created.amount) == 1200
        n(updated.amount) == 1500
        removed == null
    },
})

feature("store BudgetItems across the sub periods: a total spread over twelve months with two months set", {
    when() {
        call("mantle.other.BudgetServices.store#BudgetItemsSubPeriods", { budgetId, glAccountId: expenseAccountIds[0], amountMain: 1300,
                amountPer1: 200, amountPer2: 100 })
        const info = call("mantle.other.BudgetServices.get#BudgetItemsAccountsSubPeriods", { budgetId })
        const items = info.budgetItemsByGlId[expenseAccountIds[0]]
        return { info, items }
    },
    then({ info, items }) {
        info.subTimePeriodSize == 12
        info.budget.budgetId == budgetId
        items.length == 13
        n(items[0].amount) == 1300
        n(items[1].amount) == 200
        n(items[2].amount) == 100
        // the other ten months share what is left: (1300 - 300) / 10
        n(items[3].amount) == 100
        info.expenseClassEnumIds.length > 0
    },
})

feature("store BudgetItemDetails for an asset and a facility", {
    when() {
        facilityId = call("mantle.facility.FacilityServices.create#Facility", { facilityName: "Budget Warehouse", facilityTypeEnumId: "FcTpWarehouse", ownerPartyId: organizationPartyId }).facilityId
        assetId = call("create#mantle.product.asset.Asset", { assetTypeEnumId: "AstTpInventory", ownerPartyId: organizationPartyId, productId: "DEMO_1_1", facilityId }).assetId
        call("mantle.other.BudgetServices.store#BudgetItemDetailsSubPeriods", { budgetId, glAccountId: expenseAccountIds[1], facilityId,
                amountMain: 600, amountPer1: 50 })
        const details = ec.entity.find("mantle.other.budget.BudgetItemDetail").condition("budgetId", budgetId).condition("facilityId", facilityId).list()
        const none = call("mantle.other.BudgetServices.store#BudgetItemDetailsSubPeriods", { budgetId, glAccountId: expenseAccountIds[1], amountMain: 1 })
        return { details }
    },
    then({ details }) {
        details.length >= 2
    },
})

feature("GL account application lookups", {
    when() {
        const facilityGl = call("mantle.other.BudgetServices.get#FacilityGlAppls", { facilityId })
        const assetGl = call("mantle.other.BudgetServices.get#AssetGlAppls", { assetId })
        const appls = call("mantle.other.BudgetServices.get#GlAccountAppls", { glAccountId: expenseAccountIds[1], ownerPartyIds: [organizationPartyId] })
        return { facilityGl, assetGl, appls }
    },
    then({ facilityGl, assetGl, appls }) {
        facilityGl.glAccountIdSet != null
        assetGl.glAccountIdSet != null
        appls.assetIdSet != null
        appls.facilityIdSet != null
    },
})

feature("the budget expense reports list the expense accounts with budget and actual", {
    when() {
        const report = call("mantle.other.BudgetReportServices.run#BudgetExpenseReport", { budgetId })
        const detail = call("mantle.other.BudgetReportServices.run#BudgetExpenseDetailReport", { budgetId })
        const row = report.glAccountInfoList.find(r => r.glAccountId == expenseAccountIds[0])
        return { report, detail, row }
    },
    then({ report, detail, row }) {
        report.budget.budgetId == budgetId
        report.subTimePeriodSize == 12
        report.glAccountInfoList.length > 0
        n(row.amountMain) == 1300
        n(row.amountPer1) == 200
        detail.detailInfoList != null
    },
})

feature("store a BudgetItemDetail, change it, and delete it by storing no amount", {
    when() {
        const seq = call("mantle.other.BudgetServices.store#BudgetItem", { budgetId, glAccountId: expenseAccountIds[1], amount: 400 }).budgetItemSeqId
        const stored = call("mantle.other.BudgetServices.store#BudgetItemDetail", { budgetId, budgetItemSeqId: seq, amount: 25, description: "first" })
        const detailId = stored.budgetItemDetailId
        const read = ec.entity.find("mantle.other.budget.BudgetItemDetail").condition("budgetItemDetailId", detailId).one()
        call("mantle.other.BudgetServices.store#BudgetItemDetail", { budgetId, budgetItemSeqId: seq, budgetItemDetailId: detailId, amount: 30 })
        const updated = ec.entity.find("mantle.other.budget.BudgetItemDetail").condition("budgetItemDetailId", detailId).one()
        call("mantle.other.BudgetServices.store#BudgetItemDetail", { budgetId, budgetItemSeqId: seq, budgetItemDetailId: detailId })
        const gone = ec.entity.find("mantle.other.budget.BudgetItemDetail").condition("budgetItemDetailId", detailId).one()
        return { detailId, read, updated, gone }
    },
    then({ detailId, read, updated, gone }) {
        detailId != null
        n(read.amount) == 25
        n(updated.amount) == 30
        gone == null
    },
})
