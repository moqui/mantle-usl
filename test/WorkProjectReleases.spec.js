// IronStone Projects milestones, releases and documentation in mantle.work.ProjectServices (design-projects.md §4 Roadmap,
// MilestoneDetail, ReleaseDetail and ProjectDocs, §15 Releases and components, Release notes, Wiki space in a repository;
// impl-projects.md P4b): plan item ids (get#PlanItemDefaults, create#Milestone, create#Release, create#Component), their
// changes (update#Milestone), progress from their items (get#PlanItemSummary), a release's notes drafted from its items and
// merged merge requests (generate#ReleaseNotes), kept (store#, get#ReleaseNotes) and published (publish#ReleaseNotes), the
// release itself (release#Release: unfinished items to the next release, a tag, the notes), and a project's documentation
// space in its repository at git://<repository>/docs or on database files (create#ProjectDocsSpace) whose users follow the
// project's members (sync#ProjectDocsSpaceUsers, the rule on WorkEffortParty). New spec, no Groovy original.
// Run: ./moq test mantle-usl --spec WorkProjectReleases
const PROJECT = "PRL"
const PS = "mantle.work.ProjectServices"
const TASK = "mantle.work.TaskServices"
const JOHN = "EX_JOHN_DOE"
const JOE = "ORG_ZIZI_JD"
const BOB = "ORG_ZIZI_BD"
const repositoryId = "prl-code"
let featureId, fixId, otherId, openId, cancelledId, wikiSpaceId

spec({
    requires: ["git"],
    stepwise: true,
    setupSpec() { login("john.doe") },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
})

function errorOf(name, params) {
    try { call(name, params) } catch (e) { ec.message.clearErrors(); return String(e.message) }
    const errors = ec.message.getErrorsString ? ec.message.getErrorsString() : null
    ec.message.clearErrors()
    return errors || null
}
const we = (id) => ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", id).one()
const day = (value) => value == null ? null : ec.l10n.format(value, "yyyy-MM-dd")
const countOf = (entityName, fields) => ec.entity.find(entityName).condition(fields).count()
const userIdOf = (partyId) => ec.entity.find("moqui.security.UserAccount").condition("partyId", partyId).one().userId
const releaseOf = (id) => Array.from(ec.entity.find("mantle.work.effort.WorkEffortAssoc").condition("toWorkEffortId", id)
        .condition("workEffortAssocTypeEnumId", "WeatRelease").conditionDate("fromDate", "thruDate", null).list()).map((row) => row.workEffortId)
const spaceUser = (userId) => ec.entity.find("moqui.resource.wiki.WikiSpaceUser").condition({ wikiSpaceId, userId }).one()
const text = (location) => ec.resource.getLocationReference(location).getText()
// the gitECA post events of a change run on the git pool after it commits: wait for the repository's updates
function settle() {
    const started = Date.now()
    while (Date.now() - started < 20000) {
        const busy = ["recording", "pending", "running"].reduce((sum, status) =>
            sum + countOf("moqui.resource.GitUpdate", { repositoryId, ecaStatus: status }), 0)
        if (busy == 0) return
        call("org.moqui.impl.GitServices.process#PendingGitUpdates", {})
    }
    throw new Error("the git updates did not settle")
}

