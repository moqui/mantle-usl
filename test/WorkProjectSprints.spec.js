// IronStone Projects sprints and the backlog in mantle.work.ProjectServices, TaskServices and ProjectReportServices
// (design-projects.md §5 Backlog and SprintDetail, §15 Sprints, Rank and Reports services; impl-projects.md P4a): a sprint's
// defaults and id (get#SprintDefaults, create#Sprint, update#Sprint), the backlog's one order over the project
// (set#TaskBacklogRank), items in and out of sprints (set#TaskSprint, its scope-change audit rows), one sprint in progress
// unless the project allows several (start#Sprint), the completion with the open items carried to the next sprint, a new one
// or the backlog (complete#Sprint), the burndown by day with its ideal line, the scope changes with who made them
// (get#SprintBurndown) and the velocity (get#SprintVelocity). New spec, no Groovy original.
const TASK = "mantle.work.TaskServices"
const PROJECT = "mantle.work.ProjectServices"
const REPORT = "mantle.work.ProjectReportServices"
// Monday November 2, 2026 and the days after, at the hour given (UTC)
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
const task = (name, more) => call(`${TASK}.create#Task`, Object.assign({ rootWorkEffortId: "PSP", workEffortName: name }, more || {})).workEffortId
const day = (value) => ec.l10n.format(value, "yyyy-MM-dd")
const sprintOf = (id) => Array.from(ec.entity.find("mantle.work.effort.WorkEffortAssoc").condition("toWorkEffortId", id)
        .condition("workEffortAssocTypeEnumId", "WeatSprint").conditionDate("fromDate", "thruDate", null).list()).map((row) => row.workEffortId)
// the project's tasks in the backlog's order
const order = () => Array.from(ec.entity.find("mantle.work.effort.WorkEffort").condition("rootWorkEffortId", "PSP")
        .condition("workEffortTypeEnumId", "WetTask").orderBy("sequenceNum").orderBy("workEffortId").list()).map((row) => row.workEffortId)
const done = (id) => call(`${TASK}.set#TaskStatus`, { workEffortId: id, statusId: "WeComplete" })

feature("a sprint's defaults: Sprint n, two weeks on weekdays after the last one, in the project's estimate unit", {
    when() {
        call(`${PROJECT}.create#Project`, { workEffortId: "PSP", workEffortName: "Sprints project", visibilityEnumId: "WevWorkGroup" })
        call(`${PROJECT}.store#ProjectSetting`, { workEffortId: "PSP", settingTypeEnumId: "WstEstimateUnit", settingValue: "points" })
        const first = call(`${PROJECT}.get#SprintDefaults`, { rootWorkEffortId: "PSP" })
        const made = call(`${PROJECT}.create#Sprint`, { rootWorkEffortId: "PSP", description: "The first things", capacity: 12 }).workEffortId
        const second = call(`${PROJECT}.get#SprintDefaults`, { rootWorkEffortId: "PSP" })
        const made2 = call(`${PROJECT}.create#Sprint`, { rootWorkEffortId: "PSP", workEffortName: "Hardening" }).workEffortId
        call(`${PROJECT}.update#Sprint`, { workEffortId: made2, capacity: "10", description: "Fix what the first found" })
        return { first, made, sprint: we(made), second, made2, sprint2: we(made2) }
    },
    then({ first, made, sprint, second, made2, sprint2 }) {
        first.workEffortId == "PSP-SP-1"
        first.workEffortName == "Sprint 1"
        first.estimateUnit == "points"
        // from today, Monday, through the Friday of the next week
        first.startDay == "2026-11-02"
        first.endDay == "2026-11-13"
        made == "PSP-SP-1"
        sprint.workEffortTypeEnumId == "WetSprint"
        sprint.statusId == "WeInPlanning"
        sprint.rootWorkEffortId == "PSP"
        sprint.estimatedPoints == 12
        sprint.description == "The first things"
        day(sprint.estimatedStartDate) == "2026-11-02"
        day(sprint.estimatedCompletionDate) == "2026-11-13"
        // the next: the Monday after, ending two weeks after the last one; its capacity the last one's
        second.workEffortId == "PSP-SP-2"
        second.startDay == "2026-11-16"
        second.endDay == "2026-11-27"
        second.capacity == 12
        made2 == "PSP-SP-2"
        sprint2.workEffortName == "Hardening"
        sprint2.estimatedPoints == 10
        sprint2.description == "Fix what the first found"
    },
})

