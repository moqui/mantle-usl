// Time entry imports (summary and detail CSV text) and the bulk time entry work effort services of
// mantle.work.TimeServices. New spec, no Groovy original.
const effectiveTime = Date.now()
const day = (y, m, d) => Date.UTC(y, m - 1, d)
let workerA, workerB, clientId, vendorId, bulkEffortId, projectId, taskId

spec({
    stepwise: true,
    tempSequences: { start: 58500, banks: { "mantle.party.Party": 10, "mantle.work.effort.WorkEffort": 20, "mantle.work.time.TimeEntry": 40 } },
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

const n = (value) => dec(value).toNumber()
function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    return null
}
const entriesOf = (partyId) => Array.from(ec.entity.find("mantle.work.time.TimeEntry").condition("partyId", partyId).orderBy("timeEntryId").list())

feature("workers and a client", {
    when() {
        workerA = call("mantle.party.PartyServices.create#Person", { firstName: "Imogen", lastName: "Importer" }).partyId
        workerB = call("mantle.party.PartyServices.create#Person", { firstName: "Ivan", lastName: "Importer" }).partyId
        clientId = call("mantle.party.PartyServices.create#Organization", { organizationName: "Import Client", roleTypeId: "Customer" }).partyId
        vendorId = call("mantle.party.PartyServices.create#Organization", { organizationName: "Import Vendor", roleTypeId: "Vendor" }).partyId
        return { ids: [workerA, workerB, clientId, vendorId] }
    },
    then({ ids }) { ids.every(id => id != null) },
})

feature("import a time summary: a standard, overtime and double time entry per employee", {
    when() {
        const text = `${workerA},,8,2,1,,,\n${workerB},,40,,,,,\n`
        call("mantle.work.TimeServices.import#TimeSummaryFile", { clientPartyId: clientId, effectiveDate: day(2026, 11, 14) + 17 * 3600000, fileText: text })
        return { a: entriesOf(workerA), b: entriesOf(workerB) }
    },
    then({ a, b }) {
        a.length == 3
        b.length == 1
        n(a.find(e => e.rateModifierEnumId == "RatmRegular").hours) == 8
        n(a.find(e => e.rateModifierEnumId == "RatmOvertime").hours) == 2
        n(a.find(e => e.rateModifierEnumId == "RatmDouble").hours) == 1
        n(b[0].hours) == 40
        a.every(e => e.clientPartyId == clientId)
    },
})

feature("import time detail with start and end times, hours alone and pieces", {
    when() {
        const text = `${workerA},,Standard,11/16/2026 09:00:00,11/16/2026 17:00:00,,\n` +
                `${workerB},,Standard,,,6,\n` +
                `${workerB},,Standard,11/17/2026 08:00:00,11/17/2026 12:30:00,4.5,\n`
        const before = entriesOf(workerA).length
        call("mantle.work.TimeServices.import#TimeDetailFile", { clientPartyId: clientId, defaultDate: day(2026, 11, 18) + 12 * 3600000, fileText: text })
        const a = entriesOf(workerA)
        const b = entriesOf(workerB)
        return { before, a, b }
    },
    then({ before, a, b }) {
        a.length == before + 1
        const timed = a[a.length - 1]
        n(timed.hours) == 8
        // the times are read in the user's time zone
        timed.fromDate == String(ec.l10n.parseTimestamp("11/16/2026 09:00:00", "MM/dd/yyyy HH:mm:ss"))
        b.length == 3
        n(b[1].hours) == 6
        n(b[2].hours) == 4.5
    },
})

feature("store a bulk time entry work effort and time entries from it", {
    when() {
        bulkEffortId = call("mantle.work.TimeServices.store#TimeEntryWorkEffort", { workEffortName: "Bulk entry", actualStartDate: day(2026, 11, 19) + 8 * 3600000,
                actualWorkDuration: 7, clientPartyId: clientId, actualPaidBreakDuration: 0.5, childWorkEffortId: "TIW-BREAK" }).workEffortId
        const effort = ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", bulkEffortId).one()
        const breakEffort = ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", "TIW-BREAK").one()
        const client = Array.from(ec.entity.find("mantle.work.effort.WorkEffortParty").condition("workEffortId", bulkEffortId).condition("roleTypeId", "Customer").list())
        const before = entriesOf(workerA).length
        call("mantle.work.TimeServices.store#WorkEffortPartyTime", { workEffortId: bulkEffortId, partyId: workerA, childTimeEntryId: "TIW-CHILD", paidBreakHours: 0.5 })
        const none = call("mantle.work.TimeServices.store#WorkEffortPartyTime", { workEffortId: bulkEffortId })
        const entries = entriesOf(workerA).slice(before)
        return { effort, breakEffort, client, entries, none }
    },
    then({ effort, breakEffort, client, entries }) {
        effort.statusId == "WeComplete"
        n(effort.actualWorkDuration) == 7
        breakEffort.workTypeEnumId == "WktpPaidBreak"
        breakEffort.parentWorkEffortId == bulkEffortId
        client.length == 1
        client[0].partyId == clientId
        // the main entry takes the hours of the work effort; the paid break is a child of it
        entries.length == 2
        n(entries.find(e => e.timeEntryId != "TIW-CHILD").hours) == 7
        entries.find(e => e.timeEntryId == "TIW-CHILD").workTypeEnumId == "WktpPaidBreak"
    },
})

feature("a bulk entry before the project start or for a disabled party is refused", {
    when() {
        projectId = "TIWPRJ"
        call("mantle.work.ProjectServices.create#Project", { workEffortId: projectId, workEffortName: "Import project", clientPartyId: clientId, vendorPartyId: vendorId,
                estimatedStartDate: day(2026, 12, 1), estimatedCompletionDate: day(2026, 12, 31) })
        const early = errorOf("mantle.work.TimeServices.store#TimeEntryWorkEffort", { rootWorkEffortId: projectId, workEffortName: "Too early", actualStartDate: day(2026, 11, 1),
                actualWorkDuration: 2, clientPartyId: clientId })
        call("update#mantle.party.Party", { partyId: workerB, disabled: "Y" })
        const disabled = errorOf("mantle.work.TimeServices.store#WorkEffortPartyTime", { workEffortId: bulkEffortId, partyId: workerB })
        return { early, disabled }
    },
    then({ early, disabled }) {
        early.includes("outside of project's start date")
        disabled.includes("is not active")
    },
})

feature("invoice a worker's time entries for a vendor, and the stub work effort cost posting runs", {
    when() {
        // a worker with only this entry: the imported ones have no vendor rate
        const workerC = call("mantle.party.PartyServices.create#Person", { firstName: "Cora", lastName: "Contractor" }).partyId
        call("mantle.work.TimeServices.store#TimeEntry", { partyId: workerC, vendorPartyId: vendorId, clientPartyId: clientId, hours: 4,
                fromDate: day(2026, 11, 20) + 9 * 3600000, thruDate: day(2026, 11, 20) + 13 * 3600000, rateTypeEnumId: "RatpStandard", vendorHourRate: 30 })
        const out = call("mantle.account.InvoiceServices.create#WorkerInvoiceItems", { workerPartyId: workerC, vendorPartyId: vendorId, thruDate: day(2026, 12, 1) })
        // the service declares no out-parameters, so the invoice is found by its parties
        const invoice = Array.from(ec.entity.find("mantle.account.invoice.Invoice").condition("fromPartyId", workerC).condition("toPartyId", vendorId).list())[0]
        const items = invoice ? Array.from(ec.entity.find("mantle.account.invoice.InvoiceItem").condition("invoiceId", invoice.invoiceId).list()) : []
        const entry = Array.from(ec.entity.find("mantle.work.time.TimeEntry").condition("partyId", workerC).list())[0]
        // posting a work effort's cost is a TODO upstream, so it only has to run
        const posted = call("mantle.ledger.OtherAutoPostServices.post#WorkEffortCost", { workEffortId: bulkEffortId })
        return { out, invoice, items, posted, entry }
    },
    then({ invoice, items, posted, entry }) {
        invoice != null
        invoice.fromPartyId != null
        invoice.toPartyId == vendorId
        items.length == 1
        n(items[0].amount) == 30
        n(items[0].quantity) == 4
        entry.vendorInvoiceId == invoice.invoiceId
        posted != null
    },
})

feature("time files are uploaded: the summary and the detail", {
    when() {
        const before = entriesOf(workerA).length
        call("mantle.work.TimeServices.upload#TimeSummaryFile", { clientPartyId: clientId, effectiveDate: day(2026, 11, 21) + 17 * 3600000,
                timeFile: uploadedFile("summary.csv", `${workerA},,12,,,,,\n`, "text/csv") })
        call("mantle.work.TimeServices.upload#TimeDetailFile", { clientPartyId: clientId, defaultDate: day(2026, 11, 22) + 12 * 3600000,
                timeFile: uploadedFile("detail.csv", `${workerA},,Standard,,,3.5,\n`, "text/csv") })
        return { before, after: entriesOf(workerA) }
    },
    then({ before, after }) {
        after.length == before + 2
        after.some(e => n(e.hours) == 12)
        after.some(e => n(e.hours) == 3.5)
    },
})
