// IronStone Projects reports in mantle.work.ProjectReportServices (design-projects.md §11 and §15 Reports services; impl-projects.md
// P9): each measure checked against §11's definitions on known data: time by criteria and period with billable value at the client
// rates (get#TimeReport), work item counts with created, resolved, overdue and cycle time (get#WorkItemSummary), the portfolio with
// % complete, the forecast against the target and the budget used (get#PortfolioStatus), cost at the workers' rates plus expenses,
// billable value, billed, margin (get#ProjectProfitability), utilization and billable utilization over capacity (get#Utilization),
// the progress breakdown down the tree (get#ProgressBreakdown), and get#ProjectStats' danger only with an estimate (F70). Every report
// is limited to the projects the user sees and money is given only to those who manage it. New spec, no Groovy original.
// In a Work group project of its own (RPT: john.doe its manager, ADMIN; joe.developer a programmer and bob.developer a quality
// analyst, neither managing money; Ziziwork Services the vendor, a client of its own) and a second Work group project only John Doe is
// on (RPX), in the weeks of May 3 and 10, 2027.
const REPORT = "mantle.work.ProjectReportServices"
const PROJECT = "mantle.work.ProjectServices"
const TIME = "mantle.work.TimeServices"
const TASK = "mantle.work.TaskServices"
const CLIENT = "RPT_CLIENT"
const SUPPLIER = "RPT_SUPPLIER"
const at = (month, day, hour, minute) => Number(String(ec.l10n.parseTimestamp(`2027-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} `
        + `${String(hour).padStart(2, "0")}:${String(minute || 0).padStart(2, "0")}:00.000`, "yyyy-MM-dd HH:mm:ss.SSS")))
const NOW = at(5, 14, 17)
const made = {}

spec({
    stepwise: true,
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(NOW)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() {
        ec.artifactExecution.enableAuthz()
        login("john.doe")
        ec.user.setEffectiveTime(NOW)
    },
    cleanupSpec() {
        ec.artifactExecution.disableAuthz()
        try {
            for (const id of ["RPT", "RPX"]) {
                const project = one("mantle.work.effort.WorkEffort", { workEffortId: id })
                if (project) { project.statusId = "WeCancelled"; project.update() }
            }
            for (const rate of ec.entity.find("mantle.humanres.rate.RateAmount").condition("workEffortId", "RPT").list()) { rate.thruDate = at(1, 1, 0); rate.update() }
        } finally { ec.artifactExecution.enableAuthz() }
        ec.user.setEffectiveTime(null)
    },
})

function errorOf(name, params) {
    try { call(name, params) } catch (e) { const thrown = String(e.message); ec.message.clearErrors(); return thrown }
    const errors = ec.message.hasError() ? ec.message.getErrorsString() : null
    ec.message.clearErrors()
    return errors
}
// as another user: the services decide by the user (the screens' app roots grant them, impl-projects.md F36)
function as(username, run) {
    login(username)
    ec.user.setEffectiveTime(NOW)
    try { return run() } finally { login("john.doe"); ec.user.setEffectiveTime(NOW) }
}
const one = (entityName, fields) => ec.entity.find(entityName).condition(fields).one()
const num = (value) => value == null ? null : Number(String(value))
const near = (left, right) => left != null && right != null && Math.abs(Number(String(left)) - Number(String(right))) < 0.006
const entry = (fields) => call(`${TIME}.store#TimeEntry`, Object.assign({ rateTypeEnumId: "RatpStandard" }, fields)).timeEntryId
const valueOf = (row, criterion) => row.values.find((value) => value.criterion === criterion)
const moneyKeys = ["amount", "clientBudget", "actualClientCost", "budgetUsedPercent", "actualCost", "totalClientCostAllowed"]
const usedPercent = (project) => Math.round((num(project.actualClientCost) || 0) * 10000 / 5000) / 100
const hasMoney = (map) => map != null && moneyKeys.some((key) => key in map)

