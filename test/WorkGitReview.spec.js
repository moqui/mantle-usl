// Merge requests, reviews and repository rights on projects (design-projects.md §7, §15 "Code review"; impl-projects.md P3b):
// mantle.work.GitServices create#ProjectRepository with the organization's repository defaults, check#GitRepositoryAuthz by
// project role, create#TaskBranch by the project's branch pattern, link#MergeRequestItems and complete#MergeRequestItems as the
// rules of service/WorkGit.secas.xml after the framework's review services, the review threads (create#ReviewComment,
// store#ReviewAnchor, get#ReviewThreads, resolve#ReviewThread, refresh#ReviewAnchors), get#RecordLinkInfo on a merge request,
// release tags by version (link#RefByName), the topics MergeRequestReview, MergeRequestUpdate and CommitStatusFailed, and
// search#Code. On a database repository whose commits are made through org.moqui.impl.GitServices.commit#GitFiles; a branch's
// commits are made with the branch as the default for the moment. New spec, no Groovy original.
// Run: ./moq test mantle-usl --spec WorkGitReview
const PROJECT = "GITR"
const ORG = "ORG_ZIZI_SERVICES"
const JOHN = "EX_JOHN_DOE"
const JOE = "ORG_ZIZI_JD"
const BOB = "ORG_ZIZI_BD"
let repositoryId, taskBranch, taskClose, taskOther, branchName, mergeRequestId, threadId, firstHead, outsider

spec({
    requires: ["git"],
    stepwise: true,
    setupSpec() { login("john.doe") },
    setup() { ec.artifactExecution.disableAuthz() },
    cleanup() { ec.artifactExecution.enableAuthz() },
    cleanupSpec() {
        ec.artifactExecution.disableAuthz()
        try {
            ec.entity.find("mantle.party.PartySetting").condition({ partyId: ORG, partySettingTypeId: "ProjRepositoryDefaults" }).deleteAll()
            ec.entity.find("moqui.security.UserGroupMember").condition("userGroupId", "GITR_RL").deleteAll()
            ec.entity.find("moqui.security.ArtifactAuthz").condition("artifactAuthzId", "GITR_RL").deleteAll()
            ec.entity.find("moqui.security.ArtifactGroupMember").condition("artifactGroupId", "GITR_RL").deleteAll()
            ec.entity.find("moqui.security.ArtifactGroup").condition("artifactGroupId", "GITR_RL").deleteAll()
            ec.entity.find("moqui.security.UserGroup").condition("userGroupId", "GITR_RL").deleteAll()
        } finally { ec.artifactExecution.enableAuthz() }
    },
})

const countOf = (entityName, fields) => ec.entity.find(entityName).condition(fields).count()
const workEffort = (workEffortId) => ec.entity.find("mantle.work.effort.WorkEffort").condition("workEffortId", workEffortId).one()
const userIdOf = (partyId) => ec.entity.find("moqui.security.UserAccount").condition("partyId", partyId).one().userId
// the notices of a topic a user has about this spec's repository
const notices = (userId, topic) => Array.from(ec.entity.find("moqui.security.user.NotificationMessageUser").condition("userId", userId).list())
    .map((row) => ec.entity.find("moqui.security.user.NotificationMessage").condition("notificationMessageId", row.notificationMessageId).one())
    .filter((notice) => notice && notice.topic === topic && JSON.parse(notice.messageJson || "{}").repositoryId === repositoryId)
    .map((notice) => JSON.parse(notice.messageJson || "{}"))

// the gitECA post events of a change run on the git pool after it commits: wait for the repository's updates, running
// any left pending here
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
function commitFiles(message, fileMap) {
    const out = call("org.moqui.impl.GitServices.commit#GitFiles", { repositoryId, message, fileMap })
    settle()
    return out.commitId
}
// a commit on a branch: the branch is the default for the moment
function commitOn(branch, message, fileMap) {
    call("org.moqui.impl.GitServices.update#GitRepository", { repositoryId, branch })
    try { return commitFiles(message, fileMap) } finally { call("org.moqui.impl.GitServices.update#GitRepository", { repositoryId, branch: "main" }) }
}
const authz = (userId, action) => call("mantle.work.GitServices.check#GitRepositoryAuthz", { userId, authzActionEnumId: action,
    artifactName: repositoryId }).authzTypeEnumId