feature("plan items take the next id of their kind; a release's version is its own in the project; a change keeps the due date after the start", {
    when() {
        call(`${PS}.create#Project`, { workEffortId: PROJECT, workEffortName: "Releases project", visibilityEnumId: "WevWorkGroup" })
        for (const [partyId, roleTypeId] of [[JOHN, "ProjectManager"], [JOE, "Programmer"]])
            call("create#mantle.work.effort.WorkEffortParty", { workEffortId: PROJECT, partyId, roleTypeId, fromDate: ec.user.nowTimestamp })
        const defaults = call(`${PS}.get#PlanItemDefaults`, { rootWorkEffortId: PROJECT, workEffortTypeEnumId: "WetMilestone" })
        const beta = call(`${PS}.create#Milestone`, { rootWorkEffortId: PROJECT, workEffortName: "Beta", estimatedStartDate: "2026-11-02",
            estimatedCompletionDate: "2026-12-18" }).workEffortId
        const ga = call(`${PS}.create#Milestone`, { rootWorkEffortId: PROJECT, workEffortName: "General availability" }).workEffortId
        const given = call(`${PS}.create#Milestone`, { rootWorkEffortId: PROJECT, workEffortId: "PRL-KICKOFF", workEffortName: "Kick-off" }).workEffortId
        const one = call(`${PS}.create#Release`, { rootWorkEffortId: PROJECT, workEffortName: "1.0", estimatedCompletionDate: "2026-11-20",
            description: "The first release." }).workEffortId
        const two = call(`${PS}.create#Release`, { rootWorkEffortId: PROJECT, workEffortName: "1.1", estimatedCompletionDate: "2026-12-11" }).workEffortId
        const sameVersion = errorOf(`${PS}.create#Release`, { rootWorkEffortId: PROJECT, workEffortName: "1.0" })
        const component = call(`${PS}.create#Component`, { rootWorkEffortId: PROJECT, workEffortName: "Server" }).workEffortId
        const backwards = errorOf(`${PS}.update#Milestone`, { workEffortId: beta, estimatedCompletionDate: "2026-11-01" })
        call(`${PS}.update#Milestone`, { workEffortId: beta, workEffortName: "Public beta", statusId: "WeInProgress", description: "Open to all" })
        call(`${PS}.update#Milestone`, { workEffortId: beta, clearFields: "estimatedStartDate" })
        return { defaults, beta, ga, given, one, two, sameVersion, component, backwards, betaRow: we(beta), oneRow: we(one) }
    },
    then({ defaults, beta, ga, given, one, two, sameVersion, component, backwards, betaRow, oneRow }) {
        defaults.workEffortId == "PRL-MS-1"
        beta == "PRL-MS-1"
        ga == "PRL-MS-2"
        given == "PRL-KICKOFF"
        one == "PRL-REL-1"
        two == "PRL-REL-2"
        oneRow.workEffortTypeEnumId == "WetRelease"
        oneRow.statusId == "WeInPlanning"
        oneRow.description == "The first release."
        sameVersion.includes("has a release 1.0 already")
        component == "PRL-CMP-1"
        backwards.includes("not before the start")
        betaRow.workEffortName == "Public beta"
        betaRow.statusId == "WeInProgress"
        betaRow.description == "Open to all"
        betaRow.estimatedStartDate == null
        day(betaRow.estimatedCompletionDate) == "2026-12-18"
    },
})

feature("a plan item's progress counts its items by state, with their hours and points; a cancelled item is left out", {
    when() {
        const task = (name, purposeEnumId, more) => call(`${TASK}.create#Task`, Object.assign({ rootWorkEffortId: PROJECT, workEffortName: name,
            purposeEnumId }, more || {})).workEffortId
        featureId = task("Sign in with a passkey", "WepNewFeature", { estimatedWorkTime: 8, remainingWorkTime: 2, estimatedPoints: 5 })
        fixId = task("The date picker *closes* on phones", "WepFix", { estimatedWorkTime: 2, remainingWorkTime: 1, estimatedPoints: 1 })
        otherId = task("Write the guide", "WepDocument", { estimatedWorkTime: 3, remainingWorkTime: 3, estimatedPoints: 2 })
        openId = task("Export to CSV", "WepFeatureEnhance", { estimatedWorkTime: 4, remainingWorkTime: 4, estimatedPoints: 3 })
        cancelledId = task("Dark mode", "WepNewFeature", { estimatedWorkTime: 5, remainingWorkTime: 5 })
        for (const id of [featureId, fixId, otherId, openId, cancelledId]) call(`${TASK}.set#TaskRelease`, { workEffortId: id, releaseWorkEffortId: "PRL-REL-1" })
        call(`${TASK}.set#TaskMilestone`, { workEffortId: featureId, milestoneWorkEffortId: "PRL-MS-1" })
        for (const id of [featureId, fixId, otherId]) call("update#mantle.work.effort.WorkEffort", { workEffortId: id, statusId: "WeComplete" })
        call("update#mantle.work.effort.WorkEffort", { workEffortId: openId, statusId: "WeInProgress" })
        call("update#mantle.work.effort.WorkEffort", { workEffortId: cancelledId, statusId: "WeCancelled" })
        return call(`${PS}.get#PlanItemSummary`, { workEffortIdList: ["PRL-REL-1", "PRL-MS-1", "PRL-MS-2"] }).summaryMap
    },
    then(summary) {
        const release = summary["PRL-REL-1"]
        release.itemCount == 4
        release.doneCount == 3
        release.inProgressCount == 1
        release.notStartedCount == 0
        release.cancelledCount == 1
        release.percentDone == 75
        // done items count no remaining work
        release.estimatedWorkTime == 17
        release.remainingWorkTime == 4
        release.estimatedPoints == 11
        release.donePoints == 8
        summary["PRL-MS-1"].itemCount == 1
        summary["PRL-MS-1"].percentDone == 100
        summary["PRL-MS-2"].itemCount == 0
    },
})

