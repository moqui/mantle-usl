// IronStone Projects time, second part, in mantle.work.TimeServices, TimesheetServices and ProjectServices (design-projects.md §8
// TimeEntries and ImportTime, §12 TimeSettings, §1.4 and §15 Today and Time in Chatter; impl-projects.md P6b): the work types an
// organization offers (get#, store#WorkTypes), the time entries a user may see (find#TimeEntries: the person, the managers of the
// project, the person's line managers; rates only for those who manage money; the totals), the Time entries CSV import
// (import#TimeEntryCsv: the preview, each row on its own with the bad ones named, hours rounded and stacked, rows logged already
// skipped), the Projects today-source (get#ProjectTodayItems: the running timer, a week to submit, a request to triage) and the time
// logged on a work item in its record timeline (get#TimeEntryTimeline). New spec, no Groovy original.
// In a Work group project of its own (TEM: john.doe its manager, joe.developer a programmer, bob.developer a quality analyst), in the
// weeks of February 1 and 8, 2027.
const TS = "mantle.work.TimesheetServices"
const TIME = "mantle.work.TimeServices"
const PROJECT = "mantle.work.ProjectServices"
const TASK = "mantle.work.TaskServices"
const at = (day, hour, minute) => Number(String(ec.l10n.parseTimestamp(`2027-02-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute || 0).padStart(2, "0")}:00.000`,
        "yyyy-MM-dd HH:mm:ss.SSS")))
const made = {}