feature("a project repository takes the organization's repository defaults", {
    when() {
        call("store#mantle.party.PartySetting", { partyId: ORG, partySettingTypeId: "ProjRepositoryDefaults",
            settingValue: JSON.stringify({ storage: "db", branch: "main", mergeMethod: "GmmSquash", protectDefault: "Y", requireMergeRequest: "N", approvals: 1 }) })
        call("mantle.work.ProjectServices.create#Project", { workEffortId: PROJECT, workEffortName: "Git Review Project", vendorPartyId: ORG })
        call("update#mantle.work.effort.WorkEffort", { workEffortId: PROJECT, statusFlowId: "WorkEffortDevelopment" })
        for (const [partyId, roleTypeId] of [[JOHN, "ProjectManager"], [JOE, "Programmer"]])
            call("create#mantle.work.effort.WorkEffortParty", { workEffortId: PROJECT, partyId, roleTypeId, fromDate: ec.user.nowTimestamp })
        call("mantle.work.ProjectServices.store#ProjectSetting", { workEffortId: PROJECT, settingTypeEnumId: "WstBranchPattern", settingValue: "<KEY>-<n>-<words>" })
        call("mantle.work.ProjectServices.store#ProjectSetting", { workEffortId: PROJECT, settingTypeEnumId: "WstMergeRequestMoves", settingValue: "Y" })
        taskBranch = call("mantle.work.TaskServices.create#Task", { rootWorkEffortId: PROJECT, workEffortName: "Sign in with a passkey!", statusId: "WeInProgress" }).workEffortId
        taskClose = call("mantle.work.TaskServices.create#Task", { rootWorkEffortId: PROJECT, workEffortName: "Passkey help text", statusId: "WeInProgress" }).workEffortId
        taskOther = call("mantle.work.TaskServices.create#Task", { rootWorkEffortId: PROJECT, workEffortName: "Unrelated" }).workEffortId
        repositoryId = call("mantle.work.GitServices.create#ProjectRepository", { workEffortId: PROJECT }).repositoryId
        return { repo: ec.entity.find("moqui.resource.GitRepository").condition("repositoryId", repositoryId).one(),
            rules: Array.from(ec.entity.find("moqui.resource.GitBranchRule").condition("repositoryId", repositoryId).list()) }
    },
    then({ repo, rules }) {
        repositoryId == "gitr"
        repo.repositoryKind == "db"
        repo.defaultMergeMethodEnumId == "GmmSquash"
        rules.length == 1
        rules[0].refPattern == "main"
        rules[0].allowForcePush == "N"
        rules[0].allowDelete == "N"
        rules[0].requireMergeRequest == "N"
        rules[0].requiredApprovals == 1
    },
})

feature("repository rights follow the project roles: leads delete, members push, client contacts read only when shared", {
    when() {
        const account = call("mantle.party.PartyServices.create#Account", { firstName: "Gitr", lastName: "Client",
            emailAddress: "gitr.client@test.com", username: "gitr.client", newPassword: "moqui1!!", newPasswordVerify: "moqui1!!", loginAfterCreate: false })
        outsider = account.userId
        call("create#mantle.work.effort.WorkEffortParty", { workEffortId: PROJECT, partyId: account.partyId, roleTypeId: "ClientManager", fromDate: ec.user.nowTimestamp })
        const john = userIdOf(JOHN), joe = userIdOf(JOE)
        const before = { clientView: authz(outsider, "AUTHZA_VIEW") }
        call("mantle.work.ProjectServices.store#ProjectSetting", { workEffortId: PROJECT, settingTypeEnumId: "WstShareRepositories", settingValue: "Y" })
        return { before, johnDelete: authz(john, "AUTHZA_DELETE"), joeUpdate: authz(joe, "AUTHZA_UPDATE"), joeDelete: authz(joe, "AUTHZA_DELETE"),
            clientView: authz(outsider, "AUTHZA_VIEW"), clientCreate: authz(outsider, "AUTHZA_CREATE"), bobView: authz(userIdOf(BOB), "AUTHZA_VIEW") }
    },
    then({ before, johnDelete, joeUpdate, joeDelete, clientView, clientCreate, bobView }) {
        before.clientView == "AUTHZT_NONE"
        johnDelete == "AUTHZT_ALLOW"
        joeUpdate == "AUTHZT_ALLOW"
        joeDelete == "AUTHZT_NONE"
        clientView == "AUTHZT_ALLOW"
        clientCreate == "AUTHZT_NONE"
        bobView == "AUTHZT_NONE"
    },
})

