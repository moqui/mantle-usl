// IronStone Projects planning on the timeline and work item import in mantle.work.TaskServices, ProjectServices, EventServices
// and WorkItemImportServices (design-projects.md §5 Timeline and WorkItemImport, §15 Dependency lag, Timeline data, Calendar
// project filter and Work item import services; impl-projects.md P4c): dependencies with their lag, a loop or a branch of the
// tree refused (add#, remove#TaskDependency); a bar moved or resized, a summary bar with its sub-items, and the dependents moved on
// by business days (set#TaskDates with autoSchedule); what the timeline draws (get#TimelineData: spans, progress, kept and broken
// dependencies, plan items); a project's linked events (get#FullCalendarData rootWorkEffortId); and a Jira CSV read, previewed and
// imported (types, statuses and priorities by their value maps, estimates in seconds, parents and epics, labels and a release
// made, a sprint carried over and completed, a row without a title failing alone), then imported again (skipped, updated). New
// spec, no Groovy original.
// Run: ./moq test mantle-usl --spec WorkProjectPlan
const TASK = "mantle.work.TaskServices"
const PS = "mantle.work.ProjectServices"
const IMPORT = "mantle.work.WorkItemImportServices"
// Monday November 2, 2026 at the hour given (UTC)
const at = (day, hour) => Date.UTC(2026, 10, day, hour, 0, 0)

spec({
    stepwise: true,
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(at(2, 12))
    },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() {
        ec.artifactExecution.enableAuthz()
        login("john.doe")
    },
})

function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    const errors = ec.message.getErrorsString ? ec.message.getErrorsString() : null
    ec.message.clearErrors()
    return errors || null
}
const we = (id) => ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", id).one()
const day = (value) => value == null ? null : ec.l10n.format(value, "yyyy-MM-dd")
const dates = (id) => { const row = we(id); return [day(row.estimatedStartDate), day(row.estimatedCompletionDate)] }
const task = (name, more) => call(`${TASK}.create#Task`, Object.assign({ rootWorkEffortId: "PTL", workEffortName: name }, more || {})).workEffortId
const dependsOn = (id) => Array.from(ec.entity.find("mantle.work.effort.WorkEffortAssoc").condition("workEffortId", id)
        .condition("workEffortAssocTypeEnumId", "WeatDependsOn").conditionDate("fromDate", "thruDate", null).list())
        .map((row) => row.toWorkEffortId + (row.lagDays != null ? "+" + Number(String(row.lagDays)) : ""))

feature("a dependency has a direction and a lag; one in its branch of the tree or closing a loop is refused", {
    when() {
        call(`${PS}.create#Project`, { workEffortId: "PTL", workEffortName: "Timeline project", visibilityEnumId: "WevWorkGroup" })
        // PTL-1 design, PTL-2 build, PTL-3 test; PTL-4 a phase with PTL-5 and PTL-6
        task("Design", { estimatedStartDate: "2026-11-02", estimatedCompletionDate: "2026-11-04", estimatedWorkTime: 8, remainingWorkTime: 4 })
        task("Build", { estimatedStartDate: "2026-11-05", estimatedCompletionDate: "2026-11-09" })
        task("Test", { estimatedStartDate: "2026-11-10", estimatedCompletionDate: "2026-11-10" })
        task("Rollout")
        task("Train the team", { parentWorkEffortId: "PTL-4", estimatedStartDate: "2026-11-16", estimatedCompletionDate: "2026-11-18" })
        task("Switch over", { parentWorkEffortId: "PTL-4", estimatedCompletionDate: "2026-11-20", statusId: "WeComplete" })
        const first = call(`${TASK}.add#TaskDependency`, { workEffortId: "PTL-2", toWorkEffortId: "PTL-1" })
        const second = call(`${TASK}.add#TaskDependency`, { workEffortId: "PTL-3", toWorkEffortId: "PTL-2", lagDays: 2 })
        const again = call(`${TASK}.add#TaskDependency`, { workEffortId: "PTL-3", toWorkEffortId: "PTL-2", lagDays: 1 })
        const loop = errorOf(`${TASK}.add#TaskDependency`, { workEffortId: "PTL-1", toWorkEffortId: "PTL-3" })
        const branch = errorOf(`${TASK}.add#TaskDependency`, { workEffortId: "PTL-5", toWorkEffortId: "PTL-4" })
        call(`${TASK}.add#TaskDependency`, { workEffortId: "PTL-4", toWorkEffortId: "PTL-1" })
        const removed = call(`${TASK}.remove#TaskDependency`, { workEffortId: "PTL-4", toWorkEffortId: "PTL-1" })
        const removedAgain = call(`${TASK}.remove#TaskDependency`, { workEffortId: "PTL-4", toWorkEffortId: "PTL-1" })
        return { first, second, again, loop, branch, removed, removedAgain, deps: [dependsOn("PTL-2"), dependsOn("PTL-3"), dependsOn("PTL-4")] }
    },
    then({ first, second, again, loop, branch, removed, removedAgain, deps }) {
        first.created
        second.created
        !again.created
        deps == [["PTL-1"], ["PTL-2+1"], []]
        loop.includes("PTL-3 already waits for PTL-1")
        branch.includes("are in one branch of the tree")
        removed.removed
        !removedAgain.removed
    },
})

