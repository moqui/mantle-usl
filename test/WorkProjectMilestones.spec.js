// IronStone Projects billing, second part (design-projects.md §4 ProjectMoney and MilestoneDetail, §10 OrderDetail and Unbilled's
// Milestones due, §14 the project estimate, §15 Milestone approval and Milestone billing share; impl-projects.md P8b): the order line a
// project fulfils (mantle.work.ProjectServices.link#ProjectOrderItem), the estimate sent for approval (get#ProjectEstimate,
// send#EstimateForApproval: a file of the Estimate milestone and its gate's request) and its approval moving the project and its order
// on, milestone gates (store#MilestoneGate, request#, approve#, refuse#MilestoneApproval; update#Milestone refusing a gated milestone
// not approved), billing shares (store#MilestoneShare, get#MilestoneBilling), what is due (get#UnbilledSummary's milestones), a share on
// a client invoice (mantle.account.InvoiceServices.create#MilestoneInvoiceItems: WorkEffortBilling, OrderItemBilling) with approved time
// on the same invoice, a removed line and a cancelled invoice making the shares due again, and the project's money
// (get#ProjectMoneySummary). New spec, no Groovy original.
// In a Work group project of its own (TMS: john.doe its manager, joe.developer a programmer, Ziziwork Services the vendor, a client
// organization of its own and its contact as the ClientManager, who has no user), in May 2027.
const PROJECT = "mantle.work.ProjectServices"
const INVOICE = "mantle.account.InvoiceServices"
const TS = "mantle.work.TimesheetServices"
const CLIENT = "TMS_CLIENT"
const CONTACT = "TMS_CONTACT"
const at = (month, day, hour, minute) => Number(String(ec.l10n.parseTimestamp(`2027-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")} `
        + `${String(hour).padStart(2, "0")}:${String(minute || 0).padStart(2, "0")}:00.000`, "yyyy-MM-dd HH:mm:ss.SSS")))
const NOW = at(5, 21, 16)
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
            for (const link of ec.entity.find("mantle.work.effort.WorkEffortInvoice").condition("workEffortId", "TMS").list()) {
                const invoice = one("mantle.account.invoice.Invoice", { invoiceId: link.invoiceId })
                if (invoice && invoice.statusId !== "InvoiceCancelled") call("update#mantle.account.invoice.Invoice", { invoiceId: invoice.invoiceId, statusId: "InvoiceCancelled" })
            }
            for (const rate of ec.entity.find("mantle.humanres.rate.RateAmount").condition("workEffortId", "TMS").list()) { rate.thruDate = rate.fromDate; rate.update() }
            const project = one("mantle.work.effort.WorkEffort", { workEffortId: "TMS" })
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
const statusOf = (workEffortId) => one("mantle.work.effort.WorkEffort", { workEffortId }).statusId
const billing = (parameters) => call(`${PROJECT}.get#MilestoneBilling`, parameters)
const shareOf = (milestoneId) => billing({ workEffortId: milestoneId }).shareList[0]
const unbilledRow = () => call(`${PROJECT}.get#UnbilledSummary`, { workEffortId: "TMS", withEntries: true }).projectList[0]