feature("the backlog is one order over the project's tasks at every depth: a move takes the middle of its gap, a closed gap or a missing rank numbers them all again", {
    when() {
        // PSP-1..4 at the top level, PSP-5 a parent of PSP-6
        task("Sign in", { estimatedPoints: 3 })
        task("Order list", { estimatedPoints: 5 })
        task("Order detail", { estimatedPoints: 2 })
        task("Search", { estimatedPoints: 1 })
        task("Settings")
        task("Settings page", { parentWorkEffortId: "PSP-5", estimatedPoints: 2 })
        // no ranks yet: everything numbered, PSP-4 first
        const first = call(`${TASK}.set#TaskBacklogRank`, { workEffortId: "PSP-4", nextWorkEffortId: "PSP-1" })
        const numbered = order()
        // the sub-item between two top-level items: the middle of the gap
        const middle = call(`${TASK}.set#TaskBacklogRank`, { workEffortId: "PSP-6", previousWorkEffortId: "PSP-1" })
        const afterMiddle = order()
        return { first, numbered, middle, afterMiddle, ranks: [we("PSP-4").sequenceNum, we("PSP-1").sequenceNum, we("PSP-6").sequenceNum, we("PSP-2").sequenceNum] }
    },
    then({ first, numbered, middle, afterMiddle, ranks }) {
        first.renumbered
        first.sequenceNum == 1000
        numbered == ["PSP-4", "PSP-1", "PSP-2", "PSP-3", "PSP-5", "PSP-6"]
        !middle.renumbered
        middle.sequenceNum == 2500
        afterMiddle == ["PSP-4", "PSP-1", "PSP-6", "PSP-2", "PSP-3", "PSP-5"]
        ranks == [1000, 2000, 2500, 3000]
    },
})

feature("start#Sprint begins a planned sprint with its items; another start is refused while it runs", {
    when() {
        ec.user.setEffectiveTime(at(2, 14))
        for (const id of ["PSP-1", "PSP-2", "PSP-3"]) call(`${TASK}.set#TaskSprint`, { workEffortId: id, sprintWorkEffortId: "PSP-SP-1" })
        const moved = call(`${TASK}.set#TaskSprint`, { workEffortId: "PSP-3", sprintWorkEffortId: "PSP-SP-1" })
        ec.user.setEffectiveTime(at(2, 15))
        const started = call(`${PROJECT}.start#Sprint`, { workEffortId: "PSP-SP-1" })
        const other = errorOf(`${PROJECT}.start#Sprint`, { workEffortId: "PSP-SP-2" })
        // a sprint not started has no actuals: its committed size is what is in it
        const planned = call(`${REPORT}.get#SprintBurndown`, { workEffortId: "PSP-SP-2" })
        // no scope-change rows for a sprint not yet started
        const audits = ec.entity.find("moqui.entity.EntityAuditLog").condition("changedEntityName", "mantle.work.effort.WorkEffortAssoc")
                .condition("pkPrimaryValue", "PSP-SP-1").count()
        return { moved, started, sprint: we("PSP-SP-1"), other, planned, audits }
    },
    then({ moved, started, sprint, other, planned, audits }) {
        !moved.changed
        started.itemCount == 3
        sprint.statusId == "WeInProgress"
        sprint.actualStartDate != null
        other.includes("Sprint 1 is in progress")
        planned.committed == 0
        planned.daysLeft == 10
        planned.dayList[1].remaining == null
        audits == 0
    },
})

feature("changes in a sprint in progress are its scope changes, with who made them; items finish day by day", {
    when() {
        ec.user.setEffectiveTime(at(3, 15))
        done("PSP-3")
        call(`${TASK}.set#TaskSprint`, { workEffortId: "PSP-4", sprintWorkEffortId: "PSP-SP-1" })
        call(`${TASK}.set#TaskSprint`, { workEffortId: "PSP-6", sprintWorkEffortId: "PSP-SP-1" })
        ec.user.setEffectiveTime(at(4, 15))
        done("PSP-4")
        call(`${TASK}.set#TaskSprint`, { workEffortId: "PSP-6", sprintWorkEffortId: null })
        ec.user.setEffectiveTime(at(5, 15))
        done("PSP-1")
        ec.user.setEffectiveTime(at(6, 15))
        const midway = call(`${REPORT}.get#SprintBurndown`, { workEffortId: "PSP-SP-1" })
        return { midway, backlog6: sprintOf("PSP-6") }
    },
    then({ midway, backlog6 }) {
        midway.estimateUnit == "points"
        midway.capacity == 12
        midway.committed == 10
        midway.added == 3
        midway.removed == 2
        midway.completed == 6
        midway.remaining == 5
        midway.doneCount == 3
        midway.itemCount == 4
        // Friday the 6th through Friday the 13th
        midway.daysLeft == 6
        midway.workDays == 10
        backlog6 == []
        midway.scopeChangeList.map((change) => `${change.workEffortId} ${change.change} ${change.userName}`) == ["PSP-4 added John Doe", "PSP-6 added John Doe", "PSP-6 removed John Doe"]
        // the start, then each day's end: 10 at the start, 11 after the 3rd (2 done, 3 added), 8, 5, then nothing yet
        midway.dayList.map((row) => row.remaining).slice(0, 6) == [10, 10, 11, 8, 5, 5]
        midway.dayList[7].remaining == null
        midway.dayList[0].ideal == 10
        midway.dayList[1].ideal == 9
        midway.dayList[12].ideal == 0
    },
})