feature("a project with a tree of work items, rates, time over two weeks, a client invoice and an expense", {
    when() {
        for (const [partyId, name] of [[CLIENT, "Reports Client"], [SUPPLIER, "Reports Supplier"]]) if (!one("mantle.party.Party", { partyId })) {
            call("create#mantle.party.Party", { partyId, partyTypeEnumId: "PtyOrganization" })
            call("create#mantle.party.Organization", { partyId, organizationName: name })
        }
        if (!one("mantle.party.PartyRole", { partyId: CLIENT, roleTypeId: "Customer" })) call("create#mantle.party.PartyRole", { partyId: CLIENT, roleTypeId: "Customer" })
        call(`${PROJECT}.create#Project`, { workEffortId: "RPT", workEffortName: "Reports walk", visibilityEnumId: "WevWorkGroup" })
        call("update#mantle.work.effort.WorkEffort", { workEffortId: "RPT", statusId: "WeInProgress", ownerPartyId: "ORG_ZIZI_SERVICES",
            estimatedCompletionDate: at(5, 20, 17), totalTimeAllowed: 40, totalClientCostAllowed: 5000, costUomId: "USD" })
        for (const [partyId, roleTypeId] of [["EX_JOHN_DOE", "ProjectManager"], ["ORG_ZIZI_JD", "Programmer"], ["ORG_ZIZI_BD", "QualityAnalyst"],
                ["ORG_ZIZI_SERVICES", "Vendor"], [CLIENT, "Customer"]])
            call("create#mantle.work.effort.WorkEffortParty", { workEffortId: "RPT", partyId, roleTypeId, fromDate: at(1, 1, 0), statusId: "WeptAssigned" })
        call(`${PROJECT}.create#Project`, { workEffortId: "RPX", workEffortName: "Reports elsewhere", visibilityEnumId: "WevWorkGroup" })
        call("update#mantle.work.effort.WorkEffort", { workEffortId: "RPX", statusId: "WeInProgress", ownerPartyId: "ORG_ZIZI_SERVICES" })
        call("create#mantle.work.effort.WorkEffortParty", { workEffortId: "RPX", partyId: "EX_JOHN_DOE", roleTypeId: "ProjectManager", fromDate: at(1, 1, 0), statusId: "WeptAssigned" })

        // the items, made on May 3: an epic with a child, a bug due before today, a feature
        ec.user.setEffectiveTime(at(5, 3, 8))
        made.epic = call(`${TASK}.create#Task`, { rootWorkEffortId: "RPT", workEffortName: "Ledger", purposeEnumId: "WepTask", estimatedWorkTime: 0 }).workEffortId
        made.child = call(`${TASK}.create#Task`, { rootWorkEffortId: "RPT", parentWorkEffortId: made.epic, workEffortName: "Ledger screens", purposeEnumId: "WepTask",
            estimatedWorkTime: 10, estimatedCompletionDate: at(5, 28, 17) }).workEffortId
        made.bug = call(`${TASK}.create#Task`, { rootWorkEffortId: "RPT", workEffortName: "Rounding bug", purposeEnumId: "WepFix", estimatedWorkTime: 4,
            estimatedCompletionDate: at(5, 12, 17), assignToPartyId: "ORG_ZIZI_BD" }).workEffortId
        made.feature = call(`${TASK}.create#Task`, { rootWorkEffortId: "RPT", workEffortName: "Export", purposeEnumId: "WepTask", estimatedWorkTime: 6,
            assignToPartyId: "ORG_ZIZI_JD" }).workEffortId
        made.hidden = call(`${TASK}.create#Task`, { rootWorkEffortId: "RPX", workEffortName: "Elsewhere", purposeEnumId: "WepTask", estimatedWorkTime: 2 }).workEffortId
        // the feature goes In Progress on May 4 and Complete on May 6: a cycle of two days
        ec.user.setEffectiveTime(at(5, 4, 9))
        call(`${TASK}.set#TaskStatus`, { workEffortId: made.feature, statusId: "WeInProgress" })
        ec.user.setEffectiveTime(at(5, 6, 9))
        call(`${TASK}.set#TaskStatus`, { workEffortId: made.feature, statusId: "WeComplete" })
        ec.user.setEffectiveTime(NOW)

        // the rates: the project's client rate for everyone; the workers' pay given on each entry
        made.rate = call("mantle.humanres.RateServices.create#RateAmount", { workEffortId: "RPT", ratePurposeEnumId: "RaprClient", rateTypeEnumId: "RatpStandard",
            timePeriodUomId: "TF_hr", rateCurrencyUomId: "USD", rateAmount: 100, fromDate: at(1, 1, 0) }).rateAmountId
        made.joe1 = entry({ partyId: "ORG_ZIZI_JD", workEffortId: made.child, fromDate: at(5, 3, 9), thruDate: at(5, 3, 13), hours: 4, workTypeEnumId: "WktpDevelopment",
            clientHourRate: 120, vendorHourRate: 50 })
        made.joe2 = entry({ partyId: "ORG_ZIZI_JD", workEffortId: made.feature, fromDate: at(5, 4, 9), thruDate: at(5, 4, 11), hours: 2, workTypeEnumId: "WktpDevelopment",
            clientHourRate: 120, vendorHourRate: 50 })
        made.bob1 = entry({ partyId: "ORG_ZIZI_BD", workEffortId: made.child, fromDate: at(5, 5, 9), thruDate: at(5, 5, 12), hours: 3, workTypeEnumId: "WktpTesting",
            vendorHourRate: 40 })
        made.bobFree = entry({ partyId: "ORG_ZIZI_BD", workEffortId: made.bug, fromDate: at(5, 11, 9), thruDate: at(5, 11, 10), hours: 1, workTypeEnumId: "WktpTesting",
            rateTypeEnumId: "RatpNoCharge", vendorHourRate: 40 })
        made.john1 = entry({ partyId: "EX_JOHN_DOE", workEffortId: "RPT", fromDate: at(5, 12, 14), thruDate: at(5, 12, 15, 30), hours: 1.5, workTypeEnumId: "WktpProjectMgmt",
            clientHourRate: 150, vendorHourRate: 60 })
        made.elsewhere = entry({ partyId: "EX_JOHN_DOE", workEffortId: made.hidden, fromDate: at(5, 12, 9), thruDate: at(5, 12, 11), hours: 2, workTypeEnumId: "WktpDevelopment",
            clientHourRate: 90, vendorHourRate: 60 })

        // a client invoice of 500 on May 12 and an expense of 80 from a supplier on May 7, both on the project
        made.invoice = call("mantle.account.InvoiceServices.create#Invoice", { fromPartyId: "ORG_ZIZI_SERVICES", toPartyId: CLIENT, invoiceTypeEnumId: "InvoiceSales",
            currencyUomId: "USD", invoiceDate: at(5, 12, 16) }).invoiceId
        call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId: made.invoice, itemTypeEnumId: "ItemTimeEntry", description: "Ledger work", quantity: 1, amount: 500 })
        made.expense = call("mantle.account.InvoiceServices.create#Invoice", { fromPartyId: SUPPLIER, toPartyId: "ORG_ZIZI_SERVICES", currencyUomId: "USD",
            invoiceDate: at(5, 7, 10) }).invoiceId
        call("mantle.account.InvoiceServices.create#InvoiceItem", { invoiceId: made.expense, itemTypeEnumId: "ItemExpHosting", description: "Test server", quantity: 1, amount: 80 })
        for (const invoiceId of [made.invoice, made.expense]) call("create#mantle.work.effort.WorkEffortInvoice", { workEffortId: "RPT", invoiceId })
        return { bob1: one("mantle.work.time.TimeEntry", { timeEntryId: made.bob1 }), invoice: one("mantle.account.invoice.Invoice", { invoiceId: made.invoice }),
            expense: one("mantle.account.invoice.Invoice", { invoiceId: made.expense }) }
    },
    then({ bob1, invoice, expense }) {
        // Bob's entry has no hour rate of its own: its value comes from the project's RateAmount (impl-projects.md F86)
        bob1.rateAmountId == made.rate && bob1.clientHourRate == null
        near(invoice.invoiceTotal, 500) && near(expense.invoiceTotal, 80)
    },
})