feature("a task branch is named by the project's pattern and linked to its task", {
    when() {
        firstHead = commitFiles("The first page", { "README.md": "# Git review\n", "src/login.js": "function login() {\n    return null\n}\n" })
        const name = call("mantle.work.GitServices.get#TaskBranchName", { workEffortId: taskBranch }).branchName
        const made = call("mantle.work.GitServices.create#TaskBranch", { workEffortId: taskBranch })
        branchName = made.branchName
        settle()
        let twice = ""
        try { call("mantle.work.GitServices.create#TaskBranch", { workEffortId: taskBranch }) } catch (e) { twice = String(e.message) }
        ec.message.clearErrors()
        return { name, made, twice, link: ec.entity.find("mantle.work.effort.WorkEffortGitRef")
            .condition({ workEffortId: taskBranch, repositoryId, refName: made.refName }).one() }
    },
    then({ name, made, twice, link }) {
        name == `${taskBranch}-sign-in-with-a-passkey`
        made.repositoryId == repositoryId
        made.refName == `refs/heads/${name}`
        made.commitId == firstHead
        link != null
        link.thruDate == null
        twice != ""
    },
})

feature("a merge request links the branch's task and the keys of its text, moves them to In Review and asks its reviewers", {
    when() {
        commitOn(branchName, `Passkeys for ${taskBranch}`, { "src/login.js": "function login(passkey) {\n    return passkey\n}\n" })
        // Projects Home's reviews waiting on john (get#ProjectHomeCounts)
        const waitingBefore = call("mantle.work.ProjectServices.get#ProjectHomeCounts", {}).counts.reviewsWaiting
        login("joe.developer")
        try {
            const made = call("org.moqui.impl.GitReviewServices.create#MergeRequest", { repositoryId, sourceRef: branchName,
                title: `Sign in with a passkey (${taskBranch})`, description: `Closes ${taskClose}\n\nNot ${PROJECT}-NOPE.`,
                reviewerUserIdList: [userIdOf(JOHN)] })
            mergeRequestId = made.mergeRequestId
        } finally { login("john.doe") }
        const links = Array.from(ec.entity.find("mantle.work.effort.WorkEffortGitMergeRequest").condition("mergeRequestId", mergeRequestId).orderBy("workEffortId").list())
        return { links, branchTask: workEffort(taskBranch), closeTask: workEffort(taskClose), asked: notices(userIdOf(JOHN), "MergeRequestReview"),
            items: call("mantle.work.GitServices.get#MergeRequestItems", { mergeRequestId }).itemList, waitingBefore,
            waitingAfter: call("mantle.work.ProjectServices.get#ProjectHomeCounts", {}).counts.reviewsWaiting }
    },
    then({ links, branchTask, closeTask, asked, items, waitingBefore, waitingAfter }) {
        waitingAfter == waitingBefore + 1
        links.map((link) => link.workEffortId) == [taskBranch, taskClose].sort()
        links.find((link) => link.workEffortId == taskBranch).linkSourceEnumId == "WglsMergeRequestBranch"
        links.find((link) => link.workEffortId == taskClose).linkSourceEnumId == "WglsMergeRequestText"
        // the project moves every item on merge (WstMergeRequestMoves)
        links.every((link) => link.completeOnMerge == "Y")
        branchTask.statusId == "WeInReview"
        closeTask.statusId == "WeInReview"
        asked.length == 1
        asked[0].mergeRequestId == mergeRequestId
        asked[0].mergeRequestNum == 1
        items.length == 2
    },
})

feature("an edit of the description drops a key taken out and keeps the branch's task", {
    when() {
        call("org.moqui.impl.GitReviewServices.update#MergeRequest", { mergeRequestId, description: `Fixes ${taskOther}` })
        const ids = Array.from(ec.entity.find("mantle.work.effort.WorkEffortGitMergeRequest").condition("mergeRequestId", mergeRequestId)
            .orderBy("workEffortId").list()).map((link) => link.workEffortId)
        call("org.moqui.impl.GitReviewServices.update#MergeRequest", { mergeRequestId, description: `Closes ${taskClose}` })
        return { ids, after: Array.from(ec.entity.find("mantle.work.effort.WorkEffortGitMergeRequest").condition("mergeRequestId", mergeRequestId)
            .orderBy("workEffortId").list()).map((link) => link.workEffortId) }
    },
    then({ ids, after }) {
        ids == [taskBranch, taskOther].sort()
        after == [taskBranch, taskClose].sort()
    },
})

