// Ledger reports (mantle.ledger.LedgerReportServices) over the postings the flows before it leave in ORG_ZIZI_RETAIL.
// The checks are the accounting identities, so they hold whatever the flows posted. New spec, no Groovy original.
const organizationPartyId = "ORG_ZIZI_RETAIL", currencyUomId = "USD"
const effectiveTime = Date.now()
let timePeriodId

spec({
    dependsOn: ["AccountingActivities", "OrderToCashBasicFlow"],
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

// a decimal map value at the period, as a number (these are rounded to cents in the report)
const num = (map, key) => map[key] == null ? 0 : dec(map[key]).toNumber()
const near = (a, b) => Math.abs(a - b) < 0.005

feature("find the current fiscal month", {
    when() {
        const out = call("mantle.ledger.LedgerServices.get#OrganizationFiscalTimePeriods",
                { organizationPartyId, filterDate: ec.user.nowTimestamp, timePeriodTypeId: "FiscalMonth" })
        timePeriodId = out.timePeriodList[0].timePeriodId
        const info = call("mantle.ledger.LedgerReportServices.get#ReportBasicInfo", { organizationPartyId, timePeriodIdList: [timePeriodId] })
        return { info }
    },
    then({ info }) {
        timePeriodId != null
        info.organizationName == "Ziziwork Retail & Wholesale"
        info.currencyUomId == currencyUomId
        info.timePeriodIdList.length == 1
        info.timePeriodIdMap[timePeriodId].partyId == organizationPartyId
    },
})

feature("the income statement adds up", {
    when() { return { r: call("mantle.ledger.LedgerReportServices.run#IncomeStatement", { organizationPartyId, timePeriodIdList: [timePeriodId] }) } },
    then({ r }) {
        near(num(r.netOperatingIncomeMap, timePeriodId) + num(r.netNonOperatingIncomeMap, timePeriodId), num(r.netIncomeMap, timePeriodId))
        num(r.netIncomeMap, timePeriodId) == num(r.netIncomeMap, "ALL")
        r.classInfoById.REVENUE != null
        r.topExpenseByTimePeriod[timePeriodId] != null
        r.topExpenseByTimePeriod.ALL.length <= 10
    },
})

feature("the balance sheet balances: assets are liabilities plus equity plus net income", {
    when() { return { r: call("mantle.ledger.LedgerReportServices.run#BalanceSheet", { organizationPartyId, timePeriodIdList: [timePeriodId] }) } },
    then({ r }) {
        near(num(r.netAssetTotalMap.totalBalance, timePeriodId),
                num(r.liabilityEquityTotalMap.totalBalance, timePeriodId) + num(r.netIncomeOut.totalBalance, timePeriodId))
        num(r.equityTotalMap.totalBalance, timePeriodId) != 0
    },
})

feature("the cash flow, retained earnings and ratio reports run on the same figures", {
    when() {
        const cash = call("mantle.ledger.LedgerReportServices.run#CashFlowStatement", { organizationPartyId, timePeriodIdList: [timePeriodId] })
        const retained = call("mantle.ledger.LedgerReportServices.run#RetainedEarningsStatement", { organizationPartyId, timePeriodIdList: [timePeriodId] })
        const ratios = call("mantle.ledger.LedgerReportServices.run#FinancialRatios", { organizationPartyId, timePeriodIdList: [timePeriodId] })
        const income = call("mantle.ledger.LedgerReportServices.run#IncomeStatement", { organizationPartyId, timePeriodIdList: [timePeriodId] })
        return { cash, retained, ratios, income }
    },
    then({ cash, retained, ratios, income }) {
        near(num(cash.netIncomeMap, timePeriodId), num(income.netIncomeMap, timePeriodId))
        near(num(retained.netIncomeMap, timePeriodId), num(income.netIncomeMap, timePeriodId))
        near(num(ratios.netIncomeMap, timePeriodId), num(income.netIncomeMap, timePeriodId))
        near(num(ratios.salesMap, timePeriodId) - num(ratios.costOfSalesMap, timePeriodId), num(ratios.grossProfitMap, timePeriodId))
        near(num(ratios.grossProfitMap, timePeriodId), num(income.grossProfitOnSalesMap, timePeriodId))
        Object.keys(cash.netFinancingActivityMap).includes(timePeriodId)
    },
})

feature("PostedAmountSummary and AccountLedgerInfo", {
    when() {
        const summary = call("mantle.ledger.LedgerReportServices.run#PostedAmountSummary", { organizationPartyId, amountUomId: currencyUomId })
        const ledger = call("mantle.ledger.LedgerReportServices.get#AccountLedgerInfo",
                { glAccountIdList: ["111100000"], timePeriodId, organizationPartyId })
        return { summary, ledger }
    },
    then({ summary, ledger }) {
        summary.resultList.length > 0
        ledger.timePeriod.timePeriodId == timePeriodId
        ledger.currencyUomId == currencyUomId
        ledger.glAccountOrgTimePeriodList.length == 1
        // an opening row, one row per entry, a totals row, a closing row
        ledger.entryInfoList.length >= 4
        ledger.entryInfoList[0].accountCode == "111-100-000"
    },
})

feature("PeriodSeriesSummary builds datasets for a period group", {
    when() {
        const out = call("mantle.ledger.LedgerReportServices.get#PeriodSeriesSummary", { organizationPartyId,
                timePeriodGroups: [[timePeriodId]],
                datasets: [{ datasetId: "income", label: "Net Income", classes: ["REVENUE", "COST_OF_SALES", "EXPENSE"], negateDebit: true },
                           { datasetId: "cash", label: "Cash", classes: ["CASH_EQUIVALENT"], totalBasis: "Ending" }] })
        const rows = call("mantle.ledger.LedgerReportServices.get#PeriodSeriesSummaryRows", { periodLabels: out.periodLabels, datasets: out.datasets })
        return { out, rows }
    },
    then({ out, rows }) {
        out.periodLabels.length == 1
        out.datasets.length == 2
        out.datasetsById.income.data.length == 1
        out.datasetsById.cash.data.length == 1
        rows.rowsList.length >= 1
    },
})