feature("the time report: hours by period and criteria, billable value at the client rates, an item's subtree, the projects the user sees", {
    when() {
        const params = { fromDate: "2027-05-03", thruDate: "2027-05-14", period: "week" }
        return {
            byProject: call(`${REPORT}.get#TimeReport`, Object.assign({ criteria: "project", rootWorkEffortId: "RPT" }, params)),
            byTop: call(`${REPORT}.get#TimeReport`, Object.assign({ criteria: ["topItem", "billable"], rootWorkEffortId: "RPT" }, params)),
            subtree: call(`${REPORT}.get#TimeReport`, Object.assign({ criteria: "person", workEffortId: made.epic }, params)),
            month: call(`${REPORT}.get#TimeReport`, Object.assign({ criteria: "workType", rootWorkEffortId: "RPT" }, params, { period: "month" })),
            joe: as("joe.developer", () => call(`${REPORT}.get#TimeReport`, Object.assign({ criteria: "project", rootWorkEffortId: "RPT" }, params))),
            bob: as("bob.developer", () => call(`${REPORT}.get#TimeReport`, Object.assign({ criteria: "workItem", rootWorkEffortId: "RPX" }, params))),
        }
    },
    then({ byProject, byTop, subtree, month, joe, bob }) {
        // weeks from Monday May 3: the week of May 10 too
        byProject.periodList.map((period) => period.key).join() == "2027-05-03,2027-05-10"
        byProject.rowList.length == 1
        const row = byProject.rowList[0]
        valueOf(row, "project").id == "RPT"
        // 4 + 2 + 3 the first week; 1 (no charge) + 1.5 the second
        near(row.periodHours[0], 9) && near(row.periodHours[1], 2.5) && near(row.hours, 11.5)
        near(row.billableHours, 10.5) && near(row.nonBillableHours, 1)
        // billable hours at the client rate: 4 and 2 h at 120, 3 h at the project's 100, 1.5 h at 150; the no-charge hour none
        byProject.amountsShown == true && near(row.amount, 4 * 120 + 2 * 120 + 3 * 100 + 1.5 * 150)
        near(byProject.totals.amount, 1245) && byProject.totals.currencyUomId == "USD" && byProject.totals.missingRateCount == 0
        byProject.chart.labels.length == 2 && byProject.chart.series.length == 1 && near(byProject.chart.series[0].data[0], 9)

        // the top-level item: the epic's child counts under the epic; time on the project is its own row
        const topOf = (id, billable) => byTop.rowList.find((one) => valueOf(one, "topItem").id == id && valueOf(one, "billable").id == billable)
        near(topOf(made.epic, "Y").hours, 7)
        near(topOf(made.feature, "Y").hours, 2)
        near(topOf(made.bug, "N").hours, 1) && topOf(made.bug, "Y") == null
        topOf(null, "Y") != null && near(topOf(null, "Y").hours, 1.5)

        // an item takes its subtree: the epic's child's time, by person
        near(subtree.totals.hours, 7) && subtree.rowList.length == 2
        near(month.totals.hours, 11.5) && month.periodList.length == 1 && month.periodList[0].key == "2027-05"

        // Joe, no money and no project to manage: only his own time, no amounts
        near(joe.totals.hours, 6) && joe.amountsShown == false && joe.totals.amount == null && joe.rowList.every((one) => !("amount" in one))
        // RPX is not Bob's: nothing from it
        bob.rowList.length == 0 && bob.totals.hours == 0
    },
})