feature("a client project in planning with a work breakdown, its client rate, and a sales order line it fulfils, linked by link#ProjectOrderItem", {
    when() {
        call(`${PROJECT}.create#Project`, { workEffortId: "TMS", workEffortName: "Milestone walk", visibilityEnumId: "WevWorkGroup" })
        call("update#mantle.work.effort.WorkEffort", { workEffortId: "TMS", statusId: "WeInPlanning", ownerPartyId: "ORG_ZIZI_SERVICES", costUomId: "USD" })
        if (!one("mantle.party.Party", { partyId: CLIENT })) {
            call("create#mantle.party.Party", { partyId: CLIENT, partyTypeEnumId: "PtyOrganization" })
            call("create#mantle.party.Organization", { partyId: CLIENT, organizationName: "Milestone Walk Client" })
            call("create#mantle.party.PartyRole", { partyId: CLIENT, roleTypeId: "Customer" })
            call("create#mantle.party.Party", { partyId: CONTACT, partyTypeEnumId: "PtyPerson" })
            call("create#mantle.party.Person", { partyId: CONTACT, firstName: "Mila", lastName: "Walker" })
        }
        for (const [partyId, roleTypeId] of [["EX_JOHN_DOE", "ProjectManager"], ["ORG_ZIZI_JD", "Programmer"], ["ORG_ZIZI_SERVICES", "Vendor"], [CLIENT, "Customer"],
                [CONTACT, "ClientManager"]])
            call("create#mantle.work.effort.WorkEffortParty", { workEffortId: "TMS", partyId, roleTypeId, fromDate: at(1, 1, 0), statusId: "WeptAssigned" })
        const task = (name, hours, parent) => call("mantle.work.TaskServices.create#Task", { rootWorkEffortId: "TMS", parentWorkEffortId: parent || null,
            workEffortName: name, estimatedWorkTime: hours }).workEffortId
        made.design = task("Design", null)
        made.wire = task("Wireframes", 12, made.design)
        made.mock = task("Mockups", 8, made.design)
        made.build = task("Build", 40)
        call("mantle.humanres.RateServices.create#RateAmount", { workEffortId: "TMS", ratePurposeEnumId: "RaprClient", rateTypeEnumId: "RatpStandard",
            timePeriodUomId: "TF_hr", rateCurrencyUomId: "USD", rateAmount: 150, fromDate: at(1, 1, 0) })
        // the sales order of the work, open (not placed): one line of 10,000
        made.orderId = call("mantle.order.OrderServices.create#Order", { customerPartyId: CLIENT, vendorPartyId: "ORG_ZIZI_SERVICES", currencyUomId: "USD",
            orderName: "Milestone walk" }).orderId
        made.partSeq = one("mantle.order.OrderPart", { orderId: made.orderId }).orderPartSeqId
        made.lineSeq = call("mantle.order.OrderServices.create#OrderItem", { orderId: made.orderId, orderPartSeqId: made.partSeq, itemTypeEnumId: "ItemServiceProduct",
            itemDescription: "Milestone walk, fixed fee", quantity: 1, unitAmount: 10000 }).orderItemSeqId
        call(`${PROJECT}.link#ProjectOrderItem`, { workEffortId: "TMS", orderId: made.orderId, orderItemSeqId: made.lineSeq })
        return { link: one("mantle.order.OrderItemWorkEffort", { orderId: made.orderId, orderItemSeqId: made.lineSeq, workEffortId: "TMS" }) }
    },
    then({ link }) {
        link != null
    },
})

feature("the estimate: the breakdown to depth 2 with roll-up hours at the client rate, the order line, the total", {
    when() { return call(`${PROJECT}.get#ProjectEstimate`, { workEffortId: "TMS", depth: 2 }) },
    then({ estimate, estimateHtml }) {
        estimate.clientName == "Milestone Walk Client"
        estimate.lineList.map((line) => line.workEffortName + " " + line.level + " " + dec(line.hours)) == ["Design 1 20.00", "Wireframes 2 12.00", "Mockups 2 8.00", "Build 1 40.00"]
        dec(estimate.totalHours) == "60.00"
        dec(estimate.totalAmount) == "9000.00"
        dec(estimate.lineList[0].amount) == "3000.00"
        estimate.orderLineList.length == 1 && dec(estimate.orderLineList[0].total) == "10000.00"
        estimateHtml.includes("Wireframes") && estimateHtml.includes("$9,000.00")
    },
})

