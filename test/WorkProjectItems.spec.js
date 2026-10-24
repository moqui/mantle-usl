// IronStone Projects work items in mantle.work.TaskServices and ProjectServices (design-projects.md §5 and §15 Work model,
// impl-projects.md P2): the work item tree one level at a time with roll-ups and the ancestors of matches
// (get#WorkItemTree), and only for users who see the project; moves in the tree (move#Task, set#TaskRank with gaps of
// 1000); the status along the task's or the project's flow, the development flow included (set#TaskStatus,
// get#TaskStatusFlow, complete#TaskFromCommit); plan items, labels; a task moved to another project with its subtree
// (update#Task); recurring tasks (set#TaskRecurrence, make#NextRecurringTask through the status rule); and the
// WorkItemAssigned notification. New spec, no Groovy original.
const effectiveTime = Date.UTC(2026, 10, 2, 15, 0, 0)
const dayMillis = 86400000
const TASK = "mantle.work.TaskServices"
const PROJECT = "mantle.work.ProjectServices"
const parties = {}

spec({
    stepwise: true,
    setupSpec() {
        login("john.doe")
        ec.user.setEffectiveTime(effectiveTime)
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
const task = (root, name, more) => call(`${TASK}.create#Task`, Object.assign({ rootWorkEffortId: root, workEffortName: name }, more || {})).workEffortId
const tree = (params) => call(`${PROJECT}.get#WorkItemTree`, params)
const ids = (out) => Array.from(out.workItemList || []).map((row) => row.workEffortId)
const byId = (out) => Object.fromEntries(Array.from(out.workItemList || []).map((row) => [row.workEffortId, row]))
const ranks = (parentId) => Array.from(ec.entity.find("mantle.work.effort.WorkEffort").condition("parentWorkEffortId", parentId)
        .orderBy("sequenceNum").list()).map((row) => `${row.workEffortId}:${row.sequenceNum}`)
const assocs = (toId, type) => Array.from(ec.entity.find("mantle.work.effort.WorkEffortAssoc").condition("toWorkEffortId", toId)
        .condition("workEffortAssocTypeEnumId", type).conditionDate("fromDate", "thruDate", null).list()).map((row) => row.workEffortId)

feature("a project's work item tree: one level in rank order with each row's roll-up", {
    when() {
        call(`${PROJECT}.create#Project`, { workEffortId: "PWI", workEffortName: "Work items project", visibilityEnumId: "WevWorkGroup",
                statusFlowId: "WorkEffortDevelopment" })
        // PWI-1 epic > PWI-2 feature > PWI-3, PWI-4; PWI-1 > PWI-5 (cancelled); PWI-6 top level
        task("PWI", "Epic", { estimatedWorkTime: 2, totalTimeAllowed: 40 })
        task("PWI", "Feature", { parentWorkEffortId: "PWI-1", estimatedWorkTime: 1, sequenceNum: 1000 })
        task("PWI", "Story A", { parentWorkEffortId: "PWI-2", estimatedWorkTime: 6, remainingWorkTime: 2, actualWorkTime: 5, sequenceNum: 2000 })
        task("PWI", "Story B", { parentWorkEffortId: "PWI-2", estimatedWorkTime: 4, sequenceNum: 1000, statusId: "WeComplete" })
        task("PWI", "Dropped", { parentWorkEffortId: "PWI-1", estimatedWorkTime: 50, statusId: "WeCancelled", sequenceNum: 2000 })
        task("PWI", "Loose end", { estimatedWorkTime: 3 })
        return { top: tree({ rootWorkEffortId: "PWI", topLevel: true }), level: tree({ parentWorkEffortId: "PWI-2" }),
            found: tree({ workEffortIds: "PWI-3", withAncestors: true }), open: tree({ parentWorkEffortId: "PWI-2", statusId: "WeInPlanning" }) }
    },
    then({ top, level, found, open }) {
        ids(top) == ["PWI-1", "PWI-6"]
        // the epic: its own 2 hours, the feature's 1, the stories' 6 and 4; the cancelled item left out
        byId(top)["PWI-1"].totalEstimatedWorkTime == 13
        byId(top)["PWI-1"].totalBudget == 40
        byId(top)["PWI-1"].childCount == 2
        byId(top)["PWI-1"].itemCount == 3
        byId(top)["PWI-1"].doneCount == 1
        byId(top)["PWI-6"].childCount == 0
        byId(top)["PWI-6"].depth == 0
        top.totals.totalEstimatedWorkTime == 16
        // a level in rank order: Story B (1000) before Story A (2000)
        ids(level) == ["PWI-4", "PWI-3"]
        byId(level)["PWI-3"].depth == 2
        byId(level)["PWI-3"].percentDone == 67
        // a match with its ancestors first, from the top down
        ids(found) == ["PWI-1", "PWI-2", "PWI-3"]
        ids(open) == ["PWI-3"]
    },
})

feature("a Work group project's tree is not seen by a user who is not on it", {
    when() {
        const partyId = call("mantle.party.PartyServices.create#Person", { firstName: "Wendy", lastName: "Items" }).partyId
        parties.Wendy = partyId
        call("mantle.party.PartyServices.create#PartyUserAccount", { partyId, emailAddress: "pwi.wendy@example.com", username: "pwi.wendy",
                newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" })
        login("pwi.wendy", "moqui1!!")
        const outside = { top: tree({ rootWorkEffortId: "PWI", topLevel: true }), level: tree({ parentWorkEffortId: "PWI-1" }),
            found: tree({ workEffortIds: ["PWI-3"], withAncestors: true }) }
        login("john.doe")
        call("mantle.work.WorkEffortServices.add#WorkEffortParty", { workEffortId: "PWI", partyId, roleTypeId: "Programmer", statusId: "WeptAssigned" })
        login("pwi.wendy", "moqui1!!")
        const member = tree({ rootWorkEffortId: "PWI", topLevel: true })
        login("john.doe")
        return { outside, member }
    },
    then({ outside, member }) {
        ids(outside.top) == []
        ids(outside.level) == []
        ids(outside.found) == []
        ids(member) == ["PWI-1", "PWI-6"]
    },
})

feature("move#Task re-parents a task in its project and ranks it; a move under itself or its subtree is refused", {
    when() {
        call(`${PROJECT}.create#Project`, { workEffortId: "PWX", workEffortName: "Other project" })
        task("PWX", "Elsewhere")
        // PWI-6 under the feature, after Story B
        const moved = call(`${TASK}.move#Task`, { workEffortId: "PWI-6", parentWorkEffortId: "PWI-2", previousSiblingId: "PWI-4" })
        const afterMove = ranks("PWI-2")
        // the epic under its own story
        const intoOwn = errorOf(`${TASK}.move#Task`, { workEffortId: "PWI-1", parentWorkEffortId: "PWI-3" })
        // to the top, first
        call(`${TASK}.move#Task`, { workEffortId: "PWI-3", parentWorkEffortId: null, previousSiblingId: null })
        const top = ids(tree({ rootWorkEffortId: "PWI", topLevel: true }))
        const audit = Array.from(ec.entity.find("moqui.entity.EntityAuditLog").condition("changedEntityName", "mantle.work.effort.WorkEffort")
                .condition("changedFieldName", "parentWorkEffortId").condition("pkPrimaryValue", "PWI-6").list())
        return { moved, afterMove, intoOwn, top, audit, pwi6: we("PWI-6") }
    },
    then({ moved, afterMove, intoOwn, top, audit, pwi6 }) {
        moved.oldParentWorkEffortId == null
        moved.sequenceNum == 1500
        afterMove == ["PWI-4:1000", "PWI-6:1500", "PWI-3:2000"]
        intoOwn.includes("cannot go under itself or one of its sub-items")
        top[0] == "PWI-3"
        pwi6.parentWorkEffortId == "PWI-2"
        audit.length == 1
        audit[0].newValueText == "PWI-2"
    },
})

feature("set#TaskRank numbers the siblings again when a gap closes or a rank is missing", {
    when() {
        for (const name of ["R1", "R2", "R3"]) task("PWI", name, { parentWorkEffortId: "PWI-4" })
        // no ranks yet: numbered 1000, 2000, 3000 with PWI-9 first
        const first = call(`${TASK}.set#TaskRank`, { workEffortId: "PWI-9", previousSiblingId: null })
        const numbered = ranks("PWI-4")
        call("update#mantle.work.effort.WorkEffort", { workEffortId: "PWI-8", sequenceNum: 1001 })
        // between 1000 and 1001: no gap left
        const closed = call(`${TASK}.set#TaskRank`, { workEffortId: "PWI-7", previousSiblingId: "PWI-9" })
        const afterClosed = ranks("PWI-4")
        // at the end: the last plus 1000
        const last = call(`${TASK}.set#TaskRank`, { workEffortId: "PWI-9", previousSiblingId: "PWI-8" })
        return { first, numbered, closed, afterClosed, last }
    },
    then({ first, numbered, closed, afterClosed, last }) {
        first.renumbered == true
        numbered == ["PWI-9:1000", "PWI-7:2000", "PWI-8:3000"]
        closed.renumbered == true
        afterClosed == ["PWI-9:1000", "PWI-7:2000", "PWI-8:3000"]
        last.renumbered == false
        last.sequenceNum == 4000
    },
})

feature("the status follows the project's development flow: review and testing, a refused skip, the resolution", {
    when() {
        const flow = call(`${TASK}.get#TaskStatusFlow`, { workEffortId: "PWI-6" })
        const skip = errorOf(`${TASK}.set#TaskStatus`, { workEffortId: "PWI-6", statusId: "WeInReview" })
        call(`${TASK}.set#TaskStatus`, { workEffortId: "PWI-6", statusId: "WeInProgress" })
        call(`${TASK}.set#TaskStatus`, { workEffortId: "PWI-6", statusId: "WeInReview" })
        const inReview = we("PWI-6").statusId
        call(`${TASK}.set#TaskStatus`, { workEffortId: "PWI-6", statusId: "WeInTesting" })
        call(`${TASK}.set#TaskStatus`, { workEffortId: "PWI-6", statusId: "WeComplete", resolutionEnumId: "WerDuplicate" })
        const completed = we("PWI-6")
        call(`${TASK}.set#TaskStatus`, { workEffortId: "PWI-6", statusId: "WeInProgress" })
        const reopened = we("PWI-6")
        // a commit naming a task in review completes it, the development flow allowing it
        call(`${TASK}.set#TaskStatus`, { workEffortId: "PWI-6", statusId: "WeInReview" })
        const fromCommit = call("mantle.work.GitServices.complete#TaskFromCommit", { workEffortId: "PWI-6", commitId: "abc123" })
        // a task of a Default project: no review
        const defaultFlow = call(`${TASK}.get#TaskStatusFlow`, { workEffortId: "PWX-1" })
        return { flow, skip, inReview, completed, reopened, fromCommit, afterCommit: we("PWI-6"), defaultFlow }
    },
    then({ flow, skip, inReview, completed, reopened, fromCommit, afterCommit, defaultFlow }) {
        flow.statusFlowId == "WorkEffortDevelopment"
        flow.flowStatusIds.includes("WeInReview")
        flow.transitionList.map((row) => row.toStatusId).includes("WeInProgress")
        !flow.transitionList.map((row) => row.toStatusId).includes("WeComplete")
        skip.includes("Status change not allowed from In Planning to In Review")
        inReview == "WeInReview"
        completed.statusId == "WeComplete"
        completed.resolutionEnumId == "WerDuplicate"
        completed.actualCompletionDate != null
        reopened.resolutionEnumId == "WerUnresolved"
        reopened.actualCompletionDate == null
        fromCommit.completed == true
        afterCommit.statusId == "WeComplete"
        defaultFlow.statusFlowId == "Default"
        !defaultFlow.flowStatusIds.includes("WeInReview")
        defaultFlow.flowStatusIds == ["WeInPlanning", "WeApproved", "WeInProgress", "WeOnHold", "WeComplete", "WeClosed", "WeCancelled"]
    },
})

feature("plan items and labels: a release of the project, not of another; a label applied and taken off", {
    when() {
        call("create#mantle.work.effort.WorkEffort", { workEffortId: "PWI-REL-1", workEffortTypeEnumId: "WetRelease", rootWorkEffortId: "PWI", workEffortName: "1.0" })
        call("create#mantle.work.effort.WorkEffort", { workEffortId: "PWX-REL-1", workEffortTypeEnumId: "WetRelease", rootWorkEffortId: "PWX", workEffortName: "X 1.0" })
        call("create#mantle.work.effort.WorkEffortCategory", { workEffortCategoryId: "PWI_LBL", categoryTypeEnumId: "WcatLabel", description: "Backend" })
        call(`${TASK}.set#TaskRelease`, { workEffortId: "PWI-3", releaseWorkEffortId: "PWI-REL-1" })
        const inRelease = assocs("PWI-3", "WeatRelease")
        const otherProject = errorOf(`${TASK}.set#TaskRelease`, { workEffortId: "PWI-3", releaseWorkEffortId: "PWX-REL-1" })
        call(`${TASK}.set#TaskRelease`, { workEffortId: "PWI-3", releaseWorkEffortId: null })
        const cleared = assocs("PWI-3", "WeatRelease")
        call(`${TASK}.set#TaskRelease`, { workEffortId: "PWI-3", releaseWorkEffortId: "PWI-REL-1" })
        call(`${TASK}.add#TaskLabel`, { workEffortId: "PWI-3", workEffortCategoryId: "PWI_LBL" })
        call(`${TASK}.add#TaskLabel`, { workEffortId: "PWI-3", workEffortCategoryId: "PWI_LBL" })
        const labelled = ec.entity.find("mantle.work.effort.WorkEffortCategoryAppl").condition("workEffortId", "PWI-3").count()
        call(`${TASK}.add#TaskLabel`, { workEffortId: "PWI-4", workEffortCategoryId: "PWI_LBL" })
        call(`${TASK}.remove#TaskLabel`, { workEffortId: "PWI-4", workEffortCategoryId: "PWI_LBL" })
        return { inRelease, otherProject, cleared, labelled,
            removed: ec.entity.find("mantle.work.effort.WorkEffortCategoryAppl").condition("workEffortId", "PWI-4").count() }
    },
    then({ inRelease, otherProject, cleared, labelled, removed }) {
        inRelease == ["PWI-REL-1"]
        otherProject.includes("is not a plan item of the project")
        cleared == []
        labelled == 1
        removed == 0
    },
})

feature("a task moved to another project takes its subtree, leaves its parent and the old project's plan items", {
    when() {
        // PWI-3 (top level now, in the release) with a child; PWI-7 under PWI-4
        task("PWI", "Child of A", { parentWorkEffortId: "PWI-3", workEffortId: "PWI-3A" })
        call(`${TASK}.update#Task`, { workEffortId: "PWI-3", rootWorkEffortId: "PWX" })
        call(`${TASK}.update#Task`, { workEffortId: "PWI-7", rootWorkEffortId: "PWX" })
        return { a: we("PWI-3"), child: we("PWI-3A"), seven: we("PWI-7"), release: assocs("PWI-3", "WeatRelease") }
    },
    then({ a, child, seven, release }) {
        a.rootWorkEffortId == "PWX"
        child.rootWorkEffortId == "PWX"
        child.parentWorkEffortId == "PWI-3"
        seven.rootWorkEffortId == "PWX"
        seven.parentWorkEffortId == null
        release == []
    },
})

feature("a recurring task: the next is made when one completes, on the rule's next date, and when one is skipped; none after the rule stops", {
    when() {
        const due = Date.UTC(2026, 10, 2, 17, 0, 0)
        const first = task("PWX", "Monthly report", { estimatedCompletionDate: due, estimatedStartDate: due - 2 * 3600000, assignToPartyId: parties.Wendy,
                priority: 3, estimatedWorkTime: 2 })
        call(`${TASK}.add#TaskLabel`, { workEffortId: first, workEffortCategoryId: "PWI_LBL" })
        call(`${TASK}.set#TaskRecurrence`, { workEffortId: first, rrule: "RRULE:FREQ=MONTHLY;BYMONTHDAY=2", timeZone: "UTC" })
        call(`${TASK}.set#TaskStatus`, { workEffortId: first, statusId: "WeComplete" })
        const link1 = Array.from(ec.entity.find("mantle.work.effort.WorkEffortAssoc").condition("workEffortId", first)
                .condition("workEffortAssocTypeEnumId", "WeatRecurrenceInstance").list())
        const second = link1[0]?.toWorkEffortId
        const secondRow = we(second)
        // completed again after a reopen: no second copy
        call(`${TASK}.set#TaskStatus`, { workEffortId: first, statusId: "WeInProgress" })
        call(`${TASK}.set#TaskStatus`, { workEffortId: first, statusId: "WeComplete" })
        const afterAgain = ec.entity.find("mantle.work.effort.WorkEffortAssoc").condition("workEffortId", first)
                .condition("workEffortAssocTypeEnumId", "WeatRecurrenceInstance").count()
        // skipped: cancelled, the next one comes
        call(`${TASK}.set#TaskStatus`, { workEffortId: second, statusId: "WeCancelled" })
        const links = Array.from(ec.entity.find("mantle.work.effort.WorkEffortAssoc").condition("workEffortId", first)
                .condition("workEffortAssocTypeEnumId", "WeatRecurrenceInstance").orderBy("fromDate").list())
        const third = links[1]?.toWorkEffortId
        // stop repeating (from an instance): the rule is gone, completing makes nothing
        call(`${TASK}.set#TaskRecurrence`, { workEffortId: third, rrule: "" })
        call(`${TASK}.set#TaskStatus`, { workEffortId: third, statusId: "WeInProgress" })
        call(`${TASK}.set#TaskStatus`, { workEffortId: third, statusId: "WeComplete" })
        return { secondRow, second, afterAgain, third: we(third), linkCount: links.length,
            finalCount: ec.entity.find("mantle.work.effort.WorkEffortAssoc").condition("workEffortId", first)
                .condition("workEffortAssocTypeEnumId", "WeatRecurrenceInstance").count(),
            rule: ec.entity.find("mantle.work.effort.WorkEffortRecurrence").condition("workEffortId", first).one(),
            assignees: Array.from(ec.entity.find("mantle.work.effort.WorkEffortParty").condition("workEffortId", second).condition("roleTypeId", "Assignee").list()).map((row) => row.partyId),
            labels: ec.entity.find("mantle.work.effort.WorkEffortCategoryAppl").condition("workEffortId", second).count() }
    },
    then({ secondRow, second, afterAgain, third, linkCount, finalCount, rule, assignees, labels }) {
        secondRow.workEffortName == "Monthly report"
        secondRow.statusId == "WeInPlanning"
        secondRow.rootWorkEffortId == "PWX"
        Number(String(secondRow.estimatedCompletionDate)) == Date.UTC(2026, 11, 2, 17, 0, 0)
        Number(String(secondRow.estimatedStartDate)) == Date.UTC(2026, 11, 2, 15, 0, 0)
        secondRow.priority == 3
        afterAgain == 1
        linkCount == 2
        Number(String(third.estimatedCompletionDate)) == Date.UTC(2027, 0, 2, 17, 0, 0)
        finalCount == 2
        rule == null
        assignees == [parties.Wendy]
        labels == 1
    },
})

feature("a task repeating from its completion: the next is due a week after the day it was completed, not after its due date", {
    when() {
        const due = Date.UTC(2026, 9, 20, 17, 0, 0)
        const late = task("PWX", "Weekly backup check", { estimatedCompletionDate: due })
        call(`${TASK}.set#TaskRecurrence`, { workEffortId: late, rrule: "FREQ=WEEKLY", recurFromCompletion: "Y", timeZone: "UTC" })
        // completed on Nov 2 (the effective time), two weeks late
        call(`${TASK}.set#TaskStatus`, { workEffortId: late, statusId: "WeComplete" })
        const link = Array.from(ec.entity.find("mantle.work.effort.WorkEffortAssoc").condition("workEffortId", late)
                .condition("workEffortAssocTypeEnumId", "WeatRecurrenceInstance").list())[0]
        return { next: link ? we(link.toWorkEffortId) : null }
    },
    then({ next }) {
        next != null
        Number(String(next.estimatedCompletionDate)) == Date.UTC(2026, 10, 9, 17, 0, 0)
    },
})

feature("a party assigned to a task of a project is told on WorkItemAssigned, not when assigning themselves", {
    when() {
        const messages = () => Array.from(ec.entity.find("moqui.security.user.NotificationMessage").condition("topic", "WorkItemAssigned").list())
        const about = (id) => messages().filter((row) => { try { return JSON.parse(row.messageJson).workEffortId === id } catch (e) { return false } })
        const assigned = task("PWI", "For Wendy", { assignToPartyId: parties.Wendy })
        // john.doe assigns himself: no notification
        const mine = task("PWI", "For me", { assignToPartyId: "EX_JOHN_DOE" })
        return { toWendy: about(assigned), toMe: about(mine) }
    },
    then({ toWendy, toMe }) {
        toWendy.length == 1
        toWendy[0].titleText.includes("For Wendy")
        toWendy[0].recordId == toWendy[0].recordId
        toMe.length == 0
    },
})
