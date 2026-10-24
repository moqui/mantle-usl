// Work effort, project, task, time-entry and event services the work-plan-to-cash flow does not reach. New spec, no
// Groovy original.
const effectiveTime = Date.now()
const day = (y, m, d) => Date.UTC(y, m - 1, d)
let workerId, clientId, vendorId, rootId = "WPS", cloneRootId

spec({
    stepwise: true,
    tempSequences: { start: 57000, banks: { "mantle.party.Party": 10, "mantle.work.effort.WorkEffort": 50, "mantle.work.time.TimeEntry": 20,
        "mantle.party.communication.CommunicationEvent": 10 } },
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
const we = (id) => ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", id).one()

feature("create a project with a milestone and tasks, and a simple task", {
    when() {
        workerId = call("mantle.party.PartyServices.create#Person", { firstName: "Wally", lastName: "Worker" }).partyId
        clientId = call("mantle.party.PartyServices.create#Organization", { organizationName: "WPS Client", roleTypeId: "Customer" }).partyId
        vendorId = call("mantle.party.PartyServices.create#Organization", { organizationName: "WPS Vendor", roleTypeId: "Vendor" }).partyId
        call("mantle.work.ProjectServices.create#Project", { workEffortId: rootId, workEffortName: "WPS Project", clientPartyId: clientId, vendorPartyId: vendorId,
                estimatedStartDate: day(2026, 11, 1), estimatedCompletionDate: day(2026, 12, 31) })
        call("mantle.work.ProjectServices.create#Milestone", { rootWorkEffortId: rootId, workEffortId: "WPS-MS-1", workEffortName: "Milestone 1",
                estimatedStartDate: day(2026, 11, 1), estimatedCompletionDate: day(2026, 11, 30), statusId: "WeInProgress" })
        for (const [id, name, parent] of [["WPS-1", "Task 1", null], ["WPS-1A", "Task 1A", "WPS-1"], ["WPS-2", "Task 2", null]]) {
            call("mantle.work.TaskServices.create#Task", { rootWorkEffortId: rootId, parentWorkEffortId: parent, workEffortId: id, milestoneWorkEffortId: "WPS-MS-1",
                    workEffortName: name, estimatedCompletionDate: day(2026, 11, 20), statusId: "WeApproved", assignToPartyId: workerId, priority: 3,
                    purposeEnumId: "WepTask", estimatedWorkTime: 8 })
        }
        const simple = call("mantle.work.TaskServices.create#SimpleTask", { workEffortName: "Loose task", estimatedWorkTime: 2 })
        return { simple, project: we(rootId) }
    },
    then({ simple, project }) {
        simple.workEffortId != null
        project.workEffortTypeEnumId == "WetProject"
        project.workEffortName == "WPS Project"
    },
})

feature("project parties, teams, tasks and milestones", {
    when() {
        const tasks = call("mantle.work.ProjectServices.get#ProjectTasks", { rootWorkEffortId: rootId })
        const milestones = call("mantle.work.ProjectServices.get#ProjectMilestones", { rootWorkEffortId: rootId })
        const teams = call("mantle.work.ProjectServices.get#ProjectTeams", { rootWorkEffortId: rootId })
        const parties = call("mantle.work.ProjectServices.get#ProjectParties", { rootWorkEffortId: rootId, addOptional: false })
        return { tasks, milestones, teams, parties }
    },
    then({ tasks, milestones, teams, parties }) {
        tasks.resultList.length >= 3
        milestones.resultList.length == 1
        teams.resultList != null
        parties.resultList != null
    },
})

feature("project statistics and milestone summaries", {
    when() {
        const stats = call("mantle.work.ProjectServices.get#ProjectStats", { workEffortId: rootId })
        const summary = call("mantle.work.ProjectServices.get#ProjectMilestoneSummary", { workEffortId: rootId })
        const childStats = call("mantle.work.ProjectServices.get#WorkEffortChildStats", { workEffortId: rootId })
        return { stats, summary, childStats }
    },
    then({ stats, summary, childStats }) {
        stats != null
        summary.milestoneStatsList.length >= 1
        summary.milestoneStatsList[0].workEffortId == "WPS-MS-1"
        childStats.childStatsList.length >= 1
    },
})

feature("update a milestone, a task, its milestone, and the task comments", {
    when() {
        call("mantle.work.ProjectServices.update#Milestone", { workEffortId: "WPS-MS-1", workEffortName: "Milestone 1 renamed" })
        call("mantle.work.TaskServices.update#Task", { workEffortId: "WPS-2", workEffortName: "Task 2 renamed", estimatedCompletionDate: day(2026, 11, 25) })
        call("mantle.work.TaskServices.set#TaskMilestone", { workEffortId: "WPS-2", milestoneWorkEffortId: "WPS-MS-1" })
        const added = call("mantle.work.TaskServices.add#TaskComment", { workEffortId: "WPS-2", subject: "First", body: "A comment" })
        const comments = Array.from(ec.entity.find("mantle.work.effort.WorkEffortCommEvent").condition("workEffortId", "WPS-2").list())
        const commId = comments[0].communicationEventId
        // the new comment's id comes back (Chatter shows it at once)
        assert(added.communicationEventId === commId, `add#TaskComment answered ${added.communicationEventId}, the join has ${commId}`)
        call("mantle.work.TaskServices.update#TaskComment", { workEffortId: "WPS-2", communicationEventId: commId, subject: "First edited", body: "Edited" })
        const edited = ec.entity.find("mantle.party.communication.CommunicationEvent").condition("communicationEventId", commId).one()
        call("mantle.work.TaskServices.delete#TaskComment", { workEffortId: "WPS-2", communicationEventId: commId })
        const left = ec.entity.find("mantle.work.effort.WorkEffortCommEvent").condition("workEffortId", "WPS-2").count()
        return { ms: we("WPS-MS-1"), task: we("WPS-2"), comments: comments.length, edited, left }
    },
    then({ ms, task, comments, edited, left }) {
        ms.workEffortName == "Milestone 1 renamed"
        task.workEffortName == "Task 2 renamed"
        comments == 1
        edited.subject == "First edited"
        left == 0
    },
})

feature("work effort parties and products", {
    when() {
        const added = call("mantle.work.WorkEffortServices.add#WorkEffortParty", { workEffortId: "WPS-1", partyId: workerId, roleTypeId: "Assignee" })
        call("mantle.work.WorkEffortServices.remove#WorkEffortParty", { workEffortId: "WPS-1", partyId: workerId, roleTypeId: "Assignee" })
        const removed = Array.from(ec.entity.find("mantle.work.effort.WorkEffortParty").condition("workEffortId", "WPS-1").condition("partyId", workerId)
                .condition("roleTypeId", "Assignee").condition("thruDate", null).list()).length
        const other = call("mantle.party.PartyServices.create#Person", { firstName: "Olly", lastName: "Other" }).partyId
        call("mantle.work.WorkEffortServices.replace#WorkEffortParty", { workEffortId: "WPS-1", roleTypeId: "Assignee", newPartyId: other })
        // the effective time is fixed in this spec, so a party cannot take the same role at the same time twice: use a third party
        const third = call("mantle.party.PartyServices.create#Person", { firstName: "Terry", lastName: "Third" }).partyId
        call("mantle.work.WorkEffortServices.replace#WorkEffortParty", { workEffortId: "WPS-1", roleTypeId: "Assignee", newPartyId: third })
        const current = Array.from(ec.entity.find("mantle.work.effort.WorkEffortParty").condition("workEffortId", "WPS-1").condition("roleTypeId", "Assignee")
                .condition("thruDate", null).list()).map(p => p.partyId)
        const product = call("mantle.work.WorkEffortServices.add#WorkEffortProduct", { workEffortId: "WPS-1", productId: "DEMO_1_1", typeEnumId: "WeptSales" })
        return { added, removed, current, product }
    },
    then({ added, removed, current, product }) {
        added.fromDate != null
        removed == 0
        current.length == 1
        product != null
    },
})

feature("work effort start and end, and its content", {
    when() {
        const startEnd = call("mantle.work.WorkEffortServices.get#WorkEffortStartEnd", { workEffortId: "WPS-1" })
        const contentId = call("mantle.work.WorkEffortServices.create#WorkEffortContent", { workEffortId: "WPS-1", workEffortContentTypeEnumId: "WecAttachment", description: "note" }).workEffortContentId
        call("mantle.work.WorkEffortServices.update#WorkEffortContent", { workEffortContentId: contentId, description: "note edited" })
        const weFileId = call("mantle.work.WorkEffortServices.create#WorkEffortContent", { workEffortId: "WPS-1", workEffortContentTypeEnumId: "WecAttachment", contentFile: uploadedFile("we.txt", "task file") }).workEffortContentId
        call("mantle.work.WorkEffortServices.update#WorkEffortContent", { workEffortContentId: weFileId, contentFile: uploadedFile("we2.txt", "task file 2") })
        const loc = call("mantle.work.WorkEffortServices.get#WorkEffortContentLocation", { workEffortId: "WPS-1", contentTypeEnumIdList: ["WecAttachment"] })
        return { startEnd, contentId, loc }
    },
    then({ startEnd, contentId }) {
        startEnd != null
        contentId != null
    },
})

feature("clone the project, then delete the clone", {
    when() {
        cloneRootId = "WPSCLONE"
        call("mantle.work.ProjectServices.clone#Project", { baseWorkEffortId: rootId, workEffortId: cloneRootId, workEffortName: "WPS Clone" })
        const clone = we(cloneRootId)
        const kids = Array.from(ec.entity.find("mantle.work.effort.WorkEffort").condition("rootWorkEffortId", cloneRootId).list()).length
        // the clone has the content and product of WPS-1, which delete#WorkEffort will not remove
        const refused = errorOf("mantle.work.WorkEffortServices.delete#WorkEffort", { workEffortId: cloneRootId, deleteChildWorkEfforts: true, deleteWorkEffortParties: true, deleteTimeEntries: true })
        return { clone, kids, refused, still: we(cloneRootId) }
    },
    then({ clone, kids, refused, still }) {
        refused != null
        still != null
        clone.workEffortName == "WPS Clone"
        kids >= 1
    },
})

feature("time entries on a work effort: store, rates, timesheet, delete", {
    when() {
        const entryId = call("mantle.work.TimeServices.store#TimeEntry", { partyId: workerId, workEffortId: "WPS-1", clientPartyId: clientId, vendorPartyId: vendorId,
                fromDate: day(2026, 11, 10) + 9 * 3600000, thruDate: day(2026, 11, 10) + 17 * 3600000, hours: 8 })
        const entry = Array.from(ec.entity.find("mantle.work.time.TimeEntry").condition("partyId", workerId).condition("workEffortId", "WPS-1").list())[0]
        call("mantle.work.TimeServices.resetAndGet#TimeEntryRates", { workEffortId: "WPS-1", partyId: workerId })
        call("mantle.work.TimeServices.resetAndGet#ProjectTimeEntryRates", { rootWorkEffortId: rootId })
        const sheet = call("mantle.work.TimeServices.get#TeamTimesheetInfo", { partyId: workerId, workEffortId: "WPS-1" })
        call("mantle.work.TimeServices.delete#TimeEntry", { timeEntryId: entry.timeEntryId })
        const afterOne = ec.entity.find("mantle.work.time.TimeEntry").condition("timeEntryId", entry.timeEntryId).one()
        call("mantle.work.TimeServices.store#TimeEntry", { partyId: workerId, workEffortId: "WPS-2", clientPartyId: clientId, vendorPartyId: vendorId,
                fromDate: day(2026, 11, 11) + 9 * 3600000, thruDate: day(2026, 11, 11) + 12 * 3600000, hours: 3 })
        call("mantle.work.TimeServices.delete#TimeEntries", { workEffortId: "WPS-2" })
        const afterAll = ec.entity.find("mantle.work.time.TimeEntry").condition("workEffortId", "WPS-2").count()
        return { entry, sheet, afterOne, afterAll }
    },
    then({ entry, sheet, afterOne, afterAll }) {
        entry != null
        sheet != null
        afterOne == null
        afterAll == 0
    },
})

feature("event creation and business-day calculations", {
    when() {
        const event = call("mantle.work.EventServices.create#Event", { workEffortName: "Planning meeting", estimatedStartDate: day(2026, 11, 12) + 15 * 3600000, estimatedWorkTime: 1 })
        const next = call("mantle.work.EventServices.get#NextBusinessDay", { startDate: "2026-11-13" })
        const future = call("mantle.work.EventServices.get#FutureBusinessDay", { startDate: "2026-11-13", businessDays: 3 })
        const calendar = call("mantle.work.EventServices.get#FullCalendarData", { partyId: workerId, start: day(2026, 11, 1), end: day(2026, 12, 1) })
        const taskCalendar = call("mantle.work.TaskServices.get#FullCalendarData", { partyId: workerId, start: day(2026, 11, 1), end: day(2026, 12, 1) })
        return { event, next, future, calendar, taskCalendar }
    },
    then({ event, next, future, calendar, taskCalendar }) {
        event.workEffortId != null
        // 2026-11-13 is a Friday: the next business day is Monday the 16th, and three business days after it is Wednesday the 18th
        String(next.nextDayDate).startsWith("2026-11-16") || ec.l10n.format(next.nextDayDate, "yyyy-MM-dd") == "2026-11-16"
        ec.l10n.format(future.futureDayDate, "yyyy-MM-dd") == "2026-11-18"
        calendar != null
        taskCalendar != null
    },
})