feature("the estimate sent for approval: the Estimate milestone made with a gate to the ClientManager, the file kept, its approval requested, the order a quote", {
    when() {
        const out = call(`${PROJECT}.send#EstimateForApproval`, { workEffortId: "TMS", depth: 2, comments: "The estimate for May" })
        made.estimateId = out.milestoneId
        const content = one("mantle.work.effort.WorkEffortContent", { workEffortContentId: out.workEffortContentId })
        const approval = one("mantle.work.effort.WorkEffortApproval", { workEffortApprovalId: out.workEffortApprovalId })
        const access = call(`${PROJECT}.get#MilestoneApprovalAccess`, { workEffortId: made.estimateId })
        return { out, content, text: content ? ec.resource.getLocationReference(content.contentLocation).getText() : "", approval, access,
            setting: one("mantle.work.effort.WorkEffortSetting", { workEffortId: "TMS", settingTypeEnumId: "WstEstimateMilestone" }),
            order: one("mantle.order.OrderHeader", { orderId: made.orderId }) }
    },
    then({ out, content, text, approval, access, setting, order }) {
        made.estimateId == "TMS-MS-1"
        setting.settingValue == made.estimateId
        content.contentTypeEnumId == "WectEstimate" && content.workEffortId == made.estimateId
        text.includes("Mockups") && text.includes("Milestone Walk Client")
        approval.statusId == "WeaRequested" && approval.approverPartyId == CONTACT && approval.workEffortContentId == out.workEffortContentId
        approval.requestComments == "The estimate for May"
        access.gate.required == true && access.gate.awaiting == true && access.gate.approverName == "Mila Walker"
        order.statusId == "OrderProposed"
    },
})

feature("joe may not decide the estimate; john.doe records the client's approval: the Estimate reached, the project Approved, the order Approved", {
    when() {
        const joeDecides = as("joe.developer", () => errorOf(`${PROJECT}.approve#MilestoneApproval`, { workEffortId: made.estimateId }))
        const out = call(`${PROJECT}.approve#MilestoneApproval`, { workEffortId: made.estimateId, comments: "Approved by phone" })
        return { joeDecides, out, approval: one("mantle.work.effort.WorkEffortApproval", { workEffortApprovalId: out.workEffortApprovalId }),
            estimate: statusOf(made.estimateId), project: statusOf("TMS"), order: one("mantle.order.OrderHeader", { orderId: made.orderId }) }
    },
    then({ joeDecides, out, approval, estimate, project, order }) {
        joeDecides.includes("Only the approver")
        approval.statusId == "WeaApproved" && approval.recordedFor == "Y" && approval.decidedByUserId == "EX_JOHN_DOE"
        approval.decisionComments == "Approved by phone"
        estimate == "WeComplete"
        out.projectMoved == true && project == "WeApproved"
        order.statusId == "OrderApproved"
    },
})

feature("billing shares: Design 30% of the line, Delivery a fixed 7,000; a share passing the line's total is refused", {
    when() {
        call("update#mantle.work.effort.WorkEffort", { workEffortId: "TMS", statusId: "WeInProgress" })
        made.msDesign = call(`${PROJECT}.create#Milestone`, { rootWorkEffortId: "TMS", workEffortName: "Design sign-off", statusId: "WeInProgress",
            estimatedCompletionDate: at(5, 14, 17) }).workEffortId
        made.msDelivery = call(`${PROJECT}.create#Milestone`, { rootWorkEffortId: "TMS", workEffortName: "Delivery", statusId: "WeInProgress",
            estimatedCompletionDate: at(6, 30, 17) }).workEffortId
        const line = { orderId: made.orderId, orderItemSeqId: made.lineSeq }
        call(`${PROJECT}.store#MilestoneShare`, Object.assign({ workEffortId: made.msDesign, invoicePercent: 30 }, line))
        call(`${PROJECT}.store#MilestoneShare`, Object.assign({ workEffortId: made.msDelivery, invoiceAmount: 7000 }, line))
        const over = errorOf(`${PROJECT}.store#MilestoneShare`, Object.assign({ workEffortId: made.estimateId, invoicePercent: 1 }, line))
        return { over, out: billing({ rootWorkEffortId: "TMS" }) }
    },
    then({ over, out }) {
        over.includes("pass its total")
        out.shareList.length == 2
        out.shareList.map((share) => share.milestoneName + " " + dec(share.amount) + " " + dec(share.percent)) == ["Design sign-off 3000.00 30.00", "Delivery 7000.00 70.00"]
        out.shareList.every((share) => !share.due && !share.billed)
        out.lineList.length == 1 && dec(out.lineList[0].sharedAmount) == "10000.00"
    },
})