feature("the work item summary: open, created, resolved and overdue, by status and type, the cycle time from In Progress to Complete", {
    when() {
        return {
            byStatus: call(`${REPORT}.get#WorkItemSummary`, { rootWorkEffortId: "RPT", fromDate: "2027-05-03", thruDate: "2027-05-14", groupBy: "status" }),
            byAssignee: call(`${REPORT}.get#WorkItemSummary`, { rootWorkEffortId: "RPT", fromDate: "2027-05-03", thruDate: "2027-05-14", groupBy: "assignee" }),
            bugs: call(`${REPORT}.get#WorkItemSummary`, { rootWorkEffortId: "RPT", purposeEnumId: "WepFix" }),
            bob: as("bob.developer", () => call(`${REPORT}.get#WorkItemSummary`, { rootWorkEffortIds: ["RPT", "RPX"], fromDate: "2027-05-01", thruDate: "2027-05-14" })),
        }
    },
    then({ byStatus, byAssignee, bugs, bob }) {
        byStatus.itemCount == 4
        // four made in the period, the feature resolved, three open, the bug due May 12 and still open
        byStatus.counts.created == 4 && byStatus.counts.resolved == 1 && byStatus.counts.open == 3 && byStatus.counts.overdue == 1
        byStatus.weekList[0].weekStart == "2027-05-03" && byStatus.weekList[0].created == 4 && byStatus.weekList[0].resolved == 1
        byStatus.totals.total == 4 && near(byStatus.totals.averageCycleDays, 2)
        byStatus.rowList.find((row) => row.groupId == "WeComplete").total == 1
        byStatus.rowList.find((row) => row.groupId == "WeComplete").averageCycleDays == 2
        byStatus.statusList.some((status) => status.statusId == "WeComplete")
        byStatus.openByType.find((type) => type.id == "WepFix").count == 1
        // by assignee: Bob's bug, Joe's feature and two unassigned
        byAssignee.rowList.find((row) => row.groupId == "ORG_ZIZI_BD").total == 1
        byAssignee.rowList.find((row) => row.groupId == null).total == 2
        bugs.itemCount == 1
        // Bob is not on RPX: only RPT's items
        bob.itemCount == 4
    },
})

