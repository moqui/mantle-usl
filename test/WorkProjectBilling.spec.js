// IronStone Projects billing, first part (design-projects.md §10 Unbilled, InvoiceDetail and Rates, §3 Home's Unbilled, §15 Billing
// services; impl-projects.md P8a): rates by project, person and work type with effective dates (mantle.work.TimeServices.find#RateAmount),
// what waits to be billed (mantle.work.ProjectServices.get#UnbilledSummary: billable time not invoiced, the approved part ready to
// invoice, amounts to the cent), a client invoice from the approved time only (mantle.account.InvoiceServices.create#ProjectInvoiceItems
// with approvedOnly, billableOnly and a selection; the project linked by WorkEffortInvoice; payment terms giving the due date), the time
// behind its items (get#InvoiceTimeDetail), Home's unbilled amount (get#ProjectHomeCounts) and a cancelled invoice freeing its time.
// New spec, no Groovy original.
// In a Work group project of its own (TBL: john.doe its manager, joe.developer a programmer, bob.developer a quality analyst, Ziziwork
// Services the vendor, a client organization of its own), in the weeks of April 5 and 12, 2027.
const TS = "mantle.work.TimesheetServices"
const TIME = "mantle.work.TimeServices"
const PROJECT = "mantle.work.ProjectServices"
const INVOICE = "mantle.account.InvoiceServices"
const RATE = "mantle.humanres.RateServices"
const CLIENT = "TBL_CLIENT"
const at = (month, day, hour, minute) => Number(String(ec.l10n.parseTimestamp(`2027-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} `
        + `${String(hour).padStart(2, "0")}:${String(minute || 0).padStart(2, "0")}:00.000`, "yyyy-MM-dd HH:mm:ss.SSS")))
const NOW = at(4, 16, 17)
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
            for (const link of ec.entity.find("mantle.work.effort.WorkEffortInvoice").condition("workEffortId", "TBL").list()) {
                const invoice = one("mantle.account.invoice.Invoice", { invoiceId: link.invoiceId })
                if (invoice && invoice.statusId !== "InvoiceCancelled") call("update#mantle.account.invoice.Invoice", { invoiceId: invoice.invoiceId, statusId: "InvoiceCancelled" })
            }
            for (const rate of ec.entity.find("mantle.humanres.rate.RateAmount").condition("workEffortId", "TBL").list()) { rate.thruDate = at(1, 1, 0); rate.update() }
            const project = one("mantle.work.effort.WorkEffort", { workEffortId: "TBL" })
            if (project) { project.statusId = "WeCancelled"; project.update() }
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
function as(username, run) {
    login(username)
    ec.user.setEffectiveTime(NOW)
    try { return run() } finally { login("john.doe"); ec.user.setEffectiveTime(NOW) }
}
const one = (entityName, fields) => ec.entity.find(entityName).condition(fields).one()
const dec = (value) => value == null ? null : String(toDecimal(value).setScale(2, "HALF_UP"))
const entry = (fields) => call(`${TIME}.store#TimeEntry`, Object.assign({ rateTypeEnumId: "RatpStandard" }, fields)).timeEntryId
const summary = (parameters) => call(`${PROJECT}.get#UnbilledSummary`, Object.assign({ workEffortId: "TBL" }, parameters || {}))
const rateOf = (fields) => call(`${TIME}.find#RateAmount`, Object.assign({ ratePurposeEnumId: "RaprClient", rateTypeEnumId: "RatpStandard", rateCurrencyUomId: "USD",
    workEffortId: "TBL" }, fields))
const sheetOf = (timeEntryId) => one("mantle.work.time.TimeEntry", { timeEntryId }).timesheetId