feature("Design's gate: the ClientManager approves; reaching it before approval is refused; refused with a reason, asked again and approved, it is reached", {
    when() {
        call(`${PROJECT}.store#MilestoneGate`, { workEffortId: made.msDesign, approvalRequired: "Y", approverPartyId: CONTACT })
        const reachEarly = errorOf(`${PROJECT}.update#Milestone`, { workEffortId: made.msDesign, statusId: "WeComplete" })
        const first = as("joe.developer", () => call(`${PROJECT}.request#MilestoneApproval`, { workEffortId: made.msDesign, comments: "Designs are in the drive" }).workEffortApprovalId)
        call(`${PROJECT}.refuse#MilestoneApproval`, { workEffortId: made.msDesign, reason: "The mobile mockups are missing" })
        const refused = one("mantle.work.effort.WorkEffortApproval", { workEffortApprovalId: first })
        const afterRefusal = statusOf(made.msDesign)
        const notice = one("moqui.security.user.NotificationMessage", { topic: "MilestoneDecision", recordId: first })
        call(`${PROJECT}.request#MilestoneApproval`, { workEffortId: made.msDesign })
        const notDue = shareOf(made.msDesign)
        call(`${PROJECT}.approve#MilestoneApproval`, { workEffortId: made.msDesign })
        return { reachEarly, refused, afterRefusal, notice, notDue, reached: one("mantle.work.effort.WorkEffort", { workEffortId: made.msDesign }),
            share: shareOf(made.msDesign) }
    },
    then({ reachEarly, refused, afterRefusal, notice, notDue, reached, share }) {
        reachEarly.includes("needs approval before it is reached")
        refused.statusId == "WeaRefused" && refused.decisionComments == "The mobile mockups are missing"
        afterRefusal == "WeInProgress"
        notice != null
        notDue.awaiting == true && notDue.due == false
        reached.statusId == "WeComplete" && reached.actualCompletionDate != null
        share.due == true && share.approved == true
    },
})

feature("Unbilled lists the project for its share due even with no time; create#MilestoneInvoiceItems bills it once, with WorkEffortBilling and OrderItemBilling", {
    when() {
        const row = unbilledRow()
        const out = call(`${INVOICE}.create#MilestoneInvoiceItems`, { workEffortId: made.msDesign, invoiceDate: NOW, settlementTermId: "Net30" })
        made.invoiceId = out.invoiceId
        const items = Array.from(ec.entity.find("mantle.account.invoice.InvoiceItem").condition("invoiceId", made.invoiceId).list())
        const again = errorOf(`${INVOICE}.create#MilestoneInvoiceItems`, { workEffortId: made.msDesign })
        return { row, out, items, again, invoice: one("mantle.account.invoice.Invoice", { invoiceId: made.invoiceId }),
            web: one("mantle.work.effort.WorkEffortBilling", { workEffortId: made.msDesign, invoiceId: made.invoiceId }),
            oib: one("mantle.order.OrderItemBilling", { orderId: made.orderId, invoiceId: made.invoiceId }),
            link: one("mantle.work.effort.WorkEffortInvoice", { workEffortId: "TMS", invoiceId: made.invoiceId }), share: shareOf(made.msDesign), after: unbilledRow() }
    },
    then({ row, out, items, again, invoice, web, oib, link, share, after }) {
        row.entryCount == 0 && row.milestoneDueCount == 1 && dec(row.milestoneDueAmount) == "3000.00"
        row.canInvoice == true && row.timeReady == false
        out.invoiceItemCreatedCount == 1 && dec(out.amount) == "3000.00"
        invoice.statusId == "InvoiceInProcess" && invoice.toPartyId == CLIENT && invoice.fromPartyId == "ORG_ZIZI_SERVICES"
        dec(invoice.invoiceTotal) == "3000.00" && invoice.settlementTermId == "Net30"
        items.length == 1 && items[0].itemTypeEnumId == "ItemServiceProduct"
        items[0].description == "Design sign-off: 30% of Milestone walk, fixed fee"
        dec(web.percentage) == "30.00"
        String(toDecimal(oib.quantity).setScale(2, "HALF_UP")) == "0.30" && oib.orderItemSeqId == made.lineSeq
        link != null
        again.includes("is billed on invoice")
        share.billed == true && share.invoiceId == made.invoiceId && share.due == false
        after == null || after.milestoneDueCount == 0
    },
})