feature("the portfolio: % complete, the forecast after the target, open and overdue items, the budget used only with money", {
    when() {
        const project = one("mantle.work.effort.WorkEffort", { workEffortId: "RPT" })
        return {
            project,
            john: call(`${REPORT}.get#PortfolioStatus`, {}),
            joe: as("joe.developer", () => call(`${REPORT}.get#PortfolioStatus`, {})),
        }
    },
    then({ project, john, joe }) {
        const row = john.projectList.find((one) => one.workEffortId == "RPT")
        row != null && john.moneyShown == true
        // % complete is the estimate less what remains over the estimate
        const estimate = num(project.estimatedWorkTime), remaining = num(project.remainingWorkTime)
        estimate > 0 && near(row.percentComplete, (estimate - remaining) * 100 / estimate)
        near(row.actualHours, num(project.actualWorkTime)) && near(row.hoursBudget, 40) && near(row.hoursUsedPercent, num(project.actualWorkTime) * 100 / 40)
        // the forecast is the latest due date of the open items (the child, May 28) after the target (May 20)
        row.targetDate == "2027-05-20" && row.forecastDate == "2027-05-28" && row.late == true && row.atRisk == true
        row.openCount == 3 && row.overdueCount == 1
        // the budget used: the actual client cost over the client budget
        near(row.clientBudget, 5000) && near(row.budgetUsedPercent, usedPercent(project))
        john.projectList.some((one) => one.workEffortId == "RPX")
        // Joe sees RPT, not RPX, and no money
        joe.moneyShown == false && joe.projectList.some((one) => one.workEffortId == "RPT") && !joe.projectList.some((one) => one.workEffortId == "RPX")
        !hasMoney(joe.projectList.find((one) => one.workEffortId == "RPT"))
    },
})