feature("a project's documentation space in its repository is a docs folder beside the code, its users the project's members", {
    when() {
        call("mantle.work.GitServices.create#ProjectRepository", { workEffortId: PROJECT, repositoryId, repositoryKind: "db", applyDefaults: false })
        call("org.moqui.impl.GitServices.commit#GitFiles", { repositoryId, message: "PRL code", fileMap: { "README.md": "# PRL\n", "src/app.js": "export {}\n" } })
        settle()
        const made = call(`${PS}.create#ProjectDocsSpace`, { workEffortId: PROJECT, storage: "repository", repositoryId })
        wikiSpaceId = made.wikiSpaceId
        settle()
        const setting = call(`${PS}.get#ProjectSettings`, { workEffortId: PROJECT }).settings.WstDocsWikiSpace
        const space = ec.entity.find("moqui.resource.wiki.WikiSpace").condition("wikiSpaceId", wikiSpaceId).one()
        const before = { john: spaceUser(userIdOf(JOHN)), joe: spaceUser(userIdOf(JOE)), bob: spaceUser(userIdOf(BOB)) }
        // bob joins the project, then joe leaves it
        call("create#mantle.work.effort.WorkEffortParty", { workEffortId: PROJECT, partyId: BOB, roleTypeId: "QualityAnalyst", fromDate: ec.user.nowTimestamp })
        const bobJoined = spaceUser(userIdOf(BOB))
        const joeRow = ec.entity.find("mantle.work.effort.WorkEffortParty").condition({ workEffortId: PROJECT, partyId: JOE, roleTypeId: "Programmer" }).one()
        call("update#mantle.work.effort.WorkEffortParty", { workEffortId: PROJECT, partyId: JOE, roleTypeId: "Programmer", fromDate: joeRow.fromDate,
            thruDate: ec.user.nowTimestamp })
        const joeLeft = spaceUser(userIdOf(JOE))
        // a page saved in the space is a file under docs/ of the repository, the code as it was
        call("org.moqui.impl.WikiServices.update#WikiPage", { wikiSpaceId, pageName: "GettingStarted", pageText: "# Getting started\n", versionNote: "Getting started" })
        settle()
        return { made, setting, space, before, bobJoined, joeLeft,
            home: text(`git://${repositoryId}/docs/${wikiSpaceId}.md`), page: text(`git://${repositoryId}/docs/${wikiSpaceId}/GettingStarted.md`),
            readme: text(`git://${repositoryId}/README.md`) }
    },
    then({ made, setting, space, before, bobJoined, joeLeft, home, page, readme }) {
        made.wikiSpaceId == "PRL"
        made.rootPageLocation == "git://prl-code/docs/PRL.md"
        setting == "PRL"
        space.rootPageLocation == "git://prl-code/docs/PRL.md"
        // a Work group project: members only
        space.restrictView == "Y"
        space.restrictUpdate == "Y"
        before.john.allowAdmin == "Y"
        before.joe.allowView == "Y"
        before.joe.allowUpdate == "Y"
        before.joe.allowAdmin == "N"
        before.bob == null
        bobJoined.allowUpdate == "Y"
        joeLeft == null
        home.includes("Releases project documentation")
        page == "# Getting started\n"
        readme == "# PRL\n"
    },
})