feature("approved time and the reached Delivery share on one invoice: the time's lines and the milestone's, the milestone line removed is due again", {
    when() {
        made.entry = call("mantle.work.TimeServices.store#TimeEntry", { partyId: "ORG_ZIZI_JD", workEffortId: made.build, fromDate: at(5, 17, 9), thruDate: at(5, 17, 13), hours: 4,
            rateTypeEnumId: "RatpStandard", workTypeEnumId: "WktpDevelopment", comments: "Build start" }).timeEntryId
        const sheet = one("mantle.work.time.TimeEntry", { timeEntryId: made.entry }).timesheetId
        as("joe.developer", () => call(`${TS}.submit#Timesheet`, { timesheetId: sheet }))
        call(`${TS}.approve#Timesheet`, { timesheetId: sheet })
        call(`${PROJECT}.update#Milestone`, { workEffortId: made.msDelivery, statusId: "WeComplete" })
        const ready = unbilledRow()
        call(`${INVOICE}.create#MilestoneInvoiceItems`, { workEffortId: made.msDelivery, invoiceId: made.invoiceId })
        call(`${INVOICE}.create#ProjectInvoiceItems`, { workEffortId: "TMS", invoiceId: made.invoiceId, approvedOnly: true, billableOnly: true, timeEntryIdList: [made.entry] })
        const invoice = one("mantle.account.invoice.Invoice", { invoiceId: made.invoiceId })
        const detail = call(`${INVOICE}.get#InvoiceTimeDetail`, { invoiceId: made.invoiceId })
        const deliveryLine = one("mantle.work.effort.WorkEffortBilling", { workEffortId: made.msDelivery, invoiceId: made.invoiceId })
        call(`${INVOICE}.delete#InvoiceItem`, { invoiceId: made.invoiceId, invoiceItemSeqId: deliveryLine.invoiceItemSeqId })
        ec.message.clearErrors()
        return { ready, invoice, detail, share: shareOf(made.msDelivery), web: one("mantle.work.effort.WorkEffortBilling", { workEffortId: made.msDelivery, invoiceId: made.invoiceId }),
            total: one("mantle.account.invoice.Invoice", { invoiceId: made.invoiceId }).invoiceTotal }
    },
    then({ ready, invoice, detail, share, web, total }) {
        ready.timeReady == true && ready.milestoneDueCount == 1 && dec(ready.readyAmount) == "600.00"
        // 3,000 and 7,000 of the shares, 4 h at 150
        dec(invoice.invoiceTotal) == "10600.00"
        detail.entryList.length == 1 && dec(detail.hours) == "4.00"
        share.due == true && share.billed == false
        web == null
        dec(total) == "3600.00"
    },
})

feature("the project's money: the caps against the actuals, the invoice, the order contracted, the shares billed and due", {
    when() {
        call("update#mantle.work.effort.WorkEffort", { workEffortId: "TMS", totalTimeAllowed: 80, totalClientCostAllowed: 10000 })
        return { summary: call(`${PROJECT}.get#ProjectMoneySummary`, { workEffortId: "TMS" }).summary }
    },
    then({ summary }) {
        summary.clientName == "Milestone Walk Client" && summary.currencyUomId == "USD"
        dec(summary.hoursBudget) == "80.00" && dec(summary.clientBudget) == "10000.00"
        dec(summary.actualHours) == "4.00"
        summary.invoiceList.length == 1 && summary.invoiceList[0].invoiceId == made.invoiceId
        dec(summary.invoiced) == "3600.00"
        dec(summary.contracted) == "10000.00"
        dec(summary.sharesBilled) == "3000.00" && dec(summary.sharesDue) == "7000.00"
        dec(summary.unbilledAmount) == "0.00"
    },
})

feature("cancelling the invoice makes Design's share due again and frees the time", {
    when() {
        call("update#mantle.account.invoice.Invoice", { invoiceId: made.invoiceId, statusId: "InvoiceCancelled" })
        return { share: shareOf(made.msDesign), entry: one("mantle.work.time.TimeEntry", { timeEntryId: made.entry }), row: unbilledRow() }
    },
    then({ share, entry, row }) {
        share.due == true && share.billed == false
        entry.invoiceId == null
        row.milestoneDueCount == 2 && dec(row.milestoneDueAmount) == "10000.00" && row.readyCount == 1
    },
})
