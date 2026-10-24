// The project hub of IronStone Projects in mantle.work.ProjectServices and TaskServices (design-projects.md §3, §4, §12 and
// §15, impl-projects.md P2): a status update (post#ProjectUpdate: the StatusUpdate message on the project's Chatter, the
// WorkEffortUpdate row, the project's health, the ProjectStatusUpdate notification to the other members); the project's
// activity (get#ProjectActivity: status changes, comments and updates, newest first and paged, a Restricted item left out
// for a member who is not its party); the counters of Projects Home (get#ProjectHomeCounts); the labels (create#Label,
// update#Label, merge#Labels, delete#Label); and the templates (create#ProjectTemplate from a project and blank,
// get#ProjectTemplates with its uses, clone#Project copying the settings but not the public form token). New spec, no
// Groovy original.
const effectiveTime = Date.now()
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
    cleanupSpec() {
        // john.doe's assignments on the spec's tasks end: left open, the late one is on his Today in the specs after this one
        ec.artifactExecution.disableAuthz()
        try {
            const taskIds = Array.from(ec.entity.find("mantle.work.effort.WorkEffort").condition("rootWorkEffortId", "PHA")
                    .condition("workEffortTypeEnumId", "WetTask").list()).map((row) => row.workEffortId)
            if (taskIds.length) ec.entity.find("mantle.work.effort.WorkEffortParty").condition("workEffortId", "in", taskIds)
                    .condition("partyId", "EX_JOHN_DOE").condition("thruDate", null).updateAll({ thruDate: ec.user.nowTimestamp })
        } finally { ec.artifactExecution.enableAuthz() }
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
const homeCounts = (managers) => call(`${PROJECT}.get#ProjectHomeCounts`, { managers: !!managers })

feature("a project with a member who has a user, and work items", {
    when() {
        const partyId = call("mantle.party.PartyServices.create#Person", { firstName: "Hana", lastName: "Hub" }).partyId
        call("mantle.party.PartyServices.create#PartyUserAccount", { partyId, emailAddress: "ph.hana@example.com", username: "ph.hana",
                newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" })
        parties.Hana = partyId
        call(`${PROJECT}.create#Project`, { workEffortId: "PHA", workEffortName: "Hub project", visibilityEnumId: "WevWorkGroup",
                assignToPartyId: partyId, assignRoleTypeId: "Programmer" })
        task("PHA", "First item")
        task("PHA", "Second item")
        task("PHA", "Hana's restricted item", { visibilityEnumId: "WevRestricted", assignToPartyId: partyId })
        return { project: we("PHA") }
    },
    then({ project }) {
        project.workEffortTypeEnumId == "WetProject"
    },
})

feature("post#ProjectUpdate puts the update on the project's Chatter, sets its health and tells the other members", {
    when() {
        const out = call(`${PROJECT}.post#ProjectUpdate`, { workEffortId: "PHA", healthEnumId: "WehAtRisk", percentComplete: 30,
                body: "The **API** is late by a week.", clientVisible: "Y" })
        const event = ec.entity.find("mantle.party.communication.CommunicationEvent").condition("communicationEventId", out.communicationEventId).one()
        const link = ec.entity.find("mantle.work.effort.WorkEffortCommEvent").condition("workEffortId", "PHA")
                .condition("communicationEventId", out.communicationEventId).one()
        const update = ec.entity.find("mantle.work.effort.WorkEffortUpdate").condition("workEffortId", "PHA")
                .condition("communicationEventId", out.communicationEventId).one()
        const notes = Array.from(ec.entity.find("moqui.security.user.NotificationMessage").condition("topic", "ProjectStatusUpdate").list())
                .filter((row) => { try { return JSON.parse(row.messageJson).workEffortId === "PHA" } catch (e) { return false } })
        return { event, link, update, project: we("PHA"), notes }
    },
    then({ event, link, update, project, notes }) {
        event.communicationEventTypeId == "StatusUpdate"
        event.subject == "Status update: At Risk"
        event.body == "The **API** is late by a week."
        event.contentType == "text/markdown"
        event.fromPartyId == "EX_JOHN_DOE"
        link != null
        update.healthEnumId == "WehAtRisk"
        update.percentComplete == 30
        update.clientVisible == "Y"
        project.healthEnumId == "WehAtRisk"
        // Hana is told, john.doe (who posted) is not
        notes.length == 1
        notes[0].titleText.includes("Hub project is At Risk")
    },
})

feature("get#ProjectActivity: the status changes, comments and updates of the project, newest first and paged", {
    when() {
        call("update#mantle.work.effort.WorkEffort", { workEffortId: "PHA-1", statusId: "WeInProgress" })
        call(`${TASK}.add#TaskComment`, { workEffortId: "PHA-2", body: "Needs the design first." })
        call("update#mantle.work.effort.WorkEffort", { workEffortId: "PHA-3", statusId: "WeInProgress" })
        const all = call(`${PROJECT}.get#ProjectActivity`, { workEffortId: "PHA", pageSize: 50 })
        const page = call(`${PROJECT}.get#ProjectActivity`, { workEffortId: "PHA", pageSize: 2 })
        const comments = call(`${PROJECT}.get#ProjectActivity`, { workEffortId: "PHA", kinds: "comment" })
        return { all, page, comments }
    },
    then({ all, page, comments }) {
        const list = Array.from(all.activityList)
        list.some((entry) => entry.kind === "status" && entry.workEffortId === "PHA-1" && entry.title === "In Planning to In Progress")
        list.some((entry) => entry.kind === "comment" && entry.workEffortId === "PHA-2" && entry.text === "Needs the design first.")
        list.some((entry) => entry.kind === "update" && entry.workEffortId === "PHA" && entry.title === "Status update: At Risk")
        list.every((entry, i) => i === 0 || entry.date <= list[i - 1].date)
        Array.from(all.failedSources).length == 0
        Array.from(page.activityList).length == 2
        page.hasMore == true
        Array.from(comments.activityList).every((entry) => entry.kind === "comment")
    },
})

feature("get#ProjectActivity leaves out a Restricted item for a member who is not its party and does not manage the project", {
    when() {
        const partyId = call("mantle.party.PartyServices.create#Person", { firstName: "Ivo", lastName: "Hub" }).partyId
        call("mantle.party.PartyServices.create#PartyUserAccount", { partyId, emailAddress: "ph.ivo@example.com", username: "ph.ivo",
                newPassword: "moqui1!!", newPasswordVerify: "moqui1!!" })
        call("mantle.work.WorkEffortServices.add#WorkEffortParty", { workEffortId: "PHA", partyId, roleTypeId: "Programmer", statusId: "WeptAssigned" })
        login("ph.ivo", "moqui1!!")
        try {
            const out = call(`${PROJECT}.get#ProjectActivity`, { workEffortId: "PHA", pageSize: 50 })
            return { ids: Array.from(out.activityList).map((entry) => entry.workEffortId) }
        } finally { login("john.doe") }
    },
    then({ ids }) {
        ids.includes("PHA-1")
        !ids.includes("PHA-3")
    },
})

feature("get#ProjectHomeCounts: my open, due this week and overdue items, my hours this week, and the projects at risk and milestones soon I manage", {
    when() {
        const before = homeCounts(true)
        task("PHA", "Due soon", { assignToPartyId: "EX_JOHN_DOE", estimatedCompletionDate: effectiveTime + 2 * dayMillis })
        task("PHA", "Late", { assignToPartyId: "EX_JOHN_DOE", estimatedCompletionDate: effectiveTime - 3 * dayMillis })
        task("PHA", "Some day", { assignToPartyId: "EX_JOHN_DOE" })
        call("create#mantle.work.time.TimeEntry", { partyId: "EX_JOHN_DOE", workEffortId: "PHA-1", fromDate: effectiveTime, hours: 2.5 })
        call(`${PROJECT}.create#Milestone`, { rootWorkEffortId: "PHA", workEffortId: "PHA-MS-1", workEffortName: "Beta",
                estimatedCompletionDate: effectiveTime + 5 * dayMillis })
        const after = homeCounts(true)
        const team = homeCounts(false)
        return { before: before.counts, after: after.counts, atRisk: Array.from(after.atRiskProjectIds), failed: Array.from(after.failedParts), team: team.counts }
    },
    then({ before, after, atRisk, failed, team }) {
        after.myOpen == before.myOpen + 3
        after.dueWeek == before.dueWeek + 1
        after.overdue == before.overdue + 1
        Math.round((after.hoursWeek - before.hoursWeek) * 10) == 25
        atRisk.includes("PHA")
        after.milestonesSoon == before.milestonesSoon + 1
        // the reviews waiting are the git hosting's (none asked of john.doe here); the unbilled amount is for one who manages money (P8a)
        after.reviewsWaiting == null || typeof after.reviewsWaiting == "number"
        after.unbilledAmount != null
        team.unbilledAmount == null
        failed.length == 0
        team.projectsAtRisk == null
        team.myOpen == after.myOpen
    },
})

feature("labels: made with a color, a name the organization has already refused, renamed, merged into another and deleted", {
    when() {
        const ui = call(`${TASK}.create#Label`, { description: "PH UI", colorName: "blue", ownerPartyId: "EX_JOHN_DOE" }).workEffortCategoryId
        const front = call(`${TASK}.create#Label`, { description: "PH Front end", colorName: "teal", ownerPartyId: "EX_JOHN_DOE" }).workEffortCategoryId
        const dup = errorOf(`${TASK}.create#Label`, { description: "ph ui", colorName: "blue", ownerPartyId: "EX_JOHN_DOE" })
        call(`${TASK}.add#TaskLabel`, { workEffortId: "PHA-1", workEffortCategoryId: ui })
        call(`${TASK}.add#TaskLabel`, { workEffortId: "PHA-2", workEffortCategoryId: ui })
        call(`${TASK}.add#TaskLabel`, { workEffortId: "PHA-2", workEffortCategoryId: front })
        call(`${TASK}.update#Label`, { workEffortCategoryId: front, description: "PH Front", colorName: "green" })
        const merged = call(`${TASK}.merge#Labels`, { fromCategoryId: ui, intoCategoryId: front })
        const applied = Array.from(ec.entity.find("mantle.work.effort.WorkEffortCategoryAppl").condition("workEffortCategoryId", front).orderBy("workEffortId").list())
                .map((row) => row.workEffortId)
        const frontRow = ec.entity.find("mantle.work.effort.WorkEffortCategory").condition("workEffortCategoryId", front).one()
        const uiGone = ec.entity.find("mantle.work.effort.WorkEffortCategory").condition("workEffortCategoryId", ui).one() == null
        const deleted = call(`${TASK}.delete#Label`, { workEffortCategoryId: front })
        return { dup, merged, applied, frontRow, uiGone, deleted, frontGone: ec.entity.find("mantle.work.effort.WorkEffortCategoryAppl")
                .condition("workEffortCategoryId", front).count() == 0 }
    },
    then({ dup, merged, applied, frontRow, uiGone, deleted, frontGone }) {
        dup.includes("already")
        merged.itemCount == 1
        applied == ["PHA-1", "PHA-2"]
        frontRow.description == "PH Front"
        frontRow.colorName == "green"
        uiGone
        deleted.itemCount == 2
        frontGone
    },
})

feature("templates: one saved from a project, a blank one, both listed with their counts, and a project made from one is a use", {
    when() {
        call(`${PROJECT}.store#ProjectSetting`, { workEffortId: "PHA", settingTypeEnumId: "WstModules", settingValue: "time" })
        call(`${PROJECT}.store#ProjectSetting`, { workEffortId: "PHA", settingTypeEnumId: "WstIntakeToken", settingValue: "secret-token" })
        call(`${PROJECT}.create#ProjectTemplate`, { baseWorkEffortId: "PHA", workEffortId: "PHT", workEffortName: "PH hub template" })
        call(`${PROJECT}.create#ProjectTemplate`, { workEffortId: "PHB", workEffortName: "PH blank template" })
        call(`${PROJECT}.clone#Project`, { baseWorkEffortId: "PHT", workEffortId: "PHC", workEffortName: "From the template" })
        const list = Array.from(call(`${PROJECT}.get#ProjectTemplates`, {}).templateList).filter((row) => String(row.workEffortId).startsWith("PH"))
        const settings = (id) => Object.fromEntries(Array.from(ec.entity.find("mantle.work.effort.WorkEffortSetting").condition("workEffortId", id).list())
                .map((row) => [row.settingTypeEnumId, row.settingValue]))
        return { list, template: we("PHT"), copy: we("PHC"), templateSettings: settings("PHT"), copySettings: settings("PHC"),
            templateItems: Array.from(ec.entity.find("mantle.work.effort.WorkEffort").condition("rootWorkEffortId", "PHT").condition("workEffortTypeEnumId", "WetTask").list()) }
    },
    then({ list, template, copy, templateSettings, copySettings, templateItems }) {
        template.isTemplate == "Y"
        copy.isTemplate == "N"
        templateItems.length == 6
        templateItems.every((item) => item.statusId === "WeInPlanning")
        templateSettings.WstModules == "time"
        templateSettings.WstIntakeToken == null
        copySettings.WstModules == "time"
        const hub = list.find((row) => row.workEffortId === "PHT")
        hub.itemCount == 6
        hub.milestoneCount == 1
        hub.usedCount == 1
        list.find((row) => row.workEffortId === "PHB").itemCount == 0
    },
})