feature("a release's notes: its done items by type with their keys, how many are not done yet, its merged merge requests", {
    when() {
        // a merge request of the feature, merged, and one of the open item, closed unmerged
        const merged = call("create#moqui.resource.GitMergeRequest", { repositoryId, mergeRequestNum: 1, title: "Passkeys", sourceRef: "PRL-1-passkey",
            targetRef: "main", statusId: "GmrMerged", authorUserId: userIdOf(JOE), mergedDate: ec.user.nowTimestamp }).mergeRequestId
        const open = call("create#moqui.resource.GitMergeRequest", { repositoryId, mergeRequestNum: 2, title: "CSV export", sourceRef: "PRL-4-csv",
            targetRef: "main", statusId: "GmrClosed", authorUserId: userIdOf(JOE) }).mergeRequestId
        call("create#mantle.work.effort.WorkEffortGitMergeRequest", { workEffortId: featureId, mergeRequestId: merged, repositoryId, linkSourceEnumId: "WglsMergeRequestBranch" })
        call("create#mantle.work.effort.WorkEffortGitMergeRequest", { workEffortId: openId, mergeRequestId: open, repositoryId, linkSourceEnumId: "WglsMergeRequestBranch" })
        const draft = call(`${PS}.generate#ReleaseNotes`, { workEffortId: "PRL-REL-1" })
        const none = call(`${PS}.get#ReleaseNotes`, { workEffortId: "PRL-REL-1" })
        call(`${PS}.store#ReleaseNotes`, { workEffortId: "PRL-REL-1", notesText: draft.notesText + "\nThanks to everyone who tried the beta.\n" })
        const kept = call(`${PS}.get#ReleaseNotes`, { workEffortId: "PRL-REL-1" })
        return { draft, none, kept }
    },
    then({ draft, none, kept }) {
        draft.version == "1.0"
        draft.title == "1.0 (2026-11-20)"
        draft.itemCount == 3
        draft.mergeRequestCount == 1
        const notes = draft.notesText
        notes.startsWith("The first release.")
        notes.includes(`### Features\n\n- **${featureId}** Sign in with a passkey`)
        notes.includes(`### Fixes\n\n- **${fixId}** The date picker \\*closes\\* on phones`)
        notes.includes(`### Other\n\n- **${otherId}** Write the guide`)
        draft.openCount == 1
        !notes.includes("Export to CSV")
        !notes.includes("Dark mode")
        notes.includes(`- prl-code !1 Passkeys (${featureId})`)
        !notes.includes("CSV export")
        none.notesText == ""
        kept.notesText.includes("Thanks to everyone who tried the beta.")
        kept.workEffortContentId != null
    },
})