feature("profitability: cost at the workers' rates plus expenses, billable value at the client rates, billed, margin; only for money", {
    when() {
        const period = { fromDate: "2027-05-01", thruDate: "2027-05-14" }
        return {
            out: call(`${REPORT}.get#ProjectProfitability`, Object.assign({ rootWorkEffortId: "RPT" }, period)),
            billed: call(`${REPORT}.get#ProjectProfitability`, Object.assign({ rootWorkEffortId: "RPT", basis: "billed" }, period)),
            before: call(`${REPORT}.get#ProjectProfitability`, { rootWorkEffortId: "RPT", fromDate: "2027-05-01", thruDate: "2027-05-08" }),
            byClient: call(`${REPORT}.get#ProjectProfitability`, Object.assign({ clientPartyId: CLIENT }, period)),
            project: one("mantle.work.effort.WorkEffort", { workEffortId: "RPT" }),
            joeError: as("joe.developer", () => errorOf(`${REPORT}.get#ProjectProfitability`, {})),
        }
    },
    then({ out, billed, before, byClient, project, joeError }) {
        const row = out.projectList[0]
        out.projectList.length == 1 && row.clientPartyId == CLIENT && row.currencyUomId == "USD"
        near(row.hours, 11.5) && near(row.billableHours, 10.5)
        // the time's cost: every hour at the worker's rate, billable or not
        near(row.timeCost, 4 * 50 + 2 * 50 + 3 * 40 + 1 * 40 + 1.5 * 60) && near(row.expenses, 80) && near(row.cost, 550 + 80)
        // billable value: the billable hours at the client rates plus the expenses billed through
        near(row.timeValue, 1245) && near(row.billableValue, 1325)
        near(row.billed, 500) && near(row.unbilled, 1245)
        near(row.margin, 1325 - 630) && near(row.marginPercent, Math.round(695 * 10000 / 1325) / 100)
        row.costMissingCount == 0 && row.valueMissingCount == 0
        // the budget used: the actual client cost over the client budget
        near(row.budget, 5000) && near(row.budgetUsedPercent, usedPercent(project))
        // basis billed: billed less cost
        near(billed.projectList[0].margin, 500 - 630)
        // the period: only the first week's time and the expense of May 7; the invoice of May 12 is after it
        near(before.projectList[0].hours, 9) && near(before.projectList[0].billed, 0) && near(before.projectList[0].expenses, 80)
        // by client: the client's projects and their totals
        byClient.projectList.length == 1 && byClient.clientList.length == 1 && near(byClient.clientList[0].billableValue, 1325) && near(byClient.totals.cost, 630)
        joeError != null
    },
})

feature("utilization: logged and billable hours over capacity by person and week", {
    when() {
        const out = call(`${REPORT}.get#Utilization`, { fromDate: "2027-05-03", weeks: 2, partyId: "ORG_ZIZI_JD" })
        const capacity = call("mantle.work.ResourceServices.get#PartyCapacity", { partyIdList: ["ORG_ZIZI_JD"], fromDate: "2027-05-03", thruDate: "2027-05-16" })
        ec.message.clearErrors()
        const logged = { "2027-05-03": 0, "2027-05-10": 0 }, billable = { "2027-05-03": 0, "2027-05-10": 0 }
        for (const row of ec.entity.find("mantle.work.time.TimeEntry").condition("partyId", "ORG_ZIZI_JD").condition("fromDate", "greater-equals", new Date(at(5, 3, 0)))
                .condition("fromDate", "less-than", new Date(at(5, 17, 0))).list()) {
            const week = ec.l10n.format(row.fromDate, "yyyy-MM-dd") < "2027-05-10" ? "2027-05-03" : "2027-05-10"
            logged[week] += num(row.hours)
            if (row.rateTypeEnumId !== "RatpNoCharge") billable[week] += num(row.hours)
        }
        return { out, capacity: Array.from(capacity.capacityList || [])[0], logged, billable }
    },
    then({ out, capacity, logged, billable }) {
        out.fromDay == "2027-05-03" && out.weekList.length == 2
        out.personList.length == 1 && out.personList[0].partyId == "ORG_ZIZI_JD"
        const week = out.personList[0].weekList[0]
        const cap = num(Array.from(capacity.weekList).find((one) => one.weekStart == "2027-05-03").capacity)
        cap > 0 && near(week.capacity, cap)
        near(week.logged, logged["2027-05-03"]) && near(week.billable, billable["2027-05-03"])
        near(week.utilization, Math.round(logged["2027-05-03"] * 10000 / cap) / 100)
        near(week.billableUtilization, Math.round((billable["2027-05-03"]) * 10000 / cap) / 100)
        out.rowList.length == 2 && near(out.totals.logged, logged["2027-05-03"] + logged["2027-05-10"])
    },
})