feature("a project billed to a client, and its rates: the project's for everyone (one rate, then a new one from April 10), Joe's own, project management's", {
    when() {
        call(`${PROJECT}.create#Project`, { workEffortId: "TBL", workEffortName: "Billing walk", visibilityEnumId: "WevWorkGroup" })
        call("update#mantle.work.effort.WorkEffort", { workEffortId: "TBL", statusId: "WeInProgress", ownerPartyId: "ORG_ZIZI_SERVICES" })
        made.task = call("mantle.work.TaskServices.create#Task", { rootWorkEffortId: "TBL", workEffortName: "Ledger" }).workEffortId
        if (!one("mantle.party.Party", { partyId: CLIENT })) {
            call("create#mantle.party.Party", { partyId: CLIENT, partyTypeEnumId: "PtyOrganization" })
            call("create#mantle.party.Organization", { partyId: CLIENT, organizationName: "Billing Walk Client" })
            call("create#mantle.party.PartyRole", { partyId: CLIENT, roleTypeId: "Customer" })
        }
        for (const [partyId, roleTypeId] of [["EX_JOHN_DOE", "ProjectManager"], ["ORG_ZIZI_JD", "Programmer"], ["ORG_ZIZI_BD", "QualityAnalyst"],
                ["ORG_ZIZI_SERVICES", "Vendor"], [CLIENT, "Customer"]])
            call("create#mantle.work.effort.WorkEffortParty", { workEffortId: "TBL", partyId, roleTypeId, fromDate: at(1, 1, 0), statusId: "WeptAssigned" })
        const rate = (fields) => call(`${RATE}.create#RateAmount`, Object.assign({ workEffortId: "TBL", ratePurposeEnumId: "RaprClient", rateTypeEnumId: "RatpStandard",
            timePeriodUomId: "TF_hr", rateCurrencyUomId: "USD" }, fields)).rateAmountId
        made.rateOld = rate({ rateAmount: 150, fromDate: at(1, 1, 0), thruDate: at(4, 10, 0) })
        made.rateNew = rate({ rateAmount: 160, fromDate: at(4, 10, 0) })
        made.rateJoe = rate({ rateAmount: 175, partyId: "ORG_ZIZI_JD", fromDate: at(1, 1, 0) })
        made.ratePm = rate({ rateAmount: 180, workTypeEnumId: "WktpProjectMgmt", fromDate: at(1, 1, 0) })
        return {
            bobBefore: rateOf({ partyId: "ORG_ZIZI_BD", fromDate: at(4, 7, 9) }), bobAfter: rateOf({ partyId: "ORG_ZIZI_BD", fromDate: at(4, 13, 9) }),
            joe: rateOf({ partyId: "ORG_ZIZI_JD", fromDate: at(4, 13, 9) }), pm: rateOf({ partyId: "EX_JOHN_DOE", workTypeEnumId: "WktpProjectMgmt", fromDate: at(4, 9, 9) }),
        }
    },
    then({ bobBefore, bobAfter, joe, pm }) {
        bobBefore.rateAmountId == made.rateOld && dec(bobBefore.rateAmount) == "150.00"
        bobAfter.rateAmountId == made.rateNew && dec(bobAfter.rateAmount) == "160.00"
        // a person's rate on the project wins when greater (find#RateAmount takes the greater of the party's and the others')
        joe.rateAmountId == made.rateJoe
        // the work type's rate is the closer match; John Doe's own rate (120, on no project) is not one of the project's
        pm.rateAmountId == made.ratePm
    },
})

feature("logged time is unbilled at its rates, to the cent; a no-charge entry is not; nothing is ready before the weeks are approved", {
    when() {
        made.joe1 = entry({ partyId: "ORG_ZIZI_JD", workEffortId: made.task, fromDate: at(4, 5, 9), thruDate: at(4, 5, 12), hours: 3, workTypeEnumId: "WktpDevelopment", comments: "Ledger model" })
        made.joe2 = entry({ partyId: "ORG_ZIZI_JD", workEffortId: made.task, fromDate: at(4, 6, 9), thruDate: at(4, 6, 12), hours: 3, workTypeEnumId: "WktpDevelopment", comments: "Ledger screens" })
        made.bob1 = entry({ partyId: "ORG_ZIZI_BD", workEffortId: made.task, fromDate: at(4, 7, 9), thruDate: at(4, 7, 11, 30), hours: 2.5, workTypeEnumId: "WktpTesting", comments: "Ledger tests" })
        made.bobFree = entry({ partyId: "ORG_ZIZI_BD", workEffortId: made.task, fromDate: at(4, 8, 9), thruDate: at(4, 8, 10), hours: 1, rateTypeEnumId: "RatpNoCharge", comments: "Training" })
        made.john1 = entry({ partyId: "EX_JOHN_DOE", workEffortId: "TBL", fromDate: at(4, 9, 14), thruDate: at(4, 9, 15, 30), hours: 1.5, workTypeEnumId: "WktpProjectMgmt", comments: "Planning" })
        made.joe3 = entry({ partyId: "ORG_ZIZI_JD", workEffortId: made.task, fromDate: at(4, 12, 9), thruDate: at(4, 12, 13), hours: 4, workTypeEnumId: "WktpDevelopment", comments: "Ledger import" })
        made.bob2 = entry({ partyId: "ORG_ZIZI_BD", workEffortId: made.task, fromDate: at(4, 13, 9), thruDate: at(4, 13, 11), hours: 2, workTypeEnumId: "WktpTesting", comments: "Import tests" })
        const out = summary({ withEntries: true })
        return { out, row: out.projectList[0] }
    },
    then({ out, row }) {
        out.projectList.length == 1
        row.clientPartyId == CLIENT && row.clientName == "Billing Walk Client" && row.vendorPartyId == "ORG_ZIZI_SERVICES"
        row.currencyUomId == "USD"
        row.entryCount == 6
        dec(row.hours) == "16.00"
        // 3 and 3 h at Joe's 175, 2.5 h at 150, 1.5 h of project management at 180, 4 h at 175, 2 h at 160 from April 10
        dec(row.amount) == "2715.00"
        row.missingRateCount == 0
        row.readyCount == 0 && row.canInvoice == false && row.cannotReason == "No approved time yet"
        !row.entryList.some((te) => te.timeEntryId === made.bobFree)
        dec(row.entryList.find((te) => te.timeEntryId === made.bob2).rate) == "160.00"
        dec(row.entryList.find((te) => te.timeEntryId === made.john1).amount) == "270.00"
        dec(out.totals.amount) == "2715.00" && out.totals.currencyUomId == "USD"
    },
})