spec({
    stepwise: true,
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(at(10, 9))
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() {
        ec.artifactExecution.enableAuthz()
        login("john.doe")
        ec.user.setEffectiveTime(made.now || at(10, 9))
    },
    cleanupSpec() {
        ec.artifactExecution.disableAuthz()
        try {
            const row = made.org ? one("mantle.party.PartySetting", { partyId: made.org, partySettingTypeId: "ProjWorkTypes" }) : null
            if (row) { if (made.oldTypes == null) row.delete(); else { row.settingValue = made.oldTypes; row.update() } }
            const project = one("mantle.work.effort.WorkEffort", { workEffortId: "TEM" })
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
    ec.user.setEffectiveTime(made.now || at(10, 9))
    try { return run() } finally { login("john.doe"); ec.user.setEffectiveTime(made.now || at(10, 9)) }
}
const setNow = (millis) => { made.now = millis; ec.user.setEffectiveTime(millis) }
const one = (entityName, fields) => ec.entity.find(entityName).condition(fields).one()
const entry = (fields) => call(`${TIME}.store#TimeEntry`, Object.assign({ partyId: "ORG_ZIZI_JD", rateTypeEnumId: "RatpStandard" }, fields)).timeEntryId
const find = (who, parameters) => as(who, () => call(`${TIME}.find#TimeEntries`, Object.assign({ rootWorkEffortId: "TEM", pageNoLimit: true }, parameters || {})))

feature("a project to log on, and the work types: the services types by default, then the organization's own order", {
    when() {
        call(`${PROJECT}.create#Project`, { workEffortId: "TEM", workEffortName: "Time entries walk", visibilityEnumId: "WevWorkGroup" })
        for (const [partyId, roleTypeId] of [["EX_JOHN_DOE", "ProjectManager"], ["ORG_ZIZI_JD", "Programmer"], ["ORG_ZIZI_BD", "QualityAnalyst"]])
            call("create#mantle.work.effort.WorkEffortParty", { workEffortId: "TEM", partyId, roleTypeId, fromDate: at(1, 0), statusId: "WeptAssigned" })
        made.task1 = call(`${TASK}.create#Task`, { rootWorkEffortId: "TEM", workEffortName: "Ledger", estimatedWorkTime: 10, remainingWorkTime: 10 }).workEffortId
        made.task2 = call(`${TASK}.create#Task`, { rootWorkEffortId: "TEM", workEffortName: "Import" }).workEffortId
        made.org = call(`${TS}.get#WorkTypes`, { partyId: "EX_JOHN_DOE" }).organizationPartyId
        made.oldTypes = made.org ? one("mantle.party.PartySetting", { partyId: made.org, partySettingTypeId: "ProjWorkTypes" })?.settingValue ?? null : null
        const row = made.org ? one("mantle.party.PartySetting", { partyId: made.org, partySettingTypeId: "ProjWorkTypes" }) : null
        if (row) row.delete()
        const defaults = call(`${TS}.get#WorkTypes`, { organizationPartyId: made.org })
        const stored = call(`${TS}.store#WorkTypes`, { organizationPartyId: made.org, offered: "WktpTesting,WktpDevelopment" })
        const after = call(`${TS}.get#WorkTypes`, { organizationPartyId: made.org })
        const unknown = errorOf(`${TS}.store#WorkTypes`, { organizationPartyId: made.org, offered: "WktpTesting,NotAType" })
        return { defaults, stored, after, unknown }
    },
    then({ defaults, stored, after, unknown }) {
        made.org != null
        defaults.isSet == false
        defaults.offeredList.map((type) => type.enumId) == ["WktpDevelopment", "WktpDesign", "WktpTesting", "WktpMeeting", "WktpSupport", "WktpProjectMgmt", "WktpConsulting", "WktpTravel"]
        defaults.typeList.some((type) => type.enumId === "WktpGeneralLabor" && !type.offered)
        JSON.parse(stored.settingValue).offered == "WktpTesting,WktpDevelopment"
        after.offeredList.map((type) => type.enumId) == ["WktpTesting", "WktpDevelopment"]
        after.typeList[0].enumId == "WktpTesting" && after.typeList[0].sequence == 1
        unknown.includes("Not a work type: NotAType")
    },
})

feature("the time entries a user sees: their own, the project's for its manager, a report's for the line manager; rates only for money", {
    when() {
        made.joe1 = entry({ workEffortId: made.task1, fromDate: at(1, 9), thruDate: at(1, 12), hours: 3, workTypeEnumId: "WktpDevelopment", comments: "Ledger first", clientHourRate: 120 })
        made.joe2 = entry({ workEffortId: made.task2, fromDate: at(2, 9), thruDate: at(2, 10), hours: 1, rateTypeEnumId: "RatpNoCharge", comments: "Import look" })
        made.bob1 = entry({ partyId: "ORG_ZIZI_BD", workEffortId: made.task1, fromDate: at(2, 13), thruDate: at(2, 15), hours: 2, comments: "Ledger tests" })
        made.joeNone = entry({ workEffortId: null, fromDate: at(3, 9), thruDate: at(3, 10), hours: 1, comments: "Not on an item" })
        const joe = find("joe.developer", { withRates: true, withTotals: true })
        const joeAll = as("joe.developer", () => call(`${TIME}.find#TimeEntries`, { pageNoLimit: true, fromDate: at(1, 0), thruDate: at(8, 0) }))
        const bob = find("bob.developer")
        const john = find("john.doe", { withRates: true, withTotals: true })
        const billable = find("john.doe", { billable: "N" })
        const byItem = find("john.doe", { workEffortId: made.task1, orderByField: "hours" })
        const paged = find("john.doe", { pageNoLimit: false, pageSize: 1, pageIndex: 1 })
        const text = find("john.doe", { text: "ledger" })
        return { joe, joeAll, bob, john, billable, byItem, paged, text }
    },
    then({ joe, joeAll, bob, john, billable, byItem, paged, text }) {
        // joe: his own, no rates even when asked
        joe.rowCount == 2 && joe.ratesShown == false && !("clientHourRate" in joe.rowList[0])
        joe.totals.hours == 4 && joe.totals.billableHours == 3 && joe.totals.nonBillableHours == 1
        // his entry on no work item is his too
        joeAll.rowList.some((row) => row.timeEntryId === made.joeNone && row.workEffortId == null)
        // bob: his own, and joe's as joe's line manager (the BOSS demo's PrtManager)
        bob.rowCount == 3
        // john.doe: the project's manager, with the rates
        john.rowCount == 3 && john.ratesShown == true
        john.rowList.find((row) => row.timeEntryId === made.joe1).clientAmount == 360
        john.totals.byPerson.length == 2 && john.totals.byItem.find((item) => item.workEffortId === made.task1).estimate == 10
        john.totals.byWorkType.some((type) => type.workTypeEnumId === "WktpDevelopment" && type.hours == 3)
        john.rowList[0].timeEntryId == made.bob1
        billable.rowList.map((row) => row.timeEntryId) == [made.joe2]
        byItem.rowList.map((row) => row.timeEntryId) == [made.bob1, made.joe1]
        paged.rowList.length == 1 && paged.pageIndex == 1 && paged.pageMaxIndex == 2 && paged.rowList[0].timeEntryId == made.joe2
        text.rowCount == 2
    },
})

feature("the Time entries CSV: a preview plans each row, the import makes the good ones and names the bad ones; again, they are skipped", {
    when() {
        const csv = "Date;Email;Work item;Duration;Start;End;Activity;Billable;Description\n"
            + `2027-02-03;joe.developer;${made.task1};1:30;;;Development;yes;CSV ledger\n`
            + `2027-02-03;joe.developer;${made.task1};0.4;;;;no;CSV small\n`
            + `2027-02-03;;${made.task2};;14:00;15:15;Unknown type;;CSV default person\n`
            + `2027-02-04;nobody.here;${made.task1};1;;;;;Nobody\n`
            + `02/04/2027;joe.developer;${made.task1};1;;;;;A US date\n`
            + `2027-02-04;joe.developer;HIRE-1;1;;;;;Not on the project\n`
            + `2027-02-04;joe.developer;${made.task1};25;;;;;Too long\n`
            + `2027-02-04;bob.developer;${made.task1};1;;;;;Bob's\n`
        const preview = as("joe.developer", () => call(`${TIME}.import#TimeEntryCsv`, { fileText: csv, preview: true }))
        const imported = as("joe.developer", () => call(`${TIME}.import#TimeEntryCsv`, { fileText: csv }))
        const again = as("joe.developer", () => call(`${TIME}.import#TimeEntryCsv`, { fileText: csv }))
        const byComment = (comments) => one("mantle.work.time.TimeEntry", { comments })
        return { preview, imported, again, ledger: byComment("CSV ledger"), small: byComment("CSV small"), stacked: byComment("CSV default person") }
    },
    then({ preview, imported, again, ledger, small, stacked }) {
        preview.rowCount == 8
        preview.columnMapping.date == "Date" && preview.columnMapping.person == "Email" && preview.columnMapping.hours == "Duration"
        preview.columnMapping.workType == "Activity" && preview.columnMapping.comment == "Description"
        preview.counts.create == 3 && preview.counts.fail == 5
        preview.previewList[1].warnings.some((warning) => warning.includes("rounded to 0.5 h"))
        preview.previewList[2].warnings.some((warning) => warning.includes("No work type Unknown type"))
        imported.createdCount == 3 && imported.failedCount == 5 && imported.skippedCount == 0
        imported.hoursImported == 3.25
        imported.failureList.map((failure) => failure.rowNumber) == [5, 6, 7, 8, 9]
        imported.failureList[0].error.includes("No person nobody.here")
        imported.failureList[1].error.includes("is not yyyy-MM-dd")
        imported.failureList[2].error.includes("HIRE-1 is not available")
        imported.failureList[3].error.includes("at most 24")
        imported.failureList[4].error.includes("You may not log time for Bob Developer")
        imported.failureList[0].values.Email == "nobody.here"
        Number(String(ledger.hours)) == 1.5 && ledger.workTypeEnumId == "WktpDevelopment" && ledger.partyId == "ORG_ZIZI_JD"
        Number(String(small.hours)) == 0.5 && small.rateTypeEnumId == "RatpNoCharge"
        // the hours-only rows of a day stack from 9:00; a row with start and end keeps its times
        // (in joe's time zone: 9:00, 10:30 and 14:00)
        Number(String(small.fromDate)) - Number(String(ledger.fromDate)) == 1.5 * 3600000
        Number(String(stacked.fromDate)) - Number(String(ledger.fromDate)) == 5 * 3600000 && Number(String(stacked.hours)) == 1.25 && stacked.partyId == "ORG_ZIZI_JD"
        stacked.timesheetId != null
        again.createdCount == 0 && again.skippedCount == 3 && again.failedCount == 5
    },
})

feature("the Projects today-source: joe's running timer and a week to submit; john.doe's new request to triage", {
    when() {
        // Friday of the week of February 1, the week's last working day
        setNow(at(5, 15))
        as("joe.developer", () => call(`${TS}.start#Timer`, { workEffortId: made.task1 }))
        setNow(at(5, 16))
        made.requestId = call("mantle.request.RequestServices.create#Request", { requestName: "TEM triage", requestTypeEnumId: "RqtSupport", rootWorkEffortId: "TEM",
            statusId: "ReqSubmitted" }).requestId
        const joe = as("joe.developer", () => call(`${PROJECT}.get#ProjectTodayItems`, {}))
        const john = call(`${PROJECT}.get#ProjectTodayItems`, {})
        // the next Wednesday: last week still open is overdue
        as("joe.developer", () => call(`${TS}.stop#Timer`, {}))
        setNow(at(10, 9))
        const later = as("joe.developer", () => call(`${PROJECT}.get#ProjectTodayItems`, {}))
        return { joe, john, later }
    },
    then({ joe, john, later }) {
        joe.label == "Projects"
        joe.items.find((item) => item.kind === "timer").record.recordId == made.task1
        joe.items.find((item) => item.kind === "timer").timeEntryId != null
        joe.items.some((item) => item.kind === "timesheet" && item.weekStart === "2027-02-01" && item.overdue === false && item.record.recordEntityName === "mantle.work.time.Timesheet")
        !joe.items.some((item) => item.kind === "triage")
        john.items.some((item) => item.kind === "triage" && item.requestId === made.requestId && item.record.recordId === "TEM")
        later.items.some((item) => item.kind === "timesheet" && item.weekStart === "2027-02-01" && item.overdue === true)
        !later.items.some((item) => item.kind === "timer")
    },
})

feature("the time logged on a work item is in its record timeline, as kind time, without rates; a find of other kinds leaves it out", {
    when() {
        const all = as("joe.developer", () => call("mantle.party.CommunicationServices.get#RecordTimeline", { recordEntityName: "mantle.work.effort.WorkEffort", recordId: made.task1 }))
        const notes = as("joe.developer", () => call("mantle.party.CommunicationServices.get#RecordTimeline", { recordEntityName: "mantle.work.effort.WorkEffort", recordId: made.task1,
            kinds: ["notes"] }))
        const direct = call(`${TIME}.get#TimeEntryTimeline`, { recordEntityName: "mantle.work.effort.WorkEffort", recordId: made.task1, limit: 2 })
        const party = call(`${TIME}.get#TimeEntryTimeline`, { recordEntityName: "mantle.party.Party", recordId: "ORG_ZIZI_JD" })
        return { all, notes, direct, party }
    },
    then({ all, notes, direct, party }) {
        all.entryList.some((one) => one.kind === "time" && one.body === "Ledger first" && one.authorPartyId === "ORG_ZIZI_JD" && one.title.startsWith("3 h"))
        all.entryList.filter((one) => one.kind === "time").every((one) => !("clientHourRate" in one))
        !notes.entryList.some((one) => one.kind === "time")
        direct.entryList.length == 2
        party.entryList.length == 0
    },
})