feature("a line comment is anchored and filed on the merge request, replied to and resolved; its record is the repository's viewers'", {
    when() {
        const made = call("mantle.work.GitServices.create#ReviewComment", { mergeRequestId, body: "Check the passkey first", path: "src/login.js",
            newLine: 2, lineText: "    return passkey" })
        threadId = made.communicationEventId
        login("joe.developer")
        try {
            call("mantle.work.GitServices.create#ReviewComment", { mergeRequestId, body: "Done in the next commit", parentCommEventId: threadId })
        } finally { login("john.doe") }
        const threads = call("mantle.work.GitServices.get#ReviewThreads", { mergeRequestId }).threadList
        call("mantle.work.GitServices.resolve#ReviewThread", { communicationEventId: threadId })
        const resolved = call("mantle.work.GitServices.get#ReviewThreads", { mergeRequestId, path: "src/login.js" }).threadList[0].resolved
        call("mantle.work.GitServices.resolve#ReviewThread", { communicationEventId: threadId, resolved: false })
        // with authorization on, get#RecordLinkInfo authorized for joe and bob by a group of this spec: a member sees the
        // merge request and the comment, a stranger does not
        call("create#moqui.security.UserGroup", { userGroupId: "GITR_RL", description: "Git review record links" })
        call("create#moqui.security.ArtifactGroup", { artifactGroupId: "GITR_RL", description: "Git review record links" })
        call("create#moqui.security.ArtifactGroupMember", { artifactGroupId: "GITR_RL", artifactTypeEnumId: "AT_SERVICE",
            artifactName: "mantle.party.CommunicationServices.get#RecordLinkInfo", nameIsPattern: "N", inheritAuthz: "Y" })
        call("create#moqui.security.ArtifactAuthz", { artifactAuthzId: "GITR_RL", userGroupId: "GITR_RL", artifactGroupId: "GITR_RL",
            authzTypeEnumId: "AUTHZT_ALLOW", authzActionEnumId: "AUTHZA_ALL" })
        for (const partyId of [JOE, BOB]) call("create#moqui.security.UserGroupMember", { userGroupId: "GITR_RL", userId: userIdOf(partyId),
            fromDate: ec.user.nowTimestamp })
        ec.artifactExecution.enableAuthz()
        let joeSees, strangerSees, commentSees
        try {
            login("joe.developer")
            joeSees = call("mantle.party.CommunicationServices.get#RecordLinkInfo", { recordEntityName: "moqui.resource.GitMergeRequest",
                recordId: mergeRequestId, checkOnly: true }).recordVisible
            commentSees = call("mantle.party.CommunicationServices.get#RecordLinkInfo", { recordEntityName: "mantle.party.communication.CommunicationEvent",
                recordId: threadId, checkOnly: true }).recordVisible
            login("bob.developer")
            strangerSees = call("mantle.party.CommunicationServices.get#RecordLinkInfo", { recordEntityName: "moqui.resource.GitMergeRequest",
                recordId: mergeRequestId, checkOnly: true }).recordVisible
        } finally { login("john.doe"); ec.artifactExecution.disableAuthz() }
        return { threads, resolved, joeSees, strangerSees, commentSees, commented: notices(userIdOf(JOHN), "MergeRequestUpdate"),
            root: ec.entity.find("mantle.party.communication.CommunicationEvent").condition("communicationEventId", threadId).one() }
    },
    then({ threads, resolved, joeSees, strangerSees, commentSees, commented, root }) {
        threads.length == 1
        threads[0].path == "src/login.js"
        threads[0].newLine == 2
        !threads[0].outdated
        threads[0].commentList.length == 2
        threads[0].commentList[1].body == "Done in the next commit"
        resolved
        root.statusId == "CeSent"
        root.communicationEventTypeId == "Comment"
        joeSees
        commentSees
        !strangerSees
        // joe's reply tells the author's reviewer, john
        commented.some((notice) => notice.change == "commented")
    },
})