feature("what the timeline draws: the items with their own dates and a parent's span, progress, the dependencies kept or broken, the plan items", {
    when() {
        call(`${PS}.create#Milestone`, { rootWorkEffortId: "PTL", workEffortName: "Live", estimatedCompletionDate: "2026-11-20" })
        call(`${PS}.create#Sprint`, { rootWorkEffortId: "PTL", workEffortName: "Sprint A" })
        call(`${TASK}.set#TaskSprint`, { workEffortId: "PTL-2", sprintWorkEffortId: "PTL-SP-1" })
        const out = call(`${PS}.get#TimelineData`, { workEffortIds: "PTL-1,PTL-2,PTL-3,PTL-5" })
        const byId = {}
        for (const row of out.itemList) byId[row.workEffortId] = row
        return { out, byId }
    },
    then({ out, byId }) {
        // PTL-4 comes as the ancestor of PTL-5, spanning its sub-items (the done one counts, a cancelled one would not)
        out.itemList.map((row) => row.workEffortId) == ["PTL-4", "PTL-1", "PTL-2", "PTL-3", "PTL-5"]
        byId["PTL-4"].ancestor
        byId["PTL-4"].startDay == null
        byId["PTL-4"].spanStartDay == "2026-11-16"
        byId["PTL-4"].spanDueDay == "2026-11-20"
        byId["PTL-4"].childCount == 2
        byId["PTL-4"].progress == 50
        byId["PTL-1"].startDay == "2026-11-02"
        byId["PTL-1"].dueDay == "2026-11-04"
        byId["PTL-1"].progress == 50
        byId["PTL-2"].sprintId == "PTL-SP-1"
        // PTL-2 starts the next weekday after PTL-1; PTL-3 starts Tuesday, before Wednesday's lag of a day after PTL-2's Monday
        out.dependencyList.length == 2
        !out.dependencyList.find((link) => link.workEffortId == "PTL-2").violated
        out.dependencyList.find((link) => link.workEffortId == "PTL-3").violated
        out.dependencyList.find((link) => link.workEffortId == "PTL-3").lagDays == 1
        out.planItemList.map((plan) => plan.kind).sort() == ["milestone", "sprint"]
        out.planItemList.find((plan) => plan.kind == "milestone").dueDay == "2026-11-20"
        out.planItemList.find((plan) => plan.kind == "sprint").itemCount == 1
    },
})