feature("complete#Sprint keeps the done items and carries the open ones to the next sprint; the velocity counts it", {
    when() {
        ec.user.setEffectiveTime(at(13, 16))
        const completed = call(`${PROJECT}.complete#Sprint`, { workEffortId: "PSP-SP-1", carryTo: "next" })
        const burndown = call(`${REPORT}.get#SprintBurndown`, { workEffortId: "PSP-SP-1" })
        const intoClosed = errorOf(`${TASK}.set#TaskSprint`, { workEffortId: "PSP-5", sprintWorkEffortId: "PSP-SP-1" })
        const velocity = call(`${REPORT}.get#SprintVelocity`, { rootWorkEffortId: "PSP" })
        return { completed, sprint: we("PSP-SP-1"), burndown, intoClosed, velocity, two: sprintOf("PSP-2"), one: sprintOf("PSP-1") }
    },
    then({ completed, sprint, burndown, intoClosed, velocity, two, one }) {
        completed.doneCount == 3
        completed.notDoneCount == 1
        completed.carriedToSprintId == "PSP-SP-2"
        completed.carriedIds == ["PSP-2"]
        sprint.statusId == "WeComplete"
        sprint.actualCompletionDate != null
        // the done items stay in it; the open one went on
        one == ["PSP-SP-1"]
        two == ["PSP-SP-2"]
        burndown.completed == 6
        burndown.carriedOver == 5
        burndown.remaining == 5
        burndown.daysLeft == 0
        burndown.dayList[burndown.dayList.length - 1].remaining == 5
        burndown.itemList.find((item) => item.workEffortId == "PSP-2").outcome == "carried"
        burndown.itemList.find((item) => item.workEffortId == "PSP-6").outcome == "removed"
        intoClosed.includes("is complete and takes no more items")
        velocity.sprintList.map((row) => row.workEffortId) == ["PSP-SP-1"]
        velocity.sprintList[0].committed == 10
        velocity.sprintList[0].completed == 6
        velocity.sprintList[0].carriedOver == 5
        velocity.averageCompleted == 6
    },
})

feature("a project that allows several sprints starts two at once; open items go to a new sprint or the backlog", {
    when() {
        ec.user.setEffectiveTime(at(16, 15))
        call(`${PROJECT}.start#Sprint`, { workEffortId: "PSP-SP-2" })
        const third = call(`${PROJECT}.create#Sprint`, { rootWorkEffortId: "PSP" }).workEffortId
        call(`${PROJECT}.store#ProjectSetting`, { workEffortId: "PSP", settingTypeEnumId: "WstSeveralSprints", settingValue: "Y" })
        call(`${PROJECT}.start#Sprint`, { workEffortId: third })
        call(`${TASK}.set#TaskSprint`, { workEffortId: "PSP-6", sprintWorkEffortId: third })
        ec.user.setEffectiveTime(at(27, 16))
        const toNew = call(`${PROJECT}.complete#Sprint`, { workEffortId: third, carryTo: "new", newSprintName: "Leftovers" })
        const toBacklog = call(`${PROJECT}.complete#Sprint`, { workEffortId: "PSP-SP-2", carryTo: "backlog" })
        return { third, toNew, toBacklog, made: we(toNew.carriedToSprintId), six: sprintOf("PSP-6"), two: sprintOf("PSP-2") }
    },
    then({ third, toNew, toBacklog, made, six, two }) {
        third == "PSP-SP-3"
        toNew.carriedToSprintId == "PSP-SP-4"
        made.workEffortName == "Leftovers"
        made.statusId == "WeInPlanning"
        six == ["PSP-SP-4"]
        toBacklog.carriedToSprintId == null
        toBacklog.carriedIds == ["PSP-2"]
        two == []
    },
})