feature("a new commit on the source marks the thread on a changed line outdated and tells the author", {
    when() {
        commitOn(branchName, "Check the passkey", { "src/login.js": "function login(passkey) {\n    return passkey && passkey.valid\n}\n" })
        const mr = ec.entity.find("moqui.resource.GitMergeRequest").condition("mergeRequestId", mergeRequestId).one()
        return { thread: call("mantle.work.GitServices.get#ReviewThreads", { mergeRequestId }).threadList[0], mr,
            updates: notices(userIdOf(JOE), "MergeRequestUpdate").map((notice) => notice.change) }
    },
    then({ thread, mr, updates }) {
        thread.outdated
        mr.headCommitId != firstHead
        updates.includes("pushed new commits")
    },
})

feature("a failed check tells the commit's author; an approval and the merge complete the linked items", {
    when() {
        const mr = ec.entity.find("moqui.resource.GitMergeRequest").condition("mergeRequestId", mergeRequestId).one()
        call("org.moqui.impl.GitServices.create#GitCommitStatus", { repositoryId, commitId: mr.headCommitId, state: "failure", context: "ci/build",
            description: "Build failed" })
        const failed = notices(userIdOf(JOE), "CommitStatusFailed")
        call("org.moqui.impl.GitReviewServices.submit#MergeRequestReview", { mergeRequestId, decision: "approve", note: "Looks good" })
        const approvedNotice = notices(userIdOf(JOE), "MergeRequestUpdate").map((notice) => notice.change)
        const merged = call("org.moqui.impl.GitReviewServices.merge#MergeRequest", { mergeRequestId })
        settle()
        return { failed, approvedNotice, merged, after: ec.entity.find("moqui.resource.GitMergeRequest").condition("mergeRequestId", mergeRequestId).one(),
            branchTask: workEffort(taskBranch), closeTask: workEffort(taskClose), other: workEffort(taskOther),
            mergedNotice: notices(userIdOf(JOE), "MergeRequestUpdate").map((notice) => notice.change) }
    },
    then({ failed, approvedNotice, merged, after, branchTask, closeTask, other, mergedNotice }) {
        failed.length == 1
        failed[0].checkContext == "ci/build"
        failed[0].stateLabel == "failed"
        approvedNotice.includes("approved")
        merged.mergeMethodEnumId == "GmmSquash"
        after.statusId == "GmrMerged"
        branchTask.statusId == "WeComplete"
        closeTask.statusId == "WeComplete"
        closeTask.resolutionEnumId == "WerCompleted"
        other.statusId != "WeComplete"
        mergedNotice.includes("merged")
    },
})

feature("a tag named as a release's version links the release", {
    when() {
        const release = call("create#mantle.work.effort.WorkEffort", { workEffortId: `${PROJECT}-REL-1`, workEffortTypeEnumId: "WetRelease",
            rootWorkEffortId: PROJECT, workEffortName: "2.0", statusId: "WeInPlanning" }).workEffortId
        const made = call("org.moqui.impl.GitServices.create#GitRef", { repositoryId, refName: "v2.0", refType: "tag", message: "Release 2.0" })
        settle()
        call("mantle.work.GitServices.link#RefByName", { repositoryId, refName: "refs/tags/2.0.1", newId: made.commitId, tag: { commitId: made.commitId, annotated: false } })
        return { release, refs: Array.from(ec.entity.find("mantle.work.effort.WorkEffortGitRef").condition({ workEffortId: release }).orderBy("refName").list()) }
    },
    then({ release, refs }) {
        release == "GITR-REL-1"
        refs.map((ref) => ref.refName) == ["refs/tags/v2.0"]
        refs[0].linkSourceEnumId == "WglsReleaseVersion"
    },
})

feature("the palette's Code group finds the repository by name and the merge request by number and title", {
    when() {
        return { byName: call("mantle.work.GitServices.search#Code", { text: "gitr" }).resultList,
            byNumber: call("mantle.work.GitServices.search#Code", { text: "!1" }).resultList,
            byTitle: call("mantle.work.GitServices.search#Code", { text: "passkey" }).resultList }
    },
    then({ byName, byNumber, byTitle }) {
        byName.some((row) => row.kind == "repository" && row.repositoryId == "gitr")
        byNumber.some((row) => row.kind == "mergeRequest" && row.mergeRequestId == mergeRequestId)
        byNumber.every((row) => row.kind == "mergeRequest")
        byTitle.some((row) => row.kind == "mergeRequest" && row.title.includes("passkey"))
    },
})