feature("a bar moved with auto-schedule moves its dependents on by business days, keeping their length; a summary bar moves its sub-items", {
    when() {
        // Design now ends Friday: Build starts the Monday after (2 business days long: Wednesday), Test the Friday after a day's lag
        const moved = call(`${TASK}.set#TaskDates`, { workEffortId: "PTL-1", dueDay: "2026-11-06", autoSchedule: true })
        const after = { design: dates("PTL-1"), build: dates("PTL-2"), test: dates("PTL-3") }
        // without auto-schedule only the bar itself
        const alone = call(`${TASK}.set#TaskDates`, { workEffortId: "PTL-2", startDay: "2026-11-10", dueDay: "2026-11-12" })
        const test = dates("PTL-3")
        // the phase a week later: its sub-items with it
        const phase = call(`${TASK}.set#TaskDates`, { workEffortId: "PTL-4", startDay: "2026-11-23", dueDay: "2026-11-27", moveSubtree: true })
        return { moved, after, alone, test, phase, train: dates("PTL-5"), switchOver: dates("PTL-6"), phaseDates: dates("PTL-4") }
    },
    then({ moved, after, alone, test, phase, train, switchOver, phaseDates }) {
        after.design == ["2026-11-02", "2026-11-06"]
        after.build == ["2026-11-09", "2026-11-11"]
        after.test == ["2026-11-13", "2026-11-13"]
        moved.movedList.map((row) => row.workEffortId) == ["PTL-1", "PTL-2", "PTL-3"]
        moved.failedList.length == 0
        alone.movedList.length == 1
        test == ["2026-11-13", "2026-11-13"]
        phaseDates == ["2026-11-23", "2026-11-27"]
        // the phase had no start, so it moved by its due date's shift
        phase.movedList.length == 1
        train == ["2026-11-16", "2026-11-18"]
        switchOver == [null, "2026-11-20"]
    },
})

feature("a summary bar with dates moves its sub-items by the same days", {
    when() {
        const phase = call(`${TASK}.set#TaskDates`, { workEffortId: "PTL-4", startDay: "2026-11-30", dueDay: "2026-12-04", moveSubtree: true })
        return { phase, train: dates("PTL-5"), switchOver: dates("PTL-6") }
    },
    then({ phase, train, switchOver }) {
        phase.movedList.map((row) => row.workEffortId).sort() == ["PTL-4", "PTL-5", "PTL-6"]
        train == ["2026-11-23", "2026-11-25"]
        switchOver == [null, "2026-11-27"]
    },
})

feature("a bar dragged along by shiftDays moves its own dates, and its sub-items with moveSubtree; an item with only a due date moves too", {
    when() {
        const phase = call(`${TASK}.set#TaskDates`, { workEffortId: "PTL-4", shiftDays: -7, moveSubtree: true })
        const dueOnly = call(`${TASK}.set#TaskDates`, { workEffortId: "PTL-6", shiftDays: 3 })
        return { phase, phaseDates: dates("PTL-4"), train: dates("PTL-5"), switchOver: dates("PTL-6"), dueOnly }
    },
    then({ phase, phaseDates, train, switchOver, dueOnly }) {
        phaseDates == ["2026-11-23", "2026-11-27"]
        train == ["2026-11-16", "2026-11-18"]
        phase.movedList.length == 3
        dueOnly.movedList.length == 1
        switchOver == [null, "2026-11-23"]
    },
})

feature("a project's calendar has the events linked to it (WorkEffortRecord), not the others", {
    when() {
        const event = (id, name, linked) => {
            call("create#mantle.work.effort.WorkEffort", { workEffortId: id, workEffortTypeEnumId: "WetEvent", statusId: "WeInPlanning", workEffortName: name,
                estimatedStartDate: at(4, 15), estimatedCompletionDate: at(4, 16), ownerPartyId: "EX_JOHN_DOE" })
            if (linked) call("create#mantle.work.effort.WorkEffortRecord", { workEffortId: id, recordEntityName: "mantle.work.effort.WorkEffort", recordId: linked })
        }
        event("PTL_EV_1", "Design review", "PTL")
        event("PTL_EV_2", "Lunch", null)
        event("PTL_EV_3", "Other project's review", "PSP_NONE")
        const out = call("mantle.work.EventServices.get#FullCalendarData", { rootWorkEffortId: "PTL", start: "2026-11-01", end: "2026-11-07",
            titleGString: "${workEffort.workEffortName}" })
        return { titles: out.eventList.map((event) => event.title) }
    },
    then({ titles }) {
        titles == ["Design review"]
    },
})