feature("Joe's and Bob's first week approved, John Doe's waiting: the approved part is ready to invoice", {
    when() {
        made.joeWeek1 = sheetOf(made.joe1)
        made.bobWeek1 = sheetOf(made.bob1)
        as("joe.developer", () => call(`${TS}.submit#Timesheet`, { timesheetId: made.joeWeek1 }))
        as("bob.developer", () => call(`${TS}.submit#Timesheet`, { timesheetId: made.bobWeek1 }))
        as("john.doe", () => call(`${TS}.submit#Timesheet`, { timesheetId: sheetOf(made.john1) }))
        call(`${TS}.approve#Timesheet`, { timesheetId: made.joeWeek1 })
        call(`${TS}.approve#Timesheet`, { timesheetId: made.bobWeek1 })
        return { row: summary().projectList[0], sheets: [made.joeWeek1, made.bobWeek1].map((timesheetId) => one("mantle.work.time.Timesheet", { timesheetId }).statusId) }
    },
    then({ row, sheets }) {
        sheets == ["TmshApproved", "TmshApproved"]
        row.readyCount == 3
        dec(row.readyHours) == "8.50"
        dec(row.readyAmount) == "1425.00"
        dec(row.waitingHours) == "1.50"
        dec(row.openHours) == "6.00"
        row.canInvoice == true
    },
})

feature("an invoice from the approved time: an item per entry at its rate, Net 30, linked to the project; that time is no longer unbilled", {
    when() {
        const out = call(`${INVOICE}.create#ProjectInvoiceItems`, { workEffortId: "TBL", approvedOnly: true, billableOnly: true, entryGrouping: "entry",
            settlementTermId: "Net30", invoiceDate: NOW })
        made.invoiceId = out.invoiceId
        const invoice = one("mantle.account.invoice.Invoice", { invoiceId: made.invoiceId })
        const items = Array.from(ec.entity.find("mantle.account.invoice.InvoiceItem").condition("invoiceId", made.invoiceId).orderBy("invoiceItemSeqId").list())
        const invoiced = [made.joe1, made.joe2, made.bob1, made.bobFree, made.john1, made.joe3].map((timeEntryId) => one("mantle.work.time.TimeEntry", { timeEntryId }).invoiceId || null)
        const detail = call(`${INVOICE}.get#InvoiceTimeDetail`, { invoiceId: made.invoiceId })
        return { out, invoice, items, invoiced, detail, link: one("mantle.work.effort.WorkEffortInvoice", { workEffortId: "TBL", invoiceId: made.invoiceId }),
            row: summary().projectList[0] }
    },
    then({ out, invoice, items, invoiced, detail, link, row }) {
        out.invoiceItemCreatedCount == 3
        invoice.statusId == "InvoiceInProcess"
        invoice.fromPartyId == "ORG_ZIZI_SERVICES" && invoice.toPartyId == CLIENT
        dec(invoice.invoiceTotal) == "1425.00"
        invoice.settlementTermId == "Net30"
        Math.round((Number(String(invoice.dueDate)) - Number(String(invoice.invoiceDate))) / 86400000) == 30
        items.length == 3 && items.every((item) => item.itemTypeEnumId === "ItemTimeEntry")
        dec(items[0].amount) == "175.00" && dec(items[0].quantity) == "3.00"
        link != null
        invoiced == [made.invoiceId, made.invoiceId, made.invoiceId, null, null, null]
        detail.entryList.length == 3 && detail.workerInvoice == false
        dec(detail.amount) == "1425.00" && dec(detail.hours) == "8.50"
        detail.entryList[0].personName == "Joe Developer" && detail.entryList[0].workEffortId == made.task && detail.entryList[0].comments == "Ledger model"
        detail.projectIdList == ["TBL"]
        dec(detail.itemTotals[detail.entryList[2].invoiceItemSeqId].amount) == "375.00"
        // what is left: 7.5 h, 1290.00, nothing ready, the invoice the project's last and its draft
        dec(row.hours) == "7.50" && dec(row.amount) == "1290.00" && row.readyCount == 0
        row.lastInvoiceId == made.invoiceId
        row.draftInvoiceList.map((draft) => draft.invoiceId) == [made.invoiceId]
    },
})