feature("the progress breakdown: the top-level items with their subtree's numbers, down the tree, no money without the right", {
    when() {
        return {
            depth1: call(`${REPORT}.get#ProgressBreakdown`, { workEffortId: "RPT", depth: 1 }),
            depth2: call(`${REPORT}.get#ProgressBreakdown`, { workEffortId: "RPT", depth: 2 }),
            level: call(`${REPORT}.get#ProgressBreakdown`, { workEffortId: "RPT", parentWorkEffortId: made.epic }),
            from: call(`${REPORT}.get#ProgressBreakdown`, { workEffortId: "RPT", fromWorkEffortId: made.epic }),
            joe: as("joe.developer", () => call(`${REPORT}.get#ProgressBreakdown`, { workEffortId: "RPT", depth: 2 })),
            child: one("mantle.work.effort.WorkEffort", { workEffortId: made.child }),
        }
    },
    then({ depth1, depth2, level, from, joe, child }) {
        depth1.rowList.length == 3 && depth1.rowList.every((row) => row.level == 1 && row.parentWorkEffortId == null)
        const epic = depth1.rowList.find((row) => row.workEffortId == made.epic)
        // the epic's numbers are its subtree's: its child's estimate and actual
        epic.childCount == 1 && near(epic.estimatedWorkTime, 10) && near(epic.actualWorkTime, num(child.actualWorkTime))
        near(epic.workActualPercent, num(child.actualWorkTime) * 100 / 10)
        depth2.rowList.length == 4 && depth2.rowList.find((row) => row.workEffortId == made.child).parentWorkEffortId == made.epic
        depth2.rowList.find((row) => row.workEffortId == made.child).level == 2
        level.rowList.length == 1 && level.rowList[0].workEffortId == made.child && level.rowList[0].parentWorkEffortId == made.epic
        from.fromItem.workEffortId == made.epic && from.rowList.length == 1
        near(depth1.totals.estimatedWorkTime, 20)
        depth1.moneyShown == true && "actualCost" in epic
        joe.moneyShown == false && joe.rowList.length == 4 && joe.rowList.every((row) => !hasMoney(row)) && !hasMoney(joe.totals)
        joe.milestoneList.every((row) => !hasMoney(row))
    },
})

feature("get#ProjectStats: actual and remaining past the estimate is a danger only when there is an estimate (impl-projects.md F70)", {
    when() {
        return {
            none: call(`${PROJECT}.get#ProjectStats`, { workEffort: { workEffortId: "RPT_NONE", actualWorkTime: 12, remainingWorkTime: 0 } }),
            over: call(`${PROJECT}.get#ProjectStats`, { workEffort: { workEffortId: "RPT_NONE", estimatedWorkTime: 10, actualWorkTime: 8, remainingWorkTime: 4 } }),
            under: call(`${PROJECT}.get#ProjectStats`, { workEffort: { workEffortId: "RPT_NONE", estimatedWorkTime: 10, actualWorkTime: 4, remainingWorkTime: 4 } }),
        }
    },
    then({ none, over, under }) {
        none.projectDanger == false && none.actualPlusRemainingOverEstimated == false
        over.projectDanger == true && over.actualPlusRemainingOverEstimated == true
        under.projectDanger == false
    },
})