// a Jira export: an epic, its two stories (one by the parent's id, one by its key), a row without a title, a carried-over item
const jiraCsv = [
    "Issue key,Issue id,Summary,Issue Type,Status,Priority,Assignee,Reporter,Created,Due date,Original Estimate,Labels,Labels,Sprint,Sprint,Fix Version/s,Parent,Description",
    "PJ-1,10001,Checkout flow,Epic,In Progress,High,john.doe,john.doe,01/Oct/26 9:00 AM,,,web,,,,1.0,,\"The whole checkout\"",
    "PJ-2,10002,Cart page,Story,Done,Medium,john.doe,,02/Oct/26 9:00 AM,16/Oct/26,28800,web,ui,Sprint 1,,1.0,10001,",
    "PJ-3,10003,Payment form,Story,In Progress,Highest,nobody.here,,05/Oct/26 10:00 AM,30/Oct/26,14400,ui,,Sprint 1,Sprint 2,1.0,10001,\"Card, then\nPayPal\"",
    "PJ-4,10004,,Bug,To Do,Low,,,06/Oct/26 10:00 AM,,,,,,,,,",
    "PJ-5,10005,Receipt email,Task,To Do,Lowest,,,07/Oct/26 10:00 AM,not a date,,,,Sprint 2,,,PJ-1,",
].join("\n")
const byKey = (key) => ec.entity.find("mantle.work.effort.WorkEffort").condition("rootWorkEffortId", "PIM").condition("sourceReferenceId", key).one()

feature("a Jira CSV is read with the Jira preset: the mapping, a repeated column once, the value maps", {
    when() {
        call(`${PS}.create#Project`, { workEffortId: "PIM", workEffortName: "Import project", visibilityEnumId: "WevWorkGroup" })
        return { parsed: call(`${IMPORT}.parse#WorkItemFile`, { fileText: jiraCsv, sampleSize: 2 }) }
    },
    then({ parsed }) {
        parsed.presetId == "jira"
        parsed.rowCount == 5
        parsed.columnMapping.title == "Summary"
        parsed.columnMapping.sourceKey == "Issue key"
        parsed.columnMapping.parentKey == "Parent"
        parsed.columnMapping.release == "Fix Version/s"
        parsed.estimateUnit == "seconds"
        parsed.columnList.find((column) => column.columnName == "Labels").count == 2
        parsed.columnList.find((column) => column.columnName == "Sprint").targetField == "sprint"
        parsed.sampleRowList.length == 2
        parsed.distinctValues.type == ["Epic", "Story", "Bug", "Task"]
        parsed.valueMapsUsed.type.Bug == "WepFix"
        parsed.valueMapsUsed.type.Story == "WepNewFeature"
        parsed.valueMapsUsed.status.Done == "WeComplete"
        parsed.valueMapsUsed.status["To Do"] == "WeApproved"
        parsed.valueMapsUsed.priority.Highest == 1
        parsed.valueMapsUsed.priority.Lowest == 9
    },
})

feature("the preview shows each row as it will be made, with its problems, and the counts", {
    when() {
        return { preview: call(`${IMPORT}.preview#WorkItems`, { fileText: jiraCsv, rootWorkEffortId: "PIM", valueMaps: { type: { Epic: "WepFeatureEnhance" } } }) }
    },
    then({ preview }) {
        preview.rowCount == 5
        preview.counts.create == 4
        preview.counts.fail == 1
        preview.counts.warned == 2
        preview.previewList[0].purposeEnumId == "WepFeatureEnhance"
        preview.previewList[0].assigneePartyId == "EX_JOHN_DOE"
        preview.previewList[0].release.make
        preview.previewList[1].parentInFile
        preview.previewList[1].estimate == 8
        preview.previewList[1].labelList.map((label) => label.name) == ["web", "ui"]
        preview.previewList[2].warnings[0].includes("nobody.here")
        preview.previewList[2].sprint.name == "Sprint 2"
        preview.previewList[2].earlierSprints[0].name == "Sprint 1"
        preview.previewList[3].action == "fail"
        preview.previewList[3].problems == ["No title"]
        preview.previewList[4].warnings[0].includes("not a date")
    },
})

