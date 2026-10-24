// IronStone Projects time in mantle.work.TimesheetServices and TimeServices (design-projects.md §8 and §15 Timesheet services;
// impl-projects.md P6a): the timesheet policy (get#, store#TimesheetPolicy, its short keys), the week's timesheet made with the
// first entry (store#TimeEntry, get#PartyTimesheet), the timer (start#, stop#, get#, update#Timer: one per person, a switch stops
// the first, under a minute is discarded), a person's week (get#PartyWeek: rows by item and day, totals, billable, working hours,
// the days below them), who may see and decide a week (get#TimesheetAccess), submit, return with a reason, approve through the
// approval notice, reopen until invoiced (the lock on a submitted week in store#TimeEntry), the lists of
// find#Timesheets with their counts, the missing-time reminders (send#MissingTimeReminders, once a week each), the Home counters
// (get#ProjectHomeCounts) and a timesheet's Chatter visibility (get#RecordLinkInfo). New spec, no Groovy original.
// In a Work group project of its own (TSW: john.doe its manager, joe.developer a programmer, bob.developer a quality analyst).
const TS = "mantle.work.TimesheetServices"
const TIME = "mantle.work.TimeServices"
const PROJECT = "mantle.work.ProjectServices"
const TASK = "mantle.work.TaskServices"
// Wednesday November 18, 2026 in the week of Monday the 16th, at the hour given in the session's time zone
const at = (day, hour, minute) => Number(String(ec.l10n.parseTimestamp(`2026-11-${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute || 0).padStart(2, "0")}:00.000`,
        "yyyy-MM-dd HH:mm:ss.SSS")))
const made = {}

spec({
    stepwise: true,
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(at(18, 9))
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() {
        ec.artifactExecution.enableAuthz()
        login("john.doe")
        ec.user.setEffectiveTime(made.now || at(18, 9))
    },
    cleanupSpec() {
        // the organization's policy as it was
        ec.artifactExecution.disableAuthz()
        try {
            const row = made.org ? one("mantle.party.PartySetting", { partyId: made.org, partySettingTypeId: "ProjTimesheetPolicy" }) : null
            if (row) { if (made.oldSetting == null) row.delete(); else { row.settingValue = made.oldSetting; row.update() } }
            // the Chatter check's group: its inheritable grant would reach the specs after this one
            ec.entity.find("moqui.security.UserGroupMember").condition("userGroupId", "TSW_RL").deleteAll()
            ec.entity.find("moqui.security.ArtifactAuthz").condition("artifactAuthzId", "TSW_RL").deleteAll()
            ec.entity.find("moqui.security.ArtifactGroupMember").condition("artifactGroupId", "TSW_RL").deleteAll()
            ec.entity.find("moqui.security.ArtifactGroup").condition("artifactGroupId", "TSW_RL").deleteAll()
            ec.entity.find("moqui.security.UserGroup").condition("userGroupId", "TSW_RL").deleteAll()
            // the notices of the spec's timesheets as read: the week left submitted would be an approval waiting for
            // john.doe in the specs after this one
            const sheetIds = [made.timesheetId, made.nextSheet].filter((id) => id)
            const messageIds = sheetIds.length ? Array.from(ec.entity.find("moqui.security.user.NotificationMessage")
                    .condition("recordEntityName", "mantle.work.time.Timesheet").condition("recordId", "in", sheetIds).list())
                    .map((message) => message.notificationMessageId) : []
            if (messageIds.length) ec.entity.find("moqui.security.user.NotificationMessageUser").condition("notificationMessageId", "in", messageIds)
                    .condition("viewedDate", null).updateAll({ viewedDate: ec.user.nowTimestamp })
        } finally { ec.artifactExecution.enableAuthz() }
        ec.user.setEffectiveTime(null)
    },
})