feature("Joe's second week approved and added to the draft by selection; an entry not approved is never billed", {
    when() {
        as("joe.developer", () => call(`${TS}.submit#Timesheet`, { timesheetId: sheetOf(made.joe3) }))
        call(`${TS}.approve#Timesheet`, { timesheetId: sheetOf(made.joe3) })
        const notApproved = errorOf(`${INVOICE}.create#ProjectInvoiceItems`, { workEffortId: "TBL", invoiceId: made.invoiceId, approvedOnly: true, billableOnly: true,
            timeEntryIdList: [made.bob2] })
        const added = call(`${INVOICE}.create#ProjectInvoiceItems`, { workEffortId: "TBL", invoiceId: made.invoiceId, approvedOnly: true, billableOnly: true,
            timeEntryIdList: [made.joe3, made.bob2] })
        return { notApproved, added, invoice: one("mantle.account.invoice.Invoice", { invoiceId: made.invoiceId }),
            bob2: one("mantle.work.time.TimeEntry", { timeEntryId: made.bob2 }), joe3: one("mantle.work.time.TimeEntry", { timeEntryId: made.joe3 }) }
    },
    then({ notApproved, added, invoice, bob2, joe3 }) {
        notApproved.includes("No time entries")
        added.invoiceId == made.invoiceId && added.invoiceItemCreatedCount == 1
        dec(invoice.invoiceTotal) == "2125.00"
        joe3.invoiceId == made.invoiceId
        bob2.invoiceId == null
    },
})

feature("a line removed from the draft frees its time, which is unbilled again", {
    when() {
        const seqId = one("mantle.work.time.TimeEntry", { timeEntryId: made.joe3 }).invoiceItemSeqId
        call(`${INVOICE}.delete#InvoiceItem`, { invoiceId: made.invoiceId, invoiceItemSeqId: seqId })
        const freed = one("mantle.work.time.TimeEntry", { timeEntryId: made.joe3 })
        const invoice = one("mantle.account.invoice.Invoice", { invoiceId: made.invoiceId })
        // and back on the draft for the next feature
        call(`${INVOICE}.create#ProjectInvoiceItems`, { workEffortId: "TBL", invoiceId: made.invoiceId, approvedOnly: true, billableOnly: true, timeEntryIdList: [made.joe3] })
        return { freed, invoice }
    },
    then({ freed, invoice }) {
        freed.invoiceId == null && freed.invoiceItemSeqId == null
        dec(invoice.invoiceTotal) == "1425.00"
    },
})

feature("Home's unbilled amount counts the project's for john.doe; a cancelled invoice frees its time, unbilled and ready again", {
    when() {
        const counts = call(`${PROJECT}.get#ProjectHomeCounts`, { managers: true }).counts
        call("update#mantle.account.invoice.Invoice", { invoiceId: made.invoiceId, statusId: "InvoiceCancelled" })
        const freed = [made.joe1, made.joe2, made.bob1, made.joe3].map((timeEntryId) => one("mantle.work.time.TimeEntry", { timeEntryId }).invoiceId || null)
        return { counts, freed, row: summary().projectList[0] }
    },
    then({ counts, freed, row }) {
        counts.unbilledAmount != null && toDecimal(counts.unbilledAmount).compare("590.00") >= 0
        freed == [null, null, null, null]
        dec(row.amount) == "2715.00"
        row.readyCount == 4 && dec(row.readyAmount) == "2125.00"
        row.lastInvoiceId == null && row.draftInvoiceList.length == 0
    },
})