feature("a release: the items not done go to the next release, a tag by its version, the notes to the docs space, CHANGELOG.md and the followers", {
    when() {
        call("create#mantle.party.communication.RecordFollower", { recordEntityName: "mantle.work.effort.WorkEffort", recordId: PROJECT, userId: userIdOf(BOB) })
        const out = call(`${PS}.release#Release`, { workEffortId: "PRL-REL-1", createTag: true, repositoryId, toChangelog: true, notify: true })
        settle()
        const notes = call(`${PS}.get#ReleaseNotes`, { workEffortId: "PRL-REL-1" })
        const notices = Array.from(ec.entity.find("moqui.security.user.NotificationMessageUser").condition("userId", userIdOf(BOB)).list())
            .map((row) => ec.entity.find("moqui.security.user.NotificationMessage").condition("notificationMessageId", row.notificationMessageId).one())
            .filter((notice) => notice && notice.topic === "ReleasePublished").map((notice) => JSON.parse(notice.messageJson || "{}"))
        return { out, notes, release: we("PRL-REL-1"), notices,
            refs: Array.from(ec.entity.find("mantle.work.effort.WorkEffortGitRef").condition({ workEffortId: "PRL-REL-1", repositoryId }).list()),
            page: text(`git://${repositoryId}/docs/${wikiSpaceId}/Releases/1.0.md`), releasesPage: text(`git://${repositoryId}/docs/${wikiSpaceId}/Releases.md`),
            changelog: text(`git://${repositoryId}/CHANGELOG.md`), openRelease: releaseOf(openId), featureRelease: releaseOf(featureId),
            linked: countOf("mantle.work.effort.WikiPageWorkEffort", { workEffortId: "PRL-REL-1" }) }
    },
    then({ out, notes, release, notices, refs, page, releasesPage, changelog, openRelease, featureRelease, linked }) {
        out.movedCount == 1
        out.movedToWorkEffortId == "PRL-REL-2"
        out.tagRefName == "refs/tags/v1.0"
        out.publishedList.includes("docs")
        out.publishedList.includes("CHANGELOG.md")
        out.publishedList.includes("followers")
        out.pagePath == "Releases/1.0"
        out.commitId != null
        release.statusId == "WeComplete"
        release.actualCompletionDate != null
        openRelease == ["PRL-REL-2"]
        featureRelease == ["PRL-REL-1"]
        refs.map((ref) => ref.refName).includes("refs/tags/v1.0")
        page.startsWith("# Releases project 1.0\n")
        page.includes("## Features")
        page.includes("Thanks to everyone who tried the beta.")
        releasesPage.startsWith("# Releases")
        changelog.startsWith("# Changelog\n\n## 1.0 - ")
        changelog.includes(`- **${featureId}** Sign in with a passkey`)
        notes.pagePath == "Releases/1.0"
        notes.wikiSpaceId == wikiSpaceId
        linked == 1
        notices.length == 1
        notices[0].version == "1.0"
        notices[0].workEffortId == "PRL-REL-1"
    },
})

feature("publishing again replaces the version's section of CHANGELOG.md and makes a new version of its page", {
    when() {
        const out = call(`${PS}.publish#ReleaseNotes`, { workEffortId: "PRL-REL-1", notesText: "Only the passkeys, in the end.\n", toDocs: true, toChangelog: true, repositoryId })
        settle()
        // a repository not of the project is a warning for that way only
        const elsewhere = call(`${PS}.publish#ReleaseNotes`, { workEffortId: "PRL-REL-1", toDocs: false, toChangelog: true, repositoryId: "nowhere" })
        return { out, elsewhere, changelog: text(`git://${repositoryId}/CHANGELOG.md`), page: text(`git://${repositoryId}/docs/${wikiSpaceId}/Releases/1.0.md`) }
    },
    then({ out, elsewhere, changelog, page }) {
        elsewhere.failedList == ["CHANGELOG.md"]
        elsewhere.publishedList == []
        out.publishedList == ["docs", "CHANGELOG.md"]
        changelog.split("## 1.0 - ").length == 2
        changelog.includes("Only the passkeys, in the end.")
        !changelog.includes("Sign in with a passkey")
        page.includes("Only the passkeys, in the end.")
    },
})

feature("a documentation space on database files for a project with a short key takes the key with DOCS", {
    when() {
        call(`${PS}.create#Project`, { workEffortId: "QK", workEffortName: "Short key", visibilityEnumId: "WevGeneral" })
        const made = call(`${PS}.create#ProjectDocsSpace`, { workEffortId: "QK", storage: "db" })
        return { made, space: ec.entity.find("moqui.resource.wiki.WikiSpace").condition("wikiSpaceId", made.wikiSpaceId).one() }
    },
    then({ made, space }) {
        made.wikiSpaceId == "QKDOCS"
        made.rootPageLocation == "dbresource://WikiSpace/QKDOCS.md"
        // a General project: all internal users read it, its members change it
        space.restrictView == "N"
        space.restrictUpdate == "Y"
    },
})