function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    const errors = ec.message.getErrorsString ? ec.message.getErrorsString() : null
    ec.message.clearErrors()
    return errors || null
}
// as another user: the services decide by the user, authorization stays off (the screens' app roots grant the services)
function as(username, run) {
    login(username)
    ec.user.setEffectiveTime(made.now || at(18, 9))
    try { return run() } finally { login("john.doe"); ec.user.setEffectiveTime(made.now || at(18, 9)) }
}
const setNow = (millis) => { made.now = millis; ec.user.setEffectiveTime(millis) }
const one = (entityName, fields) => ec.entity.find(entityName).condition(fields).one()
const all = (entityName, fields) => Array.from(ec.entity.find(entityName).condition(fields).list())
const num = (value) => value == null ? null : Number(String(value))
const sheet = () => one("mantle.work.time.Timesheet", { timesheetId: made.timesheetId })
const messagesOf = (topic, recordId) => all("moqui.security.user.NotificationMessage", { topic, recordEntityName: "mantle.work.time.Timesheet", recordId })
const usersOf = (message) => all("moqui.security.user.NotificationMessageUser", { notificationMessageId: message.notificationMessageId })
const entry = (fields) => call(`${TIME}.store#TimeEntry`, Object.assign({ partyId: "ORG_ZIZI_JD", rateTypeEnumId: "RatpStandard" }, fields)).timeEntryId

feature("a project to keep time on, and the policy: its defaults, then short keys stored on the organization", {
    when() {
        call(`${PROJECT}.create#Project`, { workEffortId: "TSW", workEffortName: "Timesheet walk", visibilityEnumId: "WevWorkGroup" })
        for (const [partyId, roleTypeId] of [["EX_JOHN_DOE", "ProjectManager"], ["ORG_ZIZI_JD", "Programmer"], ["ORG_ZIZI_BD", "QualityAnalyst"]])
            call("create#mantle.work.effort.WorkEffortParty", { workEffortId: "TSW", partyId, roleTypeId, fromDate: at(1, 0), statusId: "WeptAssigned" })
        made.task1 = call(`${TASK}.create#Task`, { rootWorkEffortId: "TSW", workEffortName: "Weekly grid", estimatedWorkTime: 20, remainingWorkTime: 20 }).workEffortId
        made.task2 = call(`${TASK}.create#Task`, { rootWorkEffortId: "TSW", workEffortName: "Timer bar" }).workEffortId
        const before = call(`${TS}.get#TimesheetPolicy`, { partyId: "ORG_ZIZI_JD" })
        made.org = before.organizationPartyId
        made.oldSetting = one("mantle.party.PartySetting", { partyId: made.org, partySettingTypeId: "ProjTimesheetPolicy" })?.settingValue ?? null
        const stored = call(`${TS}.store#TimesheetPolicy`, { organizationPartyId: made.org, weekStart: 1, approvers: "project", lock: true, needComment: true,
            minHours: "0.25", dayHours: "8", workDays: "12345", remindDay: 1, remindHour: 10 })
        const after = call(`${TS}.get#TimesheetPolicy`, { partyId: "ORG_ZIZI_JD" }).policy
        const range = call(`${TS}.get#WeekRange`, { date: "2026-11-18", weekStart: 1 })
        const sunday = call(`${TS}.get#WeekRange`, { date: "2026-11-18", weekStart: 7 })
        return { before, stored, after, range, sunday }
    },
    then({ before, stored, after, range, sunday }) {
        made.org != null
        before.policy.weekStart == 1
        before.policy.lock == true
        stored.settingValue.length < 255
        JSON.parse(stored.settingValue).ap == "project"
        JSON.parse(stored.settingValue).rc == "Y"
        after.needComment == true
        after.workDays == [1, 2, 3, 4, 5]
        range.weekStartDay == "2026-11-16"
        range.dayList.length == 7
        range.dayList[6] == "2026-11-22"
        sunday.weekStartDay == "2026-11-15"
    },
})