feature("the import makes the items, their parents, labels, release and sprints; the row without a title fails alone, named", {
    when() {
        const out = call(`${IMPORT}.import#WorkItems`, { fileText: jiraCsv, rootWorkEffortId: "PIM" })
        const epic = byKey("PJ-1"), cart = byKey("PJ-2"), payment = byKey("PJ-3"), receipt = byKey("PJ-5")
        const sprintOf = (id) => Array.from(ec.entity.find("mantle.work.effort.WorkEffortAssoc").condition("toWorkEffortId", id)
                .condition("workEffortAssocTypeEnumId", "WeatSprint").list()).map((row) => row.workEffortId + (row.thruDate ? " ended" : ""))
        const sprintNamed = (name) => ec.entity.find("mantle.work.effort.WorkEffort").condition("rootWorkEffortId", "PIM").condition("workEffortTypeEnumId", "WetSprint")
                .condition("workEffortName", name).one()
        const labels = (id) => Array.from(ec.entity.find("mantle.work.effort.WorkEffortCategoryAppl").condition("workEffortId", id).list()).map((row) =>
                ec.entity.find("mantle.work.effort.WorkEffortCategory").condition("workEffortCategoryId", row.workEffortCategoryId).one().description).sort()
        const assignees = (id) => Array.from(ec.entity.find("mantle.work.effort.WorkEffortParty").condition("workEffortId", id).condition("roleTypeId", "Assignee").list()).map((row) => row.partyId)
        return { out, epic, cart, payment, receipt, sprint1: sprintNamed("Sprint 1"), sprint2: sprintNamed("Sprint 2"), paymentSprints: sprintOf(payment.workEffortId),
            cartSprints: sprintOf(cart.workEffortId), cartLabels: labels(cart.workEffortId), epicAssignees: assignees(epic.workEffortId),
            paymentAssignees: assignees(payment.workEffortId), releases: Array.from(ec.entity.find("mantle.work.effort.WorkEffort").condition("rootWorkEffortId", "PIM")
                .condition("workEffortTypeEnumId", "WetRelease").list()).map((row) => row.workEffortName) }
    },
    then({ out, epic, cart, payment, receipt, sprint1, sprint2, paymentSprints, cartSprints, cartLabels, epicAssignees, paymentAssignees, releases }) {
        out.rowCount == 5
        out.createdCount == 4
        out.failedCount == 1
        out.failureList[0].rowNumber == 5
        out.failureList[0].key == "PJ-4"
        out.failureList[0].error == "No title"
        out.warningList.some((warning) => warning.key == "PJ-3" && warning.warning.includes("nobody.here"))
        out.madeList.map((made) => made.kind).sort() == ["WetRelease", "WetSprint", "WetSprint", "label", "label"]
        epic.workEffortId == "PIM-1"
        epic.purposeEnumId == "WepNewFeature"
        epic.statusId == "WeInProgress"
        epic.priority == 3
        epic.description == "The whole checkout"
        epicAssignees == ["EX_JOHN_DOE"]
        cart.parentWorkEffortId == "PIM-1"
        cart.statusId == "WeComplete"
        cart.resolutionEnumId == "WerCompleted"
        cart.estimatedWorkTime == 8
        cart.remainingWorkTime == 0
        day(cart.estimatedCompletionDate) == "2026-10-16"
        cartLabels == ["ui", "web"]
        payment.parentWorkEffortId == "PIM-1"
        payment.priority == 1
        payment.description == "Card, then\nPayPal"
        paymentAssignees.length == 0
        receipt.parentWorkEffortId == "PIM-1"
        receipt.estimatedCompletionDate == null
        releases == ["1.0"]
        // Sprint 1 is past (PJ-3 was carried over from it): complete, with PJ-2 in it and PJ-3's membership ended; Sprint 2 open
        sprint1.statusId == "WeComplete"
        sprint2.statusId == "WeInPlanning"
        cartSprints == [sprint1.workEffortId]
        paymentSprints.sort() == [sprint1.workEffortId + " ended", sprint2.workEffortId].sort()
    },
})

feature("the same file again: the rows already imported are skipped, or updated", {
    when() {
        const skipped = call(`${IMPORT}.import#WorkItems`, { fileText: jiraCsv, rootWorkEffortId: "PIM" })
        const changed = jiraCsv.replace("Receipt email,Task,To Do", "Receipt email and SMS,Task,In Progress")
        const updated = call(`${IMPORT}.import#WorkItems`, { fileText: changed, rootWorkEffortId: "PIM", existingPolicy: "update" })
        return { skipped, updated, receipt: byKey("PJ-5"), count: ec.entity.find("mantle.work.effort.WorkEffort").condition("rootWorkEffortId", "PIM")
            .condition("workEffortTypeEnumId", "WetTask").count() }
    },
    then({ skipped, updated, receipt, count }) {
        skipped.createdCount == 0
        skipped.skippedCount == 4
        skipped.failedCount == 1
        updated.updatedCount == 4
        receipt.workEffortName == "Receipt email and SMS"
        receipt.statusId == "WeInProgress"
        count == 4
    },
})