feature("the timer: joe starts it, a switch stops the first, one runs per person, under a minute is discarded", {
    when() {
        setNow(at(16, 9))
        const first = as("joe.developer", () => call(`${TS}.start#Timer`, { workEffortId: made.task1, comments: "Grid layout" }))
        const again = as("joe.developer", () => call(`${TS}.start#Timer`, { workEffortId: made.task1 }))
        setNow(at(16, 10, 30))
        const switched = as("joe.developer", () => call(`${TS}.start#Timer`, { workEffortId: made.task2 }))
        const running = as("joe.developer", () => call(`${TS}.get#Timer`, {}).timer)
        as("joe.developer", () => call(`${TS}.update#Timer`, { comments: "Elapsed time" }))
        setNow(at(16, 11))
        const stopped = as("joe.developer", () => call(`${TS}.stop#Timer`, {}))
        const quick = as("joe.developer", () => call(`${TS}.start#Timer`, { workEffortId: made.task2 }))
        const discarded = as("joe.developer", () => call(`${TS}.stop#Timer`, {}))
        return { first, again, switched, running, stopped, quick, discarded,
            firstEntry: one("mantle.work.time.TimeEntry", { timeEntryId: first.timeEntryId }), secondEntry: one("mantle.work.time.TimeEntry", { timeEntryId: switched.timeEntryId }),
            gone: one("mantle.work.time.TimeEntry", { timeEntryId: quick.timeEntryId }), task1: one("mantle.work.effort.WorkEffort", { workEffortId: made.task1 }) }
    },
    then({ first, again, switched, running, stopped, quick, discarded, firstEntry, secondEntry, gone, task1 }) {
        first.timeEntryId != null
        again.alreadyRunning == true
        again.timeEntryId == first.timeEntryId
        switched.stoppedTimeEntryIds == [first.timeEntryId]
        num(firstEntry.hours) == 1.5
        firstEntry.timesheetId != null
        (made.timesheetId = firstEntry.timesheetId) != null
        secondEntry.timesheetId == firstEntry.timesheetId
        running.timeEntryId == switched.timeEntryId
        running.workEffortId == made.task2
        running.projectName == "Timesheet walk"
        running.elapsedMinutes == 0
        stopped.hours != null && num(stopped.hours) == 0.5
        discarded.discarded == true
        gone == null
        // the timer's hours came off the item's remaining time
        num(task1.remainingWorkTime) == 18.5
    },
})

feature("joe fills his week: entries by day go on the week's timesheet; get#PartyWeek has the rows, totals and the days below their hours", {
    when() {
        setNow(at(18, 9))
        made.monday = entry({ workEffortId: made.task1, fromDate: "2026-11-16 13:00:00", hours: "2", comments: "Cells" })
        made.tuesday = entry({ workEffortId: made.task1, fromDate: "2026-11-17 09:00:00", hours: "6", comments: "Keyboard moves" })
        made.unpaid = entry({ workEffortId: made.task2, fromDate: "2026-11-17 15:00:00", hours: "1", rateTypeEnumId: "RatpNoCharge" })
        const week = as("joe.developer", () => call(`${TS}.get#PartyWeek`, { date: "2026-11-18", extraWorkEffortIds: ["IRON-3"] }).week)
        const bob = as("bob.developer", () => errorOf(`${TS}.get#PartyWeek`, { partyId: "ORG_ZIZI_JD", date: "2026-11-18" }))
        const manager = as("john.doe", () => call(`${TS}.get#PartyWeek`, { partyId: "ORG_ZIZI_JD", date: "2026-11-18" }).week)
        return { week, bob, manager, entries: all("mantle.work.time.TimeEntry", { partyId: "ORG_ZIZI_JD", timesheetId: made.timesheetId }) }
    },
    then({ week, bob, manager, entries }) {
        entries.length == 5
        week.weekStart == "2026-11-16"
        week.prevWeek == "2026-11-09"
        week.isMine == true
        week.dayList.length == 7
        week.dayList[0].total == 4
        week.dayList[0].below == true
        week.dayList[1].total == 7
        week.dayList[2].isToday == true
        week.dayList[5].isWorkday == false
        week.total == 11
        week.billableTotal == 10
        week.expectedTotal == 40
        week.difference == -29
        const grid = week.rowList.find((row) => row.workEffortId == made.task1)
        grid.total == 9.5
        grid.cells["2026-11-16"].hours == 3.5
        grid.cells["2026-11-16"].entryIds.length == 2
        grid.projectName == "Timesheet walk"
        week.rowList.find((row) => row.workEffortId == "IRON-3").added == true
        week.entryList.find((one) => one.timeEntryId == made.unpaid).billable == false
        week.timesheet.statusId == "TmshInProcess"
        week.access.canSubmit == true
        week.access.canEdit == true
        bob.includes("This week is not available")
        manager.access.isApprover == true
        manager.access.canSubmit == false
    },
})

feature("submit: only joe submits his week; then it is locked, and its approvers are asked", {
    when() {
        const byManager = as("john.doe", () => errorOf(`${TS}.submit#Timesheet`, { timesheetId: made.timesheetId }))
        const submitted = as("joe.developer", () => call(`${TS}.submit#Timesheet`, { partyId: "ORG_ZIZI_JD", date: "2026-11-18" }))
        const added = errorOf(`${TIME}.store#TimeEntry`, { partyId: "ORG_ZIZI_JD", workEffortId: made.task1, fromDate: "2026-11-18 09:00:00", hours: "1" })
        return { byManager, submitted, added, approvals: messagesOf("TimesheetApproval", made.timesheetId) }
    },
    then({ byManager, submitted, added, approvals }) {
        byManager.includes("Only the person submits their week")
        submitted.timesheetId == made.timesheetId
        submitted.notifiedUserIds == ["EX_JOHN_DOE"]
        sheet().statusId == "TmshCompleted"
        added.includes("That week is submitted")
        approvals.length == 1
        usersOf(approvals[0]).map((row) => row.userId) == ["EX_JOHN_DOE"]
    },
})

feature("return: not by bob; john.doe returns it with a reason, which joe hears of and Chatter keeps", {
    when() {
        const outsider = as("bob.developer", () => errorOf(`${TS}.return#Timesheet`, { timesheetId: made.timesheetId, reason: "Not mine" }))
        const returned = as("john.doe", () => call(`${TS}.return#Timesheet`, { timesheetId: made.timesheetId, reason: "Monday needs its full day" }))
        const week = as("joe.developer", () => call(`${TS}.get#PartyWeek`, { date: "2026-11-18" }).week)
        const notes = all("mantle.party.communication.CommunicationEventRecord", { recordEntityName: "mantle.work.time.Timesheet", recordId: made.timesheetId })
        return { outsider, returned, week, notes, approvals: messagesOf("TimesheetApproval", made.timesheetId),
            returnedNotices: messagesOf("TimesheetReturned", made.timesheetId) }
    },
    then({ outsider, returned, week, notes, approvals, returnedNotices }) {
        outsider.includes("You are not an approver of this week")
        returned.message == "Week returned"
        sheet().statusId == "TmshInProcess"
        sheet().comments == "Monday needs its full day"
        week.timesheet.returned == true
        week.timesheet.reason == "Monday needs its full day"
        notes.length == 1
        // the approval notice is decided by the return
        usersOf(approvals[0])[0].viewedDate != null
        returnedNotices.length == 1
        JSON.parse(returnedNotices[0].messageJson).reason == "Monday needs its full day"
        usersOf(returnedNotices[0]).map((row) => row.userId) == ["ORG_ZIZI_JD"]
    },
})

feature("joe fixes Monday and submits again; john.doe approves from the notice; he reopens it, until an entry is invoiced", {
    when() {
        made.fix = entry({ workEffortId: made.task1, fromDate: "2026-11-16 15:00:00", hours: "4.5", comments: "Finished the cells" })
        as("joe.developer", () => call(`${TS}.submit#Timesheet`, { timesheetId: made.timesheetId }))
        const notice = messagesOf("TimesheetApproval", made.timesheetId).find((message) => usersOf(message).some((row) => row.viewedDate == null))
        const approved = as("john.doe", () => call("org.moqui.impl.NotificationServices.approve#NotificationMessage", { notificationMessageId: notice.notificationMessageId }))
        const status1 = sheet().statusId
        const week = as("joe.developer", () => call(`${TS}.get#PartyWeek`, { date: "2026-11-18" }).week)
        const reopened = as("john.doe", () => call(`${TS}.reopen#Timesheet`, { timesheetId: made.timesheetId, reason: "One more fix" }))
        const status2 = sheet().statusId
        as("joe.developer", () => call(`${TS}.submit#Timesheet`, { timesheetId: made.timesheetId }))
        as("john.doe", () => call(`${TS}.approve#Timesheet`, { timesheetId: made.timesheetId }))
        // an invoiced entry: the week stays approved
        const invoiced = one("mantle.work.time.TimeEntry", { timeEntryId: made.monday })
        invoiced.invoiceId = "TSW_INVOICE"
        invoiced.update()
        const refused = as("john.doe", () => errorOf(`${TS}.reopen#Timesheet`, { timesheetId: made.timesheetId }))
        invoiced.invoiceId = null
        invoiced.update()
        return { approved, status1, week, reopened, status2, refused, approvedNotices: messagesOf("TimesheetApproved", made.timesheetId) }
    },
    then({ approved, status1, week, reopened, status2, refused, approvedNotices }) {
        status1 == "TmshApproved"
        week.timesheet.approvedByName == "John Doe"
        week.timesheet.approvedDate != null
        week.timesheet.submittedDate != null
        week.access.canEdit == false
        week.dayList[0].total == 8.5
        week.dayList[0].below == false
        reopened.message == "Week reopened"
        status2 == "TmshInProcess"
        sheet().statusId == "TmshApproved"
        refused.includes("invoiced")
        approvedNotices.length == 2
    },
})

feature("find#Timesheets: john.doe's lists and counts, joe's own; the missing week of bob reminded once", {
    when() {
        // bob's week, not submitted
        call(`${TIME}.store#TimeEntry`, { partyId: "ORG_ZIZI_BD", workEffortId: made.task2, fromDate: "2026-11-17 10:00:00", hours: "3", rateTypeEnumId: "RatpStandard" })
        const managerAll = as("john.doe", () => call(`${TS}.find#Timesheets`, { list: "all", weekDate: "2026-11-18" }))
        const joeMine = as("joe.developer", () => call(`${TS}.find#Timesheets`, { list: "mine", weekDate: "2026-11-18" }))
        const bobsWeek = as("john.doe", () => call(`${TS}.find#Timesheets`, { list: "missing", weekDate: "2026-11-18" }))
        const reminded = as("john.doe", () => call(`${TS}.send#MissingTimeReminders`, { partyIds: ["ORG_ZIZI_BD", "ORG_ZIZI_JD"], weekDate: "2026-11-18" }))
        const outsider = as("bob.developer", () => call(`${TS}.send#MissingTimeReminders`, { partyIds: ["EX_JOHN_DOE"], weekDate: "2026-11-18" }))
        // the job, on the policy's day and hour (Monday 10:00, the week after): once, then not again
        setNow(at(23, 10, 5))
        const job = call(`${TS}.send#MissingTimeReminders`, {})
        const jobAgain = call(`${TS}.send#MissingTimeReminders`, {})
        setNow(at(18, 9))
        return { managerAll, joeMine, bobsWeek, reminded, outsider, job, jobAgain,
            bobNotices: all("moqui.security.user.NotificationMessage", { topic: "TimesheetMissing", subTopic: "ORG_ZIZI_BD:2026-11-16" }) }
    },
    then({ managerAll, joeMine, bobsWeek, reminded, outsider, job, jobAgain, bobNotices }) {
        const joeRow = managerAll.rowList.find((row) => row.partyId == "ORG_ZIZI_JD")
        joeRow.statusLabel == "Approved"
        joeRow.hours == 15.5
        joeRow.billable == 14.5
        joeRow.expected == 40
        managerAll.counts.approved >= 1
        joeMine.rowList.length == 1
        joeMine.rowList[0].isMine == true
        bobsWeek.rowList.some((row) => row.partyId == "ORG_ZIZI_BD" && row.hours == 3)
        !bobsWeek.rowList.some((row) => row.partyId == "ORG_ZIZI_JD")
        reminded.sentCount == 1
        outsider.sentCount == 0
        outsider.skippedCount == 1
        job.sentCount >= 1
        jobAgain.sentCount == 0
        // the job left bob out: his week was reminded already
        bobNotices.length == 1
    },
})

feature("Home counts the week's hours with its status, and the timesheets to approve; a timesheet's Chatter is its person's and approvers'", {
    when() {
        setNow(at(25, 9))
        entry({ workEffortId: made.task1, fromDate: "2026-11-24 09:00:00", hours: "2" })
        const nextSheet = made.nextSheet = call(`${TS}.get#PartyTimesheet`, { partyId: "ORG_ZIZI_JD", date: "2026-11-24", make: false }).timesheetId
        as("joe.developer", () => call(`${TS}.submit#Timesheet`, { timesheetId: nextSheet }))
        const joeCounts = as("joe.developer", () => call(`${PROJECT}.get#ProjectHomeCounts`, {}).counts)
        const managerCounts = as("john.doe", () => call(`${PROJECT}.get#ProjectHomeCounts`, { managers: true }).counts)
        const toApprove = as("john.doe", () => call(`${TS}.find#Timesheets`, { list: "toApprove" }))
        // Chatter's check with authorization on, granted the service as an app root would
        call("create#moqui.security.UserGroup", { userGroupId: "TSW_RL", description: "Timesheet record links" })
        call("create#moqui.security.ArtifactGroup", { artifactGroupId: "TSW_RL", description: "Timesheet record links" })
        call("create#moqui.security.ArtifactGroupMember", { artifactGroupId: "TSW_RL", artifactTypeEnumId: "AT_SERVICE",
            artifactName: "mantle.party.CommunicationServices.get#RecordLinkInfo", nameIsPattern: "N", inheritAuthz: "Y" })
        call("create#moqui.security.ArtifactAuthz", { artifactAuthzId: "TSW_RL", userGroupId: "TSW_RL", artifactGroupId: "TSW_RL",
            authzTypeEnumId: "AUTHZT_ALLOW", authzActionEnumId: "AUTHZA_ALL" })
        // from a past date: the group check reads the clock, not the spec's effective time
        for (const userId of ["EX_JOHN_DOE", "ORG_ZIZI_JD", "ORG_ZIZI_BD"]) call("create#moqui.security.UserGroupMember", { userGroupId: "TSW_RL", userId,
            fromDate: "2026-01-01 00:00:00" })
        const seenBy = (username) => as(username, () => {
            ec.artifactExecution.enableAuthz()
            try {
                return call("mantle.party.CommunicationServices.get#RecordLinkInfo", { recordEntityName: "mantle.work.time.Timesheet",
                    recordId: made.timesheetId, checkOnly: true }).recordVisible
            } finally { ec.artifactExecution.disableAuthz() }
        })
        return { joeCounts, managerCounts, toApprove, joeSees: seenBy("joe.developer"), managerSees: seenBy("john.doe"), bobSees: seenBy("bob.developer") }
    },
    then({ joeCounts, managerCounts, toApprove, joeSees, managerSees, bobSees }) {
        joeCounts.hoursWeek == 2
        joeCounts.timesheetStatusId == "TmshCompleted"
        joeCounts.expectedWeek == 40
        managerCounts.timesheetsToApprove >= 1
        toApprove.rowList.some((row) => row.partyId == "ORG_ZIZI_JD" && row.weekStart == "2026-11-23" && row.canApprove)
        toApprove.counts.toApprove == toApprove.rowList.length
        joeSees == true
        managerSees == true
        bobSees == false
    },
})
